import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'https://sorenavisaplatform-production.up.railway.app';

export async function POST(request: NextRequest) {
  const body = await request.json();

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json({ message: 'Could not reach backend' }, { status: 503 });
  }

  const data = await backendRes.json();

  if (!backendRes.ok) {
    return NextResponse.json(
      { message: data?.message || 'Invalid credentials' },
      { status: backendRes.status },
    );
  }

  const response = NextResponse.json({
    role: data.role,
    name: data.name,
    email: data.email,
  });

  response.cookies.set(COOKIE_NAME, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });

  return response;
}
