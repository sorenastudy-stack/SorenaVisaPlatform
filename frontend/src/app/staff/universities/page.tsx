import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { UniversitiesClient } from '@/components/staff/universities/UniversitiesClient';

// PR-UNIVERSITIES — Owner-managed institution catalog + scholarships.
// OWNER / SUPER_ADMIN only (commercial commission/scholarship terms).
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN']);

export default async function UniversitiesPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/universities');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <UniversitiesClient />;
}
