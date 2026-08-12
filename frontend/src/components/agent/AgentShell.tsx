'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BadgeCheck, Banknote, Clock, LogOut, ShieldAlert, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-AGENT-PORTAL phase 1 — the agent's shell, and the wall in front of it.
//
// The shell reads GET /agent/me once and decides between two worlds: the
// portal, or an explanation of why there isn't one yet. Nav links are not
// rendered at all while blocked — a disabled link the agent can still see is a
// list of things being kept from them, and it invites clicking.
//
// This is convenience only. Every route behind it is refused server-side by
// AgentAccessGuard; nothing here is load-bearing for access.

export interface AgentMe {
  name: string | null;
  allowed: boolean;
  verified: boolean;
  contracted: boolean;
  contractIsManualOverride: boolean;
  blockedReasons: string[];
}

const MeContext = createContext<AgentMe | null>(null);
export const useAgentMe = () => useContext(MeContext);

const NAV = [
  { href: '/agent', label: 'My clients', icon: <Users size={17} /> },
  { href: '/agent/payouts', label: 'My commission', icon: <Banknote size={17} /> },
];

/** What each blocked reason means, in the agent's terms rather than the schema's. */
const BLOCKED_COPY: Record<string, { title: string; body: string }> = {
  NOT_VERIFIED: {
    title: 'We’re checking your documents',
    body: 'Sorena is reviewing the identity and business documents for your account. You’ll be able to sign in properly once that’s done.',
  },
  NO_CONTRACT: {
    title: 'Your agreement isn’t in place yet',
    body: 'Your agent agreement still needs to be completed. We’ll email you when it’s ready to sign.',
  },
  AGENT_INACTIVE: {
    title: 'Your account is paused',
    body: 'This account isn’t active at the moment. Please contact Sorena if you think that’s a mistake.',
  },
  NO_AGENT_RECORD: {
    title: 'This account isn’t set up as an agent',
    body: 'We couldn’t find an agent record for this sign-in. Please contact Sorena.',
  },
};

export function AgentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<AgentMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<AgentMe>('/agent/me')
      .then(setMe)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Couldn’t load your account.'));
  }, []);
  useEffect(load, [load]);

  const blocked = me && !me.allowed;

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-screen bg-[#F7F7FB]">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-sorena-navy px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">
              Sorena
            </span>
            <span className="text-sm font-semibold text-sorena-navy">Agent portal</span>
          </div>
          <div className="flex items-center gap-4">
            {me?.name && <span className="text-sm text-sorena-text/70">{me.name}</span>}
            <a href="/api/auth/logout" className="inline-flex items-center gap-1.5 text-sm text-sorena-text/70 hover:text-sorena-navy">
              <LogOut size={15} /> Sign out
            </a>
          </div>
        </header>

        {/* Nav only once they can actually use it. */}
        {me?.allowed && (
          <nav className="flex gap-1 border-b border-gray-200 bg-white px-4 md:px-8">
            {NAV.map((n) => {
              const active = pathname === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={[
                    'inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition-colors',
                    active
                      ? 'border-sorena-navy text-sorena-navy'
                      : 'border-transparent text-sorena-text/60 hover:text-sorena-navy',
                  ].join(' ')}
                >
                  {n.icon} {n.label}
                </Link>
              );
            })}
          </nav>
        )}

        <main className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!me && !error && (
            <div className="flex items-center gap-2 py-16 text-sorena-text/60">
              <Clock size={18} className="animate-spin" /> Loading…
            </div>
          )}
          {blocked && <Blocked me={me!} />}
          {me?.allowed && children}
        </main>
      </div>
    </MeContext.Provider>
  );
}

/**
 * The wall.
 *
 * Says what is outstanding and nothing else. No client names, no counts, no
 * amounts — a blocked agent must not be able to infer how much business is
 * sitting behind the gate, and "3 clients waiting" would tell them exactly
 * that.
 */
function Blocked({ me }: { me: AgentMe }) {
  const reasons = me.blockedReasons.length ? me.blockedReasons : ['NO_AGENT_RECORD'];
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <h1 className="text-lg font-bold text-sorena-navy">
              {me.name ? `Hello ${me.name.split(' ')[0]} — your account isn’t open yet` : 'Your account isn’t open yet'}
            </h1>
            <p className="mt-1 text-sm text-sorena-text/70">
              There {reasons.length === 1 ? 'is one thing' : `are ${reasons.length} things`} still to finish
              before you can see your clients and commission.
            </p>
          </div>
        </div>

        <ul className="mt-5 space-y-3">
          {reasons.map((r) => {
            const copy = BLOCKED_COPY[r] ?? BLOCKED_COPY.NO_AGENT_RECORD;
            return (
              <li key={r} className="rounded-xl border border-amber-200 bg-white p-4">
                <p className="font-semibold text-sorena-navy">{copy.title}</p>
                <p className="mt-1 text-sm text-sorena-text/70">{copy.body}</p>
              </li>
            );
          })}
        </ul>

        {/* What IS done, so the wall doesn't read as "nothing has happened". */}
        {(me.verified || me.contracted) && (
          <p className="mt-5 flex items-center gap-1.5 text-sm text-sorena-text/60">
            <BadgeCheck size={15} className="text-sorena-jade" />
            {me.verified && me.contracted
              ? 'Your documents and agreement are both in place.'
              : me.verified
                ? 'Your documents have been accepted.'
                : 'Your agreement is in place.'}
          </p>
        )}
      </div>
    </div>
  );
}
