'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useAdmission, type EducationEntry, type EducationEntryInput } from './AdmissionFormContext';
import { DocumentUploader } from './DocumentUploader';

const QUALIFICATION_LEVELS = [
  { value: 'HIGH_SCHOOL', key: 'admissionEducationHistoryLevelHighSchool' },
  { value: 'DIPLOMA',     key: 'admissionEducationHistoryLevelDiploma'    },
  { value: 'BACHELORS',   key: 'admissionEducationHistoryLevelBachelors'  },
  { value: 'MASTERS',     key: 'admissionEducationHistoryLevelMasters'    },
  { value: 'DOCTORATE',   key: 'admissionEducationHistoryLevelDoctorate'  },
  { value: 'OTHER',       key: 'admissionEducationHistoryLevelOther'      },
] as const;

// In-memory shape of a card that hasn't been POSTed yet. Drafts have a
// locally-generated id (prefixed `draft-`) which never reaches the server;
// the real id is assigned by the backend on save.
interface DraftEntry {
  draftId: string;
  qualificationLevel: string;
  institutionName: string;
  country: string;
  fieldOfStudy: string;
  startYear: string; // raw input value, parsed to int on save
  endYear: string;
  completed: boolean;
}

function emptyDraft(): DraftEntry {
  return {
    draftId: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    qualificationLevel: '',
    institutionName: '',
    country: '',
    fieldOfStudy: '',
    startYear: '',
    endYear: '',
    completed: false,
  };
}

function parseYearOrNull(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function EducationHistoryEditor() {
  const t = useTranslations();
  const {
    educationEntries,
    addEducationEntry,
    updateEducationEntry,
    deleteEducationEntry,
  } = useAdmission();

  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);

  const handleAddDraft = () => {
    setDrafts(prev => [...prev, emptyDraft()]);
  };

  const handleDraftChange = (draftId: string, patch: Partial<DraftEntry>) => {
    setDrafts(prev => prev.map(d => d.draftId === draftId ? { ...d, ...patch } : d));
  };

  const handleSaveDraft = async (draft: DraftEntry) => {
    if (!draft.qualificationLevel) {
      toast.error(t('admissionEducationHistoryValidationLevel'));
      return;
    }
    if (!draft.institutionName.trim()) {
      toast.error(t('admissionEducationHistoryValidationInstitution'));
      return;
    }
    if (!draft.country.trim()) {
      toast.error(t('admissionEducationHistoryValidationCountry'));
      return;
    }
    const payload: EducationEntryInput = {
      qualificationLevel: draft.qualificationLevel,
      institutionName: draft.institutionName.trim(),
      country: draft.country.trim(),
      fieldOfStudy: draft.fieldOfStudy.trim() || null,
      startYear: parseYearOrNull(draft.startYear),
      endYear: parseYearOrNull(draft.endYear),
      completed: draft.completed,
    };
    setSavingDraftId(draft.draftId);
    try {
      await addEducationEntry(payload);
      setDrafts(prev => prev.filter(d => d.draftId !== draft.draftId));
    } catch {
      toast.error(t('admissionEducationHistorySaveError'));
    } finally {
      setSavingDraftId(null);
    }
  };

  const handleDiscardDraft = (draftId: string) => {
    setDrafts(prev => prev.filter(d => d.draftId !== draftId));
  };

  const handleSavedFieldChange = async (
    entryId: string,
    patch: Partial<EducationEntryInput>,
  ) => {
    try {
      await updateEducationEntry(entryId, patch);
    } catch {
      toast.error(t('admissionEducationHistorySaveError'));
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!window.confirm(t('admissionEducationHistoryDeleteConfirm'))) return;
    try {
      await deleteEducationEntry(entryId);
    } catch {
      toast.error(t('admissionEducationHistoryDeleteError'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-xl font-bold text-sorena-navy">
          {t('admissionEducationHistoryTitle')}
        </h3>
        <p className="mt-1 text-sm text-sorena-navy/60">
          {t('admissionEducationHistoryHelper')}
        </p>
      </div>

      {/* Saved entries */}
      {educationEntries.map((entry) => (
        <SavedEntryCard
          key={entry.id}
          entry={entry}
          onFieldChange={handleSavedFieldChange}
          onDelete={() => handleDelete(entry.id)}
        />
      ))}

      {/* Draft entries (not yet saved to the server) */}
      {drafts.map((draft) => (
        <DraftEntryCard
          key={draft.draftId}
          draft={draft}
          saving={savingDraftId === draft.draftId}
          onChange={(patch) => handleDraftChange(draft.draftId, patch)}
          onSave={() => handleSaveDraft(draft)}
          onDiscard={() => handleDiscardDraft(draft.draftId)}
        />
      ))}

      {/* Add button */}
      <button
        type="button"
        onClick={handleAddDraft}
        className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5"
      >
        + {t('admissionEducationHistoryAddButton')}
      </button>
    </div>
  );
}

// ─── Saved entry card ──────────────────────────────────────────────────────

function SavedEntryCard({
  entry,
  onFieldChange,
  onDelete,
}: {
  entry: EducationEntry;
  onFieldChange: (entryId: string, patch: Partial<EducationEntryInput>) => Promise<void>;
  onDelete: () => void;
}) {
  const t = useTranslations();

  // Local-state buffer for text inputs so we don't PATCH on every keystroke.
  // We sync with `entry.<field>` on mount and on entry-id change. PATCH fires
  // on blur (text inputs) or on change (selects/checkbox).
  const [institutionName, setInstitutionName] = useState(entry.institutionName);
  const [country, setCountry] = useState(entry.country);
  const [fieldOfStudy, setFieldOfStudy] = useState(entry.fieldOfStudy ?? '');
  const [startYear, setStartYear] = useState(entry.startYear?.toString() ?? '');
  const [endYear, setEndYear] = useState(entry.endYear?.toString() ?? '');

  const blurIfChanged = async (field: keyof EducationEntryInput, current: string, original: string | null | undefined) => {
    const next = current.trim();
    const orig = (original ?? '').toString();
    if (next === orig) return;
    if (field === 'institutionName' || field === 'country') {
      if (!next) return; // server rejects empty; UI keeps stale until user types something valid
    }
    if (field === 'startYear' || field === 'endYear') {
      const n = parseYearOrNull(current);
      await onFieldChange(entry.id, { [field]: n } as Partial<EducationEntryInput>);
      return;
    }
    if (field === 'fieldOfStudy') {
      await onFieldChange(entry.id, { fieldOfStudy: next || null });
      return;
    }
    await onFieldChange(entry.id, { [field]: next } as Partial<EducationEntryInput>);
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
          {t('admissionEducationHistoryEntryHeading')}
        </h4>
        <button
          type="button"
          onClick={onDelete}
          title={t('admissionEducationHistoryDeleteTooltip')}
          className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* qualificationLevel */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryLevelLabel')}
          </label>
          <select
            value={entry.qualificationLevel}
            onChange={(e) => onFieldChange(entry.id, { qualificationLevel: e.target.value })}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
          >
            {QUALIFICATION_LEVELS.map(({ value, key }) => (
              <option key={value} value={value}>{t(key)}</option>
            ))}
          </select>
        </div>

        {/* institutionName */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryInstitutionLabel')}
          </label>
          <input
            type="text"
            value={institutionName}
            onChange={(e) => setInstitutionName(e.target.value)}
            onBlur={() => blurIfChanged('institutionName', institutionName, entry.institutionName)}
            placeholder={t('admissionEducationHistoryInstitutionPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>

        {/* country */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryCountryLabel')}
          </label>
          <input
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            onBlur={() => blurIfChanged('country', country, entry.country)}
            placeholder={t('admissionEducationHistoryCountryPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>

        {/* fieldOfStudy */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryFieldOfStudyLabel')}
          </label>
          <input
            type="text"
            value={fieldOfStudy}
            onChange={(e) => setFieldOfStudy(e.target.value)}
            onBlur={() => blurIfChanged('fieldOfStudy', fieldOfStudy, entry.fieldOfStudy)}
            placeholder={t('admissionEducationHistoryFieldOfStudyPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>

        {/* startYear */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryStartYearLabel')}
          </label>
          <input
            type="number"
            value={startYear}
            onChange={(e) => setStartYear(e.target.value)}
            onBlur={() => blurIfChanged('startYear', startYear, entry.startYear?.toString())}
            placeholder={t('admissionEducationHistoryStartYearPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>

        {/* endYear */}
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryEndYearLabel')}
          </label>
          <input
            type="number"
            value={endYear}
            onChange={(e) => setEndYear(e.target.value)}
            onBlur={() => blurIfChanged('endYear', endYear, entry.endYear?.toString())}
            placeholder={t('admissionEducationHistoryEndYearPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>
      </div>

      {/* completed checkbox */}
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={entry.completed}
          onChange={(e) => onFieldChange(entry.id, { completed: e.target.checked })}
          className="h-4 w-4 cursor-pointer rounded border-sorena-navy/20 accent-sorena-navy"
        />
        <span className="text-sm text-sorena-navy/80">
          {t('admissionEducationHistoryCompletedLabel')}
        </span>
      </label>

      {/* Per-entry document uploaders */}
      <div className="flex flex-col gap-4 border-t border-sorena-navy/10 pt-4">
        <DocumentUploader
          documentType="NOTARIZED_CERTIFICATE"
          educationEntryId={entry.id}
          label={t('admissionEducationHistoryCertificateLabel')}
          helperText={t('admissionEducationHistoryCertificateHelper')}
          single={true}
          required={false}
        />
        <DocumentUploader
          documentType="NOTARIZED_TRANSCRIPT"
          educationEntryId={entry.id}
          label={t('admissionEducationHistoryTranscriptLabel')}
          helperText={t('admissionEducationHistoryTranscriptHelper')}
          single={true}
          required={false}
        />
      </div>
    </div>
  );
}

// ─── Draft entry card (not yet saved) ──────────────────────────────────────

function DraftEntryCard({
  draft,
  saving,
  onChange,
  onSave,
  onDiscard,
}: {
  draft: DraftEntry;
  saving: boolean;
  onChange: (patch: Partial<DraftEntry>) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-4 rounded-xl border-2 border-dashed border-sorena-navy/20 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
          {t('admissionEducationHistoryNewEntryHeading')}
        </h4>
        <button
          type="button"
          onClick={onDiscard}
          title={t('admissionEducationHistoryDiscardTooltip')}
          className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryLevelLabel')}
            <span className="ml-0.5 text-red-500">*</span>
          </label>
          <select
            value={draft.qualificationLevel}
            onChange={(e) => onChange({ qualificationLevel: e.target.value })}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
          >
            <option value="" disabled>{t('admissionEducationHistoryLevelPlaceholder')}</option>
            {QUALIFICATION_LEVELS.map(({ value, key }) => (
              <option key={value} value={value}>{t(key)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryInstitutionLabel')}
            <span className="ml-0.5 text-red-500">*</span>
          </label>
          <input
            type="text"
            value={draft.institutionName}
            onChange={(e) => onChange({ institutionName: e.target.value })}
            placeholder={t('admissionEducationHistoryInstitutionPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryCountryLabel')}
            <span className="ml-0.5 text-red-500">*</span>
          </label>
          <input
            type="text"
            value={draft.country}
            onChange={(e) => onChange({ country: e.target.value })}
            placeholder={t('admissionEducationHistoryCountryPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryFieldOfStudyLabel')}
          </label>
          <input
            type="text"
            value={draft.fieldOfStudy}
            onChange={(e) => onChange({ fieldOfStudy: e.target.value })}
            placeholder={t('admissionEducationHistoryFieldOfStudyPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryStartYearLabel')}
          </label>
          <input
            type="number"
            value={draft.startYear}
            onChange={(e) => onChange({ startYear: e.target.value })}
            placeholder={t('admissionEducationHistoryStartYearPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('admissionEducationHistoryEndYearLabel')}
          </label>
          <input
            type="number"
            value={draft.endYear}
            onChange={(e) => onChange({ endYear: e.target.value })}
            placeholder={t('admissionEducationHistoryEndYearPlaceholder')}
            className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={draft.completed}
          onChange={(e) => onChange({ completed: e.target.checked })}
          className="h-4 w-4 cursor-pointer rounded border-sorena-navy/20 accent-sorena-navy"
        />
        <span className="text-sm text-sorena-navy/80">
          {t('admissionEducationHistoryCompletedLabel')}
        </span>
      </label>

      {/* Save-first message replacing the uploaders for drafts */}
      <p className="rounded-lg border border-dashed border-sorena-navy/20 bg-sorena-navy/[0.02] p-3 text-sm text-sorena-navy/60">
        {t('admissionEducationHistorySaveFirstMessage')}
      </p>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-sorena-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-sorena-navy/90 disabled:opacity-40"
        >
          {saving
            ? t('admissionEducationHistorySaving')
            : t('admissionEducationHistorySaveButton')}
        </button>
      </div>
    </div>
  );
}
