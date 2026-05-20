'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useVisa } from '../VisaFormContext';
import { api } from '@/lib/api';

// PR-VISA12 — INZ 1200 Section "Immigration assistance".
// Single-instance section (no child table). The gate Y/N
// (completingOnBehalf) unlocks a capacity dropdown, which in turn
// unlocks a five-field adviser block when capacity ∈
// {LICENSED_IMMIGRATION_ADVISER, EXEMPT_PERSON}. The save endpoint
// clears every downstream field server-side when a higher-level
// toggle removes its need, so stale data can't linger after a
// Yes→No flip.

type Capacity =
  | 'LICENSED_IMMIGRATION_ADVISER' | 'EXEMPT_PERSON'
  | 'FAMILY_MEMBER' | 'FRIEND' | 'OTHER';

const CAPACITIES: Capacity[] = [
  'LICENSED_IMMIGRATION_ADVISER',
  'EXEMPT_PERSON',
  'FAMILY_MEMBER',
  'FRIEND',
  'OTHER',
];

const ADVISER_CAPACITIES = new Set<Capacity>([
  'LICENSED_IMMIGRATION_ADVISER',
  'EXEMPT_PERSON',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d\s]{1,16}$/;

interface ServerPayload {
  completingOnBehalf: boolean | null;
  capacity: Capacity | null;
  adviserNumber: string | null;
  adviserFullName: string | null;
  adviserEmail: string | null;
  adviserContactNumber: string | null;
  adviserIsPrimaryContact: boolean | null;
}

export function Step12ImmigrationAssistance() {
  const t = useTranslations();
  const { setActiveStep, savedAt, setSavedAt } = useVisa();

  const [gate, setGate] = useState<boolean | null>(null);
  const [capacity, setCapacity] = useState<Capacity | ''>('');
  const [adviserNumber, setAdviserNumber] = useState('');
  const [adviserFullName, setAdviserFullName] = useState('');
  const [adviserEmail, setAdviserEmail] = useState('');
  const [adviserContactNumber, setAdviserContactNumber] = useState('');
  const [adviserIsPrimaryContact, setAdviserIsPrimaryContact] =
    useState<boolean | null>(null);

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ServerPayload>('/students/me/visa/immigration-assistance')
      .then((data) => {
        if (cancelled) return;
        setGate(data.completingOnBehalf);
        setCapacity(data.capacity ?? '');
        setAdviserNumber(data.adviserNumber ?? '');
        setAdviserFullName(data.adviserFullName ?? '');
        setAdviserEmail(data.adviserEmail ?? '');
        setAdviserContactNumber(data.adviserContactNumber ?? '');
        setAdviserIsPrimaryContact(data.adviserIsPrimaryContact);
      })
      .catch(() => { /* leave defaults */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const showAdviser = gate === true &&
    capacity !== '' &&
    ADVISER_CAPACITIES.has(capacity);

  const clearError = (key: string) =>
    setErrors((p) => ({ ...p, [key]: false }));

  const validate = (): string | null => {
    const e: Record<string, boolean> = {};
    let firstError: string | null = null;
    const flag = (key: string, ok: boolean, msg: string) => {
      if (!ok) { e[key] = true; if (!firstError) firstError = msg; }
    };
    flag('gate', gate !== null, t('visaImmigrationErrorGateRequired'));

    if (gate === true) {
      flag('capacity', capacity !== '', t('visaImmigrationErrorCapacityRequired'));
      if (capacity !== '' && ADVISER_CAPACITIES.has(capacity)) {
        flag(
          'adviserNumber',
          adviserNumber.trim() !== '',
          t('visaImmigrationErrorRequired'),
        );
        flag(
          'adviserFullName',
          adviserFullName.trim() !== '',
          t('visaImmigrationErrorRequired'),
        );
        const emailTrim = adviserEmail.trim();
        if (emailTrim === '') {
          e.adviserEmail = true;
          if (!firstError) firstError = t('visaImmigrationErrorRequired');
        } else if (!EMAIL_RE.test(emailTrim)) {
          e.adviserEmail = true;
          if (!firstError) firstError = t('visaImmigrationErrorInvalidEmail');
        }
        const phoneTrim = adviserContactNumber.trim();
        if (phoneTrim === '') {
          e.adviserContactNumber = true;
          if (!firstError) firstError = t('visaImmigrationErrorRequired');
        } else if (!PHONE_RE.test(phoneTrim)) {
          e.adviserContactNumber = true;
          if (!firstError) firstError = t('visaImmigrationErrorInvalidPhone');
        }
        flag(
          'adviserIsPrimaryContact',
          adviserIsPrimaryContact !== null,
          t('visaImmigrationErrorRequired'),
        );
      }
    }
    setErrors(e);
    return firstError;
  };

  const handleSave = async () => {
    setBannerError(null);
    const err = validate();
    if (err) {
      setBannerError(err);
      toast.error(t('visaImmigrationValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        completingOnBehalf: gate,
      };
      if (gate === true) {
        payload.capacity = capacity;
        if (capacity !== '' && ADVISER_CAPACITIES.has(capacity)) {
          payload.adviserNumber           = adviserNumber.trim();
          payload.adviserFullName         = adviserFullName.trim();
          payload.adviserEmail            = adviserEmail.trim();
          payload.adviserContactNumber    = adviserContactNumber.trim();
          payload.adviserIsPrimaryContact = adviserIsPrimaryContact;
        }
      }
      await api.patch<ServerPayload>('/students/me/visa/immigration-assistance', payload);
      setSavedAt(new Date().toISOString());
      toast.success(t('visaImmigrationSaveSuccess'));
      // PR-VISA13: advance the stepper now that Section 13 exists.
      setActiveStep(13);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : t('visaImmigrationSaveError');
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

  if (!loaded) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-sorena-navy/50">
        {t('visaImmigrationLoading')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaImmigrationSectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaImmigrationIntro')}</p>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaImmigrationSavedBanner')}
        </div>
      )}
      {bannerError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {bannerError}
        </div>
      )}

      {/* Section 1 — Person completing form */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">
          {t('visaImmigrationSectionPersonCompleting')}
        </h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaImmigrationGateLabel')}<Asterisk />
        </p>
        <YesNo
          value={gate}
          onChange={(v) => {
            setGate(v);
            clearError('gate');
            if (v === false) {
              // Clear downstream local state — server clears too, but
              // we don't want the form to flash stale values before save.
              setCapacity('');
              setAdviserNumber('');
              setAdviserFullName('');
              setAdviserEmail('');
              setAdviserContactNumber('');
              setAdviserIsPrimaryContact(null);
            }
          }}
          ariaInvalid={!!errors.gate}
        />
      </div>

      {/* Capacity — only when gate = Yes */}
      {gate === true && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaImmigrationCapacityLabel')}<Asterisk />
          </p>
          <select
            value={capacity}
            onChange={(e) => {
              const v = e.target.value as Capacity | '';
              setCapacity(v);
              clearError('capacity');
              // Clear adviser fields when leaving the adviser set.
              if (v === '' || !ADVISER_CAPACITIES.has(v)) {
                setAdviserNumber('');
                setAdviserFullName('');
                setAdviserEmail('');
                setAdviserContactNumber('');
                setAdviserIsPrimaryContact(null);
              }
            }}
            className={inputClass(!!errors.capacity)}
          >
            <option value="">{t('visaCommonSelectPlaceholder')}</option>
            {CAPACITIES.map((c) => (
              <option key={c} value={c}>
                {t(`visaImmigrationCapacity_${c}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Section 2 — Adviser details */}
      {showAdviser && (
        <>
          <div className="mt-2 border-t border-sorena-navy/10 pt-6">
            <h3 className="text-xl font-bold text-sorena-navy">
              {t('visaImmigrationSectionAdviserDetails')}
            </h3>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaImmigrationAdviserNumberLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={adviserNumber}
              onChange={(e) => { setAdviserNumber(e.target.value); clearError('adviserNumber'); }}
              className={inputClass(!!errors.adviserNumber)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaImmigrationAdviserFullNameLabel')}<Asterisk />
            </label>
            <input
              type="text"
              value={adviserFullName}
              onChange={(e) => { setAdviserFullName(e.target.value); clearError('adviserFullName'); }}
              className={inputClass(!!errors.adviserFullName)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaImmigrationAdviserEmailLabel')}<Asterisk />
            </label>
            <input
              type="email"
              value={adviserEmail}
              onChange={(e) => { setAdviserEmail(e.target.value); clearError('adviserEmail'); }}
              className={inputClass(!!errors.adviserEmail)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaImmigrationAdviserContactNumberLabel')}<Asterisk />
            </label>
            <p className="mb-1.5 text-xs text-sorena-navy/50">
              {t('visaImmigrationAdviserContactNumberHelp')}
            </p>
            <input
              type="text"
              value={adviserContactNumber}
              onChange={(e) => { setAdviserContactNumber(e.target.value); clearError('adviserContactNumber'); }}
              className={inputClass(!!errors.adviserContactNumber)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaImmigrationAdviserIsPrimaryContactLabel')}<Asterisk />
            </p>
            <p className="text-xs text-sorena-navy/50">
              {t('visaImmigrationAdviserIsPrimaryContactHelp')}
            </p>
            <YesNo
              value={adviserIsPrimaryContact}
              onChange={(v) => { setAdviserIsPrimaryContact(v); clearError('adviserIsPrimaryContact'); }}
              ariaInvalid={!!errors.adviserIsPrimaryContact}
            />
          </div>
        </>
      )}

      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(11)}
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
          {saving ? t('visaCommonSaving') : t('visaImmigrationSaveButton')}
        </button>
      </div>
    </div>
  );
}
