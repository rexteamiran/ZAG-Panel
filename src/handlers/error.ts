import { decompressGzipBase64, safeError } from '@common';

export async function renderError(error: any): Promise<Response> {
    const str = await decompressGzipBase64(ERROR_HTML_CONTENT);
    const html = str
        .replace('__ERROR_MESSAGE__', safeError(error))
        .replaceAll('__ICON__', ICON_CONTENT);

    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

/**
 * Shown when the worker runs without a `zag_db` binding — the panel's only
 * storage. This is the shape of a panel deployed by an older wizard or one
 * whose bindings were dropped: rather than crash on every request, say
 * plainly what has to happen.
 */
export function renderReinstall(): Response {
    return new Response(`<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ZAGROOO Panel — reinstall required</title>
    <style>
        body { margin: 0; min-height: 100vh; display: grid; place-items: center;
               font-family: system-ui, sans-serif; background: #10262A; color: #FBF3E7; }
        .card { max-width: 460px; padding: 2rem 2.5rem; text-align: center;
                background: #1B3B3F; border: 1px solid rgba(251,243,231,.15); border-radius: 16px; }
        h1 { font-size: 1.15rem; margin: 0 0 .75rem; }
        p { line-height: 1.7; color: rgba(251,243,231,.75); margin: 0 0 1.25rem; }
        a { color: #E9B489; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Reinstall required</h1>
        <p>This panel is running without its database binding, so it cannot store
           settings, limits or usage. Panels built before version 1.3.0 must be
           installed again with the current ZAGROOO Wizard.</p>
        <a href="https://github.com/rexteamiran/ZAG-Wizard">Open the ZAGROOO Wizard &rarr;</a>
    </div>
</body>
</html>`, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}