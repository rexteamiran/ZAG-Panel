import { getClNormalConfig, getClWarpConfig } from '@cores/clash/configs';
import { getURLConfigs } from '@cores/common';
import { getSbCustomConfig, getSbWarpConfig } from '@cores/sing-box/configs';
import { getXrCustomConfigs, getXrWarpConfigs } from '@cores/xray/configs';
import { setSettings, getGlobals, getKvSettings, getSharedSettings, clients, subscriptions } from '@settings';
import { fallback } from './utils';
import { getWireguardConfigs } from '@cores/wireguard';
import { decompressGzipBase64, HttpStatus } from '@common';
import { SharedSettings } from '#types/settings';
import { activeDevices, panelStatus } from '@limits';
import { bindContext, getLimits, getUsageSnapshot, saveLimits, usageHistory, withPending } from '@usage';
import { checkAlerts } from '@api/telegram';

export async function handleSubscriptions(request: Request, env: Env): Promise<Response> {
    const response = await routeSubscription(request, env);

    // Clients read these off any subscription fetch to draw their own usage
    // bar, so they ride along with every format, not just the portal.
    if (response.headers.has('subscription-userinfo')) return response;

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

    switch (path) {
        case 'normal':
            switch (client) {
                case 'xray':
                    return getXrCustomConfigs(false);

                case 'sing-box':
                    return getSbCustomConfig(false);

                case 'clash':
                    return getClNormalConfig();

                default:
                    break;
            }

        case 'raw':
            switch (client) {
                case 'xray':
                case 'sing-box':
                    return getURLConfigs(env);

                default:
                    break;
            }

        case 'fragment':
            switch (client) {
                case 'xray':
                    return getXrCustomConfigs(true);

                case 'sing-box':
                    return getSbCustomConfig(true);

                default:
                    break;
            }

        case 'warp':
            switch (client) {
                case 'xray':
                    return getXrWarpConfigs(false, false);

                case 'sing-box':
                    return getSbWarpConfig();

                case 'clash':
                    return getClWarpConfig(false);

                case 'wireguard':
                    return getWireguardConfigs(false);

                default:
                    break;
            }

        case 'warp-pro':
            switch (client) {
                case 'xray':
                    return getXrWarpConfigs(true, false);

                case 'xray-knocker':
                    return getXrWarpConfigs(true, true);

                case 'clash':
                    return getClWarpConfig(true);

                case 'amnezia':
                    return getWireguardConfigs(true);

                default:
                    break;
            }

        case 'share-settings':
            return shareSettings();

        default:
            return fallback(request);
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

    const subs = Object.entries(subscriptions).flatMap(([path, category]) =>
        category.categories.map(entry => ({
            type: category.label,
            core: entry.core,
            clients: entry.clients,
            url: `${base}/${securePath}/sub/${path}?app=${entry.core}`
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
        links: {
            auto: `${base}/${securePath}/sub/normal`,
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
