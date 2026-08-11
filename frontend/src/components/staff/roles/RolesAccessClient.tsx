'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, ShieldCheck, ShieldAlert, Globe } from 'lucide-react';
import { api } from '@/lib/api';
import { useRoleLabel } from '@/lib/role-label';

// PR-ROLES-REFERENCE — what each role can actually reach.
//
// The route lists are read from the live guard metadata on every request, so
// they cannot drift from what the server enforces. The prose beside each role is
// authored — no decorator records intent — and is labelled as such, so the two
// are never mistaken for one another.

interface RouteGrant {
  method: string;
  path: string;
  controller: string;
  guards: string[];
}
interface RoleAccess {
  role: string;
  responsibilities: string | null;
  routeCount: number;
  routes: RouteGrant[];
}
interface Report {
  roles: RoleAccess[];
  authenticatedAnyRole: RouteGrant[];
  openRoutes: RouteGrant[];
  generatedAt: string;
}

const methodTone: Record<string, string> = {
  GET: 'bg-blue-50 text-blue-700 ring-blue-200',
  POST: 'bg-green-50 text-green-700 ring-green-200',
  PATCH: 'bg-amber-50 text-amber-800 ring-amber-200',
  PUT: 'bg-amber-50 text-amber-800 ring-amber-200',
  DELETE: 'bg-red-50 text-red-700 ring-red-200',
};

function MethodChip({ m }: { m: string }) {
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ring-1 ${methodTone[m] ?? 'bg-gray-100 text-gray-700 ring-gray-200'}`}>
      {m}
    </span>
  );
}

function RouteList({ routes }: { routes: RouteGrant[] }) {
  // Grouped by controller: a flat list of 284 paths is a wall, and the grouping
  // is what makes "which areas does this role touch" answerable at a glance.
  const groups = useMemo(() => {
    const m = new Map<string, RouteGrant[]>();
    for (const r of routes) {
      if (!m.has(r.controller)) m.set(r.controller, []);
      m.get(r.controller)!.push(r);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [routes]);

  if (!routes.length) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
        This role is granted no routes at all. Anyone holding it can sign in but reach nothing.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(([controller, rs]) => (
        <div key={controller}>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-sorena-text/50">
            {/* Split the camel case before upper-casing. "CaseConversationNotes"
                rendered as CASECONVERSATIONNOTES is a wall of letters; the
                spaces are what make it a name again. */}
            {controller.replace(/Controller$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')}
          </p>
          <ul className="space-y-1">
            {rs.map((r) => (
              <li key={`${r.method}${r.path}`} className="flex items-baseline gap-2 text-xs">
                <MethodChip m={r.method} />
                <code className="break-all font-mono text-sorena-navy">{r.path}</code>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function RolesAccessClient() {
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const label = useRoleLabel();

  useEffect(() => {
    api.get<Report>('/staff/roles-access').then(setData).catch((e) =>
      setError(e?.message ?? 'Couldn’t load the roles report.'),
    );
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">Roles &amp; access</h1>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-sorena-text/70">
        Every role in the platform, what it is for, and exactly which endpoints it can reach.
        The endpoint lists are read from the live permission checks each time this page loads —
        they cannot fall out of step with what the server actually enforces.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && (
        <div className="flex items-center gap-2 py-12 text-sorena-text/60">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {data && (
        <>
          <div className="space-y-2">
            {data.roles.map((r) => {
              const isOpen = open === r.role;
              return (
                <div key={r.role} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : r.role)}
                    aria-expanded={isOpen}
                    className="flex w-full items-start gap-3 p-4 text-left hover:bg-gray-50"
                  >
                    {isOpen
                      ? <ChevronDown size={16} className="mt-1 shrink-0 text-sorena-text/50" />
                      : <ChevronRight size={16} className="mt-1 shrink-0 text-sorena-text/50" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-bold text-sorena-navy">{label(r.role)}</span>
                        <code className="font-mono text-[11px] text-sorena-text/45">{r.role}</code>
                      </div>
                      {r.responsibilities
                        ? <p className="mt-1 text-sm text-sorena-text/70">{r.responsibilities}</p>
                        : <p className="mt-1 text-sm italic text-amber-700">No description written for this role yet.</p>}
                    </div>
                    <span className="shrink-0 rounded-full bg-sorena-navy/5 px-2.5 py-1 text-xs font-semibold tabular-nums text-sorena-navy">
                      {r.routeCount}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-gray-100 bg-[#fcfcfd] p-4">
                      <RouteList routes={r.routes} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Not role-specific, but the two answers an access review always needs next. */}
          <div className="mt-8 space-y-2">
            <details className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-bold text-sorena-navy hover:bg-gray-50">
                <ShieldAlert size={16} className="text-amber-600" />
                Signed in, but not restricted by role
                <span className="ml-auto tabular-nums text-sorena-text/60">{data.authenticatedAnyRole.length}</span>
              </summary>
              <div className="border-t border-gray-100 bg-[#fcfcfd] p-4">
                <p className="mb-3 text-xs text-sorena-text/60">
                  These require a signed-in user but accept any role. That is correct for things
                  every user does — and worth a look for anything else.
                </p>
                <RouteList routes={data.authenticatedAnyRole} />
              </div>
            </details>

            <details className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-bold text-sorena-navy hover:bg-gray-50">
                <Globe size={16} className="text-sorena-text/60" />
                Open to the internet
                <span className="ml-auto tabular-nums text-sorena-text/60">{data.openRoutes.length}</span>
              </summary>
              <div className="border-t border-gray-100 bg-[#fcfcfd] p-4">
                <p className="mb-3 text-xs text-sorena-text/60">
                  No sign-in required: sign-up and login, public forms, short links, and provider
                  webhooks. Several webhooks verify a signature <em>inside</em> the handler rather
                  than through a guard, which this report cannot see — so “no guard” here does not
                  by itself mean “unverified”.
                </p>
                <RouteList routes={data.openRoutes} />
              </div>
            </details>
          </div>

          <p className="mt-6 text-xs text-sorena-text/45">
            Endpoint lists generated from live permission metadata at {new Date(data.generatedAt).toLocaleString('en-NZ')}.
            Role descriptions are written by hand and describe intent, not enforcement.
          </p>
        </>
      )}
    </div>
  );
}
