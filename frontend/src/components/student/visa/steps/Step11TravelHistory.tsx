'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useVisa } from '../VisaFormContext';
import { api } from '@/lib/api';

// PR-VISA11 — INZ 1200 Section "Travel history".
// One gating Y/N (hasTravelledInternationally) followed by a
// repeating block of trip cards when the gate = Yes. Replace-on-save:
// the entire form posts to PATCH /students/me/visa/travel-history
// and the backend wipes + re-inserts the entries table atomically
// (same pattern as Step 10 Military history).

type ArrivalMode = 'AIR' | 'SEA' | 'LAND';
type Purpose =
  | 'EDUCATION' | 'TOURISM' | 'BUSINESS' | 'FAMILY'
  | 'MEDICAL'   | 'TRANSIT' | 'WORK'     | 'OTHER';

const ARRIVAL_MODES: ArrivalMode[] = ['AIR', 'SEA', 'LAND'];
const PURPOSES: Purpose[] = [
  'EDUCATION', 'TOURISM', 'BUSINESS', 'FAMILY',
  'MEDICAL',   'TRANSIT', 'WORK',     'OTHER',
];

interface TripForm {
  destination: string;
  dateEnteredMonth: string; // string for the <input>, parsed on save
  dateEnteredYear: string;
  dateExitedMonth: string;
  dateExitedYear: string;
  arrivalMode: ArrivalMode | '';
  pointOfEntry: string;
  purposeOfTravel: Purpose | '';
  otherPurpose: string;
}

const emptyEntry = (): TripForm => ({
  destination: '',
  dateEnteredMonth: '',
  dateEnteredYear: '',
  dateExitedMonth: '',
  dateExitedYear: '',
  arrivalMode: '',
  pointOfEntry: '',
  purposeOfTravel: '',
  otherPurpose: '',
});

interface ServerEntry {
  id: string;
  destination: string | null;
  dateEnteredMonth: number | null;
  dateEnteredYear: number | null;
  dateExitedMonth: number | null;
  dateExitedYear: number | null;
  arrivalMode: ArrivalMode | null;
  pointOfEntry: string | null;
  purposeOfTravel: Purpose | null;
  otherPurpose: string | null;
  sortOrder: number;
}
interface ServerPayload {
  hasTravelledInternationally: boolean | null;
  entries: ServerEntry[];
}

const numOrEmpty = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v);

export function Step11TravelHistory() {
  const t = useTranslations();
  const { setActiveStep, savedAt, setSavedAt } = useVisa();

  const [gate, setGate] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<TripForm[]>([]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Initial GET — gate + entries live behind their own endpoint so we
  // don't bloat /students/me/visa/application.
  useEffect(() => {
    let cancelled = false;
    api
      .get<ServerPayload>('/students/me/visa/travel-history')
      .then((data) => {
        if (cancelled) return;
        setGate(data.hasTravelledInternationally);
        setEntries(
          (data.entries ?? []).map((e) => ({
            destination:      e.destination ?? '',
            dateEnteredMonth: numOrEmpty(e.dateEnteredMonth),
            dateEnteredYear:  numOrEmpty(e.dateEnteredYear),
            dateExitedMonth:  numOrEmpty(e.dateExitedMonth),
            dateExitedYear:   numOrEmpty(e.dateExitedYear),
            arrivalMode:      e.arrivalMode ?? '',
            pointOfEntry:     e.pointOfEntry ?? '',
            purposeOfTravel:  e.purposeOfTravel ?? '',
            otherPurpose:     e.otherPurpose ?? '',
          })),
        );
      })
      .catch(() => { /* leave defaults; save path surfaces real errors */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const updateEntry = (idx: number, patch: Partial<TripForm>) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
    setErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(patch)) delete next[`entry.${idx}.${k}`];
      return next;
    });
  };

  const addEntry = () => setEntries((prev) => [...prev, emptyEntry()]);
  const removeEntry = (idx: number) =>
    setEntries((prev) => prev.filter((_, i) => i !== idx));

  const currentYear = new Date().getUTCFullYear();

  const validate = (): string | null => {
    const e: Record<string, boolean> = {};
    let firstError: string | null = null;
    const flag = (key: string, ok: boolean, msg: string) => {
      if (!ok) { e[key] = true; if (!firstError) firstError = msg; }
    };
    flag('gate', gate !== null, t('visaTravelErrorGateRequired'));

    if (gate === true) {
      if (entries.length === 0) {
        e.entriesEmpty = true;
        if (!firstError) firstError = t('visaTravelErrorEntriesRequired');
      }
      entries.forEach((entry, i) => {
        const here = (field: string, msg: string) =>
          `${msg} (${t('visaTravelEntryHeading', { n: i + 1 })})`;

        if (!entry.destination.trim()) {
          e[`entry.${i}.destination`] = true;
          if (!firstError) firstError = here('destination', t('visaTravelRowErrorDestination'));
        }
        const em = Number(entry.dateEnteredMonth);
        const ey = Number(entry.dateEnteredYear);
        if (!entry.dateEnteredMonth || !Number.isInteger(em) || em < 1 || em > 12) {
          e[`entry.${i}.dateEnteredMonth`] = true;
          if (!firstError) firstError = here('dateEnteredMonth', t('visaTravelRowErrorInvalidDate'));
        }
        if (!entry.dateEnteredYear || !Number.isInteger(ey) ||
            ey < 1900 || ey > currentYear) {
          e[`entry.${i}.dateEnteredYear`] = true;
          if (!firstError) firstError = here('dateEnteredYear', t('visaTravelRowErrorInvalidDate'));
        }
        // Optional exit pair: both or neither.
        const xmStr = entry.dateExitedMonth;
        const xyStr = entry.dateExitedYear;
        if ((xmStr === '') !== (xyStr === '')) {
          e[`entry.${i}.dateExitedMonth`] = true;
          e[`entry.${i}.dateExitedYear`]  = true;
          if (!firstError) firstError = here('dateExited', t('visaTravelRowErrorInvalidDate'));
        } else if (xmStr !== '' && xyStr !== '') {
          const xm = Number(xmStr);
          const xy = Number(xyStr);
          const xmOk = Number.isInteger(xm) && xm >= 1 && xm <= 12;
          const xyOk = Number.isInteger(xy) && xy >= 1900 && xy <= currentYear;
          if (!xmOk) {
            e[`entry.${i}.dateExitedMonth`] = true;
            if (!firstError) firstError = here('dateExitedMonth', t('visaTravelRowErrorInvalidDate'));
          }
          if (!xyOk) {
            e[`entry.${i}.dateExitedYear`] = true;
            if (!firstError) firstError = here('dateExitedYear', t('visaTravelRowErrorInvalidDate'));
          }
          // exit >= entered
          if (xmOk && xyOk && Number.isInteger(em) && Number.isInteger(ey)) {
            const enteredKey = ey * 12 + (em - 1);
            const exitedKey  = xy * 12 + (xm - 1);
            if (exitedKey < enteredKey) {
              e[`entry.${i}.dateExitedMonth`] = true;
              e[`entry.${i}.dateExitedYear`]  = true;
              if (!firstError) firstError = here('dateExited', t('visaTravelRowErrorExitBeforeEntered'));
            }
          }
        }
        if (!entry.arrivalMode) {
          e[`entry.${i}.arrivalMode`] = true;
          if (!firstError) firstError = here('arrivalMode', t('visaTravelRowErrorArrivalMode'));
        }
        if (!entry.pointOfEntry.trim()) {
          e[`entry.${i}.pointOfEntry`] = true;
          if (!firstError) firstError = here('pointOfEntry', t('visaTravelRowErrorPointOfEntry'));
        }
        if (!entry.purposeOfTravel) {
          e[`entry.${i}.purposeOfTravel`] = true;
          if (!firstError) firstError = here('purposeOfTravel', t('visaTravelRowErrorPurpose'));
        } else if (entry.purposeOfTravel === 'OTHER' && !entry.otherPurpose.trim()) {
          e[`entry.${i}.otherPurpose`] = true;
          if (!firstError) firstError = here('otherPurpose', t('visaTravelRowErrorOtherPurpose'));
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
      toast.error(t('visaTravelValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        hasTravelledInternationally: gate,
      };
      if (gate === true) {
        payload.entries = entries.map((entry) => ({
          destination:      entry.destination.trim(),
          dateEnteredMonth: Number(entry.dateEnteredMonth),
          dateEnteredYear:  Number(entry.dateEnteredYear),
          dateExitedMonth:  entry.dateExitedMonth === '' ? null : Number(entry.dateExitedMonth),
          dateExitedYear:   entry.dateExitedYear  === '' ? null : Number(entry.dateExitedYear),
          arrivalMode:      entry.arrivalMode,
          pointOfEntry:     entry.pointOfEntry.trim(),
          purposeOfTravel:  entry.purposeOfTravel,
          otherPurpose:     entry.purposeOfTravel === 'OTHER'
            ? entry.otherPurpose.trim()
            : null,
        }));
      }
      await api.patch<ServerPayload>('/students/me/visa/travel-history', payload);
      setSavedAt(new Date().toISOString());
      toast.success(t('visaTravelSaveSuccess'));
      // PR-VISA12: advance the stepper now that Section 12 exists.
      setActiveStep(12);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : t('visaTravelSaveError');
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
  const monthInputClass = (hasError: boolean) =>
    [
      'w-24 rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');
  const yearInputClass = (hasError: boolean) =>
    [
      'w-28 rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

  if (!loaded) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-sorena-navy/50">
        {t('visaTravelLoading')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaTravelSectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaTravelIntro')}</p>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaTravelSavedBanner')}
        </div>
      )}
      {bannerError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {bannerError}
        </div>
      )}

      {/* Gate */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaTravelGateLabel')}<Asterisk />
        </p>
        <p className="text-xs text-sorena-navy/50">{t('visaTravelGateHelp')}</p>
        <YesNo
          value={gate}
          onChange={(v) => {
            setGate(v);
            setErrors((p) => ({ ...p, gate: false }));
            if (v === true && entries.length === 0) {
              setEntries([emptyEntry()]);
            }
          }}
          ariaInvalid={!!errors.gate}
        />
      </div>

      {/* Entries — only when gate = Yes */}
      {gate === true && (
        <>
          <div className="mt-2 border-t border-sorena-navy/10 pt-6">
            <h3 className="text-xl font-bold text-sorena-navy">{t('visaTravelSectionHeader')}</h3>
          </div>

          {errors.entriesEmpty && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {t('visaTravelErrorEntriesRequired')}
            </div>
          )}

          {entries.map((entry, i) => (
            <div
              key={i}
              className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
                  {t('visaTravelEntryHeading', { n: i + 1 })}
                </h4>
                <button
                  type="button"
                  onClick={() => removeEntry(i)}
                  disabled={entries.length === 1}
                  title={t('visaTravelRemoveTooltip')}
                  className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-sorena-navy/40"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Destination */}
              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                  {t('visaTravelDestinationLabel')}<Asterisk />
                </label>
                <input
                  type="text"
                  value={entry.destination}
                  onChange={(e) => updateEntry(i, { destination: e.target.value })}
                  className={inputClass(!!errors[`entry.${i}.destination`])}
                />
              </div>

              {/* Date entered (mm / yyyy) */}
              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                  {t('visaTravelDateEnteredLabel')}<Asterisk />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={12}
                    placeholder={t('visaTravelMonthPlaceholder')}
                    value={entry.dateEnteredMonth}
                    onChange={(e) => updateEntry(i, { dateEnteredMonth: e.target.value })}
                    className={monthInputClass(!!errors[`entry.${i}.dateEnteredMonth`])}
                  />
                  <span className="text-sorena-navy/40">/</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1900}
                    max={currentYear}
                    placeholder={t('visaTravelYearPlaceholder')}
                    value={entry.dateEnteredYear}
                    onChange={(e) => updateEntry(i, { dateEnteredYear: e.target.value })}
                    className={yearInputClass(!!errors[`entry.${i}.dateEnteredYear`])}
                  />
                </div>
              </div>

              {/* Date exited (optional) */}
              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                  {t('visaTravelDateExitedLabel')}
                </label>
                <p className="mb-1.5 text-xs text-sorena-navy/50">
                  {t('visaTravelDateExitedHelp')}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={12}
                    placeholder={t('visaTravelMonthPlaceholder')}
                    value={entry.dateExitedMonth}
                    onChange={(e) => updateEntry(i, { dateExitedMonth: e.target.value })}
                    className={monthInputClass(!!errors[`entry.${i}.dateExitedMonth`])}
                  />
                  <span className="text-sorena-navy/40">/</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1900}
                    max={currentYear}
                    placeholder={t('visaTravelYearPlaceholder')}
                    value={entry.dateExitedYear}
                    onChange={(e) => updateEntry(i, { dateExitedYear: e.target.value })}
                    className={yearInputClass(!!errors[`entry.${i}.dateExitedYear`])}
                  />
                </div>
              </div>

              {/* Arrival mode */}
              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                  {t('visaTravelArrivalModeLabel')}<Asterisk />
                </label>
                <select
                  value={entry.arrivalMode}
                  onChange={(e) => updateEntry(i, { arrivalMode: e.target.value as ArrivalMode | '' })}
                  className={inputClass(!!errors[`entry.${i}.arrivalMode`])}
                >
                  <option value="">{t('visaCommonSelectPlaceholder')}</option>
                  {ARRIVAL_MODES.map((m) => (
                    <option key={m} value={m}>{t(`visaTravelArrivalMode_${m}` as Parameters<typeof t>[0])}</option>
                  ))}
                </select>
              </div>

              {/* Point of entry */}
              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                  {t('visaTravelPointOfEntryLabel')}<Asterisk />
                </label>
                <p className="mb-1.5 text-xs text-sorena-navy/50">
                  {t('visaTravelPointOfEntryHelp')}
                </p>
                <input
                  type="text"
                  value={entry.pointOfEntry}
                  onChange={(e) => updateEntry(i, { pointOfEntry: e.target.value })}
                  className={inputClass(!!errors[`entry.${i}.pointOfEntry`])}
                />
              </div>

              {/* Purpose of travel */}
              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                  {t('visaTravelPurposeLabel')}<Asterisk />
                </label>
                <select
                  value={entry.purposeOfTravel}
                  onChange={(e) => updateEntry(i, { purposeOfTravel: e.target.value as Purpose | '' })}
                  className={inputClass(!!errors[`entry.${i}.purposeOfTravel`])}
                >
                  <option value="">{t('visaCommonSelectPlaceholder')}</option>
                  {PURPOSES.map((p) => (
                    <option key={p} value={p}>{t(`visaTravelPurpose_${p}` as Parameters<typeof t>[0])}</option>
                  ))}
                </select>
              </div>

              {/* Other purpose — only when purpose = OTHER */}
              {entry.purposeOfTravel === 'OTHER' && (
                <div>
                  <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                    {t('visaTravelOtherPurposeLabel')}<Asterisk />
                  </label>
                  <input
                    type="text"
                    value={entry.otherPurpose}
                    onChange={(e) => updateEntry(i, { otherPurpose: e.target.value })}
                    className={inputClass(!!errors[`entry.${i}.otherPurpose`])}
                  />
                </div>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addEntry}
            className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5"
          >
            + {t('visaTravelAddTripButton')}
          </button>
        </>
      )}

      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(10)}
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
          {saving ? t('visaCommonSaving') : t('visaTravelSaveButton')}
        </button>
      </div>
    </div>
  );
}
