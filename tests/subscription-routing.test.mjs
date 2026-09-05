/**
 * Subscription routing.
 *
 * Guards the defect where the router's nested switches had no break between
 * outer cases: an unrecognised client fell through every format and landed on
 * `share-settings`, returning the operator's whole settings record — including
 * chain-proxy credentials — to any customer who opened the portal's own
 * headline link.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Bundles the real module so the test runs against shipped code. */
async function loadFormats() {
    const result = await build({
        entryPoints: [join(root, 'src/handlers/formats.ts')],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        logLevel: 'silent'
    });

    const source = result.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const { decideRoute, SUPPORTED_CLIENTS, SUBSCRIPTION_FORMATS } = await loadFormats();

const EVERY_CLIENT = ['xray', 'sing-box', 'clash', 'wireguard', 'xray-knocker', 'amnezia'];

test('share-settings is only reachable by asking for it', () => {
    for (const format of SUBSCRIPTION_FORMATS) {
        for (const client of ['', ...EVERY_CLIENT, 'nonsense']) {
            const decision = decideRoute(format, client);
            assert.notEqual(
                decision.kind, 'share',
                `${format} ?app=${client || '(none)'} reached share-settings`
            );
        }
    }

    assert.equal(decideRoute('share-settings', '').kind, 'share');
});

test('a missing ?app= never serves a config', () => {
    for (const format of SUBSCRIPTION_FORMATS) {
        const decision = decideRoute(format, '');
        assert.equal(decision.kind, 'unsupported', `${format} with no client should be refused`);
        assert.ok(decision.supported.length > 0, `${format} should name its supported clients`);
    }
});

test('the portal headline link resolves to a real config', () => {
    // The portal advertises /sub/normal?app=xray; this is the exact pair that
    // used to leak when the ?app= was absent.
    const decision = decideRoute('normal', 'xray');
    assert.deepEqual(decision, { kind: 'config', format: 'normal', client: 'xray' });
});

test('every format serves exactly its declared clients and nothing else', () => {
    for (const format of SUBSCRIPTION_FORMATS) {
        for (const client of EVERY_CLIENT) {
            const decision = decideRoute(format, client);
            const declared = SUPPORTED_CLIENTS[format].includes(client);

            if (declared) {
                assert.deepEqual(decision, { kind: 'config', format, client });
            } else {
                assert.equal(
                    decision.kind, 'unsupported',
                    `${format} ?app=${client} is not declared but was accepted as ${decision.kind}`
                );
            }
        }
    }
});

test('an unknown path falls through to the site fallback', () => {
    for (const path of ['', 'nope', 'settings', 'sub']) {
        assert.equal(decideRoute(path, 'xray').kind, 'unknown');
    }
});

test('the portal no longer advertises a link without ?app=', () => {
    const source = readFileSync(join(root, 'src/handlers/subscription.ts'), 'utf8');
    const autoLink = source.match(/auto:\s*`([^`]+)`/);

    assert.ok(autoLink, 'the portal payload should still expose an auto link');
    assert.match(
        autoLink[1], /\?app=/,
        'the portal auto link must name a client, or it walks into the unsupported branch'
    );
});
