import { NextResponse } from 'next/server';

// PR-PHASE33 — proxy: StudyField taxonomy for the v2 assessment Q13/Q32 pickers.
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://api.sorenavisa.com';

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/public/matching/study-fields`, { cache: 'no-store' });
    const data = await res.json().catch(() => []);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Could not reach backend' }, { status: 503 });
  }
}
