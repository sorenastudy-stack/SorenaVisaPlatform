import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

// Two-step magic-link — the CONFIRM step. The confirm page POSTs {token,email}
// here on an explicit user click; we forward to the backend which consumes the
// single-use token + mints the JWT, then we set the same httpOnly session
// cookie the password/Google login uses. The JWT is NEVER returned to the
// browser — only { role } for the client-side redirect.

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'https://api.sorenavisa.com';

export async function POST(request: NextRequest) {
  const body = await request.json();

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND}/auth/magic-link/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
