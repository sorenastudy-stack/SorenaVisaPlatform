import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { LiaVerificationPageClient } from '@/components/staff/lia-verification/LiaVerificationPageClient';

// PR-DOCUSIGN-1 step 3 (Screen B) — OWNER / ADMIN / SUPER_ADMIN
// verification queue. Wires the four verifier endpoints:
//   E5 GET  /staff/lia-profiles/pending-verification
//   E6 GET  /staff/lia-profiles/:userId/licence-file/download-url   (audited)
//   E7 POST /staff/lia-profiles/:userId/verify                       (self-guarded)
//   E8 POST /staff/lia-profiles/:userId/reject                       (self-guarded)
//
// Server-side role gate matches the backend's @Roles set on
// LiaProfilesVerifierController. A non-verifier landing here is
// redirected back to /staff (the backend would 403 anyway; this
// keeps the UX clean and consistent with the rest of /staff/*).

const VERIFIER_TIER = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

export default async function LiaVerificationPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/lia-verification');
  if (!VERIFIER_TIER.has(session.role)) redirect('/staff');
  return <LiaVerificationPageClient />;
}
