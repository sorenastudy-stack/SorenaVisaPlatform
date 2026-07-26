'use client';

import { useEffect, useMemo, useState } from 'react';
import { Timer, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-SLA — the Owner-editable SLA config table: rows = institution type × stage,
// editable day-counts. Saving changes the deadline/overdue calc immediately (no
// deploy). isWorkingDays is a property of the stage (shown, not edited here).

interface Row {
  id: string;
  institutionType: string;
  stage: string;
  slaDays: number;
  isWorkingDays: boolean;
}

const INSTITUTION_LABEL: Record<string, string> = { UNIVERSITY: 'University', POLYTECHNIC: 'Polytechnic', COLLEGE: 'College', SCHOOL: 'School' };
const STAGE_LABEL: Record<string, string> = { ADMISSION: 'Admission', VISA: 'Visa', INZ_SUBMITTED: 'INZ submitted' };
const STAGE_ORDER = ['ADMISSION', 'VISA', 'INZ_SUBMITTED'];

export function SlaSettingsClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = () => {
    setRows(null); setError(false); setDraft({});
    api.get<Row[]>('/staff/settings/sla').then(setRows).catch(() => setError(true));
  };
  useEffect(load, []);

  const institutions = useMemo(() => {
    const set = new Set((rows ?? []).map((r) => r.institutionType));
    return [...set];
  }, [rows]);
  const stages = useMemo(() => {
    const present = new Set((rows ?? []).map((r) => r.stage));
    return STAGE_ORDER.filter((s) => present.has(s));
  }, [rows]);
  const cell = (inst: string, stage: string) => (rows ?? []).find((r) => r.institutionType === inst && r.stage === stage);

  const key = (inst: string, stage: string) => `${inst}:${stage}`;
  const save = async (row: Row) => {
    const k = key(row.institutionType, row.stage);
    const value = draft[k] ?? row.slaDays;
    if (!Number.isInteger(value) || value < 0 || value > 365) { toast.error('Enter a whole number of days (0–365).'); return; }
    setSavingKey(k);
    try {
      await api.patch('/staff/settings/sla', { institutionType: row.institutionType, stage: row.stage, slaDays: value });
      toast.success(`${INSTITUTION_LABEL[row.institutionType]} · ${STAGE_LABEL[row.stage]} → ${value} days`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally { setSavingKey(null); }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Timer size={22} className="text-[#1e3a5f]" />
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Stage SLAs</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Deadline (in days) for each case stage, by institution type. Editable without a deploy — changes apply to the overdue calculation going forward.
        </p>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Couldn’t load the SLA config. Please refresh.</div>}
      {!rows && !error && <Card><CardContent><div className="flex items-center gap-2 py-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading…</div></CardContent></Card>}

      {rows && (
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-3 px-4 font-semibold">Institution type</th>
                  {stages.map((s) => (
                    <th key={s} className="py-3 px-4 font-semibold">
                      {STAGE_LABEL[s] ?? s}
                      <div className="text-[10px] font-normal normal-case text-gray-400">
                        {cell(institutions[0], s)?.isWorkingDays ? 'working days' : 'calendar days'}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {institutions.map((inst) => (
                  <tr key={inst} className="border-b border-gray-50">
                    <td className="py-3 px-4 font-medium text-[#1e3a5f]">{INSTITUTION_LABEL[inst] ?? inst}</td>
                    {stages.map((stage) => {
                      const row = cell(inst, stage);
                      if (!row) return <td key={stage} className="py-3 px-4 text-gray-300">—</td>;
                      const k = key(inst, stage);
                      const value = draft[k] ?? row.slaDays;
                      const dirty = draft[k] !== undefined && draft[k] !== row.slaDays;
                      return (
                        <td key={stage} className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <input type="number" value={value}
                              onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))}
                              className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                            <button type="button" onClick={() => save(row)} disabled={!dirty || savingKey === k}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#1e3a5f] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#162d4a] disabled:opacity-40">
                              {savingKey === k ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}
