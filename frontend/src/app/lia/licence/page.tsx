import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { LicencePageClient } from './LicencePageClient';

// PR-DOCUSIGN-1 step 3 (Screen A) — LIA self-service for IAA licence
// credentials. Wires to the four LIA-self endpoints:
//   E1 GET  /staff/lia-profile/me
//   E2 PUT  /staff/lia-profile/me/licence-number
//   E3 POST /staff/lia-profile/me/licence-file
//   E4 GET  /staff/lia-profile/me/licence-file/download-url
//
// The backend gates these routes to @Roles('LIA'). A non-LIA who
// somehow reaches this URL would get a 403 on the first API call —
// we redirect server-side so the UX stays clean and consistent with
// the rest of the LIA portal's role gating.

export default async function LiaLicencePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/lia/licence');
  if (session.role !== 'LIA') redirect('/lia');
  return <LicencePageClient />;
}
