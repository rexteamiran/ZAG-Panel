import { AsyncLocalStorage } from 'node:async_hooks';
import { RuntimeSettings } from '#types/settings';

/* ==========================================================================
   Request-scoped settings

   Every config builder in src/cores reads getSettings(), which composes two
   module-level variables. That works while every request resolves to the same
   settings — but a template link (`?tpl=`) means two requests in one isolate
   can want different settings, and the builders await in the middle of their
   work (DNS resolution, fetching custom subscriptions). Without scoping they
   would read each other's values and serve the wrong configuration.

   AsyncLocalStorage keeps a composed snapshot attached to the request for as
   long as it runs, across every await. `nodejs_compat` is enabled on all
   deploy paths, so this is available.

   It also closes the same race that already existed for the panel's own
   settings; it was simply invisible while every answer was identical.
   ========================================================================== */

const store = new AsyncLocalStorage<RuntimeSettings>();

/** Runs `fn` with these settings visible to every getSettings() call inside. */
export function withSettings<T>(settings: RuntimeSettings, fn: () => Promise<T>): Promise<T> {
    return store.run(settings, fn);
}

/** The settings for the request in flight, or undefined outside one. */
export function scopedSettings(): RuntimeSettings | undefined {
    return store.getStore();
}
