import { PanelErrorEvent } from '#types/settings';
import { storeGet, storePut } from './store';

/* ==========================================================================
   Event log

   Every caught failure worth knowing about lands here — what broke, from
   where, when. The /log page reads it, so an operator debugging a dead panel
   sees the actual reason instead of a blank screen and a guess.

   The log is a rolling window in the panel's own store: newest last, oldest
   dropped past the cap, and recording never throws — a broken panel must not
   be made worse by its own logging.
   ========================================================================== */

const EVENTS_KEY = 'errors';
const MAX_EVENTS = 200;

export async function recordError(
    env: Env,
    source: string,
    message: string,
    detail?: string,
    level: 'error' | 'warn' = 'error'
): Promise<void> {
    try {
        const log = (await storeGet<PanelErrorEvent[]>(env, EVENTS_KEY)) ?? [];

        log.push({
            id: crypto.randomUUID(),
            ts: Date.now(),
            level,
            source: source.slice(0, 40),
            message: String(message).slice(0, 500),
            detail: detail ? String(detail).slice(0, 2000) : ''
        });

        await storePut(env, EVENTS_KEY, log.slice(-MAX_EVENTS));
    } catch (error) {
        // Logging must never break the request it is trying to report on.
        console.log('Could not record the event:', error);
    }
}

export async function getErrorEvents(env: Env): Promise<PanelErrorEvent[]> {
    const log = (await storeGet<PanelErrorEvent[]>(env, EVENTS_KEY)) ?? [];
    return [...log].reverse();
}

export async function clearErrorEvents(env: Env): Promise<void> {
    await storePut(env, EVENTS_KEY, []);
}
