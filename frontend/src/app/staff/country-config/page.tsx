import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { CountryConfigClient } from '@/components/staff/country-config/CountryConfigClient';

// PR-OWNER-1 (slice a) — Owner-level per-country config (institution distribution
// + AI agent management). OWNER / SUPER_ADMIN may view; only OWNER may edit
// (edit controls gate in-page; the backend independently enforces OWNER on every
// PATCH). Reads are also allowed to SUPER_ADMIN for transparency.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN']);

export default async function CountryConfigPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/country-config');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <CountryConfigClient viewerRole={session.role} />;
}
