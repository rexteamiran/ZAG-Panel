import { DayUsage, PanelLimits, UsageSnapshot } from '#types/settings';
import { safeError } from '@common';

/* ==========================================================================
   Storage
   Usage counters are written far more often than anything else in the panel,
   so they prefer D1 (100k writes/day on the free plan) and fall back to KV
   (1k writes/day) on panels the wizard deployed without a D1 binding.
   ========================================================================== */

const TABLE = 'zag_store';
const USAGE_KEY = 'usage';
const LIMITS_KEY = 'limits';

const HISTORY_DAYS = 30;

/** Flush cadence. Whichever comes first. */
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_BYTES = 20 * 1024 * 1024;

let d1Ready = false;

export function hasD1(env: Env): boolean {
    return Boolean(env.zag_db);
}

async function ensureTable(env: Env): Promise<void> {
    if (d1Ready || !env.zag_db) return;
    await env.zag_db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT)`).run();
    d1Ready = true;
}

async function storeGet<T>(env: Env, key: string): Promise<T | null> {
    if (env.zag_db) {
        try {
            await ensureTable(env);
            const row = await env.zag_db
                .prepare(`SELECT value FROM ${TABLE} WHERE key = ?`)
                .bind(key)
                .first<{ value: string }>();

            return row ? JSON.parse(row.value) as T : null;
        } catch (error) {
            console.log(`D1 read failed for ${key}, falling back to KV:`, safeError(error));
        }
    }

    return await env.kv.get(key, { type: 'json' }) as T | null;
}

async function storePut(env: Env, key: string, value: unknown): Promise<void> {
    const body = JSON.stringify(value);

    if (env.zag_db) {
        try {
            await ensureTable(env);
            await env.zag_db
                .prepare(`INSERT INTO ${TABLE} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
                .bind(key, body)
                .run();

            return;
        } catch (error) {
            console.log(`D1 write failed for ${key}, falling back to KV:`, safeError(error));
        }
    }

    await env.kv.put(key, body);
}

/* ==========================================================================
   Defaults
   ========================================================================== */

export function today(): string {
    return new Date().toISOString().split('T')[0];
}

export function currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
}

export function emptyUsage(): UsageSnapshot {
    return {
        upBytes: 0,
        downBytes: 0,
        totalBytes: 0,
        dailyBytes: 0,
        day: today(),
        lastMonthlyReset: currentMonth(),
        history: [],
        updatedAt: Date.now()
    };
}

export function defaultLimits(subToken: string): PanelLimits {
    return {
        displayName: '',
        subToken,
        panelHost: '',
        panelPath: '',
        showStatusNodes: true,
        zagiroName: '',
        wizardKey: '',
        limitTotalBytes: 0,
        limitDailyBytes: 0,
        downSpeedKbps: 0,
        upSpeedKbps: 0,
        expireAt: 0,
        maxDevices: 0,
        isPaused: false,
        pauseReason: '',
        pausedAt: 0,
        monthlyReset: false,
        monthlyResetDay: 1,
        alertQuota: false,
        alertExpiry: false,
        alertState: { quota80: false, quota100: false, expirySoon: false },
        panelApiKeys: []
    };
}

function randomToken(bytes = 16): string {
    const buffer = new Uint8Array(bytes);
    crypto.getRandomValues(buffer);
    return Array.from(buffer, byte => byte.toString(16).padStart(2, '0')).join('');
}

/* ==========================================================================
   Limits
   ========================================================================== */

let limitsCache: PanelLimits | null = null;
let limitsCachedAt = 0;

/**
 * The wizard edits limits by writing this record directly through the
 * Cloudflare API, so a long-lived isolate has to re-read it periodically or
 * it would keep enforcing quotas the operator already changed.
 */
const LIMITS_TTL_MS = 60_000;

export async function getLimits(env: Env): Promise<PanelLimits> {
    if (limitsCache && Date.now() - limitsCachedAt < LIMITS_TTL_MS) return limitsCache;

    const stored = await storeGet<Partial<PanelLimits>>(env, LIMITS_KEY);
    const base = defaultLimits(randomToken());

    limitsCachedAt = Date.now();

    if (!stored) {
        await storePut(env, LIMITS_KEY, base);
        limitsCache = base;
        return base;
    }

    // Merge so panels created on an older build pick up new fields.
    const merged: PanelLimits = {
        ...base,
        ...stored,
        alertState: { ...base.alertState, ...(stored.alertState ?? {}) },
        panelApiKeys: stored.panelApiKeys ?? [],
        subToken: stored.subToken || base.subToken
    };

    limitsCache = merged;
    return merged;
}

export async function saveLimits(env: Env, limits: PanelLimits): Promise<PanelLimits> {
    limitsCache = limits;
    limitsCachedAt = Date.now();
    await storePut(env, LIMITS_KEY, limits);
    return limits;
}

export function invalidateLimitsCache(): void {
    limitsCache = null;
    limitsCachedAt = 0;
}

/* ==========================================================================
   Usage
   ========================================================================== */

let usageCache: UsageSnapshot | null = null;
let pendingUp = 0;
let pendingDown = 0;
let lastFlush = 0;

/** Rolls the daily counter over and archives the day that just ended. */
function rollDay(usage: UsageSnapshot): UsageSnapshot {
    const day = today();
    if (usage.day === day) return usage;

    if (usage.day && usage.dailyBytes > 0) {
        const history: DayUsage[] = [...usage.history, { d: usage.day, b: usage.dailyBytes }];
        usage.history = history.slice(-HISTORY_DAYS);
    }

    usage.dailyBytes = 0;
    usage.day = day;
    return usage;
}

/** Zeroes the total counter on the configured day of each month. */
function rollMonth(usage: UsageSnapshot, limits: PanelLimits): boolean {
    if (!limits.monthlyReset) return false;

    const month = currentMonth();
    if (usage.lastMonthlyReset === month) return false;
    if (new Date().getUTCDate() < Math.min(Math.max(limits.monthlyResetDay, 1), 28)) return false;

    usage.upBytes = 0;
    usage.downBytes = 0;
    usage.totalBytes = 0;
    usage.lastMonthlyReset = month;
    return true;
}

export async function getUsageSnapshot(env: Env): Promise<UsageSnapshot> {
    if (!usageCache) {
        const stored = await storeGet<Partial<UsageSnapshot>>(env, USAGE_KEY);
        usageCache = stored ? { ...emptyUsage(), ...stored, history: stored.history ?? [] } : emptyUsage();
    }

    return rollDay(usageCache);
}

/**
 * Usage including bytes counted in this isolate but not yet persisted.
 * Read paths (portal, API, gating) should use this so a live transfer is
 * reflected immediately instead of up to one flush interval late.
 */
export function withPending(usage: UsageSnapshot): UsageSnapshot {
    const pending = pendingUp + pendingDown;
    if (!pending) return usage;

    return {
        ...usage,
        upBytes: usage.upBytes + pendingUp,
        downBytes: usage.downBytes + pendingDown,
        totalBytes: usage.totalBytes + pending,
        dailyBytes: usage.dailyBytes + pending
    };
}

export function recordBytes(direction: 'up' | 'down', bytes: number): void {
    if (!bytes || bytes < 0) return;
    if (direction === 'up') {
        pendingUp += bytes;
    } else {
        pendingDown += bytes;
    }
}

export function pendingBytes(): number {
    return pendingUp + pendingDown;
}

/**
 * Merges buffered bytes into the snapshot and persists it.
 * Returns the merged snapshot, or null when the flush was skipped.
 */
export async function flushUsage(env: Env, limits?: PanelLimits, force = false): Promise<UsageSnapshot | null> {
    const pending = pendingUp + pendingDown;
    const now = Date.now();
    const due = force || pending >= FLUSH_BYTES || (pending > 0 && now - lastFlush >= FLUSH_INTERVAL_MS);
    if (!due) return null;

    const usage = await getUsageSnapshot(env);
    const up = pendingUp;
    const down = pendingDown;
    pendingUp = 0;
    pendingDown = 0;
    lastFlush = now;

    usage.upBytes += up;
    usage.downBytes += down;
    usage.totalBytes += up + down;
    usage.dailyBytes += up + down;
    usage.updatedAt = now;

    const effectiveLimits = limits ?? limitsCache;
    if (effectiveLimits) rollMonth(usage, effectiveLimits);

    usageCache = usage;
    await storePut(env, USAGE_KEY, usage);
    return usage;
}

export async function resetUsage(env: Env, scope: 'all' | 'daily' = 'all'): Promise<UsageSnapshot> {
    const usage = await getUsageSnapshot(env);
    pendingUp = 0;
    pendingDown = 0;

    if (scope === 'daily') {
        usage.dailyBytes = 0;
    } else {
        usage.upBytes = 0;
        usage.downBytes = 0;
        usage.totalBytes = 0;
        usage.dailyBytes = 0;
        usage.history = [];
        usage.lastMonthlyReset = currentMonth();
    }

    usage.day = today();
    usage.updatedAt = Date.now();
    usageCache = usage;
    await storePut(env, USAGE_KEY, usage);
    return usage;
}

/** Trailing `days` of history, gap-filled with zeroes and ending today. */
export function usageHistory(usage: UsageSnapshot, days: number): DayUsage[] {
    const byDay = new Map(usage.history.map(entry => [entry.d, entry.b]));
    byDay.set(usage.day, usage.dailyBytes);

    const out: DayUsage[] = [];
    const cursor = new Date();

    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(cursor.getTime() - i * 86_400_000);
        const key = date.toISOString().split('T')[0];
        out.push({ d: key, b: byDay.get(key) ?? 0 });
    }

    return out;
}

/* ==========================================================================
   Hot-path binding

   The proxy relay counts bytes chunk by chunk and has no access to `env` or
   the execution context, so the request handler binds them once per request
   and the relay calls scheduleFlush() as it goes.
   ========================================================================== */

let boundEnv: Env | null = null;
let boundCtx: ExecutionContext | null = null;

export function bindContext(env: Env, ctx?: ExecutionContext): void {
    boundEnv = env;
    if (ctx) boundCtx = ctx;
}

export function scheduleFlush(force = false): void {
    if (!boundEnv) return;
    if (!force && pendingUp + pendingDown === 0) return;

    const task = flushUsage(boundEnv, undefined, force).catch(error => {
        console.log('Usage flush failed:', safeError(error));
        return null;
    });

    if (boundCtx) {
        boundCtx.waitUntil(task);
    } else {
        void task;
    }
}
