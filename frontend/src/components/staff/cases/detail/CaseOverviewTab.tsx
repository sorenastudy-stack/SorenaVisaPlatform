'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';
import { formatRelativeTime } from '@/lib/format-relative-time';
import type { CaseDetail } from './types';

// PR-CONSULT-2 — Overview tab (student + case meta).
// PR-OPS-CASES — adds a minimal "Update stage / notes" editor (stage dropdown +
// notes textarea → PATCH /cases/:id). Visible to OPS and admin tier only:
//   - `canEdit` prop (passed true by the OPS detail page) forces it on;
//   - otherwise it falls back to admin-tier from StaffContext (staff surface).
// Reassignment and risk/legal actions are NOT here — they stay admin/LIA-tier
// on their own routes/components.

const STAGES = ['ADMISSION', 'VISA', 'INZ_SUBMITTED', 'COMPLETED', 'WITHDRAWN'] as const;
const ADMIN_TIER = ['OWNER', 'SUPER_ADMIN', 'ADMIN'];

export function CaseOverviewTab({
  data,
  canEdit,
  onSaved,
}: {
  data: CaseDetail;
  canEdit?: boolean;
  onSaved?: () => void;
}) {
  const { me } = useStaff();
  // Explicit prop wins (OPS); otherwise admin tier via staff context.
  const editable = canEdit ?? (!!me && ADMIN_TIER.includes(me.role));

  const fullName = `${data.student.firstName} ${data.student.lastName}`.trim() || '—';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          Student
        </h3>
        <dl className="text-sm space-y-2.5">
          <Row label="Name" value={fullName} />
          <Row label="Email" value={data.student.email} breakAll />
          <Row label="Phone" value={data.student.phone ?? '—'} />
          <Row label="Locale" value={data.student.locale} upper />
        </dl>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          Case
        </h3>
        <dl className="text-sm space-y-2.5">
          <Row label="Status" value={data.status.replace(/_/g, ' ')} />
          <Row label="Stage" value={data.stage.replace(/_/g, ' ')} />
          <Row label="Visa type" value={data.visaType ?? '—'} />
          <Row label="Created" value={formatRelativeTime(data.createdAt)} />
          <Row label="Updated" value={formatRelativeTime(data.updatedAt)} />
        </dl>
      </section>

      {editable && (
        <div className="md:col-span-2">
          <StageNotesEditor data={data} onSaved={onSaved} />
        </div>
      )}
    </div>
  );
}

function StageNotesEditor({ data, onSaved }: { data: CaseDetail; onSaved?: () => void }) {
  const [stage, setStage] = useState(data.stage);
  const [notes, setNotes] = useState(data.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const dirty = stage !== data.stage || (notes ?? '') !== (data.notes ?? '');

  async function save() {
    setSaving(true); setMsg(null);
    try {
      await api.patch(`/cases/${data.id}`, { stage, notes });
      setMsg({ kind: 'ok', text: 'Case updated.' });
      onSaved?.();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not update the case.' });
    } finally { setSaving(false); }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
        Update stage &amp; notes
      </h3>

      {msg && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.kind === 'ok' ? 'bg-sorena-jade/10 text-sorena-jade border border-sorena-jade/30' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Stage</label>
      <select
        value={stage}
        onChange={(e) => setStage(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 mb-4"
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
        ))}
      </select>

      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Notes</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        placeholder="Operational notes for this case…"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
      />

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e3a5f]/90 disabled:opacity-50"
        >
          {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : 'Save changes'}
        </button>
      </div>
    </section>
  );
}

function Row({ label, value, breakAll, upper }: { label: string; value: string; breakAll?: boolean; upper?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`text-gray-900 font-medium text-right ${breakAll ? 'break-all' : ''} ${upper ? 'uppercase' : ''}`}>{value}</dd>
    </div>
  );
}
