import { getClNormalConfig, getClWarpConfig } from '@cores/clash/configs';
import { getURLConfigs } from '@cores/common';
import { getSbCustomConfig, getSbWarpConfig } from '@cores/sing-box/configs';
import { getXrCustomConfigs, getXrWarpConfigs } from '@cores/xray/configs';
import { setSettings, getGlobals, getKvSettings, getBaseSettings, getSharedSettings, clients, subscriptions } from '@settings';
import { withSettings } from '@settings/overlay';
import { resolveTemplate, enabledTemplates } from '@templates-store';
import { fallback } from './utils';
import { decideRoute } from './formats';
import { getWireguardConfigs } from '@cores/wireguard';
import { decompressGzipBase64, HttpStatus } from '@common';
import { SharedSettings } from '#types/settings';
import { activeDevices, panelStatus } from '@limits';
import { bindContext, getLimits, getUsageSnapshot, saveLimits, usageHistory, withPending } from '@usage';
import { checkAlerts } from '@api/telegram';

export async function handleSubscriptions(request: Request, env: Env): Promise<Response> {
    const response = await routeSubscription(request, env);

    // Clients read these off any subscription fetch to draw their own usage
    // bar, so they ride along with every format, not just the portal — but
    // only on a real subscription. Stamping them onto a 404 or the operator's
    // decoy fallback page leaked the customer's byte counts to whoever asked.
    if (response.headers.has('subscription-userinfo')) return response;
    if (!response.ok) return response;

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(await subscriptionHeaders(env))) {
        headers.set(key, value);
    }

    return new Response(response.body, { status: response.status, headers });
}

async function routeSubscription(request: Request, env: Env): Promise<Response> {
    await setSettings(env);
    bindContext(env);
    const { pathname, client } = getGlobals();
    const path = pathname.split('/')[3];
    const limits = await getLimits(env);

    // The portal lives at /{securePath}/sub/{subToken}. Config formats own
    // the reserved words below, so an unrecognised segment that matches the
    // token is the portal and anything else falls through to 404.
    if (path && path === limits.subToken) {
        return renderPortal(env);
    }

    const decision = decideRoute(path, client);

    switch (decision.kind) {
        case 'share':
            return shareSettings();

        case 'unknown':
            return fallback(request);

        case 'unsupported':
            // This used to fall through to the next format, and eventually to
            // share-settings, which handed the customer the operator's own
            // settings. Say what is wrong instead.
            return new Response(
                client
                    ? `Client "${client}" does not support the "${decision.format}" format. Supported: ${decision.supported.join(', ')}.`
                    : `Missing ?app= parameter. Supported clients for "${decision.format}": ${decision.supported.join(', ')}.`,
                { status: HttpStatus.BAD_REQUEST, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
            );

        case 'config':
            return buildTemplatedConfig(decision.format, decision.client, env);
    }
}

/**
 * Serves a subscription under a template, when the link asks for one.
 *
 * The overlay is applied for the life of this request only, so two customers
 * following two different template links get two different configurations from
 * the same panel, and neither changes what the panel has stored.
 */
async function buildTemplatedConfig(format: string, client: string, env: Env): Promise<Response> {
    const { searchParams } = getGlobals();
    const templateId = searchParams.get('tpl') ?? '';
    if (!templateId) return buildConfig(format, client, env);

    const overlay = await resolveTemplate(env, templateId);
    if (!overlay) {
        return new Response(`Unknown template "${templateId}".`, {
            status: HttpStatus.BAD_REQUEST,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }

    const scoped = { ...getBaseSettings(), ...overlay };
    return withSettings(scoped, async () => buildConfig(format, client, env));
}

function buildConfig(format: string, client: string, env: Env): Promise<Response> | Response {
    switch (format) {
        case 'normal':
            if (client === 'xray') return getXrCustomConfigs(false);
            if (client === 'sing-box') return getSbCustomConfig(false);
            return getClNormalConfig();

        case 'fragment':
            return client === 'xray' ? getXrCustomConfigs(true) : getSbCustomConfig(true);

        case 'raw':
            return getURLConfigs(env);

        case 'warp':
            if (client === 'xray') return getXrWarpConfigs(false, false);
            if (client === 'sing-box') return getSbWarpConfig();
            if (client === 'clash') return getClWarpConfig(false);
            return getWireguardConfigs(false);

        default:
            if (client === 'xray') return getXrWarpConfigs(true, false);
            if (client === 'xray-knocker') return getXrWarpConfigs(true, true);
            if (client === 'clash') return getClWarpConfig(true);
            return getWireguardConfigs(true);
    }
}

async function shareSettings() {
    const sharedSettings: SharedSettings = getSharedSettings();
    const body = btoa(JSON.stringify(sharedSettings));

    return new Response(body, {
        status: HttpStatus.OK,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename=${_project_SM_}-settings.dat`,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
    });
}
/* ==========================================================================
   Subscriber portal
   ========================================================================== */

async function renderPortal(env: Env): Promise<Response> {
    const limits = await getLimits(env);
    const usage = withPending(await getUsageSnapshot(env));
    const { origin, securePath, vlUUID } = getGlobals();
    const { customDomain } = getKvSettings();
    const base = customDomain ? `https://${customDomain}` : origin;

    // Quota and expiry alerts ride on portal views and proxy traffic, since
    // Workers give us no timer to check them on.
    const updated = await checkAlerts(env, limits, usage);
    if (updated) await saveLimits(env, updated);

    // The customer picks a connection type first, then a template — so the
    // portal needs the formats as a list, and each enabled template's links
    // within each format.
    const formats = Object.entries(subscriptions).map(([path, category]) => ({
        id: path,
        label: category.label,
        cores: category.categories.map(entry => ({
            core: entry.core,
            clients: entry.clients,
            url: `${base}/${securePath}/sub/${path}?app=${entry.core}`
        }))
    }));

    const templates = (await enabledTemplates(env)).map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
        // One set of links per format, so switching the connection type at the
        // top of the page just swaps which set is shown.
        links: Object.fromEntries(formats.map(format => [
            format.id,
            format.cores.map(entry => ({
                core: entry.core,
                clients: entry.clients,
                url: `${entry.url}&tpl=${encodeURIComponent(template.id)}`
            }))
        ]))
    }));

    // Kept for anything still reading the old flat shape.
    const subs = formats.flatMap(format =>
        format.cores.map(entry => ({
            type: format.label,
            core: entry.core,
            clients: entry.clients,
            url: entry.url
        }))
    );

    const payload = {
        name: limits.displayName || 'ZAGROOO',
        uuid: vlUUID,
        status: panelStatus(limits, usage),
        devices: activeDevices(),
        limits: {
            limitTotalBytes: limits.limitTotalBytes,
            limitDailyBytes: limits.limitDailyBytes,
            downSpeedKbps: limits.downSpeedKbps,
            upSpeedKbps: limits.upSpeedKbps,
            expireAt: limits.expireAt,
            maxDevices: limits.maxDevices
        },
        usage: {
            up: usage.upBytes,
            down: usage.downBytes,
            total: usage.totalBytes,
            daily: usage.dailyBytes,
            updatedAt: usage.updatedAt,
            history: usageHistory(usage, 30)
        },
        formats,
        templates,
        links: {
            auto: `${base}/${securePath}/sub/normal?app=xray`,
            raw: `${base}/${securePath}/sub/raw?app=xray`,
            qrEndpoint: `${base}/${securePath}/qrcode`,
            subscriptions: subs
        },
        apps: clients.map(client => ({
            name: client.name,
            minVer: client.minVer,
            source: client.source,
            url: atob(client.b64Url)
        }))
    };

    const html = (await decompressGzipBase64(SUB_HTML_CONTENT))
        .replaceAll('__ICON__', ICON_CONTENT)
        // Only "</script" can terminate the JSON block early, so escaping "<"
        // to its JSON escape keeps the payload valid but inert as markup.
        // The replacement is a function so a "$" in the data is not read as a
        // substitution pattern.
        .replace('__PORTAL_DATA__', () => JSON.stringify(payload).replaceAll('<', '\\u003c'));

    return new Response(html, {
        status: HttpStatus.OK,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            ...userInfoHeaders(limits, usage)
        }
    });
}

/**
 * The header every modern client reads to draw its own usage bar.
 * `total` of 0 means unlimited, which clients render as no bar at all.
 */
function userInfoHeaders(
    limits: { limitTotalBytes: number; expireAt: number },
    usage: { upBytes: number; downBytes: number }
): Record<string, string> {
    const expire = limits.expireAt ? Math.floor(limits.expireAt / 1000) : 0;

    return {
        'subscription-userinfo': `upload=${usage.upBytes}; download=${usage.downBytes}; total=${limits.limitTotalBytes}; expire=${expire}`,
        'profile-update-interval': '6'
    };
}

/** Applied to every config subscription so clients show live usage. */
export async function subscriptionHeaders(env: Env): Promise<Record<string, string>> {
    const limits = await getLimits(env);
    const usage = withPending(await getUsageSnapshot(env));
    return userInfoHeaders(limits, usage);
}
