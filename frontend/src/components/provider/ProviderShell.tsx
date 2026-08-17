'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, Clock, Globe2, GraduationCap, LogOut, ShieldAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-PROVIDER-PORTAL slice C — the institution's shell, and the wall in front of it.
//
// Reads GET /provider/me once and decides between two worlds: the portal, or an
// explanation of why there isn't one. Same shape as AgentShell, same reasoning —
// nothing here is load-bearing for access; ProviderAccessGuard refuses these
// routes server-side regardless of what the browser renders.
//
// Slice C had one page and therefore no nav — a nav bar with a single item is
// furniture. Slice D adds the programmes screen, so the nav arrives with the
// second destination, and only for institutions that can actually use it.

export interface ProviderMe {
  id: string;
  name: string;
  legalEntityName: string | null;
  country: string | null;
  city: string | null;
  websiteUrl: string | null;
  aboutUrl: string | null;
  catalogueUrl: string | null;
  descriptionEn: string | null;
  status: string;
  counts: { programmes: number; tuitions: number; scholarships: number };
}

const MeContext = createContext<ProviderMe | null>(null);
export const useProviderMe = () => useContext(MeContext);

/** Why a sign-in can reach the portal and still not open it, in their terms. */
const BLOCKED_COPY: Record<string, { title: string; body: string }> = {
  NO_PROVIDER_RECORD: {
    title: 'This sign-in isn’t linked to an institution',
    body: 'We couldn’t find an institution for this account. Please contact your Sorena representative.',
  },
  PROVIDER_INACTIVE: {
    title: 'Your account is paused',
    body: 'This institution isn’t active at the moment. Please contact your Sorena representative if you think that’s a mistake.',
  },
};

const NAV = [
  { href: '/provider', label: 'Your institution', icon: <Building2 size={17} /> },
  { href: '/provider/programmes', label: 'Programmes', icon: <GraduationCap size={17} /> },
  { href: '/provider/pricing', label: 'Country groups', icon: <Globe2 size={17} /> },
];

export function ProviderShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<ProviderMe | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<ProviderMe>('/provider/me')
      .then(setMe)
      .catch((e) => {
        // A 403 here is the gate, not a failure — show the wall, not an error.
        if (e instanceof ApiError && e.statusCode === 403) {
          setBlocked(/not active/i.test(e.message) ? 'PROVIDER_INACTIVE' : 'NO_PROVIDER_RECORD');
          return;
        }
        setError(e instanceof ApiError ? e.message : 'Couldn’t load your institution.');
      });
  }, []);
  useEffect(load, [load]);

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-screen bg-[#F7F7FB]">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-sorena-navy px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">
              Sorena
            </span>
            <span className="text-sm font-semibold text-sorena-navy">Institution portal</span>
          </div>
          <div className="flex items-center gap-4">
            {me?.name && <span className="text-sm text-sorena-text/70">{me.name}</span>}
            <a href="/api/auth/logout" className="inline-flex items-center gap-1.5 text-sm text-sorena-text/70 hover:text-sorena-navy">
              <LogOut size={15} /> Sign out
            </a>
          </div>
        </header>

        {/* Only once they can actually use it — a blocked account gets the wall,
            not a list of doors that will not open. */}
        {me && (
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

        <main className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!me && !blocked && !error && (
            <div className="flex items-center gap-2 py-16 text-sorena-text/60">
              <Clock size={18} className="animate-spin" /> Loading…
            </div>
          )}
          {blocked && <Blocked reason={blocked} />}
          {me && children}
        </main>
      </div>
    </MeContext.Provider>
  );
}

function Blocked({ reason }: { reason: string }) {
  const copy = BLOCKED_COPY[reason] ?? BLOCKED_COPY.NO_PROVIDER_RECORD;
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6">
      <div className="flex items-start gap-3">
        <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-600" />
        <div>
          <h1 className="text-lg font-bold text-sorena-navy">{copy.title}</h1>
          <p className="mt-1 text-sm text-sorena-text/70">{copy.body}</p>
        </div>
      </div>
    </div>
  );
}
