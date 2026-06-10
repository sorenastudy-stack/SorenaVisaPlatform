import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

/**
 * Option C step 2 — accept a JWT minted by the backend's
 * /auth/google/callback (delivered to /auth/callback via URL fragment),
 * and set it in the same httpOnly cookie the password-login flow uses.
 *
 * Why a route handler rather than letting the page set the cookie:
 * cookies set from a client component via document.cookie cannot be
 * httpOnly. The route handler runs server-side, can set httpOnly,
 * and matches the password-login cookie shape byte-for-byte.
 *
 * Security:
 *   - role from the body is NOT trusted. The cookie's JWT is what
 *     protected endpoints verify; role is used client-side for
 *     redirect convenience only.
 *   - token is validated as a non-empty string. We don't verify the
 *     JWT signature here — the backend verifies on every protected
 *     call via JwtStrategy. A bad token here just produces an
 *     unusable cookie that the backend will reject on first use.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }

  const token = (body as { token?: unknown })?.token;
  if (typeof token !== 'string' || token.length === 0) {
    return NextResponse.json({ message: 'token required' }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });

  // Cookie attributes MUST match src/app/api/auth/login/route.ts —
  // any drift would let one login flow set a cookie the other
  // can't read or reject as malformed.
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });

  return response;
}
