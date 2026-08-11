import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { SalesConsultationsClient } from '@/components/sales/consultations/SalesConsultationsClient';

// PR-SALES-CONSULTATIONS — the consultations on a rep's own leads.
//
// Same role set as the rest of the /sales portal; the backend decides what the
// caller actually gets back, so an oversight role landing here sees everything
// without this page needing to know that.
const ALLOWED = new Set(['SALES', 'CONSULTANT', 'ADMIN', 'SUPER_ADMIN', 'OWNER', 'FINANCE']);

export default async function SalesConsultationsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/sales/consultations');
  if (!ALLOWED.has(session.role)) redirect('/unauthorized');
  return <SalesConsultationsClient />;
}
