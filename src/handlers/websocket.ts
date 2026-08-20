import { HttpStatus } from '@common';
import { TrOverWSHandler } from '@protocols/trojan';
import { VlOverWSHandler } from '@protocols/vless';
import { getGlobals } from '@settings';
import { deviceLimitExceeded, evaluateAccess, setActiveLimits, touchDevice } from '@limits';
import { bindContext, getLimits, getUsageSnapshot, saveLimits, withPending } from '@usage';
import { notifyAutoPause } from '@api/telegram';
import { fallback } from './utils';

export async function handleWebsocket(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const { pathname } = getGlobals();
    const protocol = pathname.split('/')[1];

    try {
        bindContext(env, ctx);
        const limits = await getLimits(env);
        setActiveLimits(limits);

        const usage = withPending(await getUsageSnapshot(env));
        const verdict = evaluateAccess(limits, usage);

        if (!verdict.allowed) {
            // Flip the panel to paused on the first refusal so the portal, the
            // API and the Telegram bot all report the same state.
            if (!limits.isPaused && verdict.reason !== 'daily-quota') {
                const paused = { ...limits, isPaused: true, pauseReason: verdict.message, pausedAt: Date.now() };
                const task = (async () => {
                    await saveLimits(env, paused);
                    await notifyAutoPause(env, verdict.message);
                })().catch(error => console.log('Auto-pause failed:', error));

                ctx ? ctx.waitUntil(task) : void task;
            }

            return new Response(verdict.message, { status: HttpStatus.FORBIDDEN });
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
