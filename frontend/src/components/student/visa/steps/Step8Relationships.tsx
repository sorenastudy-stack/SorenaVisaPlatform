'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import {
  useVisa,
  type VisaPartnerRow,
  type VisaPartnerPatch,
  type FormerPartnerRow,
  type FormerPartnerPatch,
  type ChildRow,
  type ChildPatch,
  type ParentRow,
  type ParentPatch,
  type SiblingRow,
  type SiblingPatch,
  type NzContactRow,
  type NzContactPatch,
} from '../VisaFormContext';
import { COUNTRIES } from '@/lib/data/countries';
import { SearchableSelect } from '@/components/common/SearchableSelect';

// PR-VISA8 — INZ 1200 Section 8 "Relationships".
// READ-ONLY relays from admission:
//   * partnership status   ← admission.maritalStatus  (drives partner block)
//   * has children?         ← admission.hasChildren    (drives children block)
//
// Every other answer / row persists live to its own /students/me/visa/*
// endpoint as the student types. Step 8's "Save and continue" persists
// only the three remaining Y/N gates + bumps currentStep.

const RELATIONSHIP_STATUSES = [
  { value: 'SINGLE',    key: 'visaRelMaritalStatusSingle'    as const },
  { value: 'MARRIED',   key: 'visaRelMaritalStatusMarried'   as const },
  { value: 'DE_FACTO',  key: 'visaRelMaritalStatusDeFacto'   as const },
  { value: 'SEPARATED', key: 'visaRelMaritalStatusSeparated' as const },
  { value: 'DIVORCED',  key: 'visaRelMaritalStatusDivorced'  as const },
  { value: 'WIDOWED',   key: 'visaRelMaritalStatusWidowed'   as const },
];

const GENDER_OPTIONS = [
  { value: 'MALE',           key: 'visaIdentityGenderMale'      as const },
  { value: 'FEMALE',         key: 'visaIdentityGenderFemale'    as const },
  { value: 'GENDER_DIVERSE', key: 'visaIdentityGenderDiverse'   as const },
];

const PARTNER_REL_OPTIONS = [
  { value: 'WIFE',    key: 'visaRelPartnerRelWife'    as const },
  { value: 'HUSBAND', key: 'visaRelPartnerRelHusband' as const },
  { value: 'PARTNER', key: 'visaRelPartnerRelPartner' as const },
];

const CHILD_REL_OPTIONS = [
  { value: 'SON',           key: 'visaRelChildRelSon'           as const },
  { value: 'DAUGHTER',      key: 'visaRelChildRelDaughter'      as const },
  { value: 'STEPSON',       key: 'visaRelChildRelStepSon'       as const },
  { value: 'STEPDAUGHTER',  key: 'visaRelChildRelStepDaughter'  as const },
  { value: 'ADOPTED_SON',   key: 'visaRelChildRelAdoptedSon'    as const },
  { value: 'ADOPTED_DAUGHTER', key: 'visaRelChildRelAdoptedDaughter' as const },
];

const PARENT_REL_OPTIONS = [
  { value: 'FATHER',   key: 'visaRelParentRelFather'   as const },
  { value: 'MOTHER',   key: 'visaRelParentRelMother'   as const },
  { value: 'GUARDIAN', key: 'visaRelParentRelGuardian' as const },
];

const SIBLING_REL_OPTIONS = [
  { value: 'BROTHER', key: 'visaRelSiblingRelBrother' as const },
  { value: 'SISTER',  key: 'visaRelSiblingRelSister'  as const },
];

function isoToDateInput(iso: string | null): string {
  return (iso ?? '').slice(0, 10);
}
function dateInputToIso(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export function Step8Relationships() {
  const t = useTranslations();
  const {
    visa,
    readonly,
    patchVisa,
    setActiveStep,
    savedAt,
    setSavedAt,
    partner,
    upsertPartner,
    formerPartners,
    addFormerPartner,
    updateFormerPartner,
    deleteFormerPartner,
    children: childrenRows,
    addChild,
    updateChild,
    deleteChild,
    parents,
    addParent,
    updateParent,
    deleteParent,
    siblings,
    addSibling,
    updateSibling,
    deleteSibling,
    nzContacts,
    addNzContact,
    updateNzContact,
    deleteNzContact,
  } = useVisa();

  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  // Text buffers — same shape as Step 7. Keyed by `${rowId}.${field}`.
  const [textBuf, setTextBuf] = useState<Record<string, string>>({});
  const getBuf = (rowId: string, field: string, fallback: string) =>
    textBuf[`${rowId}.${field}`] ?? fallback;
  const setBuf = (rowId: string, field: string, value: string) =>
    setTextBuf((p) => ({ ...p, [`${rowId}.${field}`]: value }));

  // Three Y/Ns persist on Save; track locally.
  const [topYN, setTopYN] = useState({
    hasFormerPartners: visa.hasFormerPartners,
    hasSiblings:       visa.hasSiblings,
    hasNzContacts:     visa.hasNzContacts,
  });
  const updateTop = <K extends keyof typeof topYN>(k: K, v: boolean) => {
    setTopYN((prev) => ({ ...prev, [k]: v }));
    if (errors[k as string]) setErrors((p) => ({ ...p, [k as string]: false }));
  };

  const isPartnered =
    readonly.maritalStatus === 'MARRIED' || readonly.maritalStatus === 'DE_FACTO';
  const hasChildren = readonly.hasChildren === true;

  const clearErr = (k: string) => {
    if (errors[k]) setErrors((p) => ({ ...p, [k]: false }));
  };

  // ── Builders for partner / each child table — keep field-specific
  //    error-clear and live-PATCH wiring centralised.

  const patchPartner = async (patch: VisaPartnerPatch, errKey?: string) => {
    if (errKey) clearErr(errKey);
    try {
      await upsertPartner(patch);
    } catch {
      toast.error(t('visaRelPartnerUpdateError'));
    }
  };

  const patchFormerPartner = async (id: string, patch: FormerPartnerPatch, errKey?: string) => {
    if (errKey) clearErr(errKey);
    try { await updateFormerPartner(id, patch); } catch { toast.error(t('visaRelGenericUpdateError')); }
  };
  const patchChild = async (id: string, patch: ChildPatch, errKey?: string) => {
    if (errKey) clearErr(errKey);
    try { await updateChild(id, patch); } catch { toast.error(t('visaRelGenericUpdateError')); }
  };
  const patchParent = async (id: string, patch: ParentPatch, errKey?: string) => {
    if (errKey) clearErr(errKey);
    try { await updateParent(id, patch); } catch { toast.error(t('visaRelGenericUpdateError')); }
  };
  const patchSibling = async (id: string, patch: SiblingPatch, errKey?: string) => {
    if (errKey) clearErr(errKey);
    try { await updateSibling(id, patch); } catch { toast.error(t('visaRelGenericUpdateError')); }
  };
  const patchNzContact = async (id: string, patch: NzContactPatch, errKey?: string) => {
    if (errKey) clearErr(errKey);
    try { await updateNzContact(id, patch); } catch { toast.error(t('visaRelGenericUpdateError')); }
  };

  // ── Add / remove handlers with debounce + confirm + toast ─────────

  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const guard = async (k: string, fn: () => Promise<unknown>, errMsg: string) => {
    if (adding[k]) return;
    setAdding((p) => ({ ...p, [k]: true }));
    try { await fn(); } catch { toast.error(t(errMsg)); }
    finally { setAdding((p) => ({ ...p, [k]: false })); }
  };

  const removeWithConfirm = async (
    fn: () => Promise<unknown>,
    confirmKey: 'visaRelRemoveConfirm',
    errKey: 'visaRelGenericRemoveError',
  ) => {
    if (!window.confirm(t(confirmKey))) return;
    try { await fn(); } catch { toast.error(t(errKey)); }
  };

  // ── Save validator ────────────────────────────────────────────────

  const validatePartner = (row: VisaPartnerRow, e: Record<string, boolean>, missing: string[]) => {
    const flag = (k: string, ok: boolean) => {
      if (!ok) { e[k] = true; missing.push(k); }
    };
    flag('partner.relationshipToApplicant', !!row.relationshipToApplicant);
    flag('partner.givenName',  !!row.givenName?.trim());
    flag('partner.surname',    !!row.surname?.trim());
    flag('partner.gender',     !!row.gender);
    flag('partner.dateOfBirth',!!row.dateOfBirth);
    flag('partner.relationshipStatus', !!row.relationshipStatus);
    flag('partner.countryOfBirth', !!row.countryOfBirth?.trim());
    flag('partner.stateOfBirth', !!row.stateOfBirth?.trim());
    flag('partner.cityOfBirth', !!row.cityOfBirth?.trim());
    flag('partner.nationality', !!row.nationality?.trim());
    flag('partner.countryOfResidence', !!row.countryOfResidence?.trim());
    flag('partner.occupation', !!row.occupation?.trim());
    flag('partner.holdsPassport', typeof row.holdsPassport === 'boolean');
    if (row.holdsPassport === true) {
      flag('partner.passportNumber', !!row.passportNumber?.trim());
      flag('partner.passportCountryOfIssue', !!row.passportCountryOfIssue?.trim());
      flag('partner.passportIssueDate', !!row.passportIssueDate);
      flag('partner.passportExpiryDate', !!row.passportExpiryDate);
    }
  };
  const validateFormerPartner = (row: FormerPartnerRow, e: Record<string, boolean>, missing: string[]) => {
    const k = (f: string) => `formerPartner.${row.id}.${f}`;
    const flag = (key: string, ok: boolean) => { if (!ok) { e[key] = true; missing.push(key); } };
    flag(k('givenName'),   !!row.givenName?.trim());
    flag(k('surname'),     !!row.surname?.trim());
    flag(k('gender'),      !!row.gender);
    flag(k('dateOfBirth'), !!row.dateOfBirth);
    flag(k('relationshipStatus'), !!row.relationshipStatus);
    flag(k('countryOfBirth'), !!row.countryOfBirth?.trim());
    flag(k('nationality'), !!row.nationality?.trim());
  };
  const validateChild = (row: ChildRow, e: Record<string, boolean>, missing: string[]) => {
    const k = (f: string) => `child.${row.id}.${f}`;
    const flag = (key: string, ok: boolean) => { if (!ok) { e[key] = true; missing.push(key); } };
    flag(k('givenName'), !!row.givenName?.trim());
    flag(k('surname'), !!row.surname?.trim());
    flag(k('gender'), !!row.gender);
    flag(k('dateOfBirth'), !!row.dateOfBirth);
    flag(k('countryOfBirth'), !!row.countryOfBirth?.trim());
    flag(k('nationality'), !!row.nationality?.trim());
    flag(k('relationshipToApplicant'), !!row.relationshipToApplicant);
    flag(k('livesWithApplicant'), typeof row.livesWithApplicant === 'boolean');
  };
  const validateParent = (row: ParentRow, e: Record<string, boolean>, missing: string[]) => {
    const k = (f: string) => `parent.${row.id}.${f}`;
    const flag = (key: string, ok: boolean) => { if (!ok) { e[key] = true; missing.push(key); } };
    flag(k('givenName'), !!row.givenName?.trim());
    flag(k('surname'), !!row.surname?.trim());
    flag(k('relationshipToApplicant'), !!row.relationshipToApplicant);
    flag(k('isDeceased'), typeof row.isDeceased === 'boolean');
    flag(k('gender'), !!row.gender);
    if (row.dateOfBirthUnknown !== true) flag(k('dateOfBirth'), !!row.dateOfBirth);
    flag(k('relationshipStatus'), !!row.relationshipStatus);
    flag(k('countryOfBirth'), !!row.countryOfBirth?.trim());
    flag(k('citizenship'), !!row.citizenship?.trim());
    flag(k('countryOfResidence'), !!row.countryOfResidence?.trim());
    flag(k('occupation'), !!row.occupation?.trim());
  };
  const validateSibling = (row: SiblingRow, e: Record<string, boolean>, missing: string[]) => {
    const k = (f: string) => `sibling.${row.id}.${f}`;
    const flag = (key: string, ok: boolean) => { if (!ok) { e[key] = true; missing.push(key); } };
    flag(k('givenName'), !!row.givenName?.trim());
    flag(k('surname'), !!row.surname?.trim());
    flag(k('relationshipToApplicant'), !!row.relationshipToApplicant);
    flag(k('gender'), !!row.gender);
    if (row.dateOfBirthUnknown !== true) flag(k('dateOfBirth'), !!row.dateOfBirth);
    flag(k('relationshipStatus'), !!row.relationshipStatus);
    flag(k('countryOfBirth'), !!row.countryOfBirth?.trim());
    flag(k('citizenship'), !!row.citizenship?.trim());
    flag(k('countryOfResidence'), !!row.countryOfResidence?.trim());
    flag(k('occupation'), !!row.occupation?.trim());
  };
  const validateNzContact = (row: NzContactRow, e: Record<string, boolean>, missing: string[]) => {
    const k = (f: string) => `nzContact.${row.id}.${f}`;
    const flag = (key: string, ok: boolean) => { if (!ok) { e[key] = true; missing.push(key); } };
    flag(k('givenName'), !!row.givenName?.trim());
    flag(k('surname'), !!row.surname?.trim());
    flag(k('relationshipToApplicant'), !!row.relationshipToApplicant);
    flag(k('phone'), !!row.phone?.trim());
    flag(k('email'), !!row.email?.trim());
    flag(k('street'), !!row.street?.trim());
    flag(k('townCity'), !!row.townCity?.trim());
  };

  const validate = (): string[] => {
    const e: Record<string, boolean> = {};
    const missing: string[] = [];

    if (!readonly.maritalStatus) {
      e.maritalStatusMissing = true; missing.push('maritalStatusMissing');
    }
    if (isPartnered) {
      if (!partner) { e.partnerMissing = true; missing.push('partnerMissing'); }
      else validatePartner(partner, e, missing);
    }
    if (topYN.hasFormerPartners === null) { e.hasFormerPartners = true; missing.push('hasFormerPartners'); }
    if (topYN.hasFormerPartners === true) {
      if (formerPartners.length === 0) { e.formerPartnersEmpty = true; missing.push('formerPartnersEmpty'); }
      else formerPartners.forEach((r) => validateFormerPartner(r, e, missing));
    }
    if (hasChildren) {
      if (childrenRows.length === 0) { e.childrenEmpty = true; missing.push('childrenEmpty'); }
      else childrenRows.forEach((r) => validateChild(r, e, missing));
    }
    if (parents.length === 0) {
      e.parentsEmpty = true; missing.push('parentsEmpty');
    } else {
      parents.forEach((r) => validateParent(r, e, missing));
    }
    if (topYN.hasSiblings === null) { e.hasSiblings = true; missing.push('hasSiblings'); }
    if (topYN.hasSiblings === true) {
      if (siblings.length === 0) { e.siblingsEmpty = true; missing.push('siblingsEmpty'); }
      else siblings.forEach((r) => validateSibling(r, e, missing));
    }
    if (topYN.hasNzContacts === null) { e.hasNzContacts = true; missing.push('hasNzContacts'); }
    if (topYN.hasNzContacts === true) {
      if (nzContacts.length === 0) { e.nzContactsEmpty = true; missing.push('nzContactsEmpty'); }
      else nzContacts.forEach((r) => validateNzContact(r, e, missing));
    }

    setErrors(e);
    return missing;
  };

  const handleSave = async () => {
    const missing = validate();
    if (missing.length > 0) {
      toast.error(t('visaRelValidationMissing'));
      return;
    }
    setSaving(true);
    try {
      await patchVisa({
        hasFormerPartners: topYN.hasFormerPartners,
        hasSiblings:       topYN.hasSiblings,
        hasNzContacts:     topYN.hasNzContacts,
        currentStep:       9,
      });
      setSavedAt(new Date().toISOString());
      toast.success(t('visaRelSaveSuccess'));
      // PR-VISA9: advance the stepper now that Section 9 exists.
      setActiveStep(9);
    } catch {
      toast.error(t('visaRelSaveError'));
    } finally {
      setSaving(false);
    }
  };

  // ── UI building blocks ────────────────────────────────────────────

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
  const dateInputClass = (hasError: boolean) =>
    [
      'w-44 rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
      hasError ? 'border-red-400 focus:border-red-500' : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    ].join(' ');

  // Reusable encrypted-name text input bound to a row's text buffer.
  const NameInput = ({
    rowId, field, label, value, asterisk, onCommit, errKey,
  }: {
    rowId: string; field: string; label: string; value: string;
    asterisk?: boolean;
    onCommit: (val: string) => void;
    errKey: string;
  }) => (
    <div>
      <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
        {label}{asterisk && <Asterisk />}
      </label>
      <input
        type="text"
        value={getBuf(rowId, field, value)}
        onChange={(e) => setBuf(rowId, field, e.target.value)}
        onBlur={(e) => onCommit(e.target.value.trim())}
        className={inputClass(!!errors[errKey])}
      />
    </div>
  );

  const SelectField = ({
    label, asterisk, value, onChange, options, errKey,
  }: {
    label: string; asterisk?: boolean;
    value: string; onChange: (v: string) => void;
    options: { value: string; key: Parameters<typeof t>[0] }[];
    errKey: string;
  }) => (
    <div>
      <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
        {label}{asterisk && <Asterisk />}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass(!!errors[errKey])}
      >
        <option value="" disabled>{t('visaCommonSelectPlaceholder')}</option>
        {options.map(({ value: v, key }) => (
          <option key={v} value={v}>{t(key)}</option>
        ))}
      </select>
    </div>
  );

  // ── Partner block render ──────────────────────────────────────────

  const renderPartnerBlock = () => {
    const row: VisaPartnerRow = partner ?? {
      id: 'pending', relationshipToApplicant: null,
      givenName: null, middleNames: null, surname: null,
      gender: null, dateOfBirth: null, relationshipStatus: null,
      countryOfBirth: null, stateOfBirth: null, cityOfBirth: null,
      nationality: null, countryOfResidence: null, occupation: null,
      holdsPassport: null, passportNumber: null,
      passportCountryOfIssue: null, passportIssueDate: null,
      passportExpiryDate: null,
    };
    const k = (f: string) => `partner.${f}`;
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4">
        <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
          {t('visaRelPartnerHeading')}
        </h4>
        <p className="text-sm text-sorena-navy/70">{t('visaRelPartnerIntro')}</p>

        <SelectField
          label={t('visaRelPartnerRelLabel')} asterisk
          value={row.relationshipToApplicant ?? ''}
          onChange={(v) => patchPartner({ relationshipToApplicant: v }, k('relationshipToApplicant'))}
          options={PARTNER_REL_OPTIONS}
          errKey={k('relationshipToApplicant')}
        />

        <NameInput
          rowId="partner" field="givenName" asterisk
          label={t('visaRelGivenNameLabel')} value={row.givenName ?? ''}
          onCommit={(v) => patchPartner({ givenName: v || null }, k('givenName'))}
          errKey={k('givenName')}
        />
        <NameInput
          rowId="partner" field="middleNames"
          label={t('visaRelMiddleNamesLabel')} value={row.middleNames ?? ''}
          onCommit={(v) => patchPartner({ middleNames: v || null })}
          errKey="never"
        />
        <NameInput
          rowId="partner" field="surname" asterisk
          label={t('visaRelSurnameLabel')} value={row.surname ?? ''}
          onCommit={(v) => patchPartner({ surname: v || null }, k('surname'))}
          errKey={k('surname')}
        />

        <SelectField
          label={t('visaRelGenderLabel')} asterisk
          value={row.gender ?? ''} onChange={(v) => patchPartner({ gender: v }, k('gender'))}
          options={GENDER_OPTIONS} errKey={k('gender')}
        />

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelDateOfBirthLabel')}<Asterisk />
          </label>
          <input
            type="date"
            value={isoToDateInput(row.dateOfBirth)}
            onChange={(e) => patchPartner({ dateOfBirth: dateInputToIso(e.target.value) }, k('dateOfBirth'))}
            className={dateInputClass(!!errors[k('dateOfBirth')])}
          />
        </div>

        <SelectField
          label={t('visaRelRelationshipStatusLabel')} asterisk
          value={row.relationshipStatus ?? ''}
          onChange={(v) => patchPartner({ relationshipStatus: v }, k('relationshipStatus'))}
          options={RELATIONSHIP_STATUSES} errKey={k('relationshipStatus')}
        />

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelCountryOfBirthLabel')}<Asterisk />
          </label>
          <SearchableSelect
            options={COUNTRIES}
            value={row.countryOfBirth ?? ''}
            onChange={(v) => patchPartner({ countryOfBirth: v }, k('countryOfBirth'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('countryOfBirth')]}
          />
        </div>
        <NameInput
          rowId="partner" field="stateOfBirth" asterisk
          label={t('visaRelStateOfBirthLabel')} value={row.stateOfBirth ?? ''}
          onCommit={(v) => patchPartner({ stateOfBirth: v || null }, k('stateOfBirth'))}
          errKey={k('stateOfBirth')}
        />
        <NameInput
          rowId="partner" field="cityOfBirth" asterisk
          label={t('visaRelCityOfBirthLabel')} value={row.cityOfBirth ?? ''}
          onCommit={(v) => patchPartner({ cityOfBirth: v || null }, k('cityOfBirth'))}
          errKey={k('cityOfBirth')}
        />

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelNationalityLabel')}<Asterisk />
          </label>
          <SearchableSelect
            options={COUNTRIES}
            value={row.nationality ?? ''}
            onChange={(v) => patchPartner({ nationality: v }, k('nationality'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('nationality')]}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelCountryOfResidenceLabel')}<Asterisk />
          </label>
          <SearchableSelect
            options={COUNTRIES}
            value={row.countryOfResidence ?? ''}
            onChange={(v) => patchPartner({ countryOfResidence: v }, k('countryOfResidence'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('countryOfResidence')]}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelOccupationLabel')}<Asterisk />
          </label>
          <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaRelOccupationHelper')}</p>
          <input
            type="text"
            value={getBuf('partner', 'occupation', row.occupation ?? '')}
            onChange={(e) => setBuf('partner', 'occupation', e.target.value)}
            onBlur={(e) => patchPartner({ occupation: e.target.value.trim() || null }, k('occupation'))}
            className={inputClass(!!errors[k('occupation')])}
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelPartnerHoldsPassportLabel')}<Asterisk />
          </p>
          <YesNo
            value={row.holdsPassport}
            onChange={(v) => patchPartner({ holdsPassport: v }, k('holdsPassport'))}
            ariaInvalid={!!errors[k('holdsPassport')]}
          />
        </div>
        {row.holdsPassport === true && (
          <>
            <NameInput
              rowId="partner" field="passportNumber" asterisk
              label={t('visaRelPartnerPassportNumberLabel')} value={row.passportNumber ?? ''}
              onCommit={(v) => patchPartner({ passportNumber: v || null }, k('passportNumber'))}
              errKey={k('passportNumber')}
            />
            <div>
              <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                {t('visaRelPartnerPassportCountryLabel')}<Asterisk />
              </label>
              <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaRelPartnerPassportCountryHelper')}</p>
              <SearchableSelect
                options={COUNTRIES}
                value={row.passportCountryOfIssue ?? ''}
                onChange={(v) => patchPartner({ passportCountryOfIssue: v }, k('passportCountryOfIssue'))}
                placeholder={t('visaCommonCountryPlaceholder')}
                hasError={!!errors[k('passportCountryOfIssue')]}
              />
            </div>
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                  {t('visaRelPartnerPassportIssueDateLabel')}<Asterisk />
                </label>
                <input
                  type="date"
                  value={isoToDateInput(row.passportIssueDate)}
                  onChange={(e) => patchPartner({ passportIssueDate: dateInputToIso(e.target.value) }, k('passportIssueDate'))}
                  className={dateInputClass(!!errors[k('passportIssueDate')])}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
                  {t('visaRelPartnerPassportExpiryDateLabel')}<Asterisk />
                </label>
                <input
                  type="date"
                  value={isoToDateInput(row.passportExpiryDate)}
                  onChange={(e) => patchPartner({ passportExpiryDate: dateInputToIso(e.target.value) }, k('passportExpiryDate'))}
                  className={dateInputClass(!!errors[k('passportExpiryDate')])}
                />
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  // ── Former-partner row ────────────────────────────────────────────

  const renderFormerPartnerBlock = (row: FormerPartnerRow, idx: number) => {
    const k = (f: string) => `formerPartner.${row.id}.${f}`;
    return (
      <div
        key={row.id}
        className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
            {t('visaRelFormerPartnerHeading', { n: idx + 1 })}
          </h4>
          <button
            type="button"
            onClick={() => removeWithConfirm(() => deleteFormerPartner(row.id), 'visaRelRemoveConfirm', 'visaRelGenericRemoveError')}
            title={t('visaRelRemoveTooltip')}
            className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 size={16} />
          </button>
        </div>
        <NameInput rowId={row.id} field="givenName" asterisk
          label={t('visaRelGivenNameLabel')} value={row.givenName ?? ''}
          onCommit={(v) => patchFormerPartner(row.id, { givenName: v || null }, k('givenName'))}
          errKey={k('givenName')}
        />
        <NameInput rowId={row.id} field="middleNames"
          label={t('visaRelMiddleNamesLabel')} value={row.middleNames ?? ''}
          onCommit={(v) => patchFormerPartner(row.id, { middleNames: v || null })}
          errKey="never"
        />
        <NameInput rowId={row.id} field="surname" asterisk
          label={t('visaRelSurnameLabel')} value={row.surname ?? ''}
          onCommit={(v) => patchFormerPartner(row.id, { surname: v || null }, k('surname'))}
          errKey={k('surname')}
        />
        <SelectField label={t('visaRelGenderLabel')} asterisk
          value={row.gender ?? ''} onChange={(v) => patchFormerPartner(row.id, { gender: v }, k('gender'))}
          options={GENDER_OPTIONS} errKey={k('gender')} />
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelDateOfBirthLabel')}<Asterisk />
          </label>
          <input type="date"
            value={isoToDateInput(row.dateOfBirth)}
            onChange={(e) => patchFormerPartner(row.id, { dateOfBirth: dateInputToIso(e.target.value) }, k('dateOfBirth'))}
            className={dateInputClass(!!errors[k('dateOfBirth')])}
          />
        </div>
        <SelectField label={t('visaRelRelationshipStatusLabel')} asterisk
          value={row.relationshipStatus ?? ''}
          onChange={(v) => patchFormerPartner(row.id, { relationshipStatus: v }, k('relationshipStatus'))}
          options={RELATIONSHIP_STATUSES} errKey={k('relationshipStatus')} />
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelCountryOfBirthLabel')}<Asterisk />
          </label>
          <SearchableSelect options={COUNTRIES}
            value={row.countryOfBirth ?? ''}
            onChange={(v) => patchFormerPartner(row.id, { countryOfBirth: v }, k('countryOfBirth'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('countryOfBirth')]} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelNationalityLabel')}<Asterisk />
          </label>
          <SearchableSelect options={COUNTRIES}
            value={row.nationality ?? ''}
            onChange={(v) => patchFormerPartner(row.id, { nationality: v }, k('nationality'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('nationality')]} />
        </div>
      </div>
    );
  };

  const renderChildBlock = (row: ChildRow, idx: number) => {
    const k = (f: string) => `child.${row.id}.${f}`;
    return (
      <div
        key={row.id}
        className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
            {t('visaRelChildHeading', { n: idx + 1 })}
          </h4>
          <button type="button"
            onClick={() => removeWithConfirm(() => deleteChild(row.id), 'visaRelRemoveConfirm', 'visaRelGenericRemoveError')}
            title={t('visaRelRemoveTooltip')}
            className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500">
            <Trash2 size={16} />
          </button>
        </div>
        <NameInput rowId={row.id} field="givenName" asterisk
          label={t('visaRelGivenNameLabel')} value={row.givenName ?? ''}
          onCommit={(v) => patchChild(row.id, { givenName: v || null }, k('givenName'))}
          errKey={k('givenName')} />
        <NameInput rowId={row.id} field="middleNames"
          label={t('visaRelMiddleNamesLabel')} value={row.middleNames ?? ''}
          onCommit={(v) => patchChild(row.id, { middleNames: v || null })}
          errKey="never" />
        <NameInput rowId={row.id} field="surname" asterisk
          label={t('visaRelSurnameLabel')} value={row.surname ?? ''}
          onCommit={(v) => patchChild(row.id, { surname: v || null }, k('surname'))}
          errKey={k('surname')} />
        <SelectField label={t('visaRelGenderLabel')} asterisk
          value={row.gender ?? ''} onChange={(v) => patchChild(row.id, { gender: v }, k('gender'))}
          options={GENDER_OPTIONS} errKey={k('gender')} />
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelDateOfBirthLabel')}<Asterisk />
          </label>
          <input type="date" value={isoToDateInput(row.dateOfBirth)}
            onChange={(e) => patchChild(row.id, { dateOfBirth: dateInputToIso(e.target.value) }, k('dateOfBirth'))}
            className={dateInputClass(!!errors[k('dateOfBirth')])} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelCountryOfBirthLabel')}<Asterisk />
          </label>
          <SearchableSelect options={COUNTRIES} value={row.countryOfBirth ?? ''}
            onChange={(v) => patchChild(row.id, { countryOfBirth: v }, k('countryOfBirth'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('countryOfBirth')]} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelNationalityLabel')}<Asterisk />
          </label>
          <SearchableSelect options={COUNTRIES} value={row.nationality ?? ''}
            onChange={(v) => patchChild(row.id, { nationality: v }, k('nationality'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('nationality')]} />
        </div>
        <SelectField label={t('visaRelChildRelLabel')} asterisk
          value={row.relationshipToApplicant ?? ''}
          onChange={(v) => patchChild(row.id, { relationshipToApplicant: v }, k('relationshipToApplicant'))}
          options={CHILD_REL_OPTIONS} errKey={k('relationshipToApplicant')} />
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelChildLivesWithLabel')}<Asterisk />
          </p>
          <YesNo value={row.livesWithApplicant}
            onChange={(v) => patchChild(row.id, { livesWithApplicant: v }, k('livesWithApplicant'))}
            ariaInvalid={!!errors[k('livesWithApplicant')]} />
        </div>
      </div>
    );
  };

  const renderParentOrSiblingFields = (
    row: ParentRow | SiblingRow,
    kind: 'parent' | 'sibling',
    relOptions: { value: string; key: Parameters<typeof t>[0] }[],
    relLabel: string,
  ) => {
    const k = (f: string) => `${kind}.${row.id}.${f}`;
    const update = kind === 'parent'
      ? (patch: ParentPatch, errKey?: string) => patchParent(row.id, patch, errKey)
      : (patch: SiblingPatch, errKey?: string) => patchSibling(row.id, patch, errKey);
    const isParent = kind === 'parent';
    return (
      <>
        <NameInput rowId={row.id} field="givenName" asterisk
          label={t('visaRelGivenNameLabel')} value={row.givenName ?? ''}
          onCommit={(v) => update({ givenName: v || null }, k('givenName'))}
          errKey={k('givenName')} />
        <NameInput rowId={row.id} field="middleNames"
          label={t('visaRelMiddleNamesLabel')} value={row.middleNames ?? ''}
          onCommit={(v) => update({ middleNames: v || null })}
          errKey="never" />
        <NameInput rowId={row.id} field="surname" asterisk
          label={t('visaRelSurnameLabel')} value={row.surname ?? ''}
          onCommit={(v) => update({ surname: v || null }, k('surname'))}
          errKey={k('surname')} />
        <SelectField label={relLabel} asterisk
          value={row.relationshipToApplicant ?? ''}
          onChange={(v) => update({ relationshipToApplicant: v }, k('relationshipToApplicant'))}
          options={relOptions} errKey={k('relationshipToApplicant')} />
        {isParent && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('visaRelParentIsDeceasedLabel')}<Asterisk />
            </p>
            <YesNo value={(row as ParentRow).isDeceased}
              onChange={(v) => update({ isDeceased: v } as ParentPatch, k('isDeceased'))}
              ariaInvalid={!!errors[k('isDeceased')]} />
          </div>
        )}
        <SelectField label={t('visaRelGenderLabel')} asterisk
          value={row.gender ?? ''}
          onChange={(v) => update({ gender: v }, k('gender'))}
          options={GENDER_OPTIONS} errKey={k('gender')} />
        <div className="flex flex-col gap-2">
          <label className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelDateOfBirthLabel')}<Asterisk />
          </label>
          <input type="date" value={isoToDateInput(row.dateOfBirth)}
            disabled={row.dateOfBirthUnknown === true}
            onChange={(e) => update({ dateOfBirth: dateInputToIso(e.target.value) }, k('dateOfBirth'))}
            className={dateInputClass(!!errors[k('dateOfBirth')])} />
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox"
              checked={row.dateOfBirthUnknown === true}
              onChange={(e) => update({ dateOfBirthUnknown: e.target.checked, dateOfBirth: e.target.checked ? null : row.dateOfBirth })}
              className="h-4 w-4 cursor-pointer rounded border-sorena-navy/20 accent-sorena-navy" />
            <span className="text-sm text-sorena-navy/80">{t('visaRelDateOfBirthUnknownLabel')}</span>
          </label>
        </div>
        <SelectField label={t('visaRelRelationshipStatusLabel')} asterisk
          value={row.relationshipStatus ?? ''}
          onChange={(v) => update({ relationshipStatus: v }, k('relationshipStatus'))}
          options={RELATIONSHIP_STATUSES} errKey={k('relationshipStatus')} />
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelCountryOfBirthLabel')}<Asterisk />
          </label>
          <SearchableSelect options={COUNTRIES} value={row.countryOfBirth ?? ''}
            onChange={(v) => update({ countryOfBirth: v }, k('countryOfBirth'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('countryOfBirth')]} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelCitizenshipLabel')}<Asterisk />
          </label>
          <SearchableSelect options={COUNTRIES} value={row.citizenship ?? ''}
            onChange={(v) => update({ citizenship: v }, k('citizenship'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('citizenship')]} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelCountryOfResidenceLabel')}<Asterisk />
          </label>
          <SearchableSelect options={COUNTRIES} value={row.countryOfResidence ?? ''}
            onChange={(v) => update({ countryOfResidence: v }, k('countryOfResidence'))}
            placeholder={t('visaCommonCountryPlaceholder')}
            hasError={!!errors[k('countryOfResidence')]} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
            {t('visaRelOccupationLabel')}<Asterisk />
          </label>
          <p className="mb-1.5 text-sm text-sorena-navy/60">{t('visaRelOccupationHelper')}</p>
          <input type="text"
            value={getBuf(row.id, 'occupation', row.occupation ?? '')}
            onChange={(e) => setBuf(row.id, 'occupation', e.target.value)}
            onBlur={(e) => update({ occupation: e.target.value.trim() || null }, k('occupation'))}
            className={inputClass(!!errors[k('occupation')])} />
        </div>
      </>
    );
  };

  const renderParentBlock = (row: ParentRow, idx: number) => (
    <div
      key={row.id}
      className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
          {t('visaRelParentHeading', { n: idx + 1 })}
        </h4>
        <button type="button"
          onClick={() => removeWithConfirm(() => deleteParent(row.id), 'visaRelRemoveConfirm', 'visaRelGenericRemoveError')}
          title={t('visaRelRemoveTooltip')}
          className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500">
          <Trash2 size={16} />
        </button>
      </div>
      {renderParentOrSiblingFields(row, 'parent', PARENT_REL_OPTIONS, t('visaRelParentRelLabel'))}
    </div>
  );
  const renderSiblingBlock = (row: SiblingRow, idx: number) => (
    <div
      key={row.id}
      className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
          {t('visaRelSiblingHeading', { n: idx + 1 })}
        </h4>
        <button type="button"
          onClick={() => removeWithConfirm(() => deleteSibling(row.id), 'visaRelRemoveConfirm', 'visaRelGenericRemoveError')}
          title={t('visaRelRemoveTooltip')}
          className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500">
          <Trash2 size={16} />
        </button>
      </div>
      {renderParentOrSiblingFields(row, 'sibling', SIBLING_REL_OPTIONS, t('visaRelSiblingRelLabel'))}
    </div>
  );

  const renderNzContactBlock = (row: NzContactRow, idx: number) => {
    const k = (f: string) => `nzContact.${row.id}.${f}`;
    return (
      <div
        key={row.id}
        className="flex flex-col gap-4 rounded-xl border border-sorena-navy/10 bg-white p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-bold uppercase tracking-wide text-sorena-navy/70">
            {t('visaRelNzContactHeading', { n: idx + 1 })}
          </h4>
          <button type="button"
            onClick={() => removeWithConfirm(() => deleteNzContact(row.id), 'visaRelRemoveConfirm', 'visaRelGenericRemoveError')}
            title={t('visaRelRemoveTooltip')}
            className="rounded p-1 text-sorena-navy/40 transition-colors hover:bg-red-50 hover:text-red-500">
            <Trash2 size={16} />
          </button>
        </div>
        <NameInput rowId={row.id} field="givenName" asterisk
          label={t('visaRelGivenNameLabel')} value={row.givenName ?? ''}
          onCommit={(v) => patchNzContact(row.id, { givenName: v || null }, k('givenName'))}
          errKey={k('givenName')} />
        <NameInput rowId={row.id} field="middleNames"
          label={t('visaRelMiddleNamesLabel')} value={row.middleNames ?? ''}
          onCommit={(v) => patchNzContact(row.id, { middleNames: v || null })}
          errKey="never" />
        <NameInput rowId={row.id} field="surname" asterisk
          label={t('visaRelSurnameLabel')} value={row.surname ?? ''}
          onCommit={(v) => patchNzContact(row.id, { surname: v || null }, k('surname'))}
          errKey={k('surname')} />
        <NameInput rowId={row.id} field="relationshipToApplicant" asterisk
          label={t('visaRelNzContactRelLabel')} value={row.relationshipToApplicant ?? ''}
          onCommit={(v) => patchNzContact(row.id, { relationshipToApplicant: v || null }, k('relationshipToApplicant'))}
          errKey={k('relationshipToApplicant')} />
        <NameInput rowId={row.id} field="phone" asterisk
          label={t('visaRelNzContactPhoneLabel')} value={row.phone ?? ''}
          onCommit={(v) => patchNzContact(row.id, { phone: v || null }, k('phone'))}
          errKey={k('phone')} />
        <NameInput rowId={row.id} field="email" asterisk
          label={t('visaRelNzContactEmailLabel')} value={row.email ?? ''}
          onCommit={(v) => patchNzContact(row.id, { email: v || null }, k('email'))}
          errKey={k('email')} />
        <NameInput rowId={row.id} field="street" asterisk
          label={t('visaRelNzContactStreetLabel')} value={row.street ?? ''}
          onCommit={(v) => patchNzContact(row.id, { street: v || null }, k('street'))}
          errKey={k('street')} />
        <NameInput rowId={row.id} field="suburb"
          label={t('visaRelNzContactSuburbLabel')} value={row.suburb ?? ''}
          onCommit={(v) => patchNzContact(row.id, { suburb: v || null })}
          errKey="never" />
        <NameInput rowId={row.id} field="townCity" asterisk
          label={t('visaRelNzContactTownCityLabel')} value={row.townCity ?? ''}
          onCommit={(v) => patchNzContact(row.id, { townCity: v || null }, k('townCity'))}
          errKey={k('townCity')} />
        <NameInput rowId={row.id} field="region"
          label={t('visaRelNzContactRegionLabel')} value={row.region ?? ''}
          onCommit={(v) => patchNzContact(row.id, { region: v || null })}
          errKey="never" />
        <NameInput rowId={row.id} field="postcode"
          label={t('visaRelNzContactPostcodeLabel')} value={row.postcode ?? ''}
          onCommit={(v) => patchNzContact(row.id, { postcode: v || null })}
          errKey="never" />
      </div>
    );
  };

  // Pretty-print the read-only admission status.
  const maritalStatusLabel =
    RELATIONSHIP_STATUSES.find((o) => o.value === readonly.maritalStatus)?.key;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-sorena-navy">{t('visaRelationshipsSectionTitle')}</h2>
      <p className="text-sm text-sorena-navy/70">{t('visaRelationshipsIntro')}</p>

      {savedAt && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('visaRelSavedBanner')}
        </div>
      )}

      {/* ── Relationship status ──────────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaRelSubsectionStatus')}</h3>
        <p className="mt-2 text-sm text-sorena-navy/70">{t('visaRelStatusHelper')}</p>
      </div>
      <ReadonlyField
        label={t('visaRelPartnershipStatusLabel')}
        value={maritalStatusLabel ? t(maritalStatusLabel) : ''}
      />
      <p className="-mt-2 text-sm text-sorena-navy/60">{t('visaRelEditOnAdmissionHelper')}</p>
      {errors.maritalStatusMissing && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {t('visaRelMaritalStatusMissingOnAdmission')}
        </div>
      )}

      {/* ── Current partner (gated by admission marital status) ─── */}
      {isPartnered && (
        <>
          <div className="mt-2 border-t border-sorena-navy/10 pt-6">
            <h3 className="text-xl font-bold text-sorena-navy">{t('visaRelSubsectionPartner')}</h3>
          </div>
          {!partner && (
            <button
              type="button"
              onClick={() => guard('partner', () => upsertPartner({}), 'visaRelPartnerUpdateError')}
              disabled={!!adding.partner}
              className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
            >
              + {t('visaRelPartnerCreateButton')}
            </button>
          )}
          {partner && renderPartnerBlock()}
        </>
      )}

      {/* ── Former partners ──────────────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaRelSubsectionFormer')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaRelHasFormerPartnersLabel')}<Asterisk />
        </p>
        <YesNo value={topYN.hasFormerPartners}
          onChange={(v) => updateTop('hasFormerPartners', v)}
          ariaInvalid={errors.hasFormerPartners} />
      </div>
      {topYN.hasFormerPartners === true && (
        <>
          {errors.formerPartnersEmpty && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {t('visaRelFormerPartnersAtLeastOne')}
            </div>
          )}
          {formerPartners.map((r, i) => renderFormerPartnerBlock(r, i))}
          <button type="button"
            onClick={() => guard('formerPartner', () => addFormerPartner(), 'visaRelGenericAddError')}
            disabled={!!adding.formerPartner}
            className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
          >
            + {t('visaRelAddFormerPartnerButton')}
          </button>
        </>
      )}

      {/* ── Children (gated by admission.hasChildren) ────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaRelSubsectionChildren')}</h3>
        <p className="mt-2 text-sm text-sorena-navy/70">{t('visaRelChildrenHelper')}</p>
      </div>
      <ReadonlyField
        label={t('visaRelHasChildrenLabel')}
        value={readonly.hasChildren === true
          ? t('visaCommonYes')
          : readonly.hasChildren === false
            ? t('visaCommonNo')
            : ''}
      />
      <p className="-mt-2 text-sm text-sorena-navy/60">{t('visaRelEditOnAdmissionHelper')}</p>
      {hasChildren && (
        <>
          {errors.childrenEmpty && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {t('visaRelChildrenAtLeastOne')}
            </div>
          )}
          {childrenRows.map((r, i) => renderChildBlock(r, i))}
          <button type="button"
            onClick={() => guard('child', () => addChild(), 'visaRelGenericAddError')}
            disabled={!!adding.child}
            className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
          >
            + {t('visaRelAddChildButton')}
          </button>
        </>
      )}

      {/* ── Parents and legal guardians (always present) ─────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaRelSubsectionParents')}</h3>
        <p className="mt-2 text-sm text-sorena-navy/70">{t('visaRelParentsHelper')}</p>
      </div>
      {errors.parentsEmpty && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {t('visaRelParentsAtLeastOne')}
        </div>
      )}
      {parents.map((r, i) => renderParentBlock(r, i))}
      <button type="button"
        onClick={() => guard('parent', () => addParent(), 'visaRelGenericAddError')}
        disabled={!!adding.parent}
        className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
      >
        + {t('visaRelAddParentButton')}
      </button>

      {/* ── Siblings ─────────────────────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaRelSubsectionSiblings')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaRelHasSiblingsLabel')}<Asterisk />
        </p>
        <p className="text-sm text-sorena-navy/60">{t('visaRelHasSiblingsHelper')}</p>
        <YesNo value={topYN.hasSiblings}
          onChange={(v) => updateTop('hasSiblings', v)}
          ariaInvalid={errors.hasSiblings} />
      </div>
      {topYN.hasSiblings === true && (
        <>
          {errors.siblingsEmpty && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {t('visaRelSiblingsAtLeastOne')}
            </div>
          )}
          {siblings.map((r, i) => renderSiblingBlock(r, i))}
          <button type="button"
            onClick={() => guard('sibling', () => addSibling(), 'visaRelGenericAddError')}
            disabled={!!adding.sibling}
            className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
          >
            + {t('visaRelAddSiblingButton')}
          </button>
        </>
      )}

      {/* ── NZ contacts ──────────────────────────────────────────── */}
      <div className="mt-2 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('visaRelSubsectionNzContacts')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('visaRelHasNzContactsLabel')}<Asterisk />
        </p>
        <YesNo value={topYN.hasNzContacts}
          onChange={(v) => updateTop('hasNzContacts', v)}
          ariaInvalid={errors.hasNzContacts} />
      </div>
      {topYN.hasNzContacts === true && (
        <>
          {errors.nzContactsEmpty && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {t('visaRelNzContactsAtLeastOne')}
            </div>
          )}
          {nzContacts.map((r, i) => renderNzContactBlock(r, i))}
          <button type="button"
            onClick={() => guard('nzContact', () => addNzContact(), 'visaRelGenericAddError')}
            disabled={!!adding.nzContact}
            className="self-start rounded-lg border border-dashed border-sorena-navy/30 px-4 py-2 text-sm font-medium text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-40"
          >
            + {t('visaRelAddNzContactButton')}
          </button>
        </>
      )}

      {/* Back + Save row */}
      <div className="flex items-center justify-between border-t border-sorena-navy/10 pt-4">
        <button
          type="button"
          onClick={() => setActiveStep(7)}
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
          {saving ? t('visaCommonSaving') : t('visaRelSaveButton')}
        </button>
      </div>
    </div>
  );
}
