import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { LicencePageClient } from '@/app/lia/licence/LicencePageClient';

// LIA licence self-service, surfaced inside the unified /staff portal.
//
// LIA advisers land on /staff post-login (role-redirect.ts), but the
// original licence screen lives in the legacy /lia portal and was only
// reachable by direct URL — so an LIA had no way to find it. This route
// re-hosts the SAME, proven client component (LicencePageClient) inside
// the /staff shell and is linked from the LIA-only sidebar entry.
//
// Gating: the backend routes are @Roles('LIA') (own-JWT only). We redirect
// non-LIA server-side so the UX stays clean — a non-LIA who reached this
// URL would otherwise just get 403s on the first API call. OWNER/ADMIN
// review licences from /staff/lia-verification, not here.

export default async function StaffLiaProfilePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/lia-profile');
  if (session.role !== 'LIA') redirect('/staff');
  return <LicencePageClient backHref="/staff" backLabel="Back to portal" />;
}
