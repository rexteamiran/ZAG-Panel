/**
 * Settings migration on a version bump.
 *
 * Guards the defect where `getDataset` called `updateDataset(env)` with no
 * second argument on a version change. That branch writes `getKvSettings()`,
 * which on a cold isolate is still the factory default — so the first request
 * after every upgrade replaced the operator's DNS, ports, clean IPs, chain
 * proxy and routing rules with defaults. On a warm isolate it rewrote a stale
 * `panelVersion`, leaving the version test true and writing to KV on every
 * subsequent request.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The operator's own configuration — none of this may be lost. */
const STORED = {
    remoteDNS: 'https://dns.quad9.net/dns-query',
    remoteDnsHost: { host: 'dns.quad9.net', isDomain: true, ipv4: ['9.9.9.9'], ipv6: [] },
    localDNS: '178.22.122.100',
    antiSanctionDNS: '78.157.42.100',
    ports: [443, 8443, 2053],
    cleanIPs: ['my-private-scanner.example', 'time.cloudflare.com'],
    chainProxy: 'vless://someone@example.com:443',
    chainProxyParams: { server: 'example.com' },
    customSubs: ['https://example.com/mysub'],
    customConfigs: ['vless://custom'],
    bypassIran: true,
    blockAds: true,
    fragmentLengthMin: 42,
    fragmentLengthMax: 88,
    customDomain: 'panel.example.com',
    panelVersion: '1.0.0'
};

/**
 * Bundles the real kv.ts, replacing only the modules that would reach the
 * network or the Cloudflare API. The merge logic under test is untouched.
 */
async function loadKv(version) {
    const stubs = {
        '@api/warp': 'export const fetchWarpAccounts = async () => [];',
        '@main': 'export const setCustomDomain = async d => d;',
        '@utils': `
            export const getDomain = h => ({ host: h, isHostDomain: true });
            export const resolveDNS = async () => ({ ipv4: [], ipv6: [] });
            export const extractProxyParams = p => ({ echo: p });
            export const extractUpstreamParams = p => ({ echo: p });
        `,
        '@settings': `export const getKvSettings = () => globalThis.__FACTORY_DEFAULTS;`,
        '@common': 'export const safeError = e => String(e);'
    };

    const stubPlugin = {
        name: 'stubs',
        setup(b) {
            for (const [name, contents] of Object.entries(stubs)) {
                const filter = new RegExp(`^${name.replace(/[/@]/g, '\\$&')}$`);
                b.onResolve({ filter }, args => ({ path: args.path, namespace: 'stub' }));
            }
            b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
                contents: stubs[args.path],
                loader: 'js'
            }));
        }
    };

    const result = await build({
        entryPoints: [join(root, 'src/settings/dataset.ts')],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        define: { VERSION: JSON.stringify(version) },
        plugins: [stubPlugin],
        logLevel: 'silent'
    });

    const source = result.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

/**
 * A D1 stub shaped like the bindings the store module uses. Records which
 * keys were written, so the tests can assert a migration did or did not run.
 * The store module namespaces rows with the panel id; with no embedded
 * settings the fallback id is `panel`.
 */
function fakeEnv(stored) {
    const rows = new Map([
        ['panel:proxySettings', JSON.stringify(stored)],
        ['panel:telegramBot', JSON.stringify({ telegramBotToken: '', telegramUserId: '' })],
        ['panel:warpAccounts', JSON.stringify([])]
    ]);

    const writes = [];

    const makeStatement = sql => ({
        _args: [],
        bind(...args) {
            this._args = args;
            return this;
        },
        async first() {
            const raw = rows.get(this._args[0]);
            return raw === undefined ? null : { value: raw };
        },
        async run() {
            const [key, value] = this._args;
            if (sql.includes('INSERT')) {
                writes.push(key);
                rows.set(key, value);
            } else if (sql.includes('DELETE')) {
                rows.delete(key);
            }
        }
    });

    return {
        writes,
        zag_db: {
            prepare(sql) {
                return makeStatement(sql);
            }
        }
    };
}

// The factory defaults a cold isolate would still be holding.
globalThis.__FACTORY_DEFAULTS = {
    remoteDNS: 'https://8.8.8.8/dns-query',
    remoteDnsHost: { host: '8.8.8.8', isDomain: false, ipv4: [], ipv6: [] },
    localDNS: '8.8.8.8',
    antiSanctionDNS: '178.22.122.100',
    ports: [443],
    cleanIPs: ['www.speedtest.net'],
    chainProxy: '',
    chainProxyParams: {},
    customSubs: [],
    customConfigs: [],
    bypassIran: false,
    blockAds: false,
    fragmentLengthMin: 100,
    fragmentLengthMax: 200,
    customDomain: '',
    remoteSettings: '',
    panelVersion: '1.2.0'
};

test('a version bump keeps every operator setting', async () => {
    const { getDataset } = await loadKv('1.2.0');
    const env = fakeEnv(STORED);

    const { settings } = await getDataset(env);

    assert.equal(settings.remoteDNS, STORED.remoteDNS, 'remote DNS was reset');
    assert.equal(settings.localDNS, STORED.localDNS, 'local DNS was reset');
    assert.deepEqual(settings.ports, STORED.ports, 'ports were reset');
    assert.deepEqual(settings.cleanIPs, STORED.cleanIPs, 'clean IPs were reset');
    assert.equal(settings.chainProxy, STORED.chainProxy, 'chain proxy was lost');
    assert.deepEqual(settings.customSubs, STORED.customSubs, 'custom subscriptions were lost');
    assert.deepEqual(settings.customConfigs, STORED.customConfigs, 'custom configs were lost');
    assert.equal(settings.bypassIran, true, 'routing rules were reset');
    assert.equal(settings.blockAds, true, 'block rules were reset');
    assert.equal(settings.fragmentLengthMin, 42, 'fragment tuning was reset');
    assert.equal(settings.fragmentLengthMax, 88, 'fragment tuning was reset');
});

test('a version bump advances panelVersion, so it settles', async () => {
    const { getDataset } = await loadKv('1.2.0');
    const env = fakeEnv(STORED);

    const { settings } = await getDataset(env);
    assert.equal(settings.panelVersion, '1.2.0', 'panelVersion did not advance');

    // Second pass on the migrated record must not migrate again.
    const second = fakeEnv(settings);
    const again = await getDataset(second);

    assert.equal(again.settings.panelVersion, '1.2.0');
    assert.ok(
        !second.writes.includes('panel:proxySettings'),
        'settings were rewritten on a matching version — the write loop is back'
    );
});

test('no version change means no migration write at all', async () => {
    const current = { ...STORED, panelVersion: '1.2.0' };
    const { getDataset } = await loadKv('1.2.0');
    const env = fakeEnv(current);

    await getDataset(env);
    assert.ok(!env.writes.includes('panel:proxySettings'), 'settings were written without a version change');
});
