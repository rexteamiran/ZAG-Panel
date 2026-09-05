import { DayUsage, PanelLimits, UsageSnapshot } from '#types/settings';
import { safeError } from '@common';
import { recordError } from './errorlog';
import { storeGet, storePut } from './store';

/* ==========================================================================
   Usage accounting

   Counters live in the panel's D1 store (`zag_store`, namespaced per panel).
   Bytes are buffered per isolate and flushed on a cadence rather than per
   chunk, which keeps write volume far below the free plan's limits.
   ========================================================================== */

const USAGE_KEY = 'usage';
const LIMITS_KEY = 'limits';

const HISTORY_DAYS = 30;

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
        limitTotalBytes: 0,
        limitDailyBytes: 0,
        downSpeedKbps: 0,
        upSpeedKbps: 0,
        expireAt: 0,
        maxDevices: 0,
        isPaused: false,
        pauseReason: '',
        pausedAt: 0,
        pausedBy: '',
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

/** Used by tests and by the settings-reset path. */
export function invalidateLimitsCache(): void {
    limitsCache = null;
    limitsCachedAt = 0;
}

/* ==========================================================================
   Usage
   ========================================================================== */

let usageCache: UsageSnapshot | null = null;
let usageCachedAt = 0;
let pendingUp = 0;
let pendingDown = 0;
let lastFlush = 0;

/**
 * Flush cadence. Bytes buffer in the isolate and are merged on this interval,
 * or when 20 MB have piled up — whichever comes first. With D1's 100k
 * writes/day across the account's shared database, a two-minute cadence keeps
 * twenty busy panels around 14k writes/day, a comfortable margin under the
 * cap. Enforcement stays exact: the quota gate counts the pending bytes in
 * memory, so a panel never overspends between flushes.
 */
const FLUSH_INTERVAL_MS = 120_000;
const FLUSH_BYTES = 20 * 1024 * 1024;

/** Rolls the daily counter over and archives the day that just ended. */
function rollDay(usage: UsageSnapshot): UsageSnapshot {
    const day = today();
    if (usage.day === day) return usage;

    if (usage.day && usage.dailyBytes > 0) {
        // Another isolate may already have archived this day; keep the larger
        // figure rather than appending a duplicate the chart would discard.
        const existing = usage.history.find(entry => entry.d === usage.day);

        if (existing) {
            existing.b = Math.max(existing.b, usage.dailyBytes);
        } else {
            const history: DayUsage[] = [...usage.history, { d: usage.day, b: usage.dailyBytes }];
            usage.history = history.slice(-HISTORY_DAYS);
        }
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

/**
 * Cloudflare spreads connections across isolates, each with its own copy of
 * this cache. Without a re-read, the isolate that flushes last overwrites
 * every other isolate's counting with its own stale baseline. The limits cache
 * has had a TTL for exactly this reason; usage needs one more, not less.
 */
const USAGE_TTL_MS = 20_000;

export async function getUsageSnapshot(env: Env, forceRead = false): Promise<UsageSnapshot> {
    const stale = Date.now() - usageCachedAt >= USAGE_TTL_MS;

    if (!usageCache || forceRead || stale) {
        const stored = await storeGet<Partial<UsageSnapshot>>(env, USAGE_KEY);
        usageCache = stored ? { ...emptyUsage(), ...stored, history: stored.history ?? [] } : emptyUsage();
        usageCachedAt = Date.now();
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
/**
 * Serialises flushes into a queue.
 *
 * scheduleFlush() fires from the relay per chunk and is never awaited, so
 * without this two flushes both read the stored snapshot, both merge their own
 * bytes into it, and the second overwrites the first — losing a whole batch.
 *
 * Waiting for the in-flight flush is not enough: every waiter then resumes at
 * once and races the same way. Each call instead chains onto the previous one,
 * so they run strictly in turn.
 */
let flushQueue: Promise<UsageSnapshot | null> = Promise.resolve(null);

async function mergeAndStore(env: Env, limits?: PanelLimits): Promise<UsageSnapshot | null> {
    // Claim whatever accumulated, including anything counted while earlier
    // flushes in the queue were running.
    const up = pendingUp;
    const down = pendingDown;
    if (!up && !down) return usageCache;

    pendingUp = 0;
    pendingDown = 0;
    lastFlush = Date.now();

    // Read immediately before merging, so writes another isolate made since
    // this one last looked are carried forward rather than overwritten.
    const usage = await getUsageSnapshot(env, true);

    usage.upBytes += up;
    usage.downBytes += down;
    usage.totalBytes += up + down;
    usage.dailyBytes += up + down;
    usage.updatedAt = Date.now();

    const effectiveLimits = limits ?? limitsCache;
    if (effectiveLimits) rollMonth(usage, effectiveLimits);

    try {
        await storePut(env, USAGE_KEY, usage);
    } catch (error) {
        // Give the bytes back rather than dropping them on the floor.
        pendingUp += up;
        pendingDown += down;
        throw error;
    }

    usageCache = usage;
    usageCachedAt = Date.now();
    return usage;
}

export async function flushUsage(env: Env, limits?: PanelLimits, force = false): Promise<UsageSnapshot | null> {
    const pending = pendingUp + pendingDown;
    const now = Date.now();
    const due = force || pending >= FLUSH_BYTES || (pending > 0 && now - lastFlush >= FLUSH_INTERVAL_MS);
    if (!due) return null;

    // A rejected flush must not break the chain for everyone behind it.
    const mine = flushQueue
        .catch(() => null)
        .then(() => mergeAndStore(env, limits));

    flushQueue = mine.catch(() => null);
    return mine;
}

/**
 * Rolls the month over on a read, not only on a flush.
 *
 * rollMonth used to be reachable only from flushUsage, which only runs when
 * traffic flows — but a panel that hit its quota is refusing traffic, so the
 * reset could never fire. Returns true when it rolled.
 */
export async function maybeRollMonth(env: Env, limits: PanelLimits): Promise<boolean> {
    if (!limits.monthlyReset) return false;

    const usage = await getUsageSnapshot(env);
    if (!rollMonth(usage, limits)) return false;

    usage.updatedAt = Date.now();
    usageCache = usage;
    usageCachedAt = Date.now();
    await storePut(env, USAGE_KEY, usage);
    return true;
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
    usageCachedAt = Date.now();
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
        // Visibility beats silence: a flush that keeps failing means the
        // usage totals on the portal and the dashboard quietly go stale.
        void recordError(boundEnv!, 'usage', safeError(error), 'Usage flush failed — reported totals may be stale.', 'warn');
        console.log('Usage flush failed:', safeError(error));
        return null;
    });

    if (boundCtx) {
        boundCtx.waitUntil(task);
    } else {
        void task;
    }
}
