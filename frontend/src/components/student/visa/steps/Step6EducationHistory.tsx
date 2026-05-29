'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ExternalLink, Paperclip, Download } from 'lucide-react';
import {
  useVisa,
  type EducationEntryRow,
  type EducationSupplement,
  type EducationSupplementPatch,
} from '../VisaFormContext';
import { api } from '@/lib/api';

// PR-VISA6 — INZ 1200 Section 6 "Education history".
// Admission entries are shown READ-ONLY (sourced from the admission row,
// not re-typed here). Per-entry attached documents are listed with a
// download action. The only editable fields are the INZ-extra
// supplement columns: start/end month, institution state, institution
// town, and "Was the qualification awarded?".
//
// Each supplement persists live via PATCH /students/me/visa/education-
// supplements/<entryId> — the backend upserts the row.

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

const MONTH_KEYS = [
  'visaCommonMonthJan', 'visaCommonMonthFeb', 'visaCommonMonthMar',
  'visaCommonMonthApr', 'visaCommonMonthMay', 'visaCommonMonthJun',
  'visaCommonMonthJul', 'visaCommonMonthAug', 'visaCommonMonthSep',
  'visaCommonMonthOct', 'visaCommonMonthNov', 'visaCommonMonthDec',
] as const;

// Friendly qualification-level label (mirrors admission's
// QUALIFICATION_LEVELS list — the value strings are stable enum-like).
const QUAL_LEVEL_KEY: Record<string, string> = {
  INTERMEDIATE:     'admissionEducationHistoryLevelIntermediate',
  HIGH_SCHOOL:      'admissionEducationHistoryLevelHighSchool',
  CERTIFICATE:      'admissionEducationHistoryLevelCertificate',
  DIPLOMA:          'admissionEducationHistoryLevelDiploma',
  ASSOCIATE_DEGREE: 'admissionEducationHistoryLevelAssociateDegree',
  BACHELORS:        'admissionEducationHistoryLevelBachelors',
  MASTERS:          'admissionEducationHistoryLevelMasters',
  DOCTORATE:        'admissionEducationHistoryLevelDoctorate',
  OTHER:            'admissionEducationHistoryLevelOther',
};

// Translation t-keys for the document-type labels we know about. Any
// unknown doc type falls back to the raw enum string.
const DOC_TYPE_KEY: Record<string, string> = {
  NOTARIZED_CERTIFICATE: 'visaEducationDocTypeNotarizedCertificate',
  NOTARIZED_TRANSCRIPT:  'visaEducationDocTypeNotarizedTranscript',
};

type AdmissionDocument = {
  id: string;
  documentType: string;
  educationEntryId: string | null;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string;
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

export function Step6EducationHistory() {
  const t = useTranslations();
  const {
    setActiveStep,
    patchVisa,
    savedAt,
    setSavedAt,
    educationEntries,
    educationSupplements,
    upsertEducationSupplement,
  } = useVisa();

  // Lookup of supplement by educationEntryId, joined for render.
  const supplementsByEntryId = useMemo(() => {
    const map = new Map<string, EducationSupplement>();
    for (const s of educationSupplements) map.set(s.educationEntryId, s);
    return map;
  }, [educationSupplements]);

  // Sort latest-graduated-first, client-side. Primary key: endYear desc
  // (nulls/ongoing last). Secondary: completed desc.
  const sortedEntries = useMemo(() => {
    return [...educationEntries].sort((a, b) => {
      const aEnd = a.endYear;
      const bEnd = b.endYear;
      if (aEnd === null && bEnd !== null) return 1;
      if (aEnd !== null && bEnd === null) return -1;
      if (aEnd !== null && bEnd !== null && aEnd !== bEnd) return bEnd - aEnd;
      // Tie-break: completed first.
      if (a.completed !== b.completed) return a.completed ? -1 : 1;
      return 0;
    });
  }, [educationEntries]);

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  // Per-entry attached documents. Fetched once on mount.
  const [documents, setDocuments] = useState<AdmissionDocument[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const docs = await api.get<AdmissionDocument[]>(
          '/students/me/admission/documents',
        );
        if (!cancelled) setDocuments(docs);
      } catch {
        // Silent — documents block is optional; admission has its own
        // error surfaces for upload/list problems.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Local-state buffer for the two text inputs (state + town) so we PATCH
  // on blur, not on every keystroke. Initialised from the server values
  // and kept in sync as supplements change.
  const [textBuffers, setTextBuffers] = useState<
    Record<string, { state: string; town: string }>
  >(() => {
    const init: Record<string, { state: string; town: string }> = {};
    for (const s of educationSupplements) {
      init[s.educationEntryId] = {
        state: s.institutionState ?? '',
        town:  s.institutionTown ?? '',
      };
    }
    return init;
  });

  const getBuffer = (entryId: string) =>
    textBuffers[entryId] ?? { state: '', town: '' };

  const setBuffer = (
    entryId: string,
    patch: Partial<{ state: string; town: string }>,
  ) => {
    setTextBuffers((prev) => ({
      ...prev,
      [entryId]: { ...getBuffer(entryId), ...patch },
    }));
  };

  // ── Live-PATCH handlers (one per editable column) ──────────────────

  const clearErr = (key: string) => {
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: false }));
  };

  const upsert = async (entryId: string, patch: EducationSupplementPatch) => {
    try {
      await upsertEducationSupplement(entryId, patch);
    } catch {
      toast.error(t('visaEducationHistoryUpdateError'));
    }
  };

  const handleStartMonth = (entryId: string, raw: string) => {
    clearErr(`startMonth:${entryId}`);
    const n = parseInt(raw, 10);
    upsert(entryId, { startMonth: Number.isFinite(n) ? n : null });
  };

  const handleEndMonth = (entryId: string, raw: string) => {
    clearErr(`endMonth:${entryId}`);
    const n = parseInt(raw, 10);
    upsert(entryId, { endMonth: Number.isFinite(n) ? n : null });
  };

  const handleStateBlur = (entryId: string) => {
    clearErr(`institutionState:${entryId}`);
    const value = getBuffer(entryId).state.trim();
    upsert(entryId, { institutionState: value || null });
  };

  const handleTownBlur = (entryId: string) => {
    clearErr(`institutionTown:${entryId}`);
    const value = getBuffer(entryId).town.trim();
    upsert(entryId, { institutionTown: value || null });
  };

  const handleAwarded = (entryId: string, awarded: boolean) => {
    clearErr(`qualificationAwarded:${entryId}`);
    upsert(entryId, { qualificationAwarded: awarded });
  };

  // ── Signed-URL download (mirrors DocumentUploader.openSignedUrl) ───

  const downloadDocument = async (docId: string, fileName: string) => {
    try {
      const { url } = await api.get<{ url: string; expiresInSeconds: number }>(
        `/students/me/admission/documents/${docId}/download`,
      );
      const full = `${BACKEND}${url}`;
      window.open(full, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error(t('visaEducationHistoryUpdateError'));
    }
    // fileName isn't used for the new-tab path; kept in signature for
    // parity with the admission flow in case we switch to an <a download>.
    void fileName;
  };

  // ── Save validator ────────────────────────────────────────────────

  const validate = (): string[] => {
    const missing: string[] = [];
    const e: Record<string, boolean> = {};

    if (sortedEntries.length === 0) {
      // Surfaced as the "no entries" banner — Save is blocked.
      e.noEntries = true;
      missing.push('noEntries');
      setErrors(e);
      return missing;
    }

    for (const entry of sortedEntries) {
      const s = supplementsByEntryId.get(entry.id);
      const buf = getBuffer(entry.id);
      const stateValue = (s?.institutionState ?? buf.state).trim();
      const townValue  = (s?.institutionTown  ?? buf.town).trim();

      if (!s?.startMonth || s.startMonth < 1 || s.startMonth > 12) {
        e[`startMonth:${entry.id}`] = true; missing.push(`startMonth:${entry.id}`);
      }
      if (!s?.endMonth || s.endMonth < 1 || s.endMonth > 12) {
        e[`endMonth:${entry.id}`] = true; missing.push(`endMonth:${entry.id}`);
      }
      if (!stateValue) {
        e[`institutionState:${entry.id}`] = true; missing.push(`institutionState:${entry.id}`);
      }
      if (!townValue) {
        e[`institutionTown:${entry.id}`] = true; missing.push(`institutionTown:${entry.id}`);
      }
      if (typeof s?.qualificationAwarded !== 'boolean') {
        e[`qualificationAwarded:${entry.id}`] = true; missing.push(`qualificationAwarded:${entry.id}`);
      }
    }

    setErrors(e);
    return missing;
  };

  const handleSave = async () => {
    const missing = validate();
    if (missing.length > 0) {
      toast.error(t('visaEducationHistoryValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      // No top-level fields beyond currentStep — supplements were already
      // persisted live as the student edited them. Bump currentStep to 7
      // so the stepper opens cleanly there.
      await patchVisa({ currentStep: 7 });
      setSavedAt(new Date().toISOString());
      toast.success(t('visaEducationHistorySaveSuccess'));
      setActiveStep(7);
    } catch {
      toast.error(t('visaEducationHistorySaveError'));
    } finally {
      setSaving(false);
    }
  };

  // ── Reusable building blocks ──────────────────────────────────────

  const Asterisk = () => <span className="ml-0.5 text-red-500">*</span>;

  const YesNo = ({
    value, onChange, ariaInvalid,
  }: { value: boolean | null; onChange: (v: boolean) => void; ariaInvalid?: boolean }) => (
    <div className={['flex gap-2', ariaInvalid ? 'rounded-lg ring-1 ring-red-400 p-1' : ''].join(' ')}>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={[
          'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
          value === true
            ? 'border-sorena-navy bg-sorena-navy text-white'
            : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
        ].join(' ')}
      >
        {t('visaCommonYes')}
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={[
          'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
          value === false
            ? 'border-sorena-navy bg-sorena-navy text-white'
            : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
        ].join(' ')}
      >
        {t('visaCommonNo')}
      </button>
    </div>
  );

  const ReadonlyField = ({ label, value }: { label: string; value: string }) => (
    <div>
      <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
        {label}
      </label>
      <div className="rounded-lg border border-sorena-navy/10 bg-gray-50 px-3 py-2.5 text-sm text-sorena-navy/80">
        {value || <span className="italic text-sorena-navy/40">{t('visaCommonNotProvided')}</span>}
      </div>
    </div>
  );

  const inputClass = (hasError: boolean) =>
    [
      'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');
  const narrowSelectClass = (hasError: boolean) =>
    [
      'w-44 rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

  // ── Per-entry render ──────────────────────────────────────────────

  const renderEntry = (entry: EducationEntryRow, idx: number) => {
    const s = supplementsByEntryId.get(entry.id);
    const buf = getBuffer(entry.id);
    const qualLevelLabel = QUAL_LEVEL_KEY[entry.qualificationLevel]
      ? t(QUAL_LEVEL_KEY[entry.qualificationLevel] as Parameters<typeof t>[0])
      : entry.qualificationLevel;
    const qualificationDisplay = `${qualLevelLabel}${entry.fieldOfStudy ? ` · ${entry.fieldOfStudy}` : ''}`;

    // Year range string.
    let yearRange: string;
    if (entry.endYear === null) {
      yearRange = t('visaEducationYearRangeOngoing');
    } else if (entry.startYear !== null && entry.startYear === entry.endYear) {
      yearRange = String(entry.startYear);
    } else if (entry.startYear !== null) {
      yearRange = `${entry.startYear} – ${entry.endYear}`;
    } else {
      yearRange = String(entry.endYear);
    }

    const completedLabel = entry.completed ? t('visaCommonYes') : t('visaCommonNo');

    // Documents attached to this admission entry.
    const entryDocuments = documents.filter(d => d.educationEntryId === entry.id);

    return (
      <div
        key={entry.id}
        className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4"
      >
        {/* Header: green-tick badge + "Edit in admission ↗" quiet link */}
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700"
                aria-label={t('visaEducationFromAdmissionBadge')}
                title={t('visaEducationFromAdmissionBadge')}
              >
                ✓
              </span>
              {t('visaEducationHistoryEntryHeading', { n: idx + 1 })}
            </span>
          </h4>
          <Link
            href="/student/admission"
            className="inline-flex items-center gap-1 text-xs text-sorena-navy/60 transition-colors hover:text-sorena-navy"
          >
            {t('visaEducationEditInAdmission')}
            <ExternalLink size={12} />
          </Link>
        </div>

        {/* Read-only summary from admission */}
        <ReadonlyField
          label={t('visaEducationHistoryQualificationLabel')}
          value={qualificationDisplay}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ReadonlyField
            label={t('visaEducationHistoryInstitutionLabel')}
            value={entry.institutionName}
          />
          <ReadonlyField
            label={t('visaEducationHistoryCountryLabel')}
            value={entry.country}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ReadonlyField
            label={t('visaEducationHistoryStartDateLabel')}
            value={yearRange}
          />
          <ReadonlyField
            label={t('visaEducationCompletedLabel')}
            value={completedLabel}
          />
        </div>

        {/* Per-entry attached documents (read-only download list) */}
        {entryDocuments.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEducationDocumentsHeading')}
            </p>
            <div className="flex flex-col gap-2">
              {entryDocuments.map(doc => {
                const docTypeKey = DOC_TYPE_KEY[doc.documentType];
                const docTypeLabel = docTypeKey
                  ? t(docTypeKey as Parameters<typeof t>[0])
                  : doc.documentType;
                return (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 rounded-lg border border-sorena-navy/10 bg-gray-50 px-3 py-2"
                  >
                    <Paperclip size={14} className="shrink-0 text-sorena-navy/50" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-sorena-navy">{docTypeLabel}</p>
                      <p className="truncate text-xs text-sorena-navy/60">
                        {doc.fileName}{' '}
                        <span className="text-sorena-navy/40">({fmtBytes(doc.fileSizeBytes)})</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadDocument(doc.id, doc.fileName)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-sorena-navy/20 bg-white px-2.5 py-1 text-xs font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5"
                    >
                      <Download size={12} />
                      {t('admissionUploadDownload')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Divider before editable visa-specific extras */}
        <div className="border-t border-sorena-navy/10" />

        {/* Editable: month selectors + read-only year box */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEducationHistoryStartDateLabel')}<Asterisk />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <select
                value={s?.startMonth ?? ''}
                onChange={(e) => handleStartMonth(entry.id, e.target.value)}
                className={narrowSelectClass(!!errors[`startMonth:${entry.id}`])}
              >
                <option value="" disabled>{t('visaCommonMonthPlaceholder')}</option>
                {MONTH_KEYS.map((k, i) => (
                  <option key={k} value={i + 1}>{t(k)}</option>
                ))}
              </select>
              <div className="w-28 rounded-lg border border-sorena-navy/10 bg-gray-50 px-3 py-2.5 text-center text-sm text-sorena-navy/80">
                {entry.startYear ?? '—'}
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEducationHistoryEndDateLabel')}<Asterisk />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <select
                value={s?.endMonth ?? ''}
                onChange={(e) => handleEndMonth(entry.id, e.target.value)}
                className={narrowSelectClass(!!errors[`endMonth:${entry.id}`])}
              >
                <option value="" disabled>{t('visaCommonMonthPlaceholder')}</option>
                {MONTH_KEYS.map((k, i) => (
                  <option key={k} value={i + 1}>{t(k)}</option>
                ))}
              </select>
              <div className="w-28 rounded-lg border border-sorena-navy/10 bg-gray-50 px-3 py-2.5 text-center text-sm text-sorena-navy/80">
                {entry.endYear ?? '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Editable: institution state + town */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEducationHistoryInstitutionStateLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={buf.state}
              onChange={(e) => setBuffer(entry.id, { state: e.target.value })}
              onBlur={() => handleStateBlur(entry.id)}
              className={inputClass(!!errors[`institutionState:${entry.id}`])}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaEducationHistoryInstitutionTownLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={buf.town}
              onChange={(e) => setBuffer(entry.id, { town: e.target.value })}
              onBlur={() => handleTownBlur(entry.id)}
              className={inputClass(!!errors[`institutionTown:${entry.id}`])}
            />
          </div>
        </div>

        {/* Editable: qualification awarded Y/N */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaEducationHistoryAwardedLabel')}<Asterisk />
          </p>
          <YesNo
            value={s?.qualificationAwarded ?? null}
            onChange={(v) => handleAwarded(entry.id, v)}
            ariaInvalid={!!errors[`qualificationAwarded:${entry.id}`]}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaEducationHistorySectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaEducationHistoryIntro')}</p>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaEducationHistorySavedBanner')}
        </div>
      )}

      {/* ── Subsection: Education details ─────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaEducationHistorySubsectionDetails')}</h3>
        <p className="mt-2 text-sm text-sorena-navy/70">{t('visaEducationHistoryEditOnAdmissionHelper')}</p>
      </div>

      {sortedEntries.length === 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t('visaEducationHistoryNoEntries')}
        </div>
      ) : (
        sortedEntries.map((entry, idx) => renderEntry(entry, idx))
      )}

      {/* Quiet helper: how to add / correct entries (admission-side) */}
      {sortedEntries.length > 0 && (
        <p className="text-xs text-sorena-navy/60">
          {t('visaEducationAddViaAdmissionNote')}{' '}
          <Link
            href="/student/admission"
            className="inline-flex items-center gap-1 text-sorena-navy underline-offset-2 hover:underline"
          >
            {t('visaEducationEditInAdmission')}
            <ExternalLink size={12} />
          </Link>
        </p>
      )}

      {/* Back + Save row */}
      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(5)}
          className="rounded-lg border border-sorena-navy/20 px-4 py-2 text-sm text-sorena-navy transition-colors hover:bg-sorena-navy/5"
        >
          {t('visaCommonBack')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || sortedEntries.length === 0}
          className="rounded-lg bg-sorena-navy px-6 py-2 text-base font-semibold text-white transition-colors hover:bg-sorena-navy/90 disabled:opacity-40"
        >
          {saving ? t('visaCommonSaving') : t('visaEducationHistorySaveButton')}
        </button>
      </div>
    </div>
  );
}
