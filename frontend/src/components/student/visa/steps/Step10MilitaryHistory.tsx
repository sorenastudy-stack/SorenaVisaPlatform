'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useVisa } from '../VisaFormContext';
import { api } from '@/lib/api';
import { DateInput } from '@/components/ui/DateInput';

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

// Module-scope current year — used as a bound on DateInput.
const CURRENT_YEAR = new Date().getFullYear();

// Hoisted out of the parent component to fix the one-character-per-
// focus bug: when defined inside the parent function body, the
// component identity changed on every render, causing React to
// unmount + remount the underlying <input> on each keystroke and
// drop focus. Stable module-level identity keeps the DOM node
// mounted across re-renders.
function inputClass(hasError: boolean): string {
  return [
    'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
    hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
  ].join(' ');
}

function TextField({
  value, onChange, label, ariaInvalid,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label: string;
  ariaInvalid: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
        {label}<span className="ml-0.5 text-red-500">*</span>
      </label>
      <input
        type="text"
        value={value}
        onChange={onChange}
        className={inputClass(ariaInvalid)}
      />
    </div>
  );
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
      // PR-VISA11: advance the stepper now that Section 11 exists.
      setActiveStep(11);
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

  // PR-FIX: `inputClass` and `TextField` were hoisted to module
  // scope above to fix a focus-loss bug. `dateInputClass` stays
  // here — used only inline below for the date inputs.
  const dateInputClass = (hasError: boolean) =>
    [
      'w-44 rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

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
                  <DateInput
                    value={entry.dateStarted || null}
                    onChange={(iso) => updateEntry(i, { dateStarted: iso ?? '' })}
                    minYear={1900}
                    maxYear={CURRENT_YEAR}
                    ariaInvalid={!!errors[`entry.${i}.dateStarted`]}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                    {t('visaMilitaryDateFinishedLabel')}<Asterisk />
                  </label>
                  <DateInput
                    value={entry.dateFinished || null}
                    onChange={(iso) => updateEntry(i, { dateFinished: iso ?? '' })}
                    minYear={1900}
                    maxYear={CURRENT_YEAR}
                    ariaInvalid={!!errors[`entry.${i}.dateFinished`]}
                  />
                </div>
              </div>

              <TextField
                value={entry.location}
                onChange={(e) => updateEntry(i, { location: e.target.value })}
                label={t('visaMilitaryLocationLabel')}
                ariaInvalid={!!errors[`entry.${i}.location`]}
              />
              <TextField
                value={entry.corps}
                onChange={(e) => updateEntry(i, { corps: e.target.value })}
                label={t('visaMilitaryCorpsLabel')}
                ariaInvalid={!!errors[`entry.${i}.corps`]}
              />
              <TextField
                value={entry.division}
                onChange={(e) => updateEntry(i, { division: e.target.value })}
                label={t('visaMilitaryDivisionLabel')}
                ariaInvalid={!!errors[`entry.${i}.division`]}
              />
              <TextField
                value={entry.brigade}
                onChange={(e) => updateEntry(i, { brigade: e.target.value })}
                label={t('visaMilitaryBrigadeLabel')}
                ariaInvalid={!!errors[`entry.${i}.brigade`]}
              />
              <TextField
                value={entry.battalion}
                onChange={(e) => updateEntry(i, { battalion: e.target.value })}
                label={t('visaMilitaryBattalionLabel')}
                ariaInvalid={!!errors[`entry.${i}.battalion`]}
              />
              <TextField
                value={entry.unit}
                onChange={(e) => updateEntry(i, { unit: e.target.value })}
                label={t('visaMilitaryUnitLabel')}
                ariaInvalid={!!errors[`entry.${i}.unit`]}
              />
              <TextField
                value={entry.rank}
                onChange={(e) => updateEntry(i, { rank: e.target.value })}
                label={t('visaMilitaryRankLabel')}
                ariaInvalid={!!errors[`entry.${i}.rank`]}
              />

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

              <TextField
                value={entry.commandingOfficer}
                onChange={(e) => updateEntry(i, { commandingOfficer: e.target.value })}
                label={t('visaMilitaryCommanderLabel')}
                ariaInvalid={!!errors[`entry.${i}.commandingOfficer`]}
              />
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
