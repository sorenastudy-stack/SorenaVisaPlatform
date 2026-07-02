'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Briefcase, Calendar, Inbox, Users, ShieldCheck, Megaphone,
  Settings, CreditCard, BadgeCheck, CalendarClock, CalendarOff, FileText,
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
  // PR-SCORECARD-2: Marketing uses an inline role check (OWNER /
  // ADMIN / SUPER_ADMIN) because no canManageMarketing permission
  // exists on StaffContext yet.
  gate?:  'canManageStaff' | 'canApprove' | 'canViewApprovals';
  roleGate?: ReadonlyArray<string>;
}

const MARKETING_ROLES = ['OWNER', 'ADMIN', 'SUPER_ADMIN'] as const;
// PR-SCORECARD-4: platform settings is tighter (OWNER/SUPER_ADMIN only),
// Wix payments is broader (adds FINANCE for reconciliation).
const SETTINGS_ROLES   = ['OWNER', 'SUPER_ADMIN'] as const;
const WIX_PAYMENT_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'FINANCE'] as const;
// PR-CRM-LEADS: same role set as Wix payments + CONSULTANT.
// LIA is excluded — they work from the case-side portal, not the
// lead funnel.
const LEADS_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'FINANCE'] as const;
// PR-SUPPORT-1: ticket-reader role set. Mirrors the staff tickets
// controller's @Roles(...) for list/detail (FINANCE excluded — they
// don't action client support threads).
const TICKETS_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'CONSULTANT', 'LIA'] as const;
// PR-DOCUSIGN-1 step 3 (Screen B): verifier roles. Matches the backend
// @Roles set on LiaProfilesVerifierController (E5-E8). LIA is excluded
// — they manage their own credential via /lia/licence (Screen A).
const LIA_VERIFICATION_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN'] as const;
// PR-BOOKING-ADMIN-A: staff management panel — admin tier only.
const STAFF_PANEL_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN'] as const;
// PR-WALLET slice 2: consultation bookings (mark no-show/completed/cancel) —
// roles that run consultations + admin tier.
const BOOKINGS_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT'] as const;
// PR-STAFF-DOCS: "My case documents" — assignment-based. Slot-holding roles +
// admin tier (admin sees all; others see only their currently-assigned cases).
const DOCS_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE'] as const;

const NAV: NavItem[] = [
  { label: 'staff.nav.overview',          href: '/staff',                    icon: <LayoutDashboard size={18} /> },
  { label: 'staff.nav.cases',             href: '/staff/cases',              icon: <Briefcase size={18} /> },
  // PR-STAFF-DOCS: documents for the viewer's currently-assigned cases.
  { label: 'Documents',                    href: '/staff/documents',          icon: <FileText size={18} />,    roleGate: DOCS_ROLES },
  // PR-CRM-LEADS: unified lead funnel. Positioned between Cases and
  // Marketing because the day-to-day staff workflow is "see cases →
  // see leads → tweak attribution".
  { label: 'staff.nav.leads',             href: '/staff/leads',              icon: <Users size={18} />,       roleGate: LEADS_ROLES },
  { label: 'staff.nav.meetings',          href: '/staff/meetings',           icon: <Calendar size={18} /> },
  // PR-WALLET slice 2: consultation bookings + outcome marker.
  { label: 'Bookings',                     href: '/staff/bookings',           icon: <CalendarClock size={18} />, roleGate: BOOKINGS_ROLES },
  { label: 'staff.nav.tickets',           href: '/staff/tickets',            icon: <Inbox size={18} />,       roleGate: TICKETS_ROLES },
  { label: 'staff.nav.staff',             href: '/staff/users',              icon: <Users size={18} />,       gate: 'canManageStaff' },
  { label: 'staff.nav.approvals',         href: '/staff/approvals',          icon: <ShieldCheck size={18} />, gate: 'canViewApprovals' },
  // PR-DOCUSIGN-1 step 3 (Screen B): LIA credential verification queue.
  // Inline label string — no next-intl yet, matching the rest of this
  // surface's English-only labels (the .nav.* keys above are the
  // pre-existing translated ones).
  { label: 'LIA verification',            href: '/staff/lia-verification',   icon: <BadgeCheck size={18} />,  roleGate: LIA_VERIFICATION_ROLES },
  { label: 'staff.nav.bookingSetup',   href: '/staff/team',           icon: <CalendarClock size={18} />, roleGate: STAFF_PANEL_ROLES },
  // PR-STAFF-HR (Phase 3): self-service HR (leave + contract + job desc) —
  // every staff role. Replaces the old standalone "My leave" item.
  { label: 'HR',                       href: '/staff/hr',             icon: <CalendarOff size={18} /> },
  { label: 'staff.nav.marketing',         href: '/staff/marketing',          icon: <Megaphone size={18} />,   roleGate: MARKETING_ROLES },
  // PR-SCORECARD-4: Wix payments visible to OWNER/SUPER_ADMIN/ADMIN/FINANCE.
  { label: 'staff.nav.wixPayments',       href: '/staff/wix-payments',       icon: <CreditCard size={18} />,  roleGate: WIX_PAYMENT_ROLES },
  // PR-SCORECARD-4: OWNER-editable booking URLs + Wix webhook secret.
  { label: 'staff.nav.platformSettings',  href: '/staff/platform-settings',  icon: <Settings size={18} />,    roleGate: SETTINGS_ROLES },
];

export function StaffSidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const { permissions, me } = useStaff();

  const items = NAV.filter((n) => {
    if (n.gate && !permissions[n.gate]) return false;
    if (n.roleGate && !n.roleGate.includes(me?.role ?? '')) return false;
    return true;
  });

  return (
    <aside className="hidden lg:flex w-60 flex-col bg-[#1e3a5f] text-white">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
        <img src="/brand/logo-mark-white.jpg" alt="Sorena" className="h-8 w-8" />
        <div className="leading-tight">
          <div className="text-white font-extrabold text-sm tracking-tight">Sorena Visa</div>
          <div className="text-[#b8941f] text-[10px] font-bold uppercase tracking-wider">
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
                  className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[#F3CE49]"
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
