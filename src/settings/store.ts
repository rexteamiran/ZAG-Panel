/* ==========================================================================
   Storage

   The panel's only storage is D1. Every ZAGROOO panel binds the account's
   shared `zagrooo-panels` database as `zag_db`, and namespaces its rows with
   its own panel id, so a dozen panels share one database without seeing each
   other's limits, settings or secrets. KV is gone entirely.

   The table itself is created lazily here and also seeded by the wizard at
   install time, so either side can come up first.
   ========================================================================== */

const TABLE = 'zag_store';

let tableReady = false;

async function ensureTable(env: Env): Promise<void> {
    if (tableReady) return;
    await env.zag_db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT)`).run();
    tableReady = true;
}

/**
 * The namespace this panel's rows live under. The wizard bakes `panelId` into
 * the deployed script at install; falling back to the host's first label keeps
 * scripts built by an older wizard addressable too.
 */
export function panelId(): string {
    const embedded = (globalThis as any).EMBEDED_SETTINGS;
    return embedded?.panelId || embedded?.mainDomain?.split('.')[0] || 'panel';
}

export function storeKey(key: string): string {
    return `${panelId()}:${key}`;
}

export async function storeGet<T>(env: Env, key: string): Promise<T | null> {
    await ensureTable(env);

    const row = await env.zag_db
        .prepare(`SELECT value FROM ${TABLE} WHERE key = ?`)
        .bind(storeKey(key))
        .first<{ value: string }>();

    return row ? JSON.parse(row.value) as T : null;
}

export async function storePut(env: Env, key: string, value: unknown): Promise<void> {
    await ensureTable(env);

    await env.zag_db
        .prepare(`INSERT INTO ${TABLE} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .bind(storeKey(key), JSON.stringify(value))
        .run();
}

export async function storeDelete(env: Env, key: string): Promise<void> {
    await ensureTable(env);

    await env.zag_db
        .prepare(`DELETE FROM ${TABLE} WHERE key = ?`)
        .bind(storeKey(key))
        .run();
}
