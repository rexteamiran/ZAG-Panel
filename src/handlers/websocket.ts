import { HttpStatus } from '@common';
import { TrOverWSHandler } from '@protocols/trojan';
import { VlOverWSHandler } from '@protocols/vless';
import { getGlobals } from '@settings';
import { deviceLimitExceeded, evaluateAccess, pauseCauseFor, setActiveLimits, touchDevice } from '@limits';
import { bindContext, getLimits, getUsageSnapshot, maybeRollMonth, saveLimits, withPending } from '@usage';
import { notifyAutoPause } from '@api/telegram';
import { fallback } from './utils';

export async function handleWebsocket(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const { pathname } = getGlobals();
    const protocol = pathname.split('/')[1];

    try {
        bindContext(env, ctx);
        let limits = await getLimits(env);

        // Roll the month before deciding, not only when traffic flows. A panel
        // that hit its quota refuses traffic, so a flush-only reset could never
        // fire and the subscription stayed dead through its own renewal.
        if (await maybeRollMonth(env, limits)) {
            limits = await getLimits(env);
        }

        setActiveLimits(limits);

        const usage = withPending(await getUsageSnapshot(env));
        const verdict = evaluateAccess(limits, usage);

        if (!verdict.allowed) {
            // Record why, so the state the portal and the wizard show matches
            // the reason, and so an automatic pause can lift itself later.
            const cause = pauseCauseFor(verdict.reason);
            const alreadyRecorded = limits.isPaused && limits.pausedBy === cause;

            if (!alreadyRecorded && cause !== 'daily-quota') {
                const paused = {
                    ...limits,
                    isPaused: true,
                    pauseReason: verdict.message,
                    pausedBy: cause,
                    pausedAt: Date.now()
                };

                const task = (async () => {
                    await saveLimits(env, paused);
                    await notifyAutoPause(env, verdict.message);
                })().catch(error => console.log('Auto-pause failed:', error));

                ctx ? ctx.waitUntil(task) : void task;
            }

            return new Response(verdict.message, { status: HttpStatus.FORBIDDEN });
        }

        // The gate allowed this, so any automatic pause no longer applies —
        // a quota was raised, an expiry extended, or the month rolled over.
        if (limits.isPaused) {
            const revived = { ...limits, isPaused: false, pauseReason: '', pausedBy: '' as const, pausedAt: 0 };
            const task = saveLimits(env, revived).catch(error => console.log('Auto-resume failed:', error));
            ctx ? ctx.waitUntil(task) : void task;
            setActiveLimits(revived);
        }

        const clientIp = request.headers.get('cf-connecting-ip') ?? '';
        if (deviceLimitExceeded(clientIp, limits.maxDevices)) {
            return new Response(
                `Device limit reached (${limits.maxDevices} concurrent connections).`,
                { status: HttpStatus.FORBIDDEN }
            );
        }
        touchDevice(clientIp);

        switch (protocol) {
            case 'vl':
                return VlOverWSHandler(request);

            case 'tr':
                return TrOverWSHandler(request);

            default:
                return fallback(request);
        }
    } catch (error) {
        console.log('Websocket handler error:', error);
        return new Response('Bad Request', { status: HttpStatus.BAD_REQUEST });
    }
}
