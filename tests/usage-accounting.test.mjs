/**
 * Usage accounting under concurrency.
 *
 * Guards three defects:
 *  - `scheduleFlush()` fires per chunk from the relay and is never awaited, so
 *    two flushes could both read the stored snapshot, both merge their own
 *    bytes, and the second overwrite the first — losing a whole batch.
 *  - `usageCache` had no TTL and was never re-read, so each isolate kept its
 *    own baseline and the later writer clobbered the earlier one's totals.
 *  - Pending counters were zeroed before the write, so a storage failure lost
 *    them silently.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Fresh module instance per test, so isolate-level state does not leak. */
async function loadUsage() {
    const stubs = {
        '@common': 'export const safeError = e => String(e);',
        '#types/settings': 'export {};',
        './store': `
            export const storeGet = async (env, key) => {
                const stmt = env.zag_db.prepare('SELECT value FROM t WHERE key = ?');
                const row = await stmt.bind(key).first();
                return row ? JSON.parse(row.value) : null;
            };
            export const storePut = async (env, key, value) => {
                const stmt = env.zag_db.prepare('INSERT INTO t (key, value) VALUES (?, ?)');
                await stmt.bind(key, JSON.stringify(value)).run();
            };
            export const storeDelete = async (env, key) => {
                const stmt = env.zag_db.prepare('DELETE FROM t WHERE key = ?');
                await stmt.bind(key).run();
            };
            export const panelId = () => 'test';
        `
    };

    const stubPaths = Object.keys(stubs).map(p => p.replace(/[/@]/g, '\\$&'));
    const result = await build({
        entryPoints: [join(root, 'src/settings/usage.ts')],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        logLevel: 'silent',
        plugins: [{
            name: 'stubs',
            setup(b) {
                // Everything except the module under test resolves to a stub;
                // the real store path './store' would otherwise drag in
                // panel-specific globals the test cannot provide.
                const filter = new RegExp(`^(${stubPaths.join('|')})$`);
                b.onResolve({ filter }, a => ({ path: a.path, namespace: 'stub' }));
                b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'js' }));
            }
        }]
    });

    const source = result.outputFiles[0].text;
    // A cache-busting comment forces a distinct module instance per call.
    const tagged = `${source}\n//${Math.random()}`;
    return import(`data:text/javascript;base64,${Buffer.from(tagged).toString('base64')}`);
}

/** KV-only env, with a controllable delay and failure mode. */
function fakeEnv({ delay = 0, failWrites = false } = {}) {
    // A D1 stub shaped like the bindings the store module actually uses:
    // prepare(sql) -> bind(...) -> first()/run().
    const rows = new Map();

    const makeStatement = sql => ({
        _args: [],
        bind(...args) {
            this._args = args;
            return this;
        },
        async first() {
            if (delay) await new Promise(r => setTimeout(r, delay));
            const raw = rows.get(this._args[0]);
            return raw === undefined ? null : { value: raw };
        },
        async run() {
            if (delay) await new Promise(r => setTimeout(r, delay));
            if (failWrites) throw new Error('storage unavailable');
            const [key, value] = this._args;
            if (sql.includes('INSERT')) {
                env.writes++;
                rows.set(key, value);
            } else if (sql.includes('DELETE')) {
                rows.delete(key);
            }
        }
    });

    const env = {
        writes: 0,
        zag_db: {
            prepare(sql) {
                return makeStatement(sql);
            }
        }
    };

    return env;
}

test('concurrent flushes do not lose bytes', async () => {
    const usage = await loadUsage();
    const env = fakeEnv({ delay: 5 });

    // Ten chunks of 1 MB, each triggering a flush while the previous is still
    // in flight — the exact shape of the relay's fire-and-forget calls.
    const MB = 1024 * 1024;
    const flushes = [];

    for (let i = 0; i < 10; i++) {
        usage.recordBytes('down', MB);
        flushes.push(usage.flushUsage(env, undefined, true));
    }

    await Promise.all(flushes);
    await usage.flushUsage(env, undefined, true);

    const final = await usage.getUsageSnapshot(env, true);
    assert.equal(final.totalBytes, 10 * MB, 'bytes were lost between concurrent flushes');
    assert.equal(final.downBytes, 10 * MB);
});

test('a later isolate does not overwrite an earlier one', async () => {
    const shared = fakeEnv();

    const first = await loadUsage();
    const second = await loadUsage();

    first.recordBytes('down', 500);
    await first.flushUsage(shared, undefined, true);

    // The second isolate starts cold, reads what the first wrote, and adds.
    second.recordBytes('down', 300);
    await second.flushUsage(shared, undefined, true);

    const final = await second.getUsageSnapshot(shared, true);
    assert.equal(final.totalBytes, 800, 'the second isolate clobbered the first');
});

test('bytes are returned when the write fails', async () => {
    const usage = await loadUsage();
    const env = fakeEnv({ failWrites: true });

    usage.recordBytes('down', 4096);
    await assert.rejects(() => usage.flushUsage(env, undefined, true), /storage unavailable/);

    assert.equal(usage.pendingBytes(), 4096, 'bytes were dropped when storage failed');

    // A later successful flush must still persist them.
    const good = fakeEnv();
    await usage.flushUsage(good, undefined, true);
    const final = await usage.getUsageSnapshot(good, true);
    assert.equal(final.totalBytes, 4096, 'recovered bytes never reached storage');
});

test('pending bytes are visible to readers before they are flushed', async () => {
    const usage = await loadUsage();
    const env = fakeEnv();

    usage.recordBytes('down', 123);
    const snapshot = usage.withPending(await usage.getUsageSnapshot(env));

    assert.equal(snapshot.totalBytes, 123, 'a live transfer was invisible to the quota gate');
});

test('the daily counter is archived once, not once per isolate', async () => {
    const usage = await loadUsage();
    const env = fakeEnv();

    usage.recordBytes('down', 2048);
    const snapshot = await usage.flushUsage(env, undefined, true);

    // Force yesterday, then roll over twice as two isolates would.
    snapshot.day = '2020-01-01';
    snapshot.dailyBytes = 2048;
    snapshot.history = [{ d: '2020-01-01', b: 1024 }];

    const rolled = await usage.getUsageSnapshot(env);
    const forDay = rolled.history.filter(entry => entry.d === '2020-01-01');

    assert.equal(forDay.length, 1, 'the same day was archived twice');
    assert.equal(forDay[0].b, 2048, 'the larger figure should win');
});
