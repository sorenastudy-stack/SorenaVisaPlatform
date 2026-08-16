'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, ChevronDown, ExternalLink, PauseCircle, FastForward, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// PR-CO-KANBAN — the CO's journey board. Mostly read-only visibility; only the two
// pre-contract lead columns are editable, via a per-card dropdown (Advance /
// Postpone — no drag). Every card can open the client's file + raise a
// Admin tier sees every officer's clients.
//
// PR-TICKET-CONSOLIDATION — the "Raise ticket" action is gone. It wrote the
// legacy Ticket model, which the staff ticket queue never read, so a raised
// ticket reached nobody. Raising a ticket against a PRE-CONTRACT LEAD is not a
// workflow the platform supports (Owner decision, 15 Aug 2026); client support
// threads live on VisaSupportTicket and require a signed client with a case.

interface Card {
  kind: 'LEAD' | 'CASE';
  id: string; contactId: string | null; clientName: string | null; officerName: string | null;
  href: string; editable: boolean;
  nurtureStage?: string; nurtureHeldUntil?: string | null; nurtureHoldReason?: string | null;
  stage?: string;
  deadline?: string | null; daysOverdue?: number; overdue?: boolean;
}
interface Column { key: string; label: string; editable: boolean; cards: Card[] }

const fmtDate = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('en-GB').format(new Date(iso)) : null);

export function KanbanClient() {
  const [columns, setColumns] = useState<Column[] | null>(null);
  const [error, setError] = useState(false);

  const load = () => {
    setColumns(null); setError(false);
    api.get<{ columns: Column[] }>('/staff/kanban').then((d) => setColumns(d.columns)).catch(() => setError(true));
  };
  useEffect(load, []);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-10">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">My clients</h1>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Your clients across the whole journey. The pre-contract lead columns are editable; everything from Admission on is read-only (handed off).
      </p>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Couldn’t load your board. Please refresh.</div>}
      {!columns && !error && <div className="flex items-center gap-2 py-10 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading…</div>}

      {columns && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => (
            <div key={col.key} className="w-72 shrink-0">
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
                  {!col.editable && <Lock size={11} className="text-gray-300" />}
                  {col.label}
                </h2>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">{col.cards.length}</span>
              </div>
              <div className="space-y-2 rounded-xl bg-[#faf8f3] p-2 min-h-[80px]">
                {col.cards.length === 0 && <p className="px-2 py-4 text-center text-xs text-gray-300">—</p>}
                {col.cards.map((c) => (
                  <CardView key={`${c.kind}-${c.id}`} card={c} onChanged={load} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

function CardView({ card, onChanged }: { card: Card; onChanged: () => void }) {
  const [menu, setMenu] = useState(false);
  const held = card.nurtureHeldUntil && new Date(card.nurtureHeldUntil) > new Date();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#1e3a5f]">{card.clientName ?? '—'}</div>
          {card.officerName && <div className="text-[11px] text-gray-400">CO: {card.officerName}</div>}
        </div>
        {card.editable && (
          <div className="relative">
            <button type="button" onClick={() => setMenu((m) => !m)} className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
              Move <ChevronDown size={11} className="inline" />
            </button>
            {menu && (
              <div className="absolute right-0 z-10 mt-1 w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
                <OverrideItem leadId={card.id} direction="ADVANCE" label="Advance — end nurturing, ready to refer" icon={<FastForward size={13} />} onDone={() => { setMenu(false); onChanged(); }} />
                <OverrideItem leadId={card.id} direction="POSTPONE" label="Postpone nurturing…" icon={<PauseCircle size={13} />} onDone={() => { setMenu(false); onChanged(); }} />
              </div>
            )}
          </div>
        )}
      </div>

      {held && (
        <div className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          On hold until {fmtDate(card.nurtureHeldUntil)}{card.nurtureHoldReason ? ` · ${card.nurtureHoldReason}` : ''}
        </div>
      )}

      {/* PR-SLA — red overdue day-counter on case cards past their stage SLA. */}
      {card.kind === 'CASE' && card.overdue && (
        <div className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">
          {card.daysOverdue} day{card.daysOverdue === 1 ? '' : 's'} overdue
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-[11px]">
        <Link href={card.href} className="inline-flex items-center gap-1 font-semibold text-[#1e3a5f] hover:underline">
          Open <ExternalLink size={11} />
        </Link>
      </div>
    </div>
  );
}

// Advance = one click (with a reason). Postpone = reason + days.
function OverrideItem({ leadId, direction, label, icon, onDone }: {
  leadId: string; direction: 'ADVANCE' | 'POSTPONE'; label: string; icon: React.ReactNode; onDone: () => void;
}) {
  const submit = async () => {
    const reason = window.prompt(direction === 'ADVANCE' ? 'Reason for advancing this lead?' : 'Reason for postponing this lead?');
    if (!reason || !reason.trim()) return;
    let holdDays: number | undefined;
    if (direction === 'POSTPONE') {
      const raw = window.prompt('Hold for how many days?', '7');
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1) { toast.error('Enter a valid number of days.'); return; }
      holdDays = Math.floor(n);
    }
    try {
      await api.post(`/staff/nurture/${leadId}/override`, { direction, reason: reason.trim(), ...(holdDays ? { holdDays } : {}) });
      toast.success(direction === 'ADVANCE' ? 'Lead advanced — ready to refer.' : `Nurturing postponed ${holdDays} day(s).`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Override failed');
    }
  };
  return (
    <button type="button" onClick={submit} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-gray-700 hover:bg-[#faf8f3]">
      {icon} {label}
    </button>
  );
}
