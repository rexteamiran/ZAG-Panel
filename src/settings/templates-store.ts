import { KvSettings } from '#types/settings';
import { settingsTemplates, SettingsTemplate, TemplateSettings } from '@templates';
import { safeError } from '@common';
import { storeGet, storePut } from './store';

/* ==========================================================================
   Template storage

   Built-in templates ship inside the worker. Custom ones the operator saved,
   and the set they chose to show customers, live in the panel's D1 store
   beside the panel's settings.

   The enabled set is what the subscriber portal shows: a customer should see
   four or five links they can choose between, not twenty-four.
   ========================================================================== */

export interface CustomTemplate {
    id: string;
    name: string;
    description: string;
    createdAt: number;
    settings: TemplateSettings;
}

export interface TemplateStore {
    /** Ids visible on the subscriber portal, in the order they appear. */
    enabled: string[];
    custom: CustomTemplate[];
}

const emptyStore = (): TemplateStore => ({ enabled: [], custom: [] });

let cache: TemplateStore | null = null;
let cachedAt = 0;

/** Short, because the wizard can write this record directly. */
const TTL_MS = 60_000;

export async function getTemplateStore(env: Env): Promise<TemplateStore> {
    if (cache && Date.now() - cachedAt < TTL_MS) return cache;

    try {
        const stored = await storeGet<Partial<TemplateStore>>(env, 'templates');
        cache = {
            enabled: Array.isArray(stored?.enabled) ? stored!.enabled : [],
            custom: Array.isArray(stored?.custom) ? stored!.custom : []
        };
    } catch (error) {
        console.log('Could not read templates:', safeError(error));
        cache = emptyStore();
    }

    cachedAt = Date.now();
    return cache;
}

export async function saveTemplateStore(env: Env, store: TemplateStore): Promise<TemplateStore> {
    cache = store;
    cachedAt = Date.now();
    await storePut(env, 'templates', store);
    return store;
}

/** Built-ins plus the operator's own, in one list. */
export async function allTemplates(env: Env): Promise<SettingsTemplate[]> {
    const store = await getTemplateStore(env);

    const custom: SettingsTemplate[] = store.custom.map(template => ({
        id: template.id,
        family: 'advanced',
        name: { en: template.name, fa: template.name },
        description: { en: template.description, fa: template.description },
        settings: template.settings
    }));

    return [...settingsTemplates, ...custom];
}

/** The settings a template link should apply, or null when there is no such template. */
export async function resolveTemplate(env: Env, id: string): Promise<TemplateSettings | null> {
    const templates = await allTemplates(env);
    return templates.find(template => template.id === id)?.settings ?? null;
}

/**
 * What the subscriber portal offers.
 *
 * Only what the operator enabled, and only ids that still exist — a template
 * deleted after being enabled must not leave a dead link on the portal.
 */
export async function enabledTemplates(env: Env): Promise<SettingsTemplate[]> {
    const [store, templates] = await Promise.all([getTemplateStore(env), allTemplates(env)]);
    const byId = new Map(templates.map(template => [template.id, template]));

    return store.enabled
        .map(id => byId.get(id))
        .filter((template): template is SettingsTemplate => Boolean(template));
}

/** Keys a custom template may carry — the same subset the built-ins use. */
const FORBIDDEN: Array<keyof KvSettings> = [
    'customDomain',
    'remoteSettings',
    'panelVersion',
    'remoteDnsHost',
    'upstreamParams',
    'chainProxyParams'
];

/**
 * Strips anything a template must not carry between panels.
 * Returns the cleaned settings and what was dropped, so an import can say so.
 */
export function sanitiseTemplateSettings(
    settings: Record<string, unknown>
): { settings: TemplateSettings; dropped: string[] } {
    const out: Record<string, unknown> = {};
    const dropped: string[] = [];

    for (const [key, value] of Object.entries(settings ?? {})) {
        if (FORBIDDEN.includes(key as keyof KvSettings)) {
            dropped.push(key);
            continue;
        }

        out[key] = value;
    }

    return { settings: out as TemplateSettings, dropped };
}

export function invalidateTemplateCache(): void {
    cache = null;
    cachedAt = 0;
}
