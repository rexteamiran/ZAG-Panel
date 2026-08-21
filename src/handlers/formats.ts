/* ==========================================================================
   Subscription format support matrix

   Which client each format can actually serve. Kept free of runtime imports
   so it can be tested on its own.

   This exists because the router used to be nested switches with no break
   between the outer cases: an unrecognised client fell through every format
   and landed on `share-settings`, handing the customer the operator's entire
   settings record. A lookup cannot fall through.
   ========================================================================== */

export const SUPPORTED_CLIENTS: Record<string, readonly string[]> = {
    'normal': ['xray', 'sing-box', 'clash'],
    'fragment': ['xray', 'sing-box'],
    'raw': ['xray', 'sing-box'],
    'warp': ['xray', 'sing-box', 'clash', 'wireguard'],
    'warp-pro': ['xray', 'xray-knocker', 'clash', 'amnezia']
};

/** Path segments the router owns; anything else is not a subscription. */
export const SUBSCRIPTION_FORMATS = Object.keys(SUPPORTED_CLIENTS);

export type RouteDecision =
    | { kind: 'config'; format: string; client: string }
    | { kind: 'share' }
    | { kind: 'unsupported'; format: string; supported: readonly string[] }
    | { kind: 'unknown' };

/**
 * Pure routing decision, so the behaviour can be asserted without standing up
 * a worker. `share-settings` is only ever reachable by asking for it.
 */
export function decideRoute(path: string, client: string): RouteDecision {
    if (path === 'share-settings') return { kind: 'share' };

    const supported = SUPPORTED_CLIENTS[path];
    if (!supported) return { kind: 'unknown' };

    if (!client || !supported.includes(client)) {
        return { kind: 'unsupported', format: path, supported };
    }

    return { kind: 'config', format: path, client };
}
