import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

// Path A — anonymous scorecard submit proxy.
//
// The client posts the completed answers here (same-origin) so we can set the
// httpOnly session cookie the rest of the app uses. We forward to the PUBLIC
// backend endpoint, which resolves-or-creates a LEAD by email:
//   • { mode:'new', token } → set sorena_session (client lands on the result
//     page signed in). The token is NEVER returned to the browser.
//   • { mode:'existing' }   → a magic-link was emailed; no session.
// The original client IP + UA are forwarded so the backend's 5/min/IP throttle
// and audit metadata see the real visitor, not the Next server.

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'https://api.sorenavisa.com';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const xff = request.headers.get('x-forwarded-for') ?? '';
  const ua = request.headers.get('user-agent') ?? '';

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND}/scorecard/public/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(xff ? { 'x-forwarded-for': xff } : {}),
        ...(ua ? { 'user-agent': ua } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json({ message: 'Could not reach backend' }, { status: 503 });
  }

  const data = (await backendRes.json().catch(() => ({}))) as {
    mode?: string;
    token?: string;
    message?: string;
  };

  if (!backendRes.ok) {
    return NextResponse.json(
      { message: data?.message || 'Submission failed. Please try again.' },
      { status: backendRes.status },
    );
  }

  // Existing account (client OR staff): no session — the magic-link was sent.
  if (data?.mode !== 'new' || !data?.token) {
    return NextResponse.json({ mode: 'existing' });
  }

  // New account: set the same httpOnly cookie the password/Google login uses.
  const response = NextResponse.json({ mode: 'new' });
  response.cookies.set(COOKIE_NAME, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  return response;
}
