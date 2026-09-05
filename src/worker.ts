import { handleDoH } from '@handlers/doh';
import { renderError, renderReinstall } from '@handlers/error';
import { handleLogin } from '@handlers/login';
import { handleLog } from '@handlers/log';
import { handlePanel } from '@handlers/panel';
import { handleProxyIPs } from '@handlers/proxy-ip';
import { generateQRCode } from '@handlers/qrcode';
import { handleSubscriptions } from '@handlers/subscription';
import { handleTelegram } from '@handlers/telegram';
import { handlePanelApi } from '@api/panel-api';
import { fallback } from '@handlers/utils';
import { handleWebsocket } from '@handlers/websocket';
import { init, getGlobals } from '@settings';
import { bindContext } from '@usage';
import { recordError } from '@settings/errorlog';
import { safeError } from '@common';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		try {
			if (!env.zag_db) return renderReinstall();

			init(request, env);
			bindContext(env, ctx);
			if (request.headers.get('Upgrade') === 'websocket') return handleWebsocket(request, env, ctx);
			const { securePath, pathname } = getGlobals();
			const path = pathname.split('/').splice(0, 3).join('/');

			switch (path) {
				case `/${securePath}/panel`:
					return handlePanel(request, env);

				case `/${securePath}/login`:
					return handleLogin(request, env);

				case `/${securePath}/log`:
					return handleLog(request, env);

				case `/${securePath}/sub`:
					return handleSubscriptions(request, env);

				case `/${securePath}/api`:
					return handlePanelApi(request, env);

				case `/${securePath}/telegram`:
					return handleTelegram(request, env);

				case `/${securePath}/dns-query`:
					return handleDoH(request);

				case `/${securePath}/proxy-ip`:
					return handleProxyIPs(request, env);

				case `/${securePath}/qrcode`:
					return generateQRCode(request);

				default:
					return fallback(request);
			}
		} catch (error) {
			// Record before rendering, so the /log page shows exactly what this
			// request died of — including the URL that triggered it.
			const task = recordError(env, 'worker', safeError(error), `URL: ${request.url}`)
				.catch(() => null);
			ctx.waitUntil(task);

			return renderError(error);
		}
	}
}
