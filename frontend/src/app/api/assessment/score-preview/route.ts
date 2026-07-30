import { NextRequest, NextResponse } from 'next/server';

// PR-PHASE33 — proxy: score-only preview (no lead, no persistence) for the v2
// assessment result screen. Byte-identical to the live engine.
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://api.sorenavisa.com';

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    const res = await fetch(`${BACKEND}/scorecard/public/score-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Could not reach backend' }, { status: 503 });
  }
}
