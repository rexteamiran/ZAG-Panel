import { authenticate } from '@auth';
import { decompressGzipBase64, HttpStatus, respond, safeError } from '@common';
import { getGlobals } from '@settings';
import { storeGet } from '@settings/store';
import { clearErrorEvents, getErrorEvents } from '@settings/errorlog';
import { fallback } from './utils';

/* ==========================================================================
   Event log — the operator's window into what went wrong, and where.
   Reading it needs an admin session, exactly like the panel itself.
   ========================================================================== */

export async function handleLog(request: Request, env: Env): Promise<Response> {
    const { pathname } = getGlobals();
    const parts = pathname.split('/');
    const path = parts.slice(2).join('/');

    switch (path) {
        case 'log':
            return renderLog(request, env);

        case 'log/api':
            return logApi(request, env);

        default:
            return fallback(request);
    }
}

async function renderLog(request: Request, env: Env): Promise<Response> {
    const pwd = await storeGet<string>(env, 'pwd');
    if (pwd) {
        const auth = await authenticate(request, env);
        if (!auth) {
            const url = new URL('../login', request.url);
            return Response.redirect(url, 302);
        }
    }

    const str = await decompressGzipBase64(LOG_HTML_CONTENT);
    const html = str.replaceAll('__ICON__', ICON_CONTENT);

    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

async function logApi(request: Request, env: Env): Promise<Response> {
    const auth = await authenticate(request, env);
    if (!auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized or expired session.');
    }

    try {
        if (request.method === 'GET') {
            return respond(true, HttpStatus.OK, '', { events: await getErrorEvents(env) });
        }

        if (request.method === 'DELETE') {
            await clearErrorEvents(env);
            return respond(true, HttpStatus.OK, 'Event log cleared.');
        }

        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    } catch (error) {
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Could not read the log: ${safeError(error)}`);
    }
}
