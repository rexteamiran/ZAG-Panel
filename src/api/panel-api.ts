import { PanelApiKey, PanelLimits } from '#types/settings';
import { authenticate } from '@auth';
import { HttpStatus, respond, safeError } from '@common';
import { activeDevices, evaluateAccess, panelStatus } from '@limits';
import { getGlobals, getKvSettings, getSettings, setSettings, subscriptions } from '@settings';
import { recordError } from '@settings/errorlog';
import { updateDataset } from '@kv';
import { validateSettings } from '@validators';
import { KvSettings, PanelSettings } from '#types/settings';
import {
    getLimits,
    getUsageSnapshot,
    resetUsage,
    saveLimits,
    usageHistory,
    withPending
} from '@usage';
import { fallback } from '@handlers/utils';
import { settingsTemplates } from '@templates';
import {
    allTemplates,
    getTemplateStore,
    sanitiseTemplateSettings,
    saveTemplateStore,
    CustomTemplate
} from '@templates-store';
import { buildScript } from '@main';
import { deployPages } from '@api/pages';
import { deployWorkers } from '@api/workers';

/* ==========================================================================
   Machine API

   Everything the ZAGROOO Wizard needs to manage this panel remotely. Reads
   and writes are authenticated with a panel API key; key management itself
   requires an admin session so a leaked key cannot mint more keys.

   Bootstrapping: the wizard holds the Cloudflare API token, so it seeds the
   first key by writing the `limits` record through the KV/D1 REST API.
   ========================================================================== */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const attempts = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
    const now = Date.now();

    // Entries were only ever overwritten, never removed, so the map grew for
    // the isolate's lifetime. Sweep expired windows occasionally.
    if (attempts.size > 1000) {
        for (const [key, value] of attempts) {
            if (now - value.windowStart > RATE_LIMIT_WINDOW_MS) attempts.delete(key);
        }
    }

    const record = attempts.get(ip);

    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
        attempts.set(ip, { count: 1, windowStart: now });
        return false;
    }

    record.count += 1;
    return record.count > RATE_LIMIT_MAX;
}

export async function sha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomKey(): string {
    const buffer = new Uint8Array(32);
    crypto.getRandomValues(buffer);
    return Array.from(buffer, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare so a timing side channel cannot leak the stored hash. */
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

async function authenticateApiKey(request: Request, limits: PanelLimits): Promise<PanelApiKey | null> {
    const header = request.headers.get('Authorization') ?? '';
    const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!raw) return null;

    const hash = await sha256(raw);
    return limits.panelApiKeys.find(key => safeEqual(key.hash, hash)) ?? null;
}

/* ==========================================================================
   Router
   ========================================================================== */

export async function handlePanelApi(request: Request, env: Env): Promise<Response> {
    return withCors(await routePanelApi(request, env));
}

async function routePanelApi(request: Request, env: Env): Promise<Response> {
    const { pathname } = getGlobals();
    const route = pathname.split('/')[3] ?? '';

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
        const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
        if (rateLimited(ip)) {
            return respond(false, HttpStatus.FORBIDDEN, 'Too many API requests, slow down.');
        }

        await setSettings(env);
        const limits = await getLimits(env);

        // Key management is session-only: an API key must not be able to mint
        // another one, and the wizard seeds the first key out of band.
        if (route === 'keys') {
            const session = await authenticate(request, env);
            if (!session) return respond(false, HttpStatus.UNAUTHORIZED, 'Admin session required.');
            return handleKeys(request, env, limits);
        }

        const key = await authenticateApiKey(request, limits);
        const session = key ? null : await authenticate(request, env);
        if (!key && !session) {
            return respond(false, HttpStatus.UNAUTHORIZED, 'Invalid or missing API key.');
        }

        if (key) {
            // This used to write on every request, including plain GETs. At the
            // 120 req/min rate limit that exhausts a KV-only panel's 1 000
            // writes/day in about nine minutes, after which usage flushes stop
            // persisting too. Hourly resolution is all this field is read at.
            const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;
            const now = Date.now();

            if (now - (key.lastUsed ?? 0) > LAST_USED_RESOLUTION_MS) {
                key.lastUsed = now;
                await saveLimits(env, limits);
            }
        }

        switch (route) {
            case 'status':
                return getStatus(env, limits);

            case 'usage':
                return getUsage(request, env);

            case 'limits':
                return request.method === 'GET'
                    ? respond(true, HttpStatus.OK, '', publicLimits(limits))
                    : patchLimits(request, env, limits);

            case 'pause':
                return setPaused(request, env, limits, true);

            case 'resume':
                return setPaused(request, env, limits, false);

            case 'reset-usage':
                return doResetUsage(request, env);

            case 'update':
                return updateSelf(request, env);

            case 'links':
                return getLinks(limits);

            case 'templates':
                return request.method === 'GET'
                    ? getTemplates(env)
                    : saveTemplates(request, env);

            case 'settings':
                return request.method === 'GET'
                    ? respond(true, HttpStatus.OK, '', { settings: shareableSettings() })
                    : applySettings(request, env);

        default:
            return fallback(request);
        }
    } catch (error) {
        await recordError(env, 'api', safeError(error), `Route: ${getGlobals().pathname}`);
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `API error: ${safeError(error)}`);
    }
}

/**
 * The preflight already answered with CORS, so the real response needs it too
 * — otherwise the browser passes the preflight and then blocks the answer.
 */
function withCors(response: Response): Response {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
}

function corsHeaders(): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': '*',
        // PUT carries settings writes from the dashboard, which talks to this
        // API directly from the browser.
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
    };
}

/** Limits minus the secrets: key hashes never leave. */
function publicLimits(limits: PanelLimits) {
    const { panelApiKeys, ...rest } = limits;
    return { ...rest, apiKeyCount: panelApiKeys.length };
}

/* ==========================================================================
   Handlers
   ========================================================================== */

async function getStatus(env: Env, limits: PanelLimits): Promise<Response> {
    const usage = withPending(await getUsageSnapshot(env));
    const { hostname, accEmail, deployType, mainDomain } = getGlobals();
    const { customDomain } = getKvSettings();
    return respond(true, HttpStatus.OK, '', {
        panel: {
            version: VERSION,
            host: customDomain || hostname || mainDomain,
            deployType,
            account: accEmail,
            storage: 'd1'
        },
        limits: publicLimits(limits),
        usage: {
            up: usage.upBytes,
            down: usage.downBytes,
            total: usage.totalBytes,
            daily: usage.dailyBytes,
            day: usage.day,
            updatedAt: usage.updatedAt
        },
        status: panelStatus(limits, usage),
        access: evaluateAccess(limits, usage),
        devices: activeDevices()
    });
}

async function getUsage(request: Request, env: Env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10) || 30, 1), 30);
    const usage = withPending(await getUsageSnapshot(env));

    return respond(true, HttpStatus.OK, '', {
        up: usage.upBytes,
        down: usage.downBytes,
        total: usage.totalBytes,
        daily: usage.dailyBytes,
        day: usage.day,
        updatedAt: usage.updatedAt,
        history: usageHistory(usage, days)
    });
}

/** Whitelisted, coerced and clamped — nothing else from the body is honoured. */
async function patchLimits(request: Request, env: Env, limits: PanelLimits): Promise<Response> {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return respond(false, HttpStatus.BAD_REQUEST, 'Expected a JSON body.');

    const next: PanelLimits = { ...limits };
    const num = (value: unknown, min = 0) => {
        const parsed = Math.floor(Number(value));
        return Number.isFinite(parsed) && parsed >= min ? parsed : null;
    };

    const numericFields: Array<keyof PanelLimits> = [
        'limitTotalBytes',
        'limitDailyBytes',
        'downSpeedKbps',
        'upSpeedKbps',
        'expireAt',
        'maxDevices'
    ];

    for (const field of numericFields) {
        if (body[field] === undefined) continue;
        const value = num(body[field]);
        if (value === null) return respond(false, HttpStatus.BAD_REQUEST, `${field} must be a non-negative integer.`);
        (next[field] as number) = value;
    }

    if (body.displayName !== undefined) next.displayName = String(body.displayName).slice(0, 64);
    // The label a dashboard profile stamps onto the panel, display only.
    if (body.zagiroName !== undefined) next.zagiroName = String(body.zagiroName).slice(0, 60);
    if (body.monthlyReset !== undefined) next.monthlyReset = Boolean(body.monthlyReset);
    if (body.showStatusNodes !== undefined) next.showStatusNodes = Boolean(body.showStatusNodes);
    if (body.alertQuota !== undefined) next.alertQuota = Boolean(body.alertQuota);
    if (body.alertExpiry !== undefined) next.alertExpiry = Boolean(body.alertExpiry);

    if (body.monthlyResetDay !== undefined) {
        const day = num(body.monthlyResetDay, 1);
        if (day === null || day > 28) return respond(false, HttpStatus.BAD_REQUEST, 'monthlyResetDay must be 1-28.');
        next.monthlyResetDay = day;
    }

    // Raising a limit should bring a panel that hit that limit back to life.
    if (next.isPaused) {
        const usage = withPending(await getUsageSnapshot(env));
        const verdict = evaluateAccess({ ...next, isPaused: false }, usage);
        if (verdict.allowed) {
            next.isPaused = false;
            next.pauseReason = '';
            next.pausedAt = 0;
        }
    }

    // A fresh quota or expiry means the old alerts no longer apply.
    next.alertState = { quota80: false, quota100: false, expirySoon: false };

    await saveLimits(env, next);
    return respond(true, HttpStatus.OK, 'Limits updated.', publicLimits(next));
}

async function setPaused(request: Request, env: Env, limits: PanelLimits, paused: boolean): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const body = await request.json().catch(() => ({})) as { reason?: string };
    const next: PanelLimits = {
        ...limits,
        isPaused: paused,
        pauseReason: paused ? String(body.reason ?? 'Paused from the wizard.').slice(0, 200) : '',
        pausedAt: paused ? Date.now() : 0
    };

    await saveLimits(env, next);
    return respond(true, HttpStatus.OK, paused ? 'Panel paused.' : 'Panel resumed.', publicLimits(next));
}

async function doResetUsage(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const body = await request.json().catch(() => ({})) as { scope?: string };
    const scope = body.scope === 'daily' ? 'daily' : 'all';
    const usage = await resetUsage(env, scope);

    // Zeroing the counters removes the reason the panel paused itself, so it
    // must not stay dead until someone separately presses Resume.
    const limits = await getLimits(env);
    if (limits.isPaused && limits.pausedBy && limits.pausedBy !== 'manual') {
        await saveLimits(env, { ...limits, isPaused: false, pauseReason: '', pausedBy: '', pausedAt: 0 });
    }

    return respond(true, HttpStatus.OK, `Usage reset (${scope}).`, {
        total: usage.totalBytes,
        daily: usage.dailyBytes
    });
}

/**
 * Redeploys this panel from the latest released script, keeping its identity.
 * Key-authenticated, so the dashboard can update panels without a Cloudflare
 * token. `deployWorkers` re-binds `zag_db` from the embedded database id, so
 * the panel stays attached to the shared store.
 */
async function updateSelf(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    try {
        const script = await buildScript(true);
        const { deployType } = getGlobals();

        if (deployType === 'pages') {
            // Pages deployments are project-level; bindings live on the
            // project config and survive the upload, so a plain redeploy works.
            await deployPages(script);
        } else {
            await deployWorkers(script);
        }

        return respond(true, HttpStatus.OK, 'Panel updated to the latest release.');
    } catch (error) {
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Update failed: ${safeError(error)}`);
    }
}

function getLinks(limits: PanelLimits): Response {
    const { origin, securePath } = getGlobals();
    const { customDomain } = getKvSettings();
    const base = customDomain ? `https://${customDomain}` : origin;

    const subs = Object.entries(subscriptions).flatMap(([path, category]) =>
        category.categories.map(entry => ({
            type: category.label,
            core: entry.core,
            clients: entry.clients,
            url: `${base}/${securePath}/sub/${path}?app=${entry.core}`
        }))
    );

    return new Response(JSON.stringify({
        success: true,
        body: {
            portal: `${base}/${securePath}/sub/${limits.subToken}`,
            subscriptions: subs
        }
    }), {
        status: HttpStatus.OK,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}

/* ==========================================================================
   Key management (admin session only)
   ========================================================================== */

async function handleKeys(request: Request, env: Env, limits: PanelLimits): Promise<Response> {
    if (request.method === 'GET') {
        return respond(true, HttpStatus.OK, '', {
            keys: limits.panelApiKeys.map(({ hash, ...rest }) => rest)
        });
    }

    if (request.method === 'POST') {
        if (limits.panelApiKeys.length >= 10) {
            return respond(false, HttpStatus.BAD_REQUEST, 'Key limit reached, revoke one first.');
        }

        const body = await request.json().catch(() => ({})) as { name?: string };
        const raw = randomKey();
        const key: PanelApiKey = {
            id: crypto.randomUUID(),
            name: String(body.name ?? 'Wizard').slice(0, 40),
            hash: await sha256(raw),
            createdAt: Date.now(),
            lastUsed: 0
        };

        await saveLimits(env, { ...limits, panelApiKeys: [...limits.panelApiKeys, key] });

        // The only time the raw key is ever returned.
        return respond(true, HttpStatus.OK, 'API key created.', { id: key.id, name: key.name, key: raw });
    }

    if (request.method === 'DELETE') {
        const body = await request.json().catch(() => ({})) as { id?: string };
        const remaining = limits.panelApiKeys.filter(key => key.id !== body.id);
        if (remaining.length === limits.panelApiKeys.length) {
            return respond(false, HttpStatus.NOT_FOUND, 'No such API key.');
        }

        await saveLimits(env, { ...limits, panelApiKeys: remaining });
        return respond(true, HttpStatus.OK, 'API key revoked.');
    }

    return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
}

/* ==========================================================================
   Proxy settings

   What a ZagiRo profile carries. Deliberately a subset of KvSettings:

   - customDomain and panelVersion are specific to one panel and must never be
     copied onto another.
   - remoteSettings would make the panel follow a third party's settings.
   - Everything in EMBEDED_SETTINGS (UUID, secure path, proxy IPs, DoH URL) is
     baked into the deployed script, so changing it means redeploying the
     worker. Profiles stay in KV so applying one is instant and reversible.
   ========================================================================== */

const PER_PANEL_KEYS: Array<keyof KvSettings> = ['customDomain', 'remoteSettings', 'panelVersion'];

/**
 * Recomputed by updateDataset() from the fields they derive from. Carrying
 * them between panels writes a stale value that the target will not refresh,
 * because it only recomputes when the source field changed.
 */
const DERIVED_KEYS: Array<keyof KvSettings> = ['remoteDnsHost', 'upstreamParams', 'chainProxyParams'];

const NOT_SHAREABLE = new Set<string>([...PER_PANEL_KEYS, ...DERIVED_KEYS]);

function shareableSettings(): Partial<KvSettings> {
    const settings = getKvSettings();
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(settings)) {
        if (NOT_SHAREABLE.has(key)) continue;
        out[key] = value;
    }

    return out as Partial<KvSettings>;
}

async function applySettings(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'PUT' && request.method !== 'PATCH') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Use PUT or PATCH.');
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
        return respond(false, HttpStatus.BAD_REQUEST, 'Expected a JSON body.');
    }

    const patch = (body.settings ?? body) as Record<string, unknown>;
    const current = getSettings() as PanelSettings;
    const merged: PanelSettings = { ...current };

    // Only keys the panel already knows about, and never the per-panel ones.
    const known = Object.keys(getKvSettings()) as Array<keyof KvSettings>;
    const applied: string[] = [];

    for (const key of known) {
        if (NOT_SHAREABLE.has(key)) continue;
        if (patch[key] === undefined) continue;
        (merged as any)[key] = patch[key];
        applied.push(key);
    }

    if (!applied.length) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Nothing in the profile applies to this panel.');
    }

    // Same validation the admin UI goes through, so a bad profile is refused
    // rather than written and left to break the panel.
    const errors = validateSettings(merged);
    if (errors) return respond(false, HttpStatus.BAD_REQUEST, 'Validation error', errors);

    // updateDataset only - deliberately not updateMainSettings, which would
    // rebuild and redeploy the worker.
    await updateDataset(env, merged);

    return respond(true, HttpStatus.OK, `Applied ${applied.length} settings.`, { applied });
}

/* ==========================================================================
   Templates

   Built-ins ship inside the worker; custom ones and the customer-visible set
   live in the panel's D1 store. The admin UI, the subscriber portal and the
   dashboard all read the same list from here.
   ========================================================================== */

async function getTemplates(env: Env): Promise<Response> {
    const [store, templates] = await Promise.all([getTemplateStore(env), allTemplates(env)]);

    return respond(true, HttpStatus.OK, '', {
        templates: templates.map(template => ({
            id: template.id,
            family: template.family,
            name: template.name,
            description: template.description,
            warning: template.warning ?? null,
            requiresOrigin: template.requiresOrigin ?? null,
            builtIn: settingsTemplates.some(builtIn => builtIn.id === template.id),
            settings: template.settings
        })),
        enabled: store.enabled,
        custom: store.custom
    });
}

/**
 * Saves the customer-visible set and the operator's own templates.
 *
 * This is also the import path, so anything a template must never carry is
 * stripped here rather than trusted — an imported file is just as untrusted as
 * a request body.
 */
async function saveTemplates(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'PUT' && request.method !== 'PATCH') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Use PUT or PATCH.');
    }

    const body = await request.json().catch(() => null) as {
        enabled?: unknown;
        custom?: unknown;
        merge?: boolean;
    } | null;

    if (!body) return respond(false, HttpStatus.BAD_REQUEST, 'Expected a JSON body.');

    const current = await getTemplateStore(env);
    const dropped: string[] = [];
    const rejected: string[] = [];

    let custom: CustomTemplate[] = current.custom;

    if (Array.isArray(body.custom)) {
        const cleaned: CustomTemplate[] = [];

        for (const entry of body.custom as any[]) {
            const name = String(entry?.name ?? '').trim().slice(0, 60);

            if (!name || typeof entry?.settings !== 'object' || entry.settings === null) {
                rejected.push(name || '(unnamed)');
                continue;
            }

            const { settings, dropped: stripped } = sanitiseTemplateSettings(entry.settings);
            dropped.push(...stripped);

            cleaned.push({
                id: String(entry.id ?? crypto.randomUUID()),
                name,
                description: String(entry.description ?? '').slice(0, 200),
                createdAt: Number(entry.createdAt) || Date.now(),
                settings
            });
        }

        // An import can add to what is already there rather than replacing it.
        if (body.merge) {
            const byId = new Map(current.custom.map(template => [template.id, template]));
            for (const template of cleaned) byId.set(template.id, template);
            custom = [...byId.values()];
        } else {
            custom = cleaned;
        }
    }

    // Only ids that exist, so a deleted template cannot leave a dead link on
    // the portal.
    const known = new Set([
        ...settingsTemplates.map(template => template.id),
        ...custom.map(template => template.id)
    ]);

    const enabled = Array.isArray(body.enabled)
        ? [...new Set((body.enabled as unknown[]).map(String))].filter(id => known.has(id))
        : current.enabled.filter(id => known.has(id));

    await saveTemplateStore(env, { enabled, custom });

    const notes: string[] = [];
    if (dropped.length) notes.push(`ignored fields that cannot move between panels: ${[...new Set(dropped)].join(', ')}`);
    if (rejected.length) notes.push(`skipped ${rejected.length} invalid template(s): ${rejected.join(', ')}`);

    return respond(true, HttpStatus.OK, notes.join('; ') || 'Templates saved.', {
        enabled,
        custom,
        dropped: [...new Set(dropped)],
        rejected
    });
}
