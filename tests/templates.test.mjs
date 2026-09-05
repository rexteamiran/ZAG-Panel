/**
 * The template library.
 *
 * Templates are what a non-technical operator picks instead of understanding
 * 97 fields, so a broken one is worse than no template at all. These assert
 * the three ways a template can be quietly wrong:
 *
 *  - it carries a field that must never be copied between panels;
 *  - its fragment numbers disagree with the preset table the admin UI will
 *    re-apply, so saving silently changes them;
 *  - it fails the panel's own validator, so applying it returns an error.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const result = await build({
    entryPoints: [join(root, 'src/settings/templates.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    define: { _VL_: '"vless"', _TR_: '"trojan"' }
});

const { settingsTemplates } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);

/** Recomputed by updateDataset(); copying them writes a stale value. */
const DERIVED = ['remoteDnsHost', 'upstreamParams', 'chainProxyParams'];
/** Specific to one panel. */
const PER_PANEL = ['customDomain', 'remoteSettings', 'panelVersion'];
/** The operator's own work, which a template must not wipe. */
const OPERATOR_OWNED = ['customSubs', 'customConfigs', 'customCdnAddrs', 'customCdnHost', 'customCdnSni'];

const TLS_PORTS = [443, 8443, 2053, 2083, 2087, 2096];

test('there are at least twenty templates, with unique ids', () => {
    assert.ok(settingsTemplates.length >= 20, `only ${settingsTemplates.length} templates`);

    const ids = settingsTemplates.map(t => t.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate template id');
});

test('every template is named and described in both languages', () => {
    for (const template of settingsTemplates) {
        for (const field of ['name', 'description']) {
            assert.ok(template[field]?.en?.trim(), `${template.id}: missing English ${field}`);
            assert.ok(template[field]?.fa?.trim(), `${template.id}: missing Persian ${field}`);
        }

        if (template.warning) {
            assert.ok(template.warning.en?.trim(), `${template.id}: warning has no English`);
            assert.ok(template.warning.fa?.trim(), `${template.id}: warning has no Persian`);
        }
    }
});

test('no template carries a derived or per-panel field', () => {
    for (const template of settingsTemplates) {
        for (const key of [...DERIVED, ...PER_PANEL]) {
            assert.ok(
                !(key in template.settings),
                `${template.id} carries ${key}, which must never move between panels`
            );
        }
    }
});

test('no template wipes the operator\'s own lists', () => {
    for (const template of settingsTemplates) {
        for (const key of OPERATOR_OWNED) {
            assert.ok(
                !(key in template.settings),
                `${template.id} would overwrite ${key}, which belongs to the operator`
            );
        }
    }
});

test('every template keeps at least one TLS port', () => {
    // validatePorts refuses a configuration with no TLS port.
    for (const template of settingsTemplates) {
        const ports = template.settings.ports ?? [];
        assert.ok(
            ports.some(port => TLS_PORTS.includes(port)),
            `${template.id} has no TLS port: ${JSON.stringify(ports)}`
        );
    }
});

test('no template puts a Cloudflare resolver in remoteDNS', () => {
    // validateRemoteDNS rejects these: the panel cannot resolve itself.
    for (const template of settingsTemplates) {
        const dns = String(template.settings.remoteDNS ?? '');
        assert.ok(
            !/1\.1\.1\.1|1\.0\.0\.1|cloudflare-dns|one\.one\.one\.one/i.test(dns),
            `${template.id} uses a Cloudflare resolver for remoteDNS: ${dns}`
        );
    }
});

test('fragment numbers agree with the preset table the panel re-applies', () => {
    // handleFragmentMode() overwrites these four whenever the mode is not
    // 'custom', so a mismatch means the saved panel silently differs from the
    // template the operator chose.
    const script = readFileSync(join(root, 'src/assets/panel/script.js'), 'utf8');
    const block = script.slice(script.indexOf('const configs = {'));

    const presets = {};
    for (const [, mode, values] of block.matchAll(/(low|medium|high|severe):\s*\[([^\]]+)\]/g)) {
        presets[mode] = values.split(',').map(value => Number(value.trim()));
    }

    assert.ok(Object.keys(presets).length >= 4, 'could not read the preset table from script.js');

    for (const template of settingsTemplates) {
        const mode = template.settings.fragmentMode;
        if (!mode || mode === 'custom') continue;

        const expected = presets[mode];
        assert.ok(expected, `${template.id} uses unknown fragment mode "${mode}"`);

        const actual = [
            template.settings.fragmentLengthMin,
            template.settings.fragmentLengthMax,
            template.settings.fragmentDelayMin,
            template.settings.fragmentDelayMax
        ];

        assert.deepEqual(
            actual, expected,
            `${template.id} declares ${mode} but its numbers differ from the panel's preset`
        );
    }
});

test('every fragment mode used is one the type allows', () => {
    const types = readFileSync(join(root, 'src/types/settings.ts'), 'utf8');
    const declared = [...types.matchAll(/export type FragmentMode =([^;]+);/g)][0][1]
        .split('|')
        .map(part => part.trim().replace(/'/g, ''));

    for (const template of settingsTemplates) {
        const mode = template.settings.fragmentMode;
        if (!mode) continue;
        assert.ok(declared.includes(mode), `${template.id} uses fragment mode "${mode}", not in the type`);
    }
});

test('applying one template after another leaves nothing behind', () => {
    // Every template spreads over the same baseline, so the same keys are
    // always present — otherwise template B would inherit A's toggles.
    const keys = settingsTemplates.map(t => new Set(Object.keys(t.settings)));
    const first = keys[0];

    for (let i = 1; i < keys.length; i++) {
        const missing = [...first].filter(key => !keys[i].has(key));
        assert.deepEqual(
            missing, [],
            `${settingsTemplates[i].id} does not reset ${missing.join(', ')} — a previous template would leak through`
        );
    }
});

test('rule-heavy templates warn, and sanction lists hold domains only', () => {
    for (const template of settingsTemplates) {
        const usesBypass = Object.entries(template.settings)
            .some(([key, value]) => key.startsWith('bypass') && key !== 'bypassIran' && value === true);

        if (usesBypass) {
            assert.ok(
                template.settings.antiSanctionDNS,
                `${template.id} routes around sanctions but sets no anti-sanction DNS, so it would not work`
            );
        }

        // validateCustomBypassSanction accepts domains, not IPs or CIDRs.
        for (const rule of template.settings.customBypassSanctionRules ?? []) {
            assert.ok(
                !/^\d+\.\d+\.\d+\.\d+/.test(rule) && !rule.includes('/'),
                `${template.id} has a non-domain sanction rule: ${rule}`
            );
        }
    }
});
