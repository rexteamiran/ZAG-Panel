import { getGlobals } from '@settings';

export async function handleDoH(request: Request): Promise<Response> {
    const { dohUrl, searchParams } = getGlobals();
    const targetURL = new URL(dohUrl);
    searchParams.forEach((value, key) => {
        targetURL.searchParams.set(key, value);
    });

    // Forward only what the DoH endpoint needs. Cloning the incoming request
    // would also relay this panel's cookies and the original Content-Type.
    const proxyRequest = new Request(targetURL.toString(), {
        method: request.method,
        headers: { accept: request.headers.get('accept') ?? 'application/dns-message' },
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual'
    });
    return fetch(proxyRequest);
}