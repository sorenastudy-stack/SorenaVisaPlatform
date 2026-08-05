'use client';

import { useEffect, useState } from 'react';
import {
  GraduationCap, Loader2, Plus, ArrowLeft, Save, Trash2, Pencil, X, Award, Upload, RefreshCw, ListChecks,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { CountryPicker } from '@/components/common/CountryPicker';
import { getCountryName, countryCodeToFlagEmoji } from '@/lib/country-codes';
import { PricingImportSection } from './PricingImportSection';
import { ProgrammeCoversSection } from './ProgrammeCoversSection';

// PR-UNIVERSITIES — Owner-managed institutional catalog: providers with their
// commission terms + bonuses, and per-nationality scholarships (optionally scoped
// to a programme/level). Wires to the existing /providers API (writes are
// OWNER/SUPER_ADMIN on the backend). Reference data — accuracy matters (feeds the
// commissions context + future AI offer generation).

const PROVIDER_TYPES = ['UNIVERSITY', 'POLYTECHNIC', 'COLLEGE', 'SCHOOL'] as const;
const STATUSES = ['ACTIVE', 'INACTIVE', 'PENDING'] as const;
const AMOUNT_TYPES = ['PERCENTAGE', 'FIXED'] as const;
const LEVELS = ['DIPLOMA', 'GRADUATE_CERTIFICATE', 'GRADUATE_DIPLOMA', 'BACHELOR', 'POSTGRADUATE_CERTIFICATE', 'POSTGRADUATE_DIPLOMA', 'MASTER', 'PHD'] as const;
const levelLabel = (l: string) => l.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

interface Programme { id: string; name: string; level: string; coverImageUrl?: string | null }
interface Provider {
  id: string; name: string; providerType: string; country: string; city: string | null; websiteUrl: string | null;
  catalogueUrl: string | null;
  isFeatured: boolean;
  status: string; agreementUrl: string | null; agreementStartDate: string | null; agreementEndDate: string | null; agreementRenewalDate: string | null;
  commissionY1Type: string; commissionY1Value: number; commissionY2Type: string; commissionY2Value: number;
  volumeTarget: number | null; bonusType: string | null; bonusValue: number | null; notes: string | null;
  programmes?: Programme[];
}
interface Scholarship {
  id: string; providerId: string; nationality: string; programmeId: string | null; level: string | null;
  name: string; amountType: string; amountValue: number; currency: string; eligibilityNotes: string | null; isActive: boolean;
  programme?: { id: string; name: string; level: string } | null;
}

const amountLabel = (type: string, value: number, currency = 'NZD') =>
  type === 'PERCENTAGE' ? `${value}%` : `${currency} ${value.toLocaleString()}`;
const statusPill: Record<string, string> = {
  ACTIVE: 'bg-[#15a86b]/10 text-[#15a86b]', INACTIVE: 'bg-gray-100 text-gray-500', PENDING: 'bg-[#c9a961]/15 text-[#8a6d10]',
};

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#1e3a5f] focus:outline-none';
const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1';

export function UniversitiesClient() {
  const [mode, setMode] = useState<{ view: 'list' } | { view: 'create' } | { view: 'edit'; id: string }>({ view: 'list' });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GraduationCap size={22} className="text-[#1e3a5f]" />
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Universities</h1>
        </div>
        {mode.view === 'list' && (
          <button type="button" onClick={() => setMode({ view: 'create' })}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#162d4a] min-h-[44px]">
            <Plus size={16} /> New university
          </button>
        )}
      </div>
      <p className="-mt-3 text-sm text-gray-500">
        The institutions Sorena works with — their commission terms, bonuses, and per-country scholarships. This is the source of truth for the commissions ledger and offer generation, so keep it accurate.
      </p>

      {mode.view === 'list' && <ProviderList onEdit={(id) => setMode({ view: 'edit', id })} />}
      {mode.view === 'create' && <ProviderForm onDone={() => setMode({ view: 'list' })} />}
      {mode.view === 'edit' && <ProviderForm providerId={mode.id} onDone={() => setMode({ view: 'list' })} />}
    </div>
  );
}

// ── List ──────────────────────────────────────────────────────────────────
function ProviderList({ onEdit }: { onEdit: (id: string) => void }) {
  const [rows, setRows] = useState<Provider[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<Provider[]>('/providers').then(setRows).catch(() => setError(true));
  }, []);

  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Couldn’t load universities. Please refresh.</div>;
  if (!rows) return <Card><CardContent><div className="flex items-center gap-2 py-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading…</div></CardContent></Card>;
  if (rows.length === 0) return <Card><CardContent><p className="py-8 text-center text-sm text-gray-500">No universities yet. Add the first one to start managing commissions and scholarships.</p></CardContent></Card>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map((p) => (
        <button key={p.id} type="button" onClick={() => onEdit(p.id)}
          className="text-left rounded-2xl border border-gray-200 bg-white p-4 hover:border-[#1e3a5f]/40 hover:shadow-sm transition-all">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-[#1e3a5f]">{p.name}</h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusPill[p.status] ?? 'bg-gray-100 text-gray-500'}`}>{p.status}</span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {levelLabel(p.providerType)} · {countryCodeToFlagEmoji(p.country)} {getCountryName(p.country, 'en')}{p.city ? ` · ${p.city}` : ''}
          </p>
          <p className="mt-2 text-xs text-gray-600">
            <span className="font-semibold text-[#8a6d10]">Y1</span> {amountLabel(p.commissionY1Type, p.commissionY1Value)} ·{' '}
            <span className="font-semibold text-[#8a6d10]">Y2</span> {amountLabel(p.commissionY2Type, p.commissionY2Value)}
            {p.bonusType ? <> · <span className="font-semibold text-[#8a6d10]">Bonus</span> {amountLabel(p.bonusType, p.bonusValue ?? 0)}</> : null}
          </p>
        </button>
      ))}
    </div>
  );
}

// ── Create / Edit form ──────────────────────────────────────────────────────
const emptyForm = {
  name: '', providerType: 'UNIVERSITY', country: 'NZ', city: '', websiteUrl: '', catalogueUrl: '', isFeatured: false, status: 'PENDING',
  commissionY1Type: 'PERCENTAGE', commissionY1Value: 0, commissionY2Type: 'PERCENTAGE', commissionY2Value: 0,
  volumeTarget: '', bonusType: '', bonusValue: '', notes: '',
  agreementStartDate: '', agreementEndDate: '', agreementRenewalDate: '', agreementUrl: '',
};
type FormState = typeof emptyForm;

function ProviderForm({ providerId, onDone }: { providerId?: string; onDone: () => void }) {
  const isEdit = !!providerId;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof FormState, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!providerId) return;
    api.get<Provider>(`/providers/${providerId}`).then((p) => {
      const iso = (d: string | null) => (d ? d.slice(0, 10) : '');
      setForm({
        name: p.name, providerType: p.providerType, country: p.country, city: p.city ?? '', websiteUrl: p.websiteUrl ?? '', catalogueUrl: p.catalogueUrl ?? '', isFeatured: p.isFeatured, status: p.status,
        commissionY1Type: p.commissionY1Type, commissionY1Value: p.commissionY1Value, commissionY2Type: p.commissionY2Type, commissionY2Value: p.commissionY2Value,
        volumeTarget: p.volumeTarget?.toString() ?? '', bonusType: p.bonusType ?? '', bonusValue: p.bonusValue?.toString() ?? '', notes: p.notes ?? '',
        agreementStartDate: iso(p.agreementStartDate), agreementEndDate: iso(p.agreementEndDate), agreementRenewalDate: iso(p.agreementRenewalDate), agreementUrl: p.agreementUrl ?? '',
      });
      setProgrammes(p.programmes ?? []);
    }).catch(() => toast.error('Could not load the university.')).finally(() => setLoading(false));
  }, [providerId]);

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required.'); return; }
    setSaving(true);
    try {
      const core: any = {
        name: form.name.trim(), providerType: form.providerType, country: form.country,
        city: form.city.trim() || undefined, websiteUrl: form.websiteUrl.trim() || undefined,
        catalogueUrl: form.catalogueUrl.trim() || undefined, isFeatured: form.isFeatured,
        commissionY1Type: form.commissionY1Type, commissionY1Value: Number(form.commissionY1Value),
        commissionY2Type: form.commissionY2Type, commissionY2Value: Number(form.commissionY2Value),
        volumeTarget: form.volumeTarget === '' ? undefined : Number(form.volumeTarget),
        bonusType: form.bonusType || undefined, bonusValue: form.bonusType && form.bonusValue !== '' ? Number(form.bonusValue) : undefined,
        notes: form.notes.trim() || undefined,
      };
      if (isEdit) {
        await api.patch(`/providers/${providerId}`, { ...core, status: form.status });
        const toIso = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toISOString() : undefined);
        await api.patch(`/providers/${providerId}/agreement`, {
          agreementUrl: form.agreementUrl.trim() || undefined,
          agreementStartDate: toIso(form.agreementStartDate), agreementEndDate: toIso(form.agreementEndDate), agreementRenewalDate: toIso(form.agreementRenewalDate),
        });
        toast.success('University updated.');
      } else {
        await api.post('/providers', core);
        toast.success('University created.');
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.');
    } finally { setSaving(false); }
  };

  if (loading) return <Card><CardContent><div className="flex items-center gap-2 py-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading…</div></CardContent></Card>;

  return (
    <div className="space-y-6">
      <button type="button" onClick={onDone} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1e3a5f] hover:underline">
        <ArrowLeft size={16} /> Back to universities
      </button>

      <Card><CardContent className="space-y-4">
        <h2 className="font-bold text-[#1e3a5f]">{isEdit ? 'Edit university' : 'New university'}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className={labelCls}>Name</label><input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. University of Auckland" /></div>
          <div><label className={labelCls}>Type</label><select className={inputCls} value={form.providerType} onChange={(e) => set('providerType', e.target.value)}>{PROVIDER_TYPES.map((t) => <option key={t} value={t}>{levelLabel(t)}</option>)}</select></div>
          <div><label className={labelCls}>Country</label><CountryPicker value={form.country} onChange={(c) => set('country', c)} /></div>
          <div><label className={labelCls}>City</label><input className={inputCls} value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
          <div><label className={labelCls}>Website</label><input className={inputCls} value={form.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value)} placeholder="https://" /></div>
          {isEdit && <div><label className={labelCls}>Status</label><select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>}
          {/* PR-CATALOG-2 — programme-listing page the monthly web check crawls to find new programmes. */}
          <div className="sm:col-span-2"><label className={labelCls}>Programme catalogue URL</label><input className={inputCls} value={form.catalogueUrl} onChange={(e) => set('catalogueUrl', e.target.value)} placeholder="https://…/study/programmes — the list page the monthly web check scans" /></div>
          {/* PR-SLOTRULES (Decision 2) — Featured pin (display-only). */}
          <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm((f) => ({ ...f, isFeatured: e.target.checked }))} />
            <span className="font-medium">Featured institution</span>
            <span className="text-xs text-gray-500">— surfaced in a “Featured” section in Apply/Study. Display only; doesn’t change ranking or the mandatory-slot rule.</span>
          </label>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Commission terms</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <RateField label="Year 1" type={form.commissionY1Type} value={form.commissionY1Value} onType={(v) => set('commissionY1Type', v)} onValue={(v) => set('commissionY1Value', v)} />
            <RateField label="Year 2" type={form.commissionY2Type} value={form.commissionY2Value} onType={(v) => set('commissionY2Type', v)} onValue={(v) => set('commissionY2Value', v)} />
            <div><label className={labelCls}>Volume target (enrolments)</label><input type="number" className={inputCls} value={form.volumeTarget} onChange={(e) => set('volumeTarget', e.target.value)} /></div>
            <div>
              <label className={labelCls}>Volume bonus</label>
              <div className="flex gap-2">
                <select className={inputCls} value={form.bonusType} onChange={(e) => set('bonusType', e.target.value)}><option value="">None</option>{AMOUNT_TYPES.map((t) => <option key={t} value={t}>{levelLabel(t)}</option>)}</select>
                <input type="number" disabled={!form.bonusType} className={`${inputCls} disabled:bg-gray-50`} value={form.bonusValue} onChange={(e) => set('bonusValue', e.target.value)} placeholder="Amount" />
              </div>
            </div>
          </div>
        </div>

        {isEdit && (
          <div className="border-t border-gray-100 pt-4">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Agreement</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div><label className={labelCls}>Start</label><input type="date" className={inputCls} value={form.agreementStartDate} onChange={(e) => set('agreementStartDate', e.target.value)} /></div>
              <div><label className={labelCls}>End</label><input type="date" className={inputCls} value={form.agreementEndDate} onChange={(e) => set('agreementEndDate', e.target.value)} /></div>
              <div><label className={labelCls}>Renewal</label><input type="date" className={inputCls} value={form.agreementRenewalDate} onChange={(e) => set('agreementRenewalDate', e.target.value)} /></div>
              <div className="sm:col-span-3"><label className={labelCls}>Agreement document URL</label><input className={inputCls} value={form.agreementUrl} onChange={(e) => set('agreementUrl', e.target.value)} placeholder="https://" /></div>
            </div>
          </div>
        )}

        <div><label className={labelCls}>Notes</label><textarea className={`${inputCls} min-h-[70px]`} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>

        <div className="flex flex-wrap justify-end gap-2">
          {/* PR-CURATION — the review screen for this institution's imported
              programmes: Active/Inactive per programme, full field editing,
              thumbnails. Only offered once the institution exists. */}
          {isEdit && providerId && (
            <a href={`/staff/universities/${providerId}/programmes`}
              className="inline-flex items-center gap-2 rounded-xl border border-[#1e3a5f] px-5 py-2.5 text-sm font-semibold text-[#1e3a5f] hover:bg-[#1e3a5f]/5 min-h-[44px]">
              <ListChecks size={16} />
              Programmes{programmes.length ? ` (${programmes.length})` : ''}
            </a>
          )}
          <button type="button" onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1e3a5f] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50 min-h-[44px]">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {isEdit ? 'Save changes' : 'Create university'}
          </button>
        </div>
      </CardContent></Card>

      {isEdit && providerId && <ImportProgrammesSection providerId={providerId} />}
      {isEdit && providerId && <PricingImportSection providerId={providerId} />}
      {isEdit && providerId && <ProgrammeCoversSection programmes={programmes} />}
      {isEdit && providerId && <ScholarshipsSection providerId={providerId} programmes={programmes} />}
    </div>
  );
}

function RateField({ label, type, value, onType, onValue }: { label: string; type: string; value: number | string; onType: (v: string) => void; onValue: (v: string) => void }) {
  return (
    <div>
      <label className={labelCls}>{label} commission</label>
      <div className="flex gap-2">
        <select className={inputCls} value={type} onChange={(e) => onType(e.target.value)}>{AMOUNT_TYPES.map((t) => <option key={t} value={t}>{levelLabel(t)}</option>)}</select>
        <input type="number" className={inputCls} value={value} onChange={(e) => onValue(e.target.value)} />
      </div>
    </div>
  );
}

// ── Scholarships subsection ─────────────────────────────────────────────────
// PR-CATALOG-1 — per-institution Excel import. Every row lands PENDING; the Owner
// reviews + approves each in "Programme approvals" before students see it.
function ImportProgrammesSection({ providerId }: { providerId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const doImport = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.upload<{ created: number; updated: number; skipped: number; unmapped: string[] }>(`/providers/${providerId}/import-programmes`, fd);
      toast.success(`Imported ${r.created} new, ${r.updated} updated${r.unmapped.length ? ` · ${r.unmapped.length} need a StudyField check` : ''}. Review them in Programme approvals.`);
      setFile(null);
    } catch (e: any) {
      toast.error(e?.message ?? 'Import failed.');
    } finally {
      setBusy(false);
    }
  };
  // PR-CATALOG-2 — run the monthly web check for just this institution, on demand.
  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api.post<{ changeProposals: number; candidatesCreated: number; discoverySkipped: { reason: string }[] }>(`/providers/${providerId}/sync-now`, {});
      const found = r.changeProposals + r.candidatesCreated;
      if (found > 0) {
        toast.success(`Web check: ${r.changeProposals} change(s), ${r.candidatesCreated} new programme(s) found — review in Programme approvals.`);
      } else {
        const skip = r.discoverySkipped?.[0]?.reason;
        toast.success(skip ? `Web check ran — nothing new. (Discovery skipped: ${skip}.)` : 'Web check ran — no changes or new programmes found.');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Web check failed.');
    } finally {
      setSyncing(false);
    }
  };
  return (
    <Card><CardContent className="p-5 space-y-3">
      <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Import programmes (Excel)</h3>
      <p className="text-xs text-gray-500">Upload this institution&apos;s programme spreadsheet. Every row lands as <strong>pending</strong> — review and approve each one in <strong>Programme approvals</strong> before students can see it.</p>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-gray-600" />
        <button onClick={doImport} disabled={!file || busy}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Import
        </button>
      </div>
      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs text-gray-500">Excel is the reliable default. The <strong>monthly web check</strong> also scans the catalogue URL above for fee/detail changes and new programmes — everything it finds still lands <strong>pending</strong> for your review. Run it now:</p>
        <button onClick={syncNow} disabled={syncing}
          className="mt-2 inline-flex items-center gap-2 rounded-xl border border-[#1e3a5f]/25 px-4 py-2 text-sm font-semibold text-[#1e3a5f] hover:bg-[#1e3a5f]/5 disabled:opacity-50">
          {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {syncing ? 'Checking…' : 'Run web check now'}
        </button>
      </div>
    </CardContent></Card>
  );
}

const emptySch = { nationality: 'IR', programmeId: '', level: '', name: '', amountType: 'FIXED', amountValue: '', currency: 'NZD', eligibilityNotes: '', isActive: true };

function ScholarshipsSection({ providerId, programmes }: { providerId: string; programmes: Programme[] }) {
  const [rows, setRows] = useState<Scholarship[] | null>(null);
  const [panel, setPanel] = useState<{ open: boolean; editingId: string | null }>({ open: false, editingId: null });
  const [draft, setDraft] = useState<typeof emptySch>(emptySch);
  const [saving, setSaving] = useState(false);
  const setD = (k: keyof typeof emptySch, v: string | boolean) => setDraft((d) => ({ ...d, [k]: v }));

  const load = () => api.get<Scholarship[]>(`/providers/${providerId}/scholarships`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [providerId]);

  const openNew = () => { setDraft(emptySch); setPanel({ open: true, editingId: null }); };
  const openEdit = (s: Scholarship) => {
    setDraft({ nationality: s.nationality, programmeId: s.programmeId ?? '', level: s.level ?? '', name: s.name, amountType: s.amountType, amountValue: String(s.amountValue), currency: s.currency, eligibilityNotes: s.eligibilityNotes ?? '', isActive: s.isActive });
    setPanel({ open: true, editingId: s.id });
  };
  const close = () => { setPanel({ open: false, editingId: null }); setDraft(emptySch); };

  const submit = async () => {
    if (!draft.name.trim()) { toast.error('Scholarship name is required.'); return; }
    if (draft.amountValue === '') { toast.error('Enter an amount.'); return; }
    setSaving(true);
    const body = {
      nationality: draft.nationality, name: draft.name.trim(),
      programmeId: draft.programmeId || undefined, level: draft.level || undefined,
      amountType: draft.amountType, amountValue: Number(draft.amountValue), currency: draft.currency.trim() || 'NZD',
      eligibilityNotes: draft.eligibilityNotes.trim() || undefined, isActive: draft.isActive,
    };
    try {
      if (panel.editingId) { await api.patch(`/providers/scholarships/${panel.editingId}`, body); toast.success('Scholarship updated.'); }
      else { await api.post(`/providers/${providerId}/scholarships`, body); toast.success('Scholarship added.'); }
      close(); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save.'); } finally { setSaving(false); }
  };

  const toggleActive = async (s: Scholarship) => {
    try { await api.patch(`/providers/scholarships/${s.id}`, { isActive: !s.isActive }); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update.'); }
  };
  const remove = async (s: Scholarship) => {
    if (!confirm(`Delete scholarship “${s.name}”?`)) return;
    try { await api.delete(`/providers/scholarships/${s.id}`); toast.success('Deleted.'); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete.'); }
  };

  return (
    <Card><CardContent className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Award size={18} className="text-[#c9a961]" /><h2 className="font-bold text-[#1e3a5f]">Scholarships</h2></div>
        {!panel.open && <button type="button" onClick={openNew} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-2 text-xs font-semibold text-white hover:bg-[#162d4a] min-h-[40px]"><Plus size={14} /> Add scholarship</button>}
      </div>
      <p className="-mt-2 text-xs text-gray-500">Per applicant nationality, optionally scoped to a programme or qualification level. Feeds offer generation.</p>

      {panel.open && (
        <div className="rounded-xl border border-[#c9a961]/40 bg-[#faf8f3] p-4 space-y-3">
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-gray-500">{panel.editingId ? 'Edit scholarship' : 'New scholarship'}</span><button type="button" onClick={close} className="text-gray-400 hover:text-gray-600"><X size={16} /></button></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className={labelCls}>Nationality</label><CountryPicker value={draft.nationality} onChange={(c) => setD('nationality', c)} /></div>
            <div><label className={labelCls}>Name</label><input className={inputCls} value={draft.name} onChange={(e) => setD('name', e.target.value)} placeholder="e.g. Iran Merit Scholarship" /></div>
            <div>
              <label className={labelCls}>Amount</label>
              <div className="flex gap-2">
                <select className={inputCls} value={draft.amountType} onChange={(e) => setD('amountType', e.target.value)}>{AMOUNT_TYPES.map((t) => <option key={t} value={t}>{levelLabel(t)}</option>)}</select>
                <input type="number" className={inputCls} value={draft.amountValue} onChange={(e) => setD('amountValue', e.target.value)} />
                {draft.amountType === 'FIXED' && <input className={`${inputCls} w-24`} value={draft.currency} onChange={(e) => setD('currency', e.target.value)} placeholder="NZD" />}
              </div>
            </div>
            <div><label className={labelCls}>Programme (optional)</label><select className={inputCls} value={draft.programmeId} onChange={(e) => setD('programmeId', e.target.value)}><option value="">Any programme</option>{programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className={labelCls}>Qualification level (optional)</label><select className={inputCls} value={draft.level} onChange={(e) => setD('level', e.target.value)}><option value="">Any level</option>{LEVELS.map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}</select></div>
            <div className="sm:col-span-2"><label className={labelCls}>Eligibility / conditions</label><textarea className={`${inputCls} min-h-[60px]`} value={draft.eligibilityNotes} onChange={(e) => setD('eligibilityNotes', e.target.value)} /></div>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50 min-h-[40px]">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {panel.editingId ? 'Save' : 'Add'}</button>
          </div>
        </div>
      )}

      {!rows ? <div className="flex items-center gap-2 py-4 text-sm text-gray-400"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        : rows.length === 0 ? <p className="py-4 text-sm text-gray-500">No scholarships yet.</p>
        : (
          <ul className="divide-y divide-gray-100">
            {rows.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#1e3a5f]">
                    {countryCodeToFlagEmoji(s.nationality)} {s.name}
                    {!s.isActive && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">inactive</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {getCountryName(s.nationality, 'en')} · {amountLabel(s.amountType, s.amountValue, s.currency)}
                    {s.programme ? ` · ${s.programme.name}` : s.level ? ` · ${levelLabel(s.level)}` : ''}
                  </p>
                  {s.eligibilityNotes && <p className="mt-0.5 text-xs text-gray-400">{s.eligibilityNotes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => toggleActive(s)} title={s.isActive ? 'Deactivate' : 'Activate'}
                    className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${s.isActive ? 'text-[#15a86b] hover:bg-[#15a86b]/10' : 'text-gray-400 hover:bg-gray-100'}`}>
                    {s.isActive ? 'Active' : 'Inactive'}
                  </button>
                  <button type="button" onClick={() => openEdit(s)} title="Edit" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-[#1e3a5f]"><Pencil size={15} /></button>
                  <button type="button" onClick={() => remove(s)} title="Delete" className="rounded-lg p-2 text-gray-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
    </CardContent></Card>
  );
}
