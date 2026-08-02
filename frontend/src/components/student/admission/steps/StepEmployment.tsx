'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useAdmission, type EmploymentEntry, type EmploymentEntryInput } from '../AdmissionFormContext';
import { CountrySelect } from '@/components/common/CountrySelect';

// PR-ADMISSION-CVDATA (step 2a) — real, structured employment history captured at admission
// stage. Feeds the AI CV's Experience section with verified data (employer/title/dates), not
// coded scorecard buckets. Mirrors the education-history editor's draft+saved-card pattern.
// New strings are inline English (Persian i18n frozen — same pattern as Step-1 notices).

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1950;

// UI year validation — mirrors backend validateEmploymentYears. Returns a message or null.
function yearError(startRaw: string, endRaw: string, isCurrent: boolean): string | null {
  const parse = (v: string): number | null => {
    const s = v.trim();
    if (!s) return null;
    if (!/^\d{4}$/.test(s)) return null;
    const n = parseInt(s, 10);
    return n >= MIN_YEAR && n <= CURRENT_YEAR ? n : null;
  };
  const provided = (v: string) => v.trim() !== '';
  const start = parse(startRaw);
  const end = parse(endRaw);
  if (provided(startRaw) && start === null) return 'Please enter a valid 4-digit year (not in the future).';
  if (!isCurrent && provided(endRaw) && end === null) return 'Please enter a valid 4-digit year (not in the future).';
  if (isCurrent && provided(endRaw)) return 'A current role cannot have an end year — leave it blank.';
  if (!isCurrent && start !== null && end !== null && start > end) return 'Start year cannot be after end year.';
  return null;
}

const parseYear = (raw: string): number | null => {
  const s = raw.trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

interface Draft {
  draftId: string;
  employerName: string; roleTitle: string; organisationField: string; countryOfWork: string;
  startYear: string; endYear: string; isCurrent: boolean; dutiesText: string;
}
const emptyDraft = (): Draft => ({
  draftId: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  employerName: '', roleTitle: '', organisationField: '', countryOfWork: '',
  startYear: '', endYear: '', isCurrent: false, dutiesText: '',
});

const inputCls = 'w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none';
const labelCls = 'mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy';

export function StepEmployment() {
  const { employmentEntries, addEmploymentEntry, updateEmploymentEntry, deleteEmploymentEntry } = useAdmission();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  const saveDraft = async (d: Draft) => {
    if (!d.employerName.trim()) { toast.error('Employer name is required.'); return; }
    if (!d.roleTitle.trim()) { toast.error('Job title is required.'); return; }
    const yErr = yearError(d.startYear, d.endYear, d.isCurrent);
    if (yErr) { toast.error(yErr); return; }
    const payload: EmploymentEntryInput = {
      employerName: d.employerName.trim(), roleTitle: d.roleTitle.trim(),
      organisationField: d.organisationField.trim() || null,
      countryOfWork: d.countryOfWork.trim() || null,
      startYear: parseYear(d.startYear), endYear: d.isCurrent ? null : parseYear(d.endYear),
      isCurrent: d.isCurrent, dutiesText: d.dutiesText.trim() || null,
    };
    setSavingId(d.draftId);
    try {
      await addEmploymentEntry(payload);
      setDrafts(prev => prev.filter(x => x.draftId !== d.draftId));
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save this role.');
    } finally { setSavingId(null); }
  };

  const del = async (id: string) => {
    if (!window.confirm('Remove this role?')) return;
    try { await deleteEmploymentEntry(id); } catch { toast.error('Could not remove this role.'); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-sorena-navy">Employment history</h2>
        <p className="mt-1 text-sm text-sorena-navy/60">
          Add your work experience — employer, job title, and years. This is used to build your CV. You can add approximate years now and refine them later; leave the end year blank for your current role.
        </p>
      </div>

      {employmentEntries.map(entry => (
        <SavedCard key={entry.id} entry={entry} onChange={updateEmploymentEntry} onDelete={() => del(entry.id)} />
      ))}

      {drafts.map(d => (
        <DraftCard
          key={d.draftId} draft={d} saving={savingId === d.draftId}
          onChange={patch => setDrafts(prev => prev.map(x => x.draftId === d.draftId ? { ...x, ...patch } : x))}
          onSave={() => saveDraft(d)}
          onDiscard={() => setDrafts(prev => prev.filter(x => x.draftId !== d.draftId))}
        />
      ))}

      <button
        type="button"
        onClick={() => setDrafts(prev => [...prev, emptyDraft()])}
        className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5"
      >
        + Add a role
      </button>

      {employmentEntries.length === 0 && drafts.length === 0 && (
        <p className="text-sm text-sorena-navy/50">No work experience yet? You can skip this and continue — it isn’t required to proceed.</p>
      )}
    </div>
  );
}

// ─── Saved (editable) card ──────────────────────────────────────────────────
function SavedCard({
  entry, onChange, onDelete,
}: {
  entry: EmploymentEntry;
  onChange: (id: string, patch: Partial<EmploymentEntryInput>) => Promise<EmploymentEntry>;
  onDelete: () => void;
}) {
  const [employerName, setEmployerName] = useState(entry.employerName);
  const [roleTitle, setRoleTitle] = useState(entry.roleTitle);
  const [organisationField, setOrganisationField] = useState(entry.organisationField ?? '');
  const [startYear, setStartYear] = useState(entry.startYear?.toString() ?? '');
  const [endYear, setEndYear] = useState(entry.endYear?.toString() ?? '');
  const [dutiesText, setDutiesText] = useState(entry.dutiesText ?? '');

  const yErr = yearError(startYear, endYear, entry.isCurrent);

  const patch = async (data: Partial<EmploymentEntryInput>) => {
    try { await onChange(entry.id, data); } catch (e: any) { toast.error(e?.message ?? 'Could not save.'); }
  };
  const blurText = (field: 'employerName' | 'roleTitle' | 'organisationField', val: string, orig: string | null | undefined) => {
    const next = val.trim();
    if (next === (orig ?? '')) return;
    if ((field === 'employerName' || field === 'roleTitle') && !next) return; // server rejects empty
    patch({ [field]: field === 'organisationField' ? (next || null) : next } as Partial<EmploymentEntryInput>);
  };
  const blurYear = (field: 'startYear' | 'endYear', val: string) => {
    if (yErr) return; // don't PATCH an invalid pair
    patch({ [field]: parseYear(val) } as Partial<EmploymentEntryInput>);
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">Role</h4>
        <button type="button" onClick={onDelete} title="Remove role" className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500">
          <Trash2 size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Employer<span className="ms-0.5 text-red-500">*</span></label>
          <input className={inputCls} value={employerName} onChange={e => setEmployerName(e.target.value)} onBlur={() => blurText('employerName', employerName, entry.employerName)} />
        </div>
        <div>
          <label className={labelCls}>Job title<span className="ms-0.5 text-red-500">*</span></label>
          <input className={inputCls} value={roleTitle} onChange={e => setRoleTitle(e.target.value)} onBlur={() => blurText('roleTitle', roleTitle, entry.roleTitle)} />
        </div>
        <div>
          <label className={labelCls}>Industry / field</label>
          <input className={inputCls} value={organisationField} onChange={e => setOrganisationField(e.target.value)} onBlur={() => blurText('organisationField', organisationField, entry.organisationField)} placeholder="e.g. Software, Healthcare" />
        </div>
        <div>
          <label className={labelCls}>Country of work</label>
          <CountrySelect value={entry.countryOfWork || null} onChange={code => patch({ countryOfWork: code ?? null })} placeholder="Select country" />
        </div>
        <div>
          <label className={labelCls}>Start year</label>
          <input type="number" className={inputCls} value={startYear} onChange={e => setStartYear(e.target.value)} onBlur={() => blurYear('startYear', startYear)} placeholder="e.g. 2019" />
        </div>
        <div>
          <label className={labelCls}>End year</label>
          <input type="number" className={inputCls} value={endYear} disabled={entry.isCurrent} onChange={e => setEndYear(e.target.value)} onBlur={() => blurYear('endYear', endYear)} placeholder={entry.isCurrent ? 'Current role' : 'e.g. 2022'} />
        </div>
      </div>
      {yErr && <p className="text-xs text-red-500">{yErr}</p>}

      <label className="flex cursor-pointer items-center gap-3">
        <input type="checkbox" checked={entry.isCurrent} onChange={e => patch({ isCurrent: e.target.checked, ...(e.target.checked ? { endYear: null } : {}) })} className="h-4 w-4 cursor-pointer rounded border-sorena-navy/20 accent-sorena-navy" />
        <span className="text-sm text-sorena-navy/80">This is my current role</span>
      </label>

      <div>
        <label className={labelCls}>What you did (optional)</label>
        <textarea className={inputCls} rows={2} value={dutiesText} onChange={e => setDutiesText(e.target.value)} onBlur={() => { if ((dutiesText.trim() || null) !== (entry.dutiesText ?? null)) patch({ dutiesText: dutiesText.trim() || null }); }} placeholder="A short description of your responsibilities." />
      </div>
    </div>
  );
}

// ─── Draft (unsaved) card ───────────────────────────────────────────────────
function DraftCard({
  draft, saving, onChange, onSave, onDiscard,
}: {
  draft: Draft; saving: boolean;
  onChange: (patch: Partial<Draft>) => void; onSave: () => void; onDiscard: () => void;
}) {
  const yErr = yearError(draft.startYear, draft.endYear, draft.isCurrent);
  return (
    <div className="flex flex-col gap-4 rounded-xl border-2 border-dashed border-sorena-navy/20 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">New role</h4>
        <button type="button" onClick={onDiscard} title="Discard" className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Employer<span className="ms-0.5 text-red-500">*</span></label>
          <input className={inputCls} value={draft.employerName} onChange={e => onChange({ employerName: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Job title<span className="ms-0.5 text-red-500">*</span></label>
          <input className={inputCls} value={draft.roleTitle} onChange={e => onChange({ roleTitle: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Industry / field</label>
          <input className={inputCls} value={draft.organisationField} onChange={e => onChange({ organisationField: e.target.value })} placeholder="e.g. Software, Healthcare" />
        </div>
        <div>
          <label className={labelCls}>Country of work</label>
          <CountrySelect value={draft.countryOfWork || null} onChange={code => onChange({ countryOfWork: code ?? '' })} placeholder="Select country" />
        </div>
        <div>
          <label className={labelCls}>Start year</label>
          <input type="number" className={inputCls} value={draft.startYear} onChange={e => onChange({ startYear: e.target.value })} placeholder="e.g. 2019" />
        </div>
        <div>
          <label className={labelCls}>End year</label>
          <input type="number" className={inputCls} value={draft.endYear} disabled={draft.isCurrent} onChange={e => onChange({ endYear: e.target.value })} placeholder={draft.isCurrent ? 'Current role' : 'e.g. 2022'} />
        </div>
      </div>
      {yErr && <p className="text-xs text-red-500">{yErr}</p>}
      <label className="flex cursor-pointer items-center gap-3">
        <input type="checkbox" checked={draft.isCurrent} onChange={e => onChange({ isCurrent: e.target.checked })} className="h-4 w-4 cursor-pointer rounded border-sorena-navy/20 accent-sorena-navy" />
        <span className="text-sm text-sorena-navy/80">This is my current role</span>
      </label>
      <div>
        <label className={labelCls}>What you did (optional)</label>
        <textarea className={inputCls} rows={2} value={draft.dutiesText} onChange={e => onChange({ dutiesText: e.target.value })} placeholder="A short description of your responsibilities." />
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={onSave} disabled={saving} className="rounded-lg bg-sorena-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-sorena-navy/90 disabled:opacity-40">
          {saving ? 'Saving…' : 'Save role'}
        </button>
      </div>
    </div>
  );
}
