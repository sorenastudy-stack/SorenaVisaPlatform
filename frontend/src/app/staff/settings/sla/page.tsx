import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { SlaSettingsClient } from '@/components/staff/sla/SlaSettingsClient';

// PR-SLA — Owner-manageable stage deadlines. OWNER / SUPER_ADMIN only.
const ALLOWED = new Set(['OWNER', 'SUPER_ADMIN']);

export default async function SlaSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/staff/settings/sla');
  if (!ALLOWED.has(session.role)) redirect('/staff');
  return <SlaSettingsClient />;
}
