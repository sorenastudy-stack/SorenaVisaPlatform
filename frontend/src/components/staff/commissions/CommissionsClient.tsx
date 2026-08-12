'use client';

import { useEffect, useMemo, useState } from 'react';
import { DollarSign, Loader2, Plus, BellRing, X, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-COMMISSIONS-UI — institutional / provider commission ledger. This is revenue
// Sorena EARNS from education providers after a student enrolls — NOT sales-rep
// payouts (a separate future model). Read + money-lifecycle for OWNER + FINANCE;
// recording a new commission is OWNER/SUPER_ADMIN (it reads enrolment applications,
// which are admissions-tier gated). All actions reuse the existing CommissionsService.

type Status = 'ESTIMATED' | 'CONFIRMED' | 'INVOICED' | 'PAID' | 'CANCELLED';

interface Commission {
  id: string;
  commissionYear: number;
  commissionType: 'PERCENTAGE' | 'FIXED';
  commissionValue: number;
  estimatedAmountNZD: number | null;
  actualAmountNZD: number | null;
  currency: string;
  status: Status;
  renewalReminderDate: string | null;
  reminderSent: boolean;
  provider: { id: string; name: string } | null;
  programme: { id: string; name: string } | null;
  // PR-COMMISSION-ANCHOR — the student is reached through the programme choice
  // now. This used to read `application.case.lead.contact`; after the re-anchor
  // that path is simply absent, and the optional chaining turned every student
  // name into "—" without any error to notice.
  programmeChoice: {
    admissionApplication?: {
      case?: { lead?: { contact?: { fullName?: string | null } | null } | null } | null;
    } | null;
  } | null;
}

const STATUSES: Status[] = ['ESTIMATED', 'CONFIRMED', 'INVOICED', 'PAID', 'CANCELLED'];
const STATUS_TONE: Record<Status, string> = {
  ESTIMATED: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-sky-100 text-sky-700',
  INVOICED:  'bg-amber-100 text-amber-800',
  PAID:      'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-700',
};

// The valid next lifecycle moves (mirrors the service's transition map).
const NEXT_ACTIONS: Record<Status, Array<{ label: string; to?: Status; confirm?: boolean; tone: string }>> = {
  ESTIMATED: [{ label: 'Confirm', confirm: true, tone: 'bg-[#1e3a5f] text-white' }, { label: 'Cancel', to: 'CANCELLED', tone: 'border border-rose-200 text-rose-600' }],
  CONFIRMED: [{ label: 'Mark invoiced', to: 'INVOICED', tone: 'bg-[#1e3a5f] text-white' }, { label: 'Cancel', to: 'CANCELLED', tone: 'border border-rose-200 text-rose-600' }],
  INVOICED:  [{ label: 'Mark paid', to: 'PAID', tone: 'bg-emerald-600 text-white' }, { label: 'Cancel', to: 'CANCELLED', tone: 'border border-rose-200 text-rose-600' }],
  PAID:      [],
  CANCELLED: [],
};

const money = (n: number | null, ccy = 'NZD') => (n == null ? '—' : `${ccy} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const clientName = (c: Commission) =>
  c.programmeChoice?.admissionApplication?.case?.lead?.contact?.fullName ?? '—';
const fmtDate = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-GB').format(new Date(iso)) : '—');
const isReminderDue = (c: Commission) =>
  !!c.renewalReminderDate && !c.reminderSent && c.status !== 'PAID' && c.status !== 'CANCELLED' && new Date(c.renewalReminderDate) <= new Date();

export function CommissionsClient({ role }: { role: string }) {
  const canRecord = role === 'OWNER' || role === 'SUPER_ADMIN';
  const [rows, setRows] = useState<Commission[] | null>(null);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [providerFilter, setProviderFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showRecord, setShowRecord] = useState(false);

  const load = () => {
    const qs = new URLSearchParams();
    if (statusFilter) qs.set('status', statusFilter);
    if (providerFilter) qs.set('providerId', providerFilter);
    setRows(null); setError(false);
    api.get<Commission[]>(`/commissions${qs.toString() ? `?${qs}` : ''}`).then(setRows).catch(() => setError(true));
  };
  useEffect(load, [statusFilter, providerFilter]);

  // Provider filter options derived from the ledger itself (no separate catalog
  // fetch — FINANCE isn't admitted to the providers endpoint).
  const providerOptions = useMemo(() => {
    const m = new Map<string, string>();
    (rows ?? []).forEach((c) => c.provider && m.set(c.provider.id, c.provider.name));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const dueCount = (rows ?? []).filter(isReminderDue).length;

  const act = async (c: Commission, fn: () => Promise<unknown>, ok: string) => {
    setBusyId(c.id);
    try { await fn(); toast.success(ok); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusyId(null); }
  };
  const doAction = (c: Commission, a: { label: string; to?: Status; confirm?: boolean }) => {
    if (a.confirm) return act(c, () => api.post(`/commissions/${c.id}/confirm`, {}), 'Commission confirmed.');
    return act(c, () => api.patch(`/commissions/${c.id}/status`, { status: a.to }), `Marked ${a.to?.toLowerCase()}.`);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <PendingTriggers onDecided={() => load()} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <DollarSign size={22} className="text-[#1e3a5f]" />
            <h1 className="text-2xl font-bold text-[#1e3a5f]">Commissions</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Institutional / provider revenue — commission Sorena earns from education providers after a student enrolls.
          </p>
        </div>
        {canRecord && (
          <button type="button" onClick={() => setShowRecord(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a]">
            <Plus size={15} /> Record commission
          </button>
        )}
      </div>

      {/* Renewal-reminder banner */}
      {dueCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <BellRing size={16} className="text-amber-600" />
          <span><strong>{dueCount}</strong> commission{dueCount === 1 ? '' : 's'} due for a renewal reminder.</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | Status)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <option value="">All providers</option>
          {providerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>

      <Card><CardContent className="p-0">
        {error && <div className="p-4"><div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Couldn’t load the commission ledger. Please refresh.</div></div>}
        {!rows && !error && <div className="flex items-center gap-2 p-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
        {rows && rows.length === 0 && (
          <div className="py-12 text-center">
            <CheckCircle2 size={28} className="mx-auto mb-2 text-[#c9a961]" />
            <p className="text-sm font-medium text-[#4A4A4A]">No commissions{statusFilter || providerFilter ? ' match these filters' : ' recorded yet'}</p>
            <p className="mt-1 text-xs text-gray-400">Provider revenue will appear here as enrolments are recorded.</p>
          </div>
        )}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2.5 px-3 font-semibold">Student</th>
                  <th className="py-2.5 px-3 font-semibold">Provider · Programme</th>
                  <th className="py-2.5 px-3 font-semibold">Yr</th>
                  <th className="py-2.5 px-3 font-semibold">Rate</th>
                  <th className="py-2.5 px-3 font-semibold">Est. / Actual</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Renewal</th>
                  <th className="py-2.5 px-3 font-semibold w-0"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-[#faf8f3]">
                    <td className="py-2.5 px-3 font-medium text-[#1e3a5f]">{clientName(c)}</td>
                    <td className="py-2.5 px-3 text-gray-600">
                      <div className="font-medium text-[#1e3a5f]">{c.provider?.name ?? '—'}</div>
                      <div className="text-xs text-gray-400">{c.programme?.name ?? '—'}</div>
                    </td>
                    <td className="py-2.5 px-3 text-gray-500">{c.commissionYear}</td>
                    <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">
                      {c.commissionType === 'PERCENTAGE' ? `${c.commissionValue}%` : money(c.commissionValue, c.currency)}
                    </td>
                    <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">
                      {money(c.estimatedAmountNZD, c.currency)} <span className="text-gray-300">/</span> {money(c.actualAmountNZD, c.currency)}
                    </td>
                    <td className="py-2.5 px-3"><span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[c.status]}`}>{c.status}</span></td>
                    <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                      {c.renewalReminderDate ? (
                        <span className={isReminderDue(c) ? 'font-semibold text-amber-700' : 'text-gray-500'}>
                          {isReminderDue(c) && <BellRing size={11} className="mr-1 inline" />}{fmtDate(c.renewalReminderDate)}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {NEXT_ACTIONS[c.status].map((a) => (
                          <button key={a.label} type="button" disabled={busyId === c.id}
                            onClick={() => doAction(c, a)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${a.tone}`}>
                            {busyId === c.id ? '…' : a.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent></Card>

      {showRecord && canRecord && (
        <RecordCommissionModal onClose={() => setShowRecord(false)} onDone={() => { setShowRecord(false); load(); }} />
      )}
    </div>
  );
}

const MONTH_SHORT = ['', 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Record a commission: pick case → programme choice → enter rate/estimate ──
//
// PR-COMMISSION-ANCHOR — the picker used to list `Application` rows. Nothing in
// the admission flow creates those, so it was always empty: a case could never
// offer anything to record against. It lists the case's programme choices now,
// which is what the client actually applied to.
interface CaseRow { id: string; studentName: string; stage: string }
interface ChoiceRow {
  id: string;
  programmeId: string;
  programmeName: string | null;
  providerId: string | null;
  providerName: string | null;
  intakeMonth: number;
  intakeYear: number;
  priority: number;
  /** Already has a commission — one per choice is the rule. */
  taken: boolean;
}

function RecordCommissionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [caseId, setCaseId] = useState('');
  const [choices, setChoices] = useState<ChoiceRow[]>([]);
  const [choiceId, setChoiceId] = useState('');
  const [value, setValue] = useState('');
  const [type, setType] = useState<'PERCENTAGE' | 'FIXED'>('PERCENTAGE');
  const [year, setYear] = useState('1');
  const [estimated, setEstimated] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ items: CaseRow[] }>('/api/staff/cases?activeOnly=true&pageSize=200').then((d) => setCases(d.items)).catch(() => {});
  }, []);
  useEffect(() => {
    setChoices([]); setChoiceId('');
    if (!caseId) return;
    api.get<ChoiceRow[]>(`/commissions/programme-choices/${caseId}`).then(setChoices).catch(() => {});
  }, [caseId]);

  const choice = choices.find((c) => c.id === choiceId);

  const submit = async () => {
    if (!choice || !value) { toast.error('Pick a programme and enter a rate.'); return; }
    if (!choice.providerId) { toast.error('That programme has no institution on record.'); return; }
    setBusy(true);
    try {
      await api.post('/commissions', {
        programmeChoiceId: choice.id, providerId: choice.providerId, programmeId: choice.programmeId,
        commissionType: type, commissionValue: Number(value),
        commissionYear: Number(year) || 1,
        ...(estimated ? { estimatedAmountNZD: Number(estimated) } : {}),
      });
      toast.success('Commission recorded.');
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the commission');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#1e3a5f]">Record commission</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="mb-4 text-xs text-gray-500">Provider revenue for an enrolment. Pick the student’s case and the programme they applied to.</p>

        <label className="mb-1 block text-xs font-semibold text-gray-600">Case (student)</label>
        <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <option value="">Select a case…</option>
          {cases.map((c) => <option key={c.id} value={c.id}>{c.studentName || c.id} · {c.stage}</option>)}
        </select>

        <label className="mb-1 block text-xs font-semibold text-gray-600">Programme applied to</label>
        <select value={choiceId} onChange={(e) => setChoiceId(e.target.value)} disabled={!caseId} className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50">
          <option value="">{caseId ? (choices.length ? 'Select a programme…' : 'No programme choices on this case') : 'Pick a case first'}</option>
          {choices.map((c) => (
            // A choice that already has a commission stays visible but unselectable —
            // "it is already recorded" reads better than the row simply not being there.
            <option key={c.id} value={c.id} disabled={c.taken}>
              {c.providerName ?? '—'} · {c.programmeName ?? '—'} ({MONTH_SHORT[c.intakeMonth] ?? c.intakeMonth} {c.intakeYear})
              {c.taken ? ' — already recorded' : ''}
            </option>
          ))}
        </select>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as 'PERCENTAGE' | 'FIXED')} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="PERCENTAGE">Percentage (%)</option>
              <option value="FIXED">Fixed (NZD)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Rate {type === 'PERCENTAGE' ? '(%)' : '(NZD)'}</label>
            <input type="number" value={value} onChange={(e) => setValue(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Year</label>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">Estimated NZD (optional)</label>
            <input type="number" value={estimated} onChange={(e) => setEstimated(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={submit} disabled={busy || !choice || !value}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Record
          </button>
        </div>
      </div>
    </div>
  );
}


// PR-COMMISSION-TRIGGER — Finance's decision queue.
//
// Sits above the ledger because it is work waiting on the reader, where the
// ledger below is a record of work already done. Approving CREATES the
// commission, which is why the rate is collected here: it is the same
// information the Record modal asks for, gathered at the moment someone is
// already looking at the claim.
//
// Renders nothing at all when the queue is empty, so the ledger looks exactly
// as it did before for anyone with no decisions outstanding.
interface TriggerRow {
  id: string;
  studentName: string | null;
  clientId: string | null;
  programmeName: string | null;
  providerName: string | null;
  submittedByName: string | null;
  submittedAt: string;
  firstClassAttendedAt: string | null;
}

function PendingTriggers({ onDecided }: { onDecided: () => void }) {
  const [rows, setRows] = useState<TriggerRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<'approve' | 'reject'>('approve');
  const [value, setValue] = useState('');
  const [type, setType] = useState<'PERCENTAGE' | 'FIXED'>('PERCENTAGE');
  const [estimated, setEstimated] = useState('');
  const [reason, setReason] = useState('');

  const load = () => {
    api.get<TriggerRow[]>('/staff/commission-triggers/pending')
      .then(setRows)
      .catch(() => setRows([]));
  };
  useEffect(load, []);

  const close = () => {
    setOpenId(null); setValue(''); setEstimated(''); setReason(''); setType('PERCENTAGE');
  };

  const decide = async (id: string) => {
    setBusy(id);
    try {
      if (mode === 'approve') {
        if (!value) { toast.error('Enter the commission rate or amount.'); setBusy(null); return; }
        await api.patch('/staff/commission-triggers/' + id + '/approve', {
          commissionType: type,
          commissionValue: Number(value),
          ...(estimated ? { estimatedAmountNZD: Number(estimated) } : {}),
        });
        toast.success('Approved - commission recorded.');
      } else {
        if (!reason.trim()) {
          toast.error('Give a reason so the Admission Officer knows what to fix.');
          setBusy(null); return;
        }
        await api.patch('/staff/commission-triggers/' + id + '/reject', { reason });
        toast.success('Claim declined.');
      }
      close(); load(); onDecided();
    } catch (e) {
      const raw = (e as any)?.body?.message ?? (e as Error)?.message;
      toast.error((Array.isArray(raw) ? raw[0] : raw) || 'Could not record that decision');
    } finally {
      setBusy(null);
    }
  };

  if (!rows || rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-300/60 bg-amber-50/50 p-4 md:p-5">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-[#1e3a5f]">
        Commission claims awaiting your decision ({rows.length})
      </h2>
      <p className="mb-3 text-xs text-gray-600">
        Submitted by the Admission Officer once the student has been in class two weeks. Approving records the commission.
      </p>
      <ul className="space-y-2">
        {rows.map((t) => (
          <li key={t.id} className="rounded-xl border border-gray-200 bg-white p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-[#1e3a5f]">
                  {t.studentName ?? 'Unknown student'}
                  {t.clientId && <code className="ml-2 font-mono text-[11px] text-gray-400">{t.clientId}</code>}
                </p>
                <p className="mt-0.5 text-sm text-gray-600">{t.providerName ?? '—'} · {t.programmeName ?? '—'}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Claimed by {t.submittedByName ?? 'an officer'} · first class{' '}
                  {t.firstClassAttendedAt ? new Date(t.firstClassAttendedAt).toLocaleDateString('en-NZ') : '—'}
                </p>
              </div>
              {openId !== t.id && (
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => { setMode('approve'); setOpenId(t.id); }}
                    className="rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#162d4a]">
                    Approve
                  </button>
                  <button type="button" onClick={() => { setMode('reject'); setOpenId(t.id); }}
                    className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50">
                    Decline
                  </button>
                </div>
              )}
            </div>

            {openId === t.id && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                {mode === 'approve' ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-600">Type</label>
                      <select value={type} onChange={(e) => setType(e.target.value as 'PERCENTAGE' | 'FIXED')}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                        <option value="PERCENTAGE">Percentage (%)</option>
                        <option value="FIXED">Fixed (NZD)</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-600">Rate / amount</label>
                      <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-600">Estimated NZD (optional)</label>
                      <input value={estimated} onChange={(e) => setEstimated(e.target.value)} inputMode="decimal"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-600">Why is this being declined?</label>
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                      placeholder="The Admission Officer sees this, and can re-submit once it is resolved."
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={close}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button type="button" disabled={busy === t.id} onClick={() => decide(t.id)}
                    className={'rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 ' + (mode === 'approve' ? 'bg-[#1e3a5f] hover:bg-[#162d4a]' : 'bg-rose-600 hover:bg-rose-700')}>
                    {busy === t.id ? 'Saving…' : mode === 'approve' ? 'Approve & record' : 'Decline claim'}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

