import { NextRequest, NextResponse } from 'next/server';

// Path A — anonymous scorecard submit proxy.
//
// The client posts the completed answers here (same-origin). We forward to the
// PUBLIC backend endpoint, which resolves-or-creates a LEAD by email:
//   • { mode:'created' }  → a brand-new LEAD; a "Create Your Password" link was
//     emailed. NO session is set here — the client sets a password via the
//     email link, then lands in the portal.
//   • { mode:'existing' } → a magic-link was emailed; no session.
// No session cookie is EVER set on this route anymore (the old auto-session on
// new accounts was removed in favour of the set-password onboarding). The
// original client IP + UA are forwarded so the backend's 5/min/IP throttle and
// audit metadata see the real visitor, not the Next server.

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
    message?: string;
  };

  if (!backendRes.ok) {
    return NextResponse.json(
      { message: data?.message || 'Submission failed. Please try again.' },
      { status: backendRes.status },
    );
  }

  // Pass the mode straight through — no cookie is set here anymore. Both modes
  // resolve to a "check your email" screen on the client (the copy differs).
  //   created  → new LEAD, "Create Your Password" email sent.
  //   existing → existing account, magic-link sent.
  return NextResponse.json({ mode: data?.mode === 'created' ? 'created' : 'existing' });
}
