'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Loader2, CheckCircle2, Clock, AlertTriangle, ArrowLeftRight, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { useStaff } from '@/contexts/StaffContext';

// PR-ADMISSION-TASKS-UI — "My admission tasks": the Admission Specialist's cross-case task queue.
// Reuses GET /staff/admission-tasks as-is (mine + the unassigned queue; admin can request all). One
// list covers all three task types — the day-5 SUBMISSION_FOLLOW_UP (step 5) and the older
// INTAKE_REASSIGNED / INTAKE_REASSIGN_FAILED (Intake Timing). Urgent first, then oldest.

interface AdmissionTask {
  id: string; caseId: string; type: string; status: string; urgent: boolean;
  title: string; referenceId: string | null; assignedToId: string | null;
  studentName: string | null; createdAt: string;
}

const ADMIN_ROLES = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN']);

// Per-type presentation: label + icon + accent. Unknown types degrade gracefully.
const TYPE_META: Record<string, { label: string; icon: typeof Clock; tint: string }> = {
  SUBMISSION_FOLLOW_UP:   { label: 'Follow-up',        icon: Clock,         tint: 'bg-amber-100 text-amber-700' },
  INTAKE_REASSIGNED:      { label: 'Intake reassigned', icon: ArrowLeftRight, tint: 'bg-sky-100 text-sky-700' },
  INTAKE_REASSIGN_FAILED: { label: 'Intake failed',    icon: AlertTriangle, tint: 'bg-red-100 text-red-700' },
};
const typeMeta = (t: string) => TYPE_META[t] ?? { label: t.replace(/_/g, ' ').toLowerCase(), icon: ClipboardList, tint: 'bg-gray-100 text-gray-600' };

export function AdmissionTasksClient() {
  const { me } = useStaff();
  const isAdmin = ADMIN_ROLES.has(me?.role ?? '');
  const [tasks, setTasks] = useState<AdmissionTask[] | null>(null);
  const [error, setError] = useState(false);
  const [scopeAll, setScopeAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setTasks(null); setError(false);
    api.get<AdmissionTask[]>(`/staff/admission-tasks${scopeAll ? '?scope=all' : ''}`).then(setTasks).catch(() => setError(true));
  };
  useEffect(load, [scopeAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolve = async (id: string) => {
    setBusyId(id);
    try {
      await api.patch(`/staff/admission-tasks/${id}/resolve`, {});
      toast.success('Task marked done.');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resolve the task.');
    } finally { setBusyId(null); }
  };

  const openCount = tasks?.length ?? 0;
  const urgentCount = tasks?.filter((t) => t.urgent).length ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList size={22} className="text-[#1e3a5f]" />
            <h1 className="text-2xl font-bold text-[#1e3a5f]">My admission tasks</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Open admission work assigned to you or unassigned — institution follow-ups and intake re-applications. Urgent first.
          </p>
        </div>
        {isAdmin && (
          <label className="flex items-center gap-2 text-xs font-medium text-gray-500">
            <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Show all (every officer)
          </label>
        )}
      </div>

      {tasks && openCount > 0 && (
        <div className="flex gap-2 text-xs">
          <span className="rounded-full bg-[#1e3a5f]/8 px-2.5 py-1 font-semibold text-[#1e3a5f]">{openCount} open</span>
          {urgentCount > 0 && <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-700">{urgentCount} urgent</span>}
        </div>
      )}

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Couldn’t load your tasks. Please refresh.</div>}

      {!tasks && !error && (
        <Card><CardContent><div className="flex items-center gap-2 py-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading…</div></CardContent></Card>
      )}

      {tasks && openCount === 0 && !error && (
        <Card><CardContent>
          <div className="py-12 text-center">
            <CheckCircle2 size={30} className="mx-auto text-[#c9a961] mb-2" />
            <p className="text-sm font-medium text-[#4A4A4A]">No open tasks</p>
            <p className="text-xs text-gray-400 mt-1">You’re all caught up on admission tasks.</p>
          </div>
        </CardContent></Card>
      )}

      {tasks && openCount > 0 && (
        <Card><CardContent className="p-0">
          <ul className="divide-y divide-gray-50">
            {tasks.map((t) => {
              const m = typeMeta(t.type);
              const Icon = m.icon;
              return (
                <li key={t.id} className={`p-4 ${t.urgent ? 'bg-red-50/40' : ''}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.tint}`}>
                          <Icon size={11} /> {m.label}
                        </span>
                        {t.urgent && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Urgent</span>}
                        {t.assignedToId === null && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">Unassigned</span>}
                      </div>
                      <p className="mt-1 text-sm font-medium text-[#1e3a5f]">{t.title}</p>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {t.studentName && <span>{t.studentName} · </span>}
                        <Link href={`/staff/cases/${t.caseId}`} className="text-[#b8941f] hover:underline">Open case</Link>
                        <span className="ms-2 inline-flex items-center gap-1 text-gray-400"><Clock size={11} /> {formatRelativeTime(t.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link href={`/staff/cases/${t.caseId}`} className="inline-flex items-center gap-1 rounded-xl border border-[#1e3a5f]/25 px-3 py-2 text-xs font-semibold text-[#1e3a5f] hover:bg-[#1e3a5f]/5">
                        Go to case <ArrowRight size={12} />
                      </Link>
                      <button
                        type="button"
                        disabled={busyId === t.id}
                        onClick={() => resolve(t.id)}
                        className="inline-flex items-center gap-1 rounded-xl bg-[#1e3a5f] px-3 py-2 text-xs font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50"
                      >
                        {busyId === t.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Done
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent></Card>
      )}
    </div>
  );
}
