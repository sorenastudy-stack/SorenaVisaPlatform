import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ProviderShell } from '@/components/provider/ProviderShell';

// PR-PROVIDER-PORTAL slice C — the institution's portal.
//
// PROVIDER only, mirroring the agent portal. Staff are deliberately not
// admitted: an Owner wanting to see an institution's view has the staff-side
// provider screen, and letting staff in here would give this surface two kinds
// of caller with two meanings of "my institution".
//
// This redirect is convenience. The boundary is ProviderAccessGuard on the API —
// every route refuses a caller the guard has not resolved, whatever the browser
// was allowed to render.
export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/provider');
  if (session.role !== 'PROVIDER') redirect('/unauthorized');

  return <ProviderShell>{children}</ProviderShell>;
}
