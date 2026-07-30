import { NextRequest, NextResponse } from 'next/server';

// PR-PHASE33 — proxy: server-authoritative Q30 allowed-field set for Q32 filtering.
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://api.sorenavisa.com';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('qualificationFieldId') ?? '';
  try {
    const res = await fetch(`${BACKEND}/public/matching/allowed-fields?qualificationFieldId=${encodeURIComponent(q)}`, { cache: 'no-store' });
    const data = await res.json().catch(() => []);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Could not reach backend' }, { status: 503 });
  }
}
