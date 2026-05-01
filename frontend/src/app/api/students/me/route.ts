import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

const COOKIE_NAME = 'sorena_session';

export async function GET(_req: NextRequest) {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const res = await fetch(`${API_URL}/students/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
