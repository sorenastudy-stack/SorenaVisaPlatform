'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, BadgeCheck, CircleDashed, KeyRound, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';

// PR-AGENT-PORTAL phase 1 — the Owner's view of whether an agent can actually
// get in, and the manual override that stands in for the contract flow.
//
// The override is presented as what it is. It is amber, it is labelled
// "manually cleared", and it names who did it and why. Nothing here says
// "signed", because nothing was signed — and in phase 3, when real signatures
// start arriving in the same column, the difference has to still be legible.

export interface PortalAccess {
  hasLogin: boolean;
  verified: boolean;
  contracted: boolean;
  contractIsManualOverride: boolean;
  contractClearedByName: string | null;
  contractClearedReason: string | null;
  allowed: boolean;
}

export function AgentPortalAccessCard({
  agentId, access, hasEmail,
}: { agentId: string; access: PortalAccess; hasEmail: boolean }) {
  const router = useRouter();
  const { me } = useStaff();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = me?.role === 'OWNER';

  async function clearContract() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/staff/marketing/agents/${agentId}/clear-contract`, { reason });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (err) {
      const raw = (err as any)?.body?.message ?? (err as Error)?.message;
      setError((Array.isArray(raw) ? raw[0] : raw) || 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold uppercase tracking-wide text-sorena-navy">Portal access</h3>
      <p className="mt-0.5 text-xs text-sorena-text/60">
        An agent can sign in only once both are done.
      </p>

      <ul className="mt-3 space-y-2">
        <Condition
          done={access.hasLogin}
          label={access.hasLogin ? 'Sign-in created' : 'No sign-in'}
          detail={
            access.hasLogin
              ? 'They sign in with a link emailed to them — there is no password.'
              : hasEmail
                ? 'This agent predates portal logins. Their account is created next time they are edited.'
                : 'Add an email address to give this agent a sign-in.'
          }
        />
        <Condition
          done={access.verified}
          label={access.verified ? 'Documents verified' : 'Documents not verified'}
          detail={
            access.verified
              ? 'Identity and business documents were accepted.'
              : 'Identity and business documents still need reviewing.'
          }
        />
        <Condition
          done={access.contracted}
          label={
            access.contracted
              ? access.contractIsManualOverride
                ? 'Contract manually cleared'
                : 'Contract signed'
              : 'No contract'
          }
          detail={
            access.contracted
              ? access.contractIsManualOverride
                ? `Cleared by ${access.contractClearedByName ?? 'an Owner'} — no contract was signed.${
                    access.contractClearedReason ? ` Reason: “${access.contractClearedReason}”` : ''
                  }`
                : 'A signed agreement is on file.'
              : 'The agent agreement is not in place yet.'
          }
          warn={access.contracted && access.contractIsManualOverride}
        />
      </ul>

      <p className={`mt-3 text-sm font-semibold ${access.allowed ? 'text-sorena-jade' : 'text-amber-700'}`}>
        {access.allowed ? 'This agent can use the portal.' : 'This agent cannot use the portal yet.'}
      </p>

      {isOwner && !access.contracted && (
        <div className="mt-4 border-t border-gray-200 pt-4">
          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            >
              <AlertTriangle size={15} /> Clear contract manually
            </button>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                This does not create a contract.
              </p>
              <p className="mt-1 text-xs text-amber-800">
                It lets this agent into the portal without one, and is recorded as a manual override
                with your name against it. The real signing flow arrives later.
              </p>
              <label className="mt-3 block text-xs font-semibold text-sorena-navy" htmlFor={`why-${agentId}`}>
                Why is this agent allowed to work without a signed contract?
              </label>
              <textarea
                id={`why-${agentId}`}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="e.g. agreement signed on paper, scan on file"
              />
              {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setOpen(false); setReason(''); setError(null); }}
                  className="rounded-lg px-3 py-1.5 text-sm text-sorena-text/70 hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || reason.trim().length < 3}
                  onClick={clearContract}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-40"
                >
                  {busy && <Loader2 size={14} className="animate-spin" />} Clear manually
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Condition({
  done, label, detail, warn,
}: { done: boolean; label: string; detail: string; warn?: boolean }) {
  const Icon = done ? (warn ? AlertTriangle : BadgeCheck) : CircleDashed;
  const tone = done ? (warn ? 'text-amber-600' : 'text-sorena-jade') : 'text-sorena-text/40';
  return (
    <li className="flex items-start gap-2">
      <Icon size={16} className={`mt-0.5 shrink-0 ${tone}`} />
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${done ? 'text-sorena-navy' : 'text-sorena-text/60'}`}>{label}</p>
        <p className="text-xs text-sorena-text/60">{detail}</p>
      </div>
    </li>
  );
}
