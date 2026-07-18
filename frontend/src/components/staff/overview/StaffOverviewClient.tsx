'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Briefcase, CalendarClock, Inbox, Award, FileText, Users,
  AlertTriangle, Clock, ArrowRight, Loader2, type LucideIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';

// Staff Overview — replaces the old placeholder panel. Every staff role lands
// here post-login, so it must show something real for each.
//
// Two honest modes, chosen by what the server actually returns:
//   • SEE_ALL tier (OWNER/SUPER_ADMIN/ADMIN) → the real ops dashboard from
//     GET /api/staff/cases/dashboard: active cases by stage, the attention
//     worklist, and recent case activity.
//   • Everyone else (LIA/CONSULTANT/SUPPORT/…) → a personalized launchpad to
//     the sections they actually use. The dashboard endpoint 403s them; we
//     catch that and fall back — the server stays the source of truth for
//     entitlement, the UI never assumes.

interface Dashboard {
  countsByStage: { stage: string; count: number }[];
  worklist: { caseId: string; clientName: string; stage: string; reasons: string[] }[];
  recentActivity: {
    id: string; caseId: string; clientName: string;
    actorName: string | null; actorRole: string | null;
    createdAt: string; summary: string;
  }[];
}

const STAGE_LABEL: Record<string, string> = {
  ADMISSION: 'Admission', VISA: 'Visa', INZ_SUBMITTED: 'INZ submitted',
};
const REASON_LABEL: Record<string, string> = {
  HARD_STOP: 'Hard stop', HIGH_RISK: 'High risk', ESCALATION: 'Escalation', UNASSIGNED: 'No LIA assigned',
};

export function StaffOverviewClient() {
  const { me } = useStaff();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [mode, setMode] = useState<'loading' | 'dashboard' | 'launchpad' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    api.get<Dashboard>('/api/staff/cases/dashboard')
      .then((d) => { if (alive) { setDash(d); setMode('dashboard'); } })
      .catch((e) => {
        if (!alive) return;
        // 403 = this role isn't on the ops dashboard; that's expected — show
        // the launchpad. Anything else is a real failure.
        setMode(e instanceof ApiError && e.statusCode === 403 ? 'launchpad' : 'error');
      });
    return () => { alive = false; };
  }, []);

  const firstName = (me?.fullName ?? '').trim().split(/\s+/)[0] || 'there';

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">Welcome back, {firstName}</h1>
        <p className="mt-1 text-sm text-[#4A4A4A]/70">
          {mode === 'dashboard'
            ? "Here's what's active across your cases and what needs attention."
            : "Here's where your work lives."}
        </p>
      </div>

      {mode === 'loading' && (
        <div className="flex items-center gap-2 py-16 text-[#4A4A4A]/60">
          <Loader2 size={18} className="animate-spin" /> Loading your overview…
        </div>
      )}

      {mode === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load your overview just now. Please refresh.
        </div>
      )}

      {mode === 'launchpad' && <Launchpad role={me?.role ?? ''} />}

      {mode === 'dashboard' && dash && <DashboardView dash={dash} />}
    </div>
  );
}

// ─── Admin-tier dashboard ────────────────────────────────────────────────

function DashboardView({ dash }: { dash: Dashboard }) {
  return (
    <div className="space-y-8">
      {/* Active cases by stage */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#4A4A4A]/60">Active cases</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {dash.countsByStage.map((c) => (
            <div key={c.stage} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="text-3xl font-bold text-[#1e3a5f]">{c.count}</div>
              <div className="mt-1 text-sm text-[#4A4A4A]/70">{STAGE_LABEL[c.stage] ?? c.stage}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Needs attention */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#4A4A4A]/60">
          <AlertTriangle size={15} className="text-[#c9a961]" /> Needs attention
        </h2>
        {dash.worklist.length === 0 ? (
          <EmptyRow>Nothing needs your attention right now — you're all caught up.</EmptyRow>
        ) : (
          <div className="space-y-2">
            {dash.worklist.slice(0, 12).map((w) => (
              <Link
                key={w.caseId}
                href={`/staff/cases/${w.caseId}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-[#c9a961]/50 hover:bg-[#faf8f3]"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-[#1e3a5f]">{w.clientName}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-[#1e3a5f]/10 px-2 py-0.5 text-[11px] font-medium text-[#1e3a5f]">
                      {STAGE_LABEL[w.stage] ?? w.stage}
                    </span>
                    {w.reasons.map((r) => (
                      <span key={r} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                        {REASON_LABEL[r] ?? r}
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowRight size={16} className="shrink-0 text-[#4A4A4A]/40" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Recent activity */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#4A4A4A]/60">
          <Clock size={15} className="text-[#c9a961]" /> Recent activity
        </h2>
        {dash.recentActivity.length === 0 ? (
          <EmptyRow>No recent case activity yet — it'll show up here as your team works.</EmptyRow>
        ) : (
          <div className="space-y-1.5">
            {dash.recentActivity.map((a) => (
              <Link
                key={a.id}
                href={`/staff/cases/${a.caseId}`}
                className="flex items-baseline justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[#faf8f3]"
              >
                <span className="min-w-0 text-sm text-[#4A4A4A]">
                  <span className="font-medium text-[#1e3a5f]">{a.clientName}</span>
                  {' · '}{a.summary}
                  {a.actorName ? <span className="text-[#4A4A4A]/50"> — {a.actorName}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-[#4A4A4A]/50">{timeAgo(a.createdAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Non-admin launchpad ─────────────────────────────────────────────────

interface Shortcut { label: string; href: string; desc: string; icon: LucideIcon; }

const SHORTCUTS: Record<string, Shortcut> = {
  cases:    { label: 'Cases',       href: '/staff/cases',       desc: 'Client cases you can view', icon: Briefcase },
  meetings: { label: 'My Meetings', href: '/staff/meetings',    desc: 'Your upcoming & past sessions', icon: CalendarClock },
  tickets:  { label: 'Tickets',     href: '/staff/tickets',     desc: 'Support requests to action', icon: Inbox },
  licence:  { label: 'My Licence',  href: '/staff/lia-profile', desc: 'Your IAA licence & verification', icon: Award },
  documents:{ label: 'Documents',   href: '/staff/documents',   desc: 'Documents on your cases', icon: FileText },
  leads:    { label: 'Leads',       href: '/staff/leads',       desc: 'The lead funnel', icon: Users },
};

// Role → the sections that role can actually reach (mirrors the sidebar gates,
// so a launchpad card never links somewhere the user would be 403'd).
const ROLE_SHORTCUTS: Record<string, string[]> = {
  LIA:        ['cases', 'meetings', 'licence', 'documents', 'tickets'],
  CONSULTANT: ['cases', 'meetings', 'leads', 'documents', 'tickets'],
  CLIENT_CONSULTANT: ['cases', 'documents', 'tickets'],
  SUPPORT:    ['tickets', 'cases'],
};

function Launchpad({ role }: { role: string }) {
  const keys = ROLE_SHORTCUTS[role] ?? ['cases', 'meetings'];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {keys.map((k) => {
        const s = SHORTCUTS[k];
        if (!s) return null;
        const Icon = s.icon;
        return (
          <Link
            key={k}
            href={s.href}
            className="group flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-[#c9a961]/50 hover:bg-[#faf8f3]"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1e3a5f]/10">
              <Icon size={20} className="text-[#1e3a5f]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[#1e3a5f]">{s.label}</div>
              <div className="truncate text-sm text-[#4A4A4A]/60">{s.desc}</div>
            </div>
            <ArrowRight size={16} className="shrink-0 text-[#4A4A4A]/30 transition-transform group-hover:translate-x-0.5" />
          </Link>
        );
      })}
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-[#faf8f3] px-4 py-6 text-center text-sm text-[#4A4A4A]/70">
      {children}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
