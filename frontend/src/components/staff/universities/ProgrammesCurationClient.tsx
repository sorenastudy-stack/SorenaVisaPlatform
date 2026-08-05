'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ChevronDown, ChevronRight, ImageIcon, Loader2, Save, Search, AlertTriangle, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-CURATION — review screen for one institution's imported programmes.
//
// LAYOUT DECISION: a single filterable list, not tabs. AUT alone imported 113
// programmes across 15 subject areas; tabs would hide most of the institution
// behind a second click and make "have I reviewed everything?" unanswerable.
// The subject area becomes a FILTER over one list instead, so the default view
// is still every programme, in subject-area order, with a running count.

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp';

interface Programme {
  id: string;
  name: string;
  level: string;
  nzqfLevel: string;
  qualificationType: string | null;
  majorStrand: string | null;
  subjectAreaRaw: string | null;
  durationMonths: number | null;
  durationText: string | null;
  tuitionFeeNZD: number | null;
  tuitionFeeRaw: string | null;
  tuitionParseNote: string | null;
  feeBasis: string | null;
  feeYear: number | null;
  campusCity: string | null;
  deliveryMode: string | null;
  intakeMonths: number[];
  remaining2026Intakes: string | null;
  published2027Intakes: string | null;
  projected2027Intakes: string | null;
  intakeBasis2027: string | null;
  intakes2027Planning: string | null;
  academicPrerequisites: string | null;
  englishRequirementRaw: string | null;
  otherRequirements: string | null;
  scholarshipNote: string | null;
  descriptionEn: string | null;
  programmeUrl: string | null;
  verificationSourceUrl: string | null;
  notes: string | null;
  coverImageUrl: string | null;
  reviewStatus: string;
  isActive: boolean;
  studentHolds: number;
  matchingBlockedReason: string | null;
}

interface CurationPayload {
  provider: { id: string; name: string; brand: string | null; status: string; providerType: string };
  subjectAreas: Array<{ label: string; count: number }>;
  programmes: Programme[];
}

const inputCls = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1e3a5f] focus:outline-none';
const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1';

export function ProgrammesCurationClient({ providerId }: { providerId: string }) {
  const router = useRouter();
  const [data, setData] = useState<CurationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    try {
      setData(await api.get<CurationPayload>(`/providers/${providerId}/curation`));
    } catch (e: any) {
      setError(e?.message ?? 'Could not load this institution’s programmes.');
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [providerId]);

  const visible = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.programmes.filter((p) => {
      const inArea = area === 'all' || (p.subjectAreaRaw ?? 'Unspecified') === area;
      const inSearch = !q || p.name.toLowerCase().includes(q)
        || (p.majorStrand ?? '').toLowerCase().includes(q)
        || (p.campusCity ?? '').toLowerCase().includes(q);
      return inArea && inSearch;
    });
  }, [data, area, search]);

  const patchLocal = (id: string, patch: Partial<Programme>) =>
    setData((d) => d && ({ ...d, programmes: d.programmes.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));

  if (error) {
    return <div className="p-6"><Card><CardContent className="p-5 text-sm text-red-600">{error}</CardContent></Card></div>;
  }
  if (!data) {
    return <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Loading programmes…</div>;
  }

  const activeCount = data.programmes.filter((p) => p.isActive).length;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <button type="button" onClick={() => router.push('/staff/universities')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#1e3a5f]">
        <ArrowLeft size={15} /> Back to institutions
      </button>

      <div>
        <h1 className="text-xl font-bold text-[#1e3a5f]">{data.provider.name}</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {data.programmes.length} programme{data.programmes.length === 1 ? '' : 's'} ·{' '}
          <span className={activeCount ? 'font-semibold text-emerald-700' : ''}>{activeCount} active</span>
          {' '}· {data.subjectAreas.length} subject area{data.subjectAreas.length === 1 ? '' : 's'}
        </p>
      </div>

      {/* The provider-level gate is invisible from here otherwise: the Owner can
          switch programmes Active all day and students still see nothing. */}
      {data.provider.status !== 'ACTIVE' && (
        <div className="flex gap-2 rounded-lg border border-[#c9a961] bg-[#fff8e1] p-3 text-sm text-[#7a6320]">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>
            This institution is <b>{data.provider.status}</b> — not marked as under contract yet. You can review and
            switch programmes on here, but nothing from this institution reaches students until the institution
            itself is set to Active on its edit screen.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className={`${inputCls} pl-8`} placeholder="Search by name, strand or campus…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={`${inputCls} w-auto`} value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="all">All subject areas ({data.programmes.length})</option>
          {data.subjectAreas.map((s) => <option key={s.label} value={s.label}>{s.label} ({s.count})</option>)}
        </select>
      </div>

      {visible.length === 0 && (
        <Card><CardContent className="p-5 text-sm text-gray-500">No programmes match that filter.</CardContent></Card>
      )}

      <div className="space-y-2">
        {visible.map((p) => (
          <ProgrammeRow
            key={p.id}
            programme={p}
            open={openId === p.id}
            onToggleOpen={() => setOpenId(openId === p.id ? null : p.id)}
            onChanged={(patch) => patchLocal(p.id, patch)}
          />
        ))}
      </div>
    </div>
  );
}

// ── one programme: summary row + expandable full editor ─────────────────────
function ProgrammeRow({ programme, open, onToggleOpen, onChanged }: {
  programme: Programme;
  open: boolean;
  onToggleOpen: () => void;
  onChanged: (patch: Partial<Programme>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<null | { message: string; affected: Array<{ studentName: string | null; caseReference: string | null }> }>(null);

  const setActive = async (active: boolean, confirm = false) => {
    setBusy(true);
    try {
      const r = await api.patch<{ isActive: boolean; reviewStatus: string; warning: string | null }>(
        `/providers/programmes/${programme.id}/activation`, { active, confirm },
      );
      onChanged({ isActive: r.isActive, reviewStatus: r.reviewStatus, matchingBlockedReason: r.warning });
      setConfirmState(null);
      toast.success(active ? 'Programme is now Active.' : 'Programme is now Inactive.');
      if (r.warning) toast.info(r.warning, { duration: 8000 });
    } catch (e: any) {
      // 409 → students already hold this programme. Show who, then let the
      // Owner decide; never silently allow, never silently block.
      if (e instanceof ApiError && e.statusCode === 409 && e.body?.details?.code === 'CONFIRMATION_REQUIRED') {
        setConfirmState({ message: e.body.message, affected: e.body.details.affected ?? [] });
      } else {
        toast.error(e?.message ?? 'Could not change that.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-3 p-3">
          <button type="button" onClick={onToggleOpen} className="text-gray-400 hover:text-[#1e3a5f]" aria-label={open ? 'Collapse' : 'Expand'}>
            {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>

          <button type="button" onClick={onToggleOpen} className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-semibold text-[#1e3a5f]">{programme.name}</p>
            <p className="truncate text-xs text-gray-500">
              {[programme.majorStrand, programme.subjectAreaRaw ?? 'Unspecified',
                programme.nzqfLevel?.replace('LEVEL_', 'Level '), programme.campusCity]
                .filter(Boolean).join(' · ')}
            </p>
          </button>

          <div className="hidden shrink-0 text-right text-xs sm:block">
            {programme.tuitionFeeNZD != null
              ? <span className="font-semibold text-[#1e3a5f]">NZ${programme.tuitionFeeNZD.toLocaleString()}</span>
              : <span className="italic text-gray-400">fee not parsed</span>}
          </div>

          {programme.studentHolds > 0 && (
            <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
              {programme.studentHolds} student{programme.studentHolds === 1 ? '' : 's'}
            </span>
          )}

          <ActiveToggle active={programme.isActive} busy={busy} onChange={(v) => setActive(v)} />
        </div>

        {confirmState && (
          <div className="border-t border-amber-200 bg-amber-50 p-3">
            <div className="flex gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-amber-900">{confirmState.message}</p>
                <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800">
                  {confirmState.affected.map((a, i) => (
                    <li key={i}>• {a.studentName ?? 'Unnamed student'}{a.caseReference ? ` — ${a.caseReference}` : ''}</li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => setActive(false, true)}
                    className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                    Yes, make it Inactive
                  </button>
                  <button type="button" onClick={() => setConfirmState(null)}
                    className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {programme.matchingBlockedReason && !confirmState && (
          <div className="border-t border-[#e6e1d6] bg-[#fff8e1] px-3 py-2 text-xs text-[#7a6320]">
            {programme.matchingBlockedReason}
          </div>
        )}

        {open && <ProgrammeEditor programme={programme} onChanged={onChanged} />}
      </CardContent>
    </Card>
  );
}

function ActiveToggle({ active, busy, onChange }: { active: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={active} disabled={busy}
      aria-label={active ? 'Active — switch off' : 'Inactive — switch on'}
      onClick={() => onChange(!active)}
      className={`flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50
        ${active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}
    >
      {busy
        ? <Loader2 size={13} className="animate-spin" />
        : <span className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-emerald-600' : 'bg-gray-400'}`} />}
      {active ? 'Active' : 'Inactive'}
    </button>
  );
}

// ── the full editor: every imported field, one Save ─────────────────────────
const TEXT_FIELDS: Array<[keyof Programme, string, 'text' | 'area']> = [
  ['name', 'Programme name', 'text'],
  ['qualificationType', 'Qualification type', 'text'],
  ['majorStrand', 'Strand / major', 'text'],
  ['subjectAreaRaw', 'Subject area', 'text'],
  ['campusCity', 'Campus', 'text'],
  ['deliveryMode', 'Delivery mode', 'text'],
  ['durationText', 'Duration (as published)', 'text'],
  ['tuitionFeeRaw', 'Tuition (institution’s own wording)', 'area'],
  ['tuitionParseNote', 'Why the fee is not a single number', 'text'],
  ['feeBasis', 'Fee basis', 'text'],
  ['remaining2026Intakes', 'Remaining 2026 intakes', 'text'],
  ['published2027Intakes', 'Published 2027 intakes', 'text'],
  ['projected2027Intakes', 'Projected 2027 intakes', 'text'],
  ['intakeBasis2027', '2027 intake basis', 'text'],
  ['intakes2027Planning', '2027 intake planning', 'area'],
  ['academicPrerequisites', 'Academic prerequisites', 'area'],
  ['englishRequirementRaw', 'English requirement', 'area'],
  ['otherRequirements', 'Other requirements', 'area'],
  ['scholarshipNote', 'Scholarship / study grant', 'area'],
  ['descriptionEn', 'Description', 'area'],
  ['programmeUrl', 'Programme page URL', 'text'],
  ['verificationSourceUrl', 'Verification source URL', 'text'],
  ['notes', 'Internal notes', 'area'],
];

function ProgrammeEditor({ programme, onChanged }: { programme: Programme; onChanged: (p: Partial<Programme>) => void }) {
  const [form, setForm] = useState<Record<string, any>>(() => ({ ...programme }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cover, setCover] = useState<string | null>(programme.coverImageUrl);

  // Re-seed when the toggle changes the row underneath an open editor.
  useEffect(() => { setForm({ ...programme }); }, [programme.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      for (const [k] of TEXT_FIELDS) payload[k as string] = form[k as string] ?? '';
      payload.tuitionFeeNZD = form.tuitionFeeNZD === '' || form.tuitionFeeNZD == null ? null : Number(form.tuitionFeeNZD);
      payload.durationMonths = form.durationMonths === '' || form.durationMonths == null ? null : Number(form.durationMonths);
      payload.feeYear = form.feeYear === '' || form.feeYear == null ? null : Number(form.feeYear);
      payload.intakeMonths = String(form.intakeMonths ?? '')
        .split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => n >= 1 && n <= 12);

      const r = await api.patch<Programme & { changed: string[] }>(
        `/providers/programmes/${programme.id}/curation`, payload,
      );
      onChanged(r);
      toast.success(r.changed.length ? `Saved — ${r.changed.length} field${r.changed.length === 1 ? '' : 's'} updated.` : 'No changes to save.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save those changes.');
    } finally {
      setSaving(false);
    }
  };

  // Reuses the existing per-programme cover-image endpoint (R2 + signed URL +
  // 2 MB / JPG-PNG-WebP validation server-side). No second upload path.
  const upload = async (file: File | null) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Please choose a JPG, PNG or WebP image.'); return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please keep it under 2 MB.`); return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.upload<{ coverImageUrl: string | null }>(`/providers/programmes/${programme.id}/cover-image`, fd);
      setCover(r.coverImageUrl);
      onChanged({ coverImageUrl: r.coverImageUrl });
      toast.success('Thumbnail saved.');
    } catch (e: any) {
      toast.error(e?.message ?? 'That image didn’t upload.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-[#e6e1d6] bg-[#faf8f3] p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEXT_FIELDS.map(([key, label, kind]) => (
          <div key={key as string} className={kind === 'area' ? 'sm:col-span-2 lg:col-span-3' : ''}>
            <label className={labelCls}>{label}</label>
            {kind === 'area'
              ? <textarea className={inputCls} rows={2} value={form[key as string] ?? ''} onChange={(e) => set(key as string, e.target.value)} />
              : <input className={inputCls} value={form[key as string] ?? ''} onChange={(e) => set(key as string, e.target.value)} />}
          </div>
        ))}

        <div>
          <label className={labelCls}>Tuition (NZD, parsed)</label>
          <input className={inputCls} type="number" min={0} value={form.tuitionFeeNZD ?? ''}
            onChange={(e) => set('tuitionFeeNZD', e.target.value)} placeholder="leave empty if conditional" />
        </div>
        <div>
          <label className={labelCls}>Fee year</label>
          <input className={inputCls} type="number" value={form.feeYear ?? ''} onChange={(e) => set('feeYear', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Duration (months)</label>
          <input className={inputCls} type="number" min={1} value={form.durationMonths ?? ''}
            onChange={(e) => set('durationMonths', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Intake months (1–12, comma separated)</label>
          <input className={inputCls} value={Array.isArray(form.intakeMonths) ? form.intakeMonths.join(', ') : (form.intakeMonths ?? '')}
            onChange={(e) => set('intakeMonths', e.target.value)} placeholder="2, 7" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e6e1d6] pt-3">
        <div className="flex items-center gap-3">
          {cover
            ? <img src={cover} alt="" className="h-12 w-20 rounded object-cover" />
            : <div className="flex h-12 w-20 items-center justify-center rounded bg-gray-100 text-gray-400"><ImageIcon size={16} /></div>}
          <label className="cursor-pointer text-xs font-semibold text-[#1e3a5f] hover:underline">
            {uploading ? 'Uploading…' : cover ? 'Replace thumbnail' : 'Add thumbnail'}
            <input type="file" accept={ACCEPT} className="hidden" disabled={uploading}
              onChange={(e) => upload(e.target.files?.[0] ?? null)} />
          </label>
          <span className="text-[11px] text-gray-400">JPG, PNG or WebP · up to 2 MB</span>
        </div>

        <button type="button" onClick={save} disabled={saving}
          className="flex items-center gap-2 rounded-md bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-50">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save changes
        </button>
      </div>
    </div>
  );
}
