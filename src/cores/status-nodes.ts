import { PanelLimits, UsageSnapshot } from '#types/settings';
import { formatBytes } from '@limits';

/* ==========================================================================
   Status nodes

   Subscription entries that exist only to be read. Their names carry the
   remaining quota and the days left, so a customer sees their own status
   inside their VPN app without opening the portal or being messaged.

   They point at 127.0.0.1, so a client that tries one fails instantly and
   locally rather than reaching anything. They are named with a leading marker
   so they sort together and read as information, not as servers.
   ========================================================================== */

const UNROUTABLE_HOST = '127.0.0.1';
const UNROUTABLE_PORT = 1;

/** Below this fraction of the total quota, the remaining-volume note appears. */
const QUOTA_NOTICE_THRESHOLD = 0.75;

/** Within this many days of expiry, the countdown note appears. */
const EXPIRY_NOTICE_DAYS = 7;

function daysLeft(expireAt: number): number {
    const remaining = expireAt - Date.now();
    if (remaining <= 0) return -1;

    // Math.ceil yields -0 for anything expired within the last 24 hours, and
    // -0 is neither less than 0 nor distinguishable from 0 — which showed an
    // already-dead subscription as "Expires today" for a whole day.
    return Math.ceil(remaining / 86_400_000);
}

/**
 * The lines to show, most urgent first. Empty when nothing is worth saying —
 * a customer with plenty of quota and no expiry should not see clutter.
 */
export function statusLines(limits: PanelLimits, usage: UsageSnapshot): string[] {
    if (!limits.showStatusNodes) return [];

    const lines: string[] = [];

    if (limits.expireAt) {
        const days = daysLeft(limits.expireAt);

        if (days < 0) {
            lines.push('⚠️ Subscription expired');
        } else if (days === 0) {
            lines.push('⚠️ Expires today');
        } else if (days <= EXPIRY_NOTICE_DAYS) {
            lines.push(`⚠️ ${days} day${days === 1 ? '' : 's'} left`);
        }
    }

    if (limits.limitTotalBytes) {
        const remaining = Math.max(0, limits.limitTotalBytes - usage.totalBytes);
        const ratio = usage.totalBytes / limits.limitTotalBytes;

        if (remaining === 0) {
            lines.push('⚠️ Data finished');
        } else if (ratio >= QUOTA_NOTICE_THRESHOLD) {
            lines.push(`⚠️ ${formatBytes(remaining)} left`);
        }
    }

    if (limits.isPaused && !lines.length) {
        lines.push('⚠️ Subscription paused');
    }

    return lines;
}

/**
 * Status lines as subscription URLs, ready to prepend to a raw subscription.
 * Returns '' when there is nothing to show.
 */
export function statusConfigs(
    limits: PanelLimits,
    usage: UsageSnapshot,
    // Accepts either shape: the KV setting is a comma-joined string, while the
    // cores work with the parsed list from getProtocols().
    credentials: { uuid: string; trojanPass: string; protocols: string | readonly string[] }
): string {
    const lines = statusLines(limits, usage);
    if (!lines.length) return '';

    // Match whatever the panel actually serves, so the note lands in the
    // client's list rather than being dropped as an unparseable entry.
    const useVless = credentials.protocols.includes(_VL_);
    const scheme = useVless ? _VL_ : _TR_;

    return lines.map(line => {
        const config = new URL(`${scheme}://config`);
        config.username = useVless ? credentials.uuid : credentials.trojanPass;
        config.hostname = UNROUTABLE_HOST;
        config.port = String(UNROUTABLE_PORT);
        if (useVless) config.searchParams.append('encryption', 'none');
        config.searchParams.append('security', 'none');
        config.searchParams.append('type', 'ws');
        config.hash = line;

        return config.href;
    }).join('\n') + '\n';
}
