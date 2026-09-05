import { HttpStatus, respond } from '@common';
import { SignJWT, jwtVerify } from 'jose';
import { getGlobals } from '@settings';
import { storeGet, storePut } from '@settings/store';
import { recordError } from '@settings/errorlog';

export function logout(): Response {
    return respond(true, HttpStatus.OK, 'Successfully logged out!', null, {
        'Set-Cookie': 'jwtToken=; Path=/; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Content-Type': 'text/plain'
    });
}

export async function generateJWTToken(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
        return respond(false, HttpStatus.METHOD_NOT_ALLOWED, 'Method not allowed.');
    }

    const data = await request.json().catch(() => null) as any;
    if (!data || typeof data.username !== 'string' || typeof data.password !== 'string') {
        return respond(false, HttpStatus.BAD_REQUEST, 'Malformed request.');
    }

    const savedPass = await storeGet<string>(env, 'pwd');
    const { accEmail } = getGlobals();
    const username = data.username?.toLowerCase();
    if (username !== accEmail || data.password !== savedPass) {
        // Record, don't just reject: repeated failures here are the one
        // signal an operator gets that someone is knocking on the door.
        await recordError(env, 'auth', 'Failed login attempt', `Username: ${username ?? '(none)'}`, 'warn');
        return respond(false, HttpStatus.UNAUTHORIZED, 'Wrong Credentials.');
    }

    let secretKey = await storeGet<string>(env, 'secretKey');
    if (!secretKey) {
        secretKey = generateSecretKey();
        await storePut(env, 'secretKey', secretKey);
    }

    const secret = new TextEncoder().encode(secretKey);
    const { accID } = getGlobals();
    const jwtToken = await new SignJWT({ id: accID })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secret);

    return respond(true, HttpStatus.OK, 'Successfully generated Auth token', null, {
        'Set-Cookie': `jwtToken=${jwtToken}; Path=/; HttpOnly; Secure; Max-Age=${24 * 60 * 60}; SameSite=Strict`,
        'Content-Type': 'text/plain',
    });
}

function generateSecretKey(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);

    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function authenticate(request: Request, env: Env): Promise<boolean> {
    try {
        const secretKey = await storeGet<string>(env, 'secretKey');
        if (secretKey === null) {
            console.log('Secret key not found in the panel store.');
            return false;
        }

        const secret = new TextEncoder().encode(secretKey);
        const cookie = request.headers.get('Cookie')?.match(/(^|;\s*)jwtToken=([^;]*)/);
        const token = cookie ? cookie[2] : null;
        if (!token) {
            console.log('Unauthorized: Token not available!');
            return false;
        }

        const { payload } = await jwtVerify(token, secret);
        console.log(`Successfully authenticated, User ID: ${payload.id}`);

        return true;
    } catch (error) {
        console.log(error);
        return false;
    }
}

export async function resetPassword(request: Request, env: Env): Promise<Response> {
    const auth = await authenticate(request, env);
    const oldPwd = await storeGet<string>(env, 'pwd');
    if (oldPwd && !auth) {
        return respond(false, HttpStatus.UNAUTHORIZED, 'Unauthorized.');
    }

    const data = await request.json().catch(() => null) as any;
    if (!data || typeof data.password !== 'string') {
        return respond(false, HttpStatus.BAD_REQUEST, 'Malformed request.');
    }
    const { accEmail } = getGlobals();

    if (!auth && !data.username) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Missing username.');
    }

    if (data.username && data.username !== accEmail) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Wrong username.');
    }

    if (data.password === oldPwd) {
        return respond(false, HttpStatus.BAD_REQUEST, 'Please enter a new Password.');
    }

    // The login form enforces this too; a direct API call must not be able to
    // write a weaker password than the UI would accept.
    if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(data.password)) {
        return respond(
            false,
            HttpStatus.BAD_REQUEST,
            'Password must contain a capital letter, a number, and be at least 8 characters long.'
        );
    }

    await storePut(env, 'pwd', data.password);

    return respond(true, HttpStatus.OK, 'Successfully logged in!', null, {
        'Set-Cookie': 'jwtToken=; Path=/; Secure; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Content-Type': 'text/plain',
    });
}