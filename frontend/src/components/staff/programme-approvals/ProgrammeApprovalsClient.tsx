'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, ClipboardCheck, MapPin, Wallet, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-CATALOG-1 — the Owner's pending-programme review queue across all
// institutions. Per-programme Approve / Reject (no bulk). Approving makes it
// visible to students (given the institution is ACTIVE).

interface Pending {
  id: string; name: string; level: string | null; nzqfLevel: string | null;
  campusCity: string | null; tuitionFeeNZD: number | null; currency: string | null;
  source: string; sourceRef: string | null; intakeCount: number;
  provider: { id: string; name: string; status: string; institutionType: string | null };
  studyField: { key: string; nameEn: string } | null;
}

const INSTITUTION_LABEL: Record<string, string> = { UNIVERSITY: 'University', ITP: 'Polytechnic', PTE: 'College' };
const SOURCE_LABEL: Record<string, string> = { MANUAL_EXCEL: 'Excel import', MANUAL_ENTRY: 'Manual', AUTOMATED_WEB_CHECK: 'Web check' };

export function ProgrammeApprovalsClient() {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setRows(null); setError(false);
    api.get<Pending[]>('/providers/programmes/pending').then(setRows).catch(() => setError(true));
  };
  useEffect(load, []);

  const act = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id);
    try {
      await api.patch(`/providers/programmes/${id}/${action}`, {});
      setRows((r) => (r ?? []).filter((p) => p.id !== id));
      toast.success(action === 'approve' ? 'Programme approved — now visible to students.' : 'Programme rejected.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Action failed.');
    } finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-5">
      <div className="flex items-center gap-2.5">
        <ClipboardCheck className="text-[#1e3a5f]" size={22} />
        <div>
          <h1 className="text-lg font-bold text-[#1e3a5f]">Programme approvals</h1>
          <p className="text-xs text-gray-500">Review each pending programme before it becomes visible to students. Approving requires the institution to be Active.</p>
        </div>
      </div>

      {error && <Card><CardContent className="p-6 text-center text-sm text-red-600">Couldn’t load the queue. <button onClick={load} className="underline">Try again</button></CardContent></Card>}
      {!rows && !error && <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#c9a961]" /></div>}
      {rows && rows.length === 0 && (
        <Card><CardContent className="p-10 text-center text-sm text-gray-500">Nothing waiting for review. Imported programmes will appear here.</CardContent></Card>
      )}

      {rows && rows.length > 0 && (
        <>
          <p className="text-sm text-gray-500">{rows.length} programme{rows.length === 1 ? '' : 's'} awaiting review</p>
          <ul className="space-y-3">
            {rows.map((p) => (
              <li key={p.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-[#1e3a5f]">{p.name}</p>
                      <span className="rounded-full bg-[#c9a961]/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a6d10]">{SOURCE_LABEL[p.source] ?? p.source}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {p.provider.name}
                      {p.provider.institutionType ? ` · ${INSTITUTION_LABEL[p.provider.institutionType] ?? p.provider.institutionType}` : ''}
                      {' · '}
                      <span className={p.provider.status === 'ACTIVE' ? 'text-[#15a86b] font-medium' : 'text-amber-700 font-medium'}>
                        institution {p.provider.status}
                      </span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                      {p.studyField && <span className="rounded bg-gray-100 px-1.5 py-0.5">{p.studyField.nameEn}</span>}
                      {p.level && <span>{p.level}</span>}
                      {p.nzqfLevel && <span className="text-gray-400">NZQF {p.nzqfLevel.replace('LEVEL_', 'L')}</span>}
                      {p.campusCity && <span className="inline-flex items-center gap-1"><MapPin size={12} className="text-gray-400" />{p.campusCity}</span>}
                      {p.tuitionFeeNZD != null && <span className="inline-flex items-center gap-1"><Wallet size={12} className="text-gray-400" />{(p.currency ?? 'NZD')} {p.tuitionFeeNZD.toLocaleString('en-NZ')}</span>}
                      <span className="inline-flex items-center gap-1"><CalendarDays size={12} className="text-gray-400" />{p.intakeCount} intake{p.intakeCount === 1 ? '' : 's'}</span>
                    </div>
                    {p.provider.status !== 'ACTIVE' && (
                      <p className="mt-2 text-[11px] text-amber-700">Approving won’t show this to students until the institution is set Active.</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => act(p.id, 'approve')} disabled={busy === p.id}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-3 py-2 text-xs font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
                      {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Approve
                    </button>
                    <button onClick={() => act(p.id, 'reject')} disabled={busy === p.id}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                      <XCircle size={13} /> Reject
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
