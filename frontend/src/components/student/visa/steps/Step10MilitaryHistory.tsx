'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useVisa } from '../VisaFormContext';
import { api } from '@/lib/api';

// PR-VISA10 — INZ 1200 Section D "Military service".
// Three gating Y/Ns (D1/D2/D3) + a conditional D3 explanation
// (encrypted) + a conditional D4 repeating service-period block.
// Replace-on-save: the entire form posts to PATCH /students/me/visa/
// military-history; the backend wipes and re-inserts the entries
// table atomically.

const EXPLANATION_MIN = 20;

interface ServiceEntryForm {
  dateStarted: string;
  dateFinished: string;
  location: string;
  corps: string;
  division: string;
  brigade: string;
  battalion: string;
  unit: string;
  rank: string;
  duties: string;
  commandingOfficer: string;
}

const emptyEntry = (): ServiceEntryForm => ({
  dateStarted: '',
  dateFinished: '',
  location: '',
  corps: '',
  division: '',
  brigade: '',
  battalion: '',
  unit: '',
  rank: '',
  duties: '',
  commandingOfficer: '',
});

// Backend returns ISO datetimes; the date input wants YYYY-MM-DD.
function isoToDateInput(iso: string | null | undefined): string {
  return (iso ?? '').slice(0, 10);
}

interface ServerEntry {
  id: string;
  dateStarted: string | null;
  dateFinished: string | null;
  location: string | null;
  corps: string | null;
  division: string | null;
  brigade: string | null;
  battalion: string | null;
  unit: string | null;
  rank: string | null;
  duties: string | null;
  commandingOfficer: string | null;
  sortOrder: number;
}
interface ServerPayload {
  militaryServiceCompulsoryHome: boolean | null;
  everUndertakenMilitaryService: boolean | null;
  wasExemptFromMilitaryService: boolean | null;
  exemptExplanation: string | null;
  militaryServices: ServerEntry[];
}

export function Step10MilitaryHistory() {
  const t = useTranslations();
  const { setActiveStep, savedAt, setSavedAt } = useVisa();

  const [d1, setD1] = useState<boolean | null>(null);
  const [d2, setD2] = useState<boolean | null>(null);
  const [d3, setD3] = useState<boolean | null>(null);
  const [explanation, setExplanation] = useState<string>('');
  const [entries, setEntries] = useState<ServiceEntryForm[]>([]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Initial GET — the booleans + explanation + entries live behind
  // their own endpoint so we don't bloat /students/me/visa/application.
  useEffect(() => {
    let cancelled = false;
    api
      .get<ServerPayload>('/students/me/visa/military-history')
      .then((data) => {
        if (cancelled) return;
        setD1(data.militaryServiceCompulsoryHome);
        setD2(data.everUndertakenMilitaryService);
        setD3(data.wasExemptFromMilitaryService);
        setExplanation(data.exemptExplanation ?? '');
        setEntries(
          (data.militaryServices ?? []).map((e) => ({
            dateStarted:       isoToDateInput(e.dateStarted),
            dateFinished:      isoToDateInput(e.dateFinished),
            location:          e.location ?? '',
            corps:             e.corps ?? '',
            division:          e.division ?? '',
            brigade:           e.brigade ?? '',
            battalion:         e.battalion ?? '',
            unit:              e.unit ?? '',
            rank:              e.rank ?? '',
            duties:            e.duties ?? '',
            commandingOfficer: e.commandingOfficer ?? '',
          })),
        );
      })
      .catch(() => { /* leave defaults; the save path surfaces real errors */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const updateEntry = (
    idx: number,
    patch: Partial<ServiceEntryForm>,
  ) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
    // Clear matching field-level errors for this row.
    setErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(patch)) delete next[`entry.${idx}.${k}`];
      return next;
    });
  };

  const addEntry = () => setEntries((prev) => [...prev, emptyEntry()]);
  const removeEntry = (idx: number) =>
    setEntries((prev) => prev.filter((_, i) => i !== idx));

  const validate = (): string | null => {
    const e: Record<string, boolean> = {};
    let firstError: string | null = null;
    const flag = (key: string, ok: boolean, msg: string) => {
      if (!ok) { e[key] = true; if (!firstError) firstError = msg; }
    };
    flag('d1', d1 !== null, t('visaMilitaryErrorD1Required'));
    flag('d2', d2 !== null, t('visaMilitaryErrorD2Required'));
    flag('d3', d3 !== null, t('visaMilitaryErrorD3Required'));
    if (d3 === true) {
      flag(
        'explanation',
        explanation.trim().length >= EXPLANATION_MIN,
        t('visaMilitaryErrorExplanationMin', { min: EXPLANATION_MIN }),
      );
    }
    if (d2 === true) {
      if (entries.length === 0) {
        e.entriesEmpty = true;
        if (!firstError) firstError = t('visaMilitaryErrorEntriesRequired');
      }
      entries.forEach((entry, i) => {
        const checks: Array<[keyof ServiceEntryForm, string]> = [
          ['dateStarted',       t('visaMilitaryRowErrorDateStarted')],
          ['dateFinished',      t('visaMilitaryRowErrorDateFinished')],
          ['location',          t('visaMilitaryRowErrorLocation')],
          ['corps',             t('visaMilitaryRowErrorCorps')],
          ['division',          t('visaMilitaryRowErrorDivision')],
          ['brigade',           t('visaMilitaryRowErrorBrigade')],
          ['battalion',         t('visaMilitaryRowErrorBattalion')],
          ['unit',              t('visaMilitaryRowErrorUnit')],
          ['rank',              t('visaMilitaryRowErrorRank')],
          ['duties',            t('visaMilitaryRowErrorDuties')],
          ['commandingOfficer', t('visaMilitaryRowErrorCommander')],
        ];
        for (const [field, msg] of checks) {
          if (!String(entry[field] ?? '').trim()) {
            e[`entry.${i}.${field}`] = true;
            if (!firstError) firstError = `${msg} (${t('visaMilitaryServicePeriodHeading', { n: i + 1 })})`;
          }
        }
      });
    }
    setErrors(e);
    return firstError;
  };

  const handleSave = async () => {
    setBannerError(null);
    const err = validate();
    if (err) {
      setBannerError(err);
      toast.error(t('visaMilitaryValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        militaryServiceCompulsoryHome: d1,
        everUndertakenMilitaryService: d2,
        wasExemptFromMilitaryService:  d3,
      };
      if (d3 === true) payload.exemptExplanation = explanation.trim();
      if (d2 === true) {
        payload.militaryServices = entries.map((entry) => ({
          dateStarted:       new Date(entry.dateStarted).toISOString(),
          dateFinished:      new Date(entry.dateFinished).toISOString(),
          location:          entry.location.trim(),
          corps:             entry.corps.trim(),
          division:          entry.division.trim(),
          brigade:           entry.brigade.trim(),
          battalion:         entry.battalion.trim(),
          unit:              entry.unit.trim(),
          rank:              entry.rank.trim(),
          duties:            entry.duties.trim(),
          commandingOfficer: entry.commandingOfficer.trim(),
        }));
      }
      await api.patch<ServerPayload>('/students/me/visa/military-history', payload);
      setSavedAt(new Date().toISOString());
      toast.success(t('visaMilitarySaveSuccess'));
      // Step 11 doesn't exist yet — stay on Step 10 per spec.
    } catch (caught) {
      const msg =
        caught instanceof Error ? caught.message : t('visaMilitarySaveError');
      setBannerError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Building blocks ───────────────────────────────────────────────

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

  const inputClass = (hasError: boolean) =>
    [
      'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');
  const dateInputClass = (hasError: boolean) =>
    [
      'w-44 rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

  const TextField = ({
    idx, field, label,
  }: { idx: number; field: keyof ServiceEntryForm; label: string }) => (
    <div>
      <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
        {label}<Asterisk />
      </label>
      <input
        type="text"
        value={entries[idx][field]}
        onChange={(e) => updateEntry(idx, { [field]: e.target.value } as Partial<ServiceEntryForm>)}
        className={inputClass(!!errors[`entry.${idx}.${field}`])}
      />
    </div>
  );

  if (!loaded) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-sorena-navy/50">
        {t('visaMilitaryLoading')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaMilitarySectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaMilitaryIntro')}</p>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaMilitarySavedBanner')}
        </div>
      )}
      {bannerError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {bannerError}
        </div>
      )}

      {/* D1 */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaMilitarySubsectionCompulsory')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaMilitaryD1Label')}<Asterisk />
        </p>
        <YesNo value={d1} onChange={(v) => { setD1(v); setErrors((p) => ({ ...p, d1: false })); }} ariaInvalid={!!errors.d1} />
      </div>

      {/* D2 */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaMilitarySubsectionUndertaken')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaMilitaryD2Label')}<Asterisk />
        </p>
        <YesNo value={d2} onChange={(v) => { setD2(v); setErrors((p) => ({ ...p, d2: false })); }} ariaInvalid={!!errors.d2} />
      </div>

      {/* D3 */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaMilitarySubsectionExempt')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaMilitaryD3Label')}<Asterisk />
        </p>
        <YesNo value={d3} onChange={(v) => { setD3(v); setErrors((p) => ({ ...p, d3: false })); }} ariaInvalid={!!errors.d3} />
        {d3 === true && (
          <div className="mt-2">
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaMilitaryExplanationLabel')}<Asterisk />
            </label>
            <textarea
              rows={5}
              value={explanation}
              onChange={(e) => {
                setExplanation(e.target.value);
                setErrors((p) => ({ ...p, explanation: false }));
              }}
              className={inputClass(!!errors.explanation)}
              placeholder={t('visaMilitaryExplanationPlaceholder')}
            />
            <p className="mt-1 text-xs text-sorena-navy/50">
              {t('visaMilitaryExplanationCounter', {
                len: explanation.trim().length,
                min: EXPLANATION_MIN,
              })}
            </p>
          </div>
        )}
      </div>

      {/* D4 — only when D2 = Yes */}
      {d2 === true && (
        <>
          <div className="mt-2 border-t border-sorena-navy/10 pt-6">
            <h3 className="text-xl font-bold text-sorena-navy">{t('visaMilitarySubsectionDeclaration')}</h3>
            <p className="mt-2 text-sm text-sorena-navy/70">{t('visaMilitaryDeclarationHelper')}</p>
          </div>

          {errors.entriesEmpty && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {t('visaMilitaryErrorEntriesRequired')}
            </div>
          )}

          {entries.map((entry, i) => (
            <div
              key={i}
              className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
                  {t('visaMilitaryServicePeriodHeading', { n: i + 1 })}
                </h4>
                <button
                  type="button"
                  onClick={() => removeEntry(i)}
                  title={t('visaMilitaryRemoveTooltip')}
                  className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-6">
                <div>
                  <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                    {t('visaMilitaryDateStartedLabel')}<Asterisk />
                  </label>
                  <input
                    type="date"
                    value={entry.dateStarted}
                    onChange={(e) => updateEntry(i, { dateStarted: e.target.value })}
                    className={dateInputClass(!!errors[`entry.${i}.dateStarted`])}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                    {t('visaMilitaryDateFinishedLabel')}<Asterisk />
                  </label>
                  <input
                    type="date"
                    value={entry.dateFinished}
                    onChange={(e) => updateEntry(i, { dateFinished: e.target.value })}
                    className={dateInputClass(!!errors[`entry.${i}.dateFinished`])}
                  />
                </div>
              </div>

              <TextField idx={i} field="location"  label={t('visaMilitaryLocationLabel')} />
              <TextField idx={i} field="corps"     label={t('visaMilitaryCorpsLabel')} />
              <TextField idx={i} field="division"  label={t('visaMilitaryDivisionLabel')} />
              <TextField idx={i} field="brigade"   label={t('visaMilitaryBrigadeLabel')} />
              <TextField idx={i} field="battalion" label={t('visaMilitaryBattalionLabel')} />
              <TextField idx={i} field="unit"      label={t('visaMilitaryUnitLabel')} />
              <TextField idx={i} field="rank"      label={t('visaMilitaryRankLabel')} />

              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                  {t('visaMilitaryDutiesLabel')}<Asterisk />
                </label>
                <textarea
                  rows={4}
                  value={entry.duties}
                  onChange={(e) => updateEntry(i, { duties: e.target.value })}
                  className={inputClass(!!errors[`entry.${i}.duties`])}
                />
              </div>

              <TextField idx={i} field="commandingOfficer" label={t('visaMilitaryCommanderLabel')} />
            </div>
          ))}

          <button
            type="button"
            onClick={addEntry}
            className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5"
          >
            + {t('visaMilitaryAddPeriodButton')}
          </button>
        </>
      )}

      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(9)}
          className="rounded-lg border border-sorena-navy/20 px-4 py-2 text-sm text-sorena-navy transition-colors hover:bg-sorena-navy/5"
        >
          {t('visaCommonBack')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-sorena-navy px-6 py-2 text-base font-semibold text-white transition-colors hover:bg-sorena-navy/90 disabled:opacity-40"
        >
          {saving ? t('visaCommonSaving') : t('visaMilitarySaveButton')}
        </button>
      </div>
    </div>
  );
}
