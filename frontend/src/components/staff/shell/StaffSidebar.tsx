'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Briefcase, Calendar, Inbox, Users, ShieldCheck,
} from 'lucide-react';
import { useStaff } from '@/contexts/StaffContext';

// PR-CONSULT-2 — Staff sidebar (desktop).
//
// 240px wide navy panel pinned to the left on `lg` and up. Nav items
// are filtered by permission — Staff requires canManageStaff,
// Approvals requires canApprove (OWNER + SUPER_ADMIN). The active
// state uses a gold left-border + lighter bg, matching the locked
// UI rules.

interface NavItem {
  label:  string;
  href:   string;
  icon:   React.ReactNode;
  // Hide when this permission is false; undefined = always show.
  // PR-CONSULT-3: Approvals uses `canViewApprovals` (OWNER + SUPER_ADMIN)
  // rather than `canApprove` (OWNER-only) so SUPER_ADMIN can reach
  // their own "Mine" tab.
  gate?:  'canManageStaff' | 'canApprove' | 'canViewApprovals';
}

const NAV: NavItem[] = [
  { label: 'staff.nav.overview',   href: '/staff',           icon: <LayoutDashboard size={18} /> },
  { label: 'staff.nav.cases',      href: '/staff/cases',     icon: <Briefcase size={18} /> },
  { label: 'staff.nav.meetings',   href: '/staff/meetings',  icon: <Calendar size={18} /> },
  { label: 'staff.nav.tickets',    href: '/staff/tickets',   icon: <Inbox size={18} /> },
  { label: 'staff.nav.staff',      href: '/staff/users',     icon: <Users size={18} />,       gate: 'canManageStaff' },
  { label: 'staff.nav.approvals',  href: '/staff/approvals', icon: <ShieldCheck size={18} />, gate: 'canViewApprovals' },
];

export function StaffSidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const { permissions } = useStaff();

  const items = NAV.filter((n) => !n.gate || permissions[n.gate]);

  return (
    <aside className="hidden lg:flex w-60 flex-col bg-[#1e3a5f] text-white">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
        <img src="/brand/logo-mark-white.jpg" alt="Sorena" className="h-8 w-8" />
        <div className="leading-tight">
          <div className="text-white font-extrabold text-sm tracking-tight">Sorena Visa</div>
          <div className="text-[#c9a961] text-[10px] font-bold uppercase tracking-wider">
            Staff Portal
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'relative flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors min-h-[48px]',
                active
                  ? 'bg-white/10 text-white'
                  : 'text-white/70 hover:bg-white/5 hover:text-white',
              ].join(' ')}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[#c9a961]"
                />
              )}
              {item.icon}
              {t(item.label)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
