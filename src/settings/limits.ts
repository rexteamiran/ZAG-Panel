import { AccessVerdict, PanelLimits, PanelStatus, UsageSnapshot } from '#types/settings';

/* ==========================================================================
   Access gating
   ========================================================================== */

export function evaluateAccess(limits: PanelLimits, usage: UsageSnapshot): AccessVerdict {
    if (limits.isPaused) {
        return {
            allowed: false,
            reason: 'paused',
            message: limits.pauseReason || 'This subscription is paused.'
        };
    }

    if (limits.expireAt && Date.now() > limits.expireAt) {
        return {
            allowed: false,
            reason: 'expired',
            message: `Subscription expired on ${new Date(limits.expireAt).toISOString().split('T')[0]}.`
        };
    }

    if (limits.limitTotalBytes && usage.totalBytes >= limits.limitTotalBytes) {
        return {
            allowed: false,
            reason: 'quota',
            message: `Total volume limit reached (${formatBytes(usage.totalBytes)} / ${formatBytes(limits.limitTotalBytes)}).`
        };
    }

    if (limits.limitDailyBytes && usage.dailyBytes >= limits.limitDailyBytes) {
        return {
            allowed: false,
            reason: 'daily-quota',
            message: `Daily volume limit reached (${formatBytes(usage.dailyBytes)} / ${formatBytes(limits.limitDailyBytes)}).`
        };
    }

    return { allowed: true, reason: null, message: '' };
}

export function panelStatus(limits: PanelLimits, usage: UsageSnapshot): PanelStatus {
    const verdict = evaluateAccess(limits, usage);
    if (verdict.allowed) return 'active';

    switch (verdict.reason) {
        case 'paused': return 'paused';
        case 'expired': return 'expired';
        case 'daily-quota': return 'daily-limited';
        default: return 'limited';
    }
}

export function formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exponent);
    return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

/* ==========================================================================
   Speed limiting

   A token bucket per direction, scoped to this isolate. Cloudflare spreads
   connections across isolates, so the effective ceiling is the configured
   rate multiplied by the number of isolates a client happens to land on —
   this throttles, it does not meter precisely. Debt carries across windows
   instead of being zeroed, which keeps the average close to the target.
   ========================================================================== */

interface Bucket {
    tokens: number;
    updatedAt: number;
}

const buckets: Record<'up' | 'down', Bucket> = {
    up: { tokens: 0, updatedAt: 0 },
    down: { tokens: 0, updatedAt: 0 }
};

/** Never sleep longer than this in one call, so a huge chunk cannot stall a socket. */
const MAX_SLEEP_MS = 1_000;

export async function throttle(direction: 'up' | 'down', bytes: number, limitKbps: number): Promise<void> {
    if (!limitKbps || limitKbps <= 0 || !bytes) return;

    const bytesPerSecond = limitKbps * 1024;
    const bucket = buckets[direction];
    const now = Date.now();

    if (!bucket.updatedAt) {
        bucket.updatedAt = now;
        bucket.tokens = bytesPerSecond;
    } else {
        const elapsed = (now - bucket.updatedAt) / 1000;
        bucket.tokens = Math.min(bytesPerSecond, bucket.tokens + elapsed * bytesPerSecond);
        bucket.updatedAt = now;
    }

    bucket.tokens -= bytes;
    if (bucket.tokens >= 0) return;

    const waitMs = Math.min(MAX_SLEEP_MS, Math.ceil((-bucket.tokens / bytesPerSecond) * 1000));
    if (waitMs <= 0) return;

    // Whatever debt the cap leaves behind is forgiven, otherwise a client that
    // exceeds the rate once would be throttled forever.
    bucket.tokens = Math.max(bucket.tokens, -bytesPerSecond);
    await new Promise(resolve => setTimeout(resolve, waitMs));
}

/* ==========================================================================
   Concurrent device tracking

   Isolate-scoped like the buckets above, so this is a soft ceiling meant to
   discourage link sharing, not a hard guarantee.
   ========================================================================== */

const DEVICE_TTL_MS = 5 * 60 * 1000;
const devices = new Map<string, number>();

export function touchDevice(ip: string): void {
    if (!ip) return;
    devices.set(ip, Date.now());
}

export function activeDevices(): number {
    const cutoff = Date.now() - DEVICE_TTL_MS;
    for (const [ip, seen] of devices) {
        if (seen < cutoff) devices.delete(ip);
    }

    return devices.size;
}

export function deviceLimitExceeded(ip: string, maxDevices: number): boolean {
    if (!maxDevices || maxDevices <= 0) return false;
    const cutoff = Date.now() - DEVICE_TTL_MS;
    for (const [seenIp, seen] of devices) {
        if (seen < cutoff) devices.delete(seenIp);
    }

    if (devices.has(ip)) return false;
    return devices.size >= maxDevices;
}

/* ==========================================================================
   Active limits

   Set once per request by the websocket handler so the relay can read speed
   caps per chunk without an async lookup.
   ========================================================================== */

let activeLimits: PanelLimits | null = null;

export function setActiveLimits(limits: PanelLimits | null): void {
    activeLimits = limits;
}

export function getActiveLimits(): PanelLimits | null {
    return activeLimits;
}
