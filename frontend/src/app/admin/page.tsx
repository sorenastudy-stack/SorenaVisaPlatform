import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/Card';
import {
  FileText, Users, ShieldCheck, Settings, Briefcase, UserPlus, ArrowRight,
} from 'lucide-react';

// Admin landing hub. Replaces the retired legacy monolith dashboard (which ran
// its own parallel localStorage-token login + hardcoded API URL). Admins are
// already authenticated via the platform session + RBAC (the /admin layout
// gates to ADMIN/SUPER_ADMIN/OWNER), so there is no second login here — just
// links to the real surfaces. The lead list / notes / manual lead-create and
// the consultation-link generator that used to live here now live in the
// Sales portal (the generator moved to the lead-detail page).

interface HubLink {
  label: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  ownerOnly?: boolean; // Audit log endpoint is OWNER/SUPER_ADMIN only.
}

const LINKS: HubLink[] = [
  { label: 'Audit Log', description: 'Immutable record of every system action.', href: '/admin/audit', icon: <FileText size={20} />, ownerOnly: true },
  { label: 'Leads', description: 'Pipeline, lead detail, and consultation payment links.', href: '/sales/leads', icon: <UserPlus size={20} /> },
  { label: 'Cases', description: 'Cross-case operations view.', href: '/ops/cases', icon: <Briefcase size={20} /> },
  { label: 'Staff Users', description: 'Manage staff accounts.', href: '/staff/users', icon: <Users size={20} /> },
  { label: 'Approvals', description: 'Owner-approval (dual-control) queue.', href: '/staff/approvals', icon: <ShieldCheck size={20} /> },
  { label: 'Platform Settings', description: 'Booking URLs and platform configuration.', href: '/staff/platform-settings', icon: <Settings size={20} /> },
];

export default async function AdminHubPage() {
  const session = await getSession();
  const isOwnerTier = session?.role === 'OWNER' || session?.role === 'SUPER_ADMIN';
  const links = LINKS.filter((l) => !l.ownerOnly || isOwnerTier);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1E3A5F] mb-1">Admin</h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">Jump to the tool you need.</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="group">
            <Card className="h-full transition-colors hover:border-[#F3CE49]/60">
              <CardContent className="py-5">
                <div className="flex items-start gap-3">
                  <span className="text-[#b8941f]">{l.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-semibold text-[#1E3A5F]">
                      {l.label}
                      <ArrowRight size={14} className="opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <p className="mt-0.5 text-sm text-[#4A4A4A]/70">{l.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
