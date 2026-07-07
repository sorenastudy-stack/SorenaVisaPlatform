'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Briefcase, Calendar, Inbox, Users, Clock, CheckCircle2, CalendarOff,
} from 'lucide-react';
import { useStaff } from '@/contexts/StaffContext';

// PR-CONSULT-2 — Mobile bottom tab bar.
//
// 64px tall, fixed to the bottom on `< lg`. Approvals + Staff tabs
// only render when the caller has the corresponding permission;
// other roles see a 4-tab layout. The active tab gets the navy text
// color, inactive tabs are mid-gray.

interface Tab {
  label: string;
  href:  string;
  icon:  React.ReactNode;
  gate?: 'canManageStaff' | 'canApprove';
}

const TABS: Tab[] = [
  { label: 'staff.nav.overview',  href: '/staff',          icon: <LayoutDashboard size={20} /> },
  { label: 'staff.nav.cases',     href: '/staff/cases',    icon: <Briefcase size={20} /> },
  { label: 'staff.nav.meetings',  href: '/staff/meetings', icon: <Calendar size={20} /> },
  { label: 'staff.nav.tickets',   href: '/staff/tickets',  icon: <Inbox size={20} /> },
  { label: 'staff.nav.staff',     href: '/staff/users',    icon: <Users size={20} />, gate: 'canManageStaff' },
];

// Finance portal (option a) — a role-filtered mobile tab bar for FINANCE, so
// the four primary finance surfaces are reachable on small screens. Labels are
// plain English (rendered directly, not via t()). Other roles use TABS above.
const FINANCE_TABS: Array<{ label: string; href: string; icon: React.ReactNode }> = [
  { label: 'Dashboard',  href: '/staff/finance',           icon: <LayoutDashboard size={20} /> },
  { label: 'Processing', href: '/staff/payments',          icon: <Clock size={20} /> },
  { label: 'Finalised',  href: '/staff/finance/finalised', icon: <CheckCircle2 size={20} /> },
  { label: 'HR',         href: '/staff/hr',                icon: <CalendarOff size={20} /> },
];

export function StaffBottomTabs() {
  const pathname = usePathname();
  const t = useTranslations();
  const { permissions, me } = useStaff();

  const isFinance = me?.role === 'FINANCE';
  const tabs = isFinance
    ? FINANCE_TABS
    : TABS.filter((tab) => !tab.gate || permissions[tab.gate]);

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-200 flex z-30">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors min-h-[48px]',
              active ? 'text-[#1e3a5f]' : 'text-gray-500',
            ].join(' ')}
          >
            {tab.icon}
            <span>{t(tab.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
