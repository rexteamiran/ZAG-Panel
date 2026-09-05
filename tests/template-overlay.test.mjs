/**
 * Request-scoped settings.
 *
 * Every config builder reads getSettings(), which composed two module-level
 * variables. That was safe only while every request wanted the same answer.
 * Template links (`?tpl=`) break that assumption: two customers can follow two
 * different template links against the same panel, and the builders await in
 * the middle of their work — so without scoping they would read each other's
 * settings and each get the wrong configuration.
 *
 * This is the test that proves the scoping holds under interleaving.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const result = await build({
    entryPoints: [join(root, 'src/settings/overlay.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['node:async_hooks'],
    logLevel: 'silent'
});

const { withSettings, scopedSettings } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a scoped request sees its own settings', async () => {
    const result = await withSettings({ fingerprint: 'android' }, async () => scopedSettings().fingerprint);
    assert.equal(result, 'android');
});

test('outside a request there is no scope, so the panel\'s own settings apply', () => {
    assert.equal(scopedSettings(), undefined);
});

test('two template requests interleaving do not read each other', async () => {
    // Mimics the builders: read, await, read again. Without scoping the second
    // read returns whatever the other request set in between.
    async function serve(template, delay) {
        return withSettings({ template }, async () => {
            const before = scopedSettings().template;
            await sleep(delay);
            const after = scopedSettings().template;
            return { before, after };
        });
    }

    const [a, b, c] = await Promise.all([
        serve('mobile-data', 30),
        serve('gaming', 10),
        serve('family-safe', 20)
    ]);

    assert.deepEqual(a, { before: 'mobile-data', after: 'mobile-data' });
    assert.deepEqual(b, { before: 'gaming', after: 'gaming' });
    assert.deepEqual(c, { before: 'family-safe', after: 'family-safe' });
});

test('the scope survives nested awaits, as the builders use', async () => {
    const seen = await withSettings({ ports: [443, 8443] }, async () => {
        const collected = [];

        // getConfigAddresses / fetchCustomSubs nest several levels deep.
        async function inner(depth) {
            await sleep(1);
            collected.push(scopedSettings()?.ports?.length);
            if (depth > 0) await inner(depth - 1);
        }

        await inner(4);
        return collected;
    });

    assert.deepEqual(seen, [2, 2, 2, 2, 2], 'the scope was lost somewhere down the call stack');
});

test('many concurrent requests each keep their own template', async () => {
    const requests = Array.from({ length: 50 }, (_, i) =>
        withSettings({ id: i }, async () => {
            await sleep(Math.random() * 20);
            return scopedSettings().id === i;
        })
    );

    const results = await Promise.all(requests);
    assert.ok(results.every(Boolean), 'at least one request saw another request\'s settings');
});
