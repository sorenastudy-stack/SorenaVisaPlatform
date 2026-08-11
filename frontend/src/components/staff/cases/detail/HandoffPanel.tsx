'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Loader2, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';
import type { CaseDetail, RoleSlot } from './types';

// PR-HANDOFF — "hand this case to the next stage".
//
// Shown only to the person who currently holds a stage on this case (admin tier
// always). That mirrors the server guard rather than replacing it: the endpoint
// re-checks, so hiding the button is a courtesy, not the control.

/** Backend CaseSlot ← frontend RoleSlot. They differ: the first stage is called
 *  ADMISSION on the server and CONSULTANT in the assignments panel, because the
 *  slot is Case.ownerId and the role that fills it is CONSULTANT. */
const STAGES: { slot: 'ADMISSION' | 'SUPPORT' | 'FINANCE'; uiSlot: RoleSlot; label: string; nextLabel: string }[] = [
  { slot: 'ADMISSION', uiSlot: 'CONSULTANT', label: 'Admission',       nextLabel: 'Student Support' },
  { slot: 'SUPPORT',   uiSlot: 'SUPPORT',    label: 'Student Support', nextLabel: 'Finance' },
  { slot: 'FINANCE',   uiSlot: 'FINANCE',    label: 'Finance',         nextLabel: 'Immigration Adviser' },
];

const ADMIN_TIER = ['OWNER', 'SUPER_ADMIN', 'ADMIN'];

export function HandoffPanel({ data, onDone }: { data: CaseDetail; onDone: () => void }) {
  const { me } = useStaff();
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const isAdmin = !!me?.role && ADMIN_TIER.includes(me.role);

  // Which stages this person may hand off FROM. Usually one; admin tier sees
  // all three, because unsticking someone else's case is their job.
  const available = useMemo(
    () => STAGES.filter((s) => isAdmin || data.assignments?.[s.uiSlot]?.id === me?.id),
    [data.assignments, isAdmin, me?.id],
  );

  if (!me || available.length === 0) return null;

  async function send(stage: typeof STAGES[number]) {
    setSending(true);
    setError(null);
    try {
      await api.post(`/cases/${data.id}/handoff`, { fromSlot: stage.slot, note: note.trim() || undefined });
      setDone(stage.nextLabel);
      setOpenStage(null);
      setNote('');
      onDone();
    } catch (e: any) {
      setError(e?.message ?? 'Couldn’t hand off this case.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold uppercase tracking-wide text-sorena-navy">Hand off</h2>
      <p className="mt-1 text-xs text-sorena-text/60">
        Passes this case to the next stage and notifies whoever picks it up.
      </p>

      {done && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">
          Handed to {done}. It’s now in their queue.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-3 space-y-2">
        {available.map((s) => (
          <div key={s.slot}>
            {openStage === s.slot ? (
              <div className="rounded-xl border border-gray-200 bg-[#fcfcfd] p-3">
                <label htmlFor={`note-${s.slot}`} className="mb-1 block text-xs font-semibold text-sorena-navy">
                  Note for {s.nextLabel} <span className="font-normal text-sorena-text/50">(optional)</span>
                </label>
                <textarea
                  id={`note-${s.slot}`}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                  placeholder="Anything they need to know before picking this up"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-sorena-gold focus:outline-none focus:ring-1 focus:ring-sorena-gold"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => send(s)}
                    disabled={sending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sorena-navy px-3 py-2 text-sm font-bold text-white hover:bg-[#162d49] disabled:opacity-50"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Hand to {s.nextLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setOpenStage(null); setNote(''); }}
                    disabled={sending}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-sorena-navy hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setOpenStage(s.slot); setDone(null); }}
                className="inline-flex w-full items-center justify-between gap-2 rounded-xl border border-sorena-navy/20 px-3 py-2.5 text-sm font-semibold text-sorena-navy hover:bg-sorena-navy/5"
              >
                <span className="flex items-center gap-1.5">
                  {s.label} <ArrowRight size={14} className="text-sorena-text/40" /> {s.nextLabel}
                </span>
                <Send size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
