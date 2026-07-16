import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

// Phase F — staff password RESET completion. The /reset-password page POSTs
// {token, email, password} here; we forward to the backend which consumes the
// single-use token, sets the new password, and mints the JWT. We set the same
// httpOnly session cookie the login/set-password flows use. The JWT is NEVER
// returned to the browser — only { role } for the client-side redirect.

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'https://api.sorenavisa.com';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const xff = request.headers.get('x-forwarded-for') ?? '';

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND}/auth/password-reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(xff ? { 'x-forwarded-for': xff } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json({ message: 'Could not reach backend' }, { status: 503 });
  }

  const data = (await backendRes.json().catch(() => ({}))) as {
    token?: string;
    role?: string;
    message?: string;
  };

  if (!backendRes.ok || !data?.token) {
    // 401 → invalid/expired/replayed token. 400 → password strength. Preserve
    // the status so the page can distinguish "bounce to login" from "inline".
    return NextResponse.json(
      { message: data?.message || 'Invalid or expired link' },
      { status: backendRes.status || 401 },
    );
  }

  const response = NextResponse.json({ role: data.role });
  response.cookies.set(COOKIE_NAME, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  return response;
}
