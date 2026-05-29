'use client';

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import { scrollPortalToTop } from '@/lib/scrollToTop';

// All fields are nullable in the DB — the student fills the form over time.
// The shape mirrors what the backend returns from GET/POST/PATCH
// /students/me/visa/application.
export interface VisaApplication {
  id: string;
  applicationId: string;
  // Section 1 — Identity (PR-VISA1)
  hasMononym: boolean | null;
  middleNames: string | null;
  hasUsedOtherNames: boolean | null;
  otherNames: string | null;
  countryWhenSubmitting: string | null;
  prevAppliedNzVisa: boolean | null;
  prevRequestedNzeta: boolean | null;
  everTravelledNz: boolean | null;
  totalNzTime24Plus: boolean | null;
  passportIssueDate: string | null;
  passportExpiryDate: string | null;
  passportCountryOfIssue: string | null;
  passportGender: string | null;
  stateOfBirth: string | null;
  cityOfBirth: string | null;
  hasNationalId: boolean | null;
  nationalId: string | null;
  nationalIdCountry: string | null;
  // Section 2 — Address and contact information (PR-VISA2)
  physicalStreet: string | null;
  physicalSuburb: string | null;
  physicalCity: string | null;
  physicalState: string | null;
  physicalPostcode: string | null;
  physicalCountry: string | null;
  postalSameAsPhysical: boolean | null;
  postalStreet: string | null;
  postalSuburb: string | null;
  postalCity: string | null;
  postalState: string | null;
  postalPostcode: string | null;
  postalCountry: string | null;
  preferredContactCountryCode: string | null;
  preferredContactNumber: string | null;
  alternativeContactCountryCode: string | null;
  alternativeContactNumber: string | null;

  // Section 3 — Eligibility (PR-VISA3)
  holdsNzStudentVisa: boolean | null;
  usedEducationAgent: boolean | null;
  agentOrganisationName: string | null;
  agentCountry: string | null;
  agentGivenName: string | null;
  agentSurname: string | null;
  agentEmail: string | null;
  studyingSchoolLevel: boolean | null;
  studyingMastersOrPhd: string | null;
  educationProviderName: string | null;
  studyLocation: string | null;
  courseRequiresOtherLocation: boolean | null;
  courseProgrammeName: string | null;
  courseStartDate: string | null;
  courseEndDate: string | null;
  intendedArrivalDate: string | null;
  phdDiscipline: string | null;
  phdSubject: string | null;
  phdSupervisorTitle: string | null;
  phdSupervisorGivenName: string | null;
  phdSupervisorSurname: string | null;
  phdSupervisorOrganisation: string | null;
  phdPublishedPapers: boolean | null;
  phdSupervisorOutsideNz: boolean | null;
  providerIssuedStudentId: boolean | null;
  studentIdNumber: string | null;
  homeCommitments: string | null;
  studyRelatesToPrevious: boolean | null;
  studyRelatesDetails: string | null;
  whyStudyNz: string | null;
  whyThisProvider: string | null;
  howCourseBenefits: string | null;
  plansAfterStudy: string | null;
  studyingMultiYear: boolean | null;

  // Section 4 — Character (PR-VISA4)
  everConvicted: boolean | null;
  underInvestigation: boolean | null;
  everDeportedExcluded: boolean | null;
  everRefusedVisa: boolean | null;
  policeCertIssueDate: string | null;
  policeCertCountryOfIssue: string | null;
  policeCertInEnglish: boolean | null;
  holdsOtherCitizenships: boolean | null;
  livedOtherCountry5Years: boolean | null;

  // Section 7 — Employment history (PR-VISA7)
  everGovernmentEmployed: boolean | null;
  everPrisonGuard: boolean | null;
  currentlyWorking: boolean | null;
  hadPreviousEmployment: boolean | null;
  everUnemployed: boolean | null;

  // Section 8 — Relationships (PR-VISA8). maritalStatus and hasChildren
  // are NOT on the visa row — they live on admission and arrive via the
  // readonly snapshot (see VisaReadonly).
  hasFormerPartners: boolean | null;
  hasSiblings: boolean | null;
  hasNzContacts: boolean | null;

  // Section 9 — Background details (PR-VISA9). Flat Y/N declarations.
  heldReligiousCulturalPosition: boolean | null;
  heldPoliticalAppointment: boolean | null;
  hadPoliticalAssociation: boolean | null;
  associatedIntelligenceAgency: boolean | null;
  witnessedIllTreatment: boolean | null;
  involvedArmedConflict: boolean | null;
  associatedViolentGroup: boolean | null;
  involvedWarCrimes: boolean | null;
  memberLiberationMilitia: boolean | null;
  everDetainedImprisoned: boolean | null;

  // Section 10 — Military service (PR-VISA10). Three gating Y/Ns; the
  // D3 explanation + D4 service-period array are fetched separately
  // via /students/me/visa/military-history because the explanation is
  // encrypted PII and the entries are a child-table replace-on-save.
  militaryServiceCompulsoryHome: boolean | null;
  everUndertakenMilitaryService: boolean | null;
  wasExemptFromMilitaryService: boolean | null;

  // Section 11 — Travel history (PR-VISA11). Single gate Y/N; the
  // entries array is fetched separately via /students/me/visa/
  // travel-history because destination + pointOfEntry + otherPurpose
  // are encrypted PII and the entries are a replace-on-save child table.
  hasTravelledInternationally: boolean | null;

  // Section 12 — Immigration assistance (PR-VISA12). Single-instance.
  // The four adviser-* fields hold the decrypted plaintext when
  // present; the actual fetch happens via /students/me/visa/
  // immigration-assistance so the encrypted blobs never reach the
  // browser. completingOnBehalf + capacity arrive on the same
  // payload and are mirrored here so the stepper can render gate
  // state without an extra round-trip.
  completingOnBehalf: boolean | null;

  // Section 13 — Supporting documents page 1 (PR-VISA13). Three
  // parent-row fields; the document metadata array is fetched
  // separately via /students/me/visa/supporting-documents. File
  // storage is deferred to a later PR — we capture only metadata
  // (originalFilename / mimeType / sizeBytes / uploadedAt) here.
  livingInDifferentCountry: boolean | null;
  areAllDocsInEnglish: boolean | null;

  // Section 14 — Supporting documents page 2 (PR-VISA14). 28 parent
  // flags driving a tree of conditional sections + a repeating
  // "Other evidence" child table. The encrypted free-text values
  // (depositExplanation / scholarshipName / scholarshipOrganisation)
  // are fetched separately via /students/me/visa/supporting-
  // documents-2 — only the booleans / enum land on this mirror so
  // the stepper can render conditional gates without an extra
  // round-trip. File storage is still deferred — metadata only.
  tuitionFeesPaid: boolean | null;
  tuitionPaymentMethod:
    | 'SELF_PAID' | 'PARTNER_PROVIDER_OR_GOVT_LOAN'
    | 'THIRD_PARTY_SPONSOR' | 'SCHOLARSHIP' | null;
  fundsSourceSavings: boolean | null;
  fundsSourceNZSponsor: boolean | null;
  fundsSourceInz1014: boolean | null;
  fundsSourcePrepaidAccom: boolean | null;
  fundsSourceScholarship: boolean | null;
  outwardSourceSufficientFunds: boolean | null;
  outwardSourceInz1014: boolean | null;
  outwardSourcePrepaidBooking: boolean | null;
  outwardSourceScholarship: boolean | null;
  fundsFormatBankAccount: boolean | null;
  fundsFormatProvidentFund: boolean | null;
  fundsFormatEducationLoan: boolean | null;
  fundsFormatFixedTermDeposit: boolean | null;
  fundsFormatOther: boolean | null;
  savingsSourceWages: boolean | null;
  savingsSourceSelfEmployment: boolean | null;
  savingsSourceRentalIncome: boolean | null;
  savingsSourceOther: boolean | null;
  studyIs120CreditsOrMore: boolean | null;
  courseRequiresPracticalWork: boolean | null;
  tookEnglishTest: boolean | null;
  declarationChecked: boolean | null;

  // Section 5 — Health (PR-VISA5)
  hasTuberculosis: boolean | null;
  needsRenalDialysis: boolean | null;
  hasMedicalCondition: boolean | null;
  needsResidentialCare: boolean | null;
  isPregnant: boolean | null;
  intendedLengthOfStay: string | null;
  hadMedicalExam: boolean | null;
  medicalRefNumber: string | null;
  tbCountriesNoMore: boolean | null;
  insuranceDeclarationAgreed: boolean | null;
  publicHealthAckAgreed: boolean | null;

  currentStep: number;
  createdAt: string;
  updatedAt: string;
}

// Repeating child rows for "Do you hold any other citizenships?" = Yes
// (PR-VISA4 fix). Persisted via /students/me/visa/citizenships endpoints,
// returned alongside the visa application on every read.
export interface OtherCitizenship {
  id: string;
  country: string;
  holdsPassport: boolean;
  sortOrder: number;
}

export interface OtherCitizenshipInput {
  country: string;
  holdsPassport: boolean;
}

// Repeating child rows for the Step 5 "TB-risk countries" block
// (PR-VISA5). Persisted via /students/me/visa/tb-countries endpoints.
export interface TbRiskCountry {
  id: string;
  country: string;
  totalDurationDays: number;
  sortOrder: number;
}

export interface TbRiskCountryInput {
  country: string;
  totalDurationDays: number;
}

// Step 6 (PR-VISA6) reads existing admission education entries
// read-only and pairs each with a visa-side supplement holding only the
// INZ-extra fields. Both arrays come back from GET /students/me/visa/
// application; the frontend joins them on educationEntry.id ===
// supplement.educationEntryId.
export interface EducationEntryRow {
  id: string;
  qualificationLevel: string;
  institutionName: string;
  country: string;
  fieldOfStudy: string | null;
  startYear: number | null;
  endYear: number | null;
  completed: boolean;
  sortOrder: number;
}

export interface EducationSupplement {
  id: string;
  educationEntryId: string;
  startMonth: number | null;
  endMonth: number | null;
  institutionState: string | null;
  institutionTown: string | null;
  qualificationAwarded: boolean | null;
}

export interface EducationSupplementPatch {
  startMonth?: number | null;
  endMonth?: number | null;
  institutionState?: string | null;
  institutionTown?: string | null;
  qualificationAwarded?: boolean | null;
}

// Step 7 (PR-VISA7) — jobs table. Same row shape for CURRENT and
// PREVIOUS entries; `entryKind` discriminates. `duties` is the plaintext
// value of the encrypted dutiesEncrypted column.
export interface EmploymentEntry {
  id: string;
  entryKind: 'CURRENT' | 'PREVIOUS' | string;
  startDate: string | null;
  endDate: string | null;
  roleTitle: string | null;
  duties: string | null;
  countryOfWork: string | null;
  stateOfWork: string | null;
  supervisorName: string | null;
  organisationField: string | null;
  organisationCountry: string | null;
  organisationState: string | null;
  employerName: string | null;
  employerStreet: string | null;
  employerSuburb: string | null;
  employerTownCity: string | null;
  employerSubregion: string | null;
  employerRegion: string | null;
  employerPostcode: string | null;
  employerPhone: string | null;
  employerEmail: string | null;
  sortOrder: number;
}

export interface EmploymentEntryPatch {
  startDate?: string | null;
  endDate?: string | null;
  roleTitle?: string | null;
  duties?: string | null;
  countryOfWork?: string | null;
  stateOfWork?: string | null;
  supervisorName?: string | null;
  organisationField?: string | null;
  organisationCountry?: string | null;
  organisationState?: string | null;
  employerName?: string | null;
  employerStreet?: string | null;
  employerSuburb?: string | null;
  employerTownCity?: string | null;
  employerSubregion?: string | null;
  employerRegion?: string | null;
  employerPostcode?: string | null;
  employerPhone?: string | null;
  employerEmail?: string | null;
}

export interface UnemploymentEntry {
  id: string;
  startDate: string | null;
  endDate: string | null;
  activity: string | null;
  financialSupport: string | null;
  sortOrder: number;
}

export interface UnemploymentEntryPatch {
  startDate?: string | null;
  endDate?: string | null;
  activity?: string | null;
  financialSupport?: string | null;
}

// Step 8 (PR-VISA8) types. All name fields and the partner's
// passportNumber / NZ-contact phone+street are decrypted plaintext on
// read; the backend encrypts on write.
export interface VisaPartnerRow {
  id: string;
  relationshipToApplicant: string | null;
  givenName: string | null;
  middleNames: string | null;
  surname: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  relationshipStatus: string | null;
  countryOfBirth: string | null;
  stateOfBirth: string | null;
  cityOfBirth: string | null;
  nationality: string | null;
  countryOfResidence: string | null;
  occupation: string | null;
  holdsPassport: boolean | null;
  passportNumber: string | null;
  passportCountryOfIssue: string | null;
  passportIssueDate: string | null;
  passportExpiryDate: string | null;
}
export type VisaPartnerPatch = Partial<Omit<VisaPartnerRow, 'id'>>;

export interface FormerPartnerRow {
  id: string;
  givenName: string | null;
  middleNames: string | null;
  surname: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  relationshipStatus: string | null;
  countryOfBirth: string | null;
  nationality: string | null;
  sortOrder: number;
}
export type FormerPartnerPatch = Partial<Omit<FormerPartnerRow, 'id' | 'sortOrder'>>;

export interface ChildRow {
  id: string;
  givenName: string | null;
  middleNames: string | null;
  surname: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  countryOfBirth: string | null;
  nationality: string | null;
  relationshipToApplicant: string | null;
  livesWithApplicant: boolean | null;
  sortOrder: number;
}
export type ChildPatch = Partial<Omit<ChildRow, 'id' | 'sortOrder'>>;

export interface ParentRow {
  id: string;
  givenName: string | null;
  middleNames: string | null;
  surname: string | null;
  relationshipToApplicant: string | null;
  isDeceased: boolean | null;
  gender: string | null;
  dateOfBirth: string | null;
  dateOfBirthUnknown: boolean | null;
  relationshipStatus: string | null;
  countryOfBirth: string | null;
  citizenship: string | null;
  countryOfResidence: string | null;
  occupation: string | null;
  sortOrder: number;
}
export type ParentPatch = Partial<Omit<ParentRow, 'id' | 'sortOrder'>>;

export interface SiblingRow {
  id: string;
  givenName: string | null;
  middleNames: string | null;
  surname: string | null;
  relationshipToApplicant: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  dateOfBirthUnknown: boolean | null;
  relationshipStatus: string | null;
  countryOfBirth: string | null;
  citizenship: string | null;
  countryOfResidence: string | null;
  occupation: string | null;
  sortOrder: number;
}
export type SiblingPatch = Partial<Omit<SiblingRow, 'id' | 'sortOrder'>>;

export interface NzContactRow {
  id: string;
  givenName: string | null;
  middleNames: string | null;
  surname: string | null;
  relationshipToApplicant: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  suburb: string | null;
  townCity: string | null;
  region: string | null;
  postcode: string | null;
  sortOrder: number;
}
export type NzContactPatch = Partial<Omit<NzContactRow, 'id' | 'sortOrder'>>;

// Read-only snapshot pulled from admission + contacts. The Visa Section
// never re-collects these — they are displayed inline and the student
// edits them on the admission/account profile if a correction is needed.
export interface VisaReadonly {
  fullName: string;
  email: string | null;
  countryOfResidence: string | null;
  passportNumber: string | null;
  citizenship: string | null;
  dateOfBirth: string | null;
  countryOfBirth: string | null;
  // PR-VISA3: from admission's first-priority programme choice. Used to
  // pre-fill Step 3's "education provider" + "course or programme name" as
  // read-only so the student doesn't enter the same data twice.
  programmeName: string | null;
  providerName: string | null;
  // PR-VISA8: admission's marital status drives the Step 8 partnership
  // dropdown read-only; hasChildren drives the Children block.
  maritalStatus: string | null;
  hasChildren: boolean | null;
}

interface ContextValue {
  visa: VisaApplication;
  readonly: VisaReadonly;
  patchVisa: (fields: Record<string, unknown>) => Promise<void>;
  // Active step in the UI. Initialised from visa.currentStep on mount, then
  // controlled by the stepper (Back/Save-and-continue). Persisted to the row
  // only when a save advances it — Back is local navigation.
  activeStep: number;
  setActiveStep: (n: number) => void;
  savedAt: string | null;
  setSavedAt: (iso: string) => void;
  // Other-citizenship rows (Step 4 branch). Live-API pattern same as
  // admission education entries: add/update/delete each hit their own
  // endpoint and update local state.
  otherCitizenships: OtherCitizenship[];
  addOtherCitizenship: (data: OtherCitizenshipInput) => Promise<OtherCitizenship>;
  updateOtherCitizenship: (
    id: string,
    data: Partial<OtherCitizenshipInput>,
  ) => Promise<OtherCitizenship>;
  deleteOtherCitizenship: (id: string) => Promise<void>;
  // Clears the in-memory rows. Used by Step 4's save handler after the
  // server reconciles holdsOtherCitizenships → false (server-side delete
  // already happened; this just syncs UI state).
  resetOtherCitizenships: () => void;

  // TB-risk countries (Step 5 block). Same live-API shape.
  tbRiskCountries: TbRiskCountry[];
  addTbRiskCountry: (data: TbRiskCountryInput) => Promise<TbRiskCountry>;
  updateTbRiskCountry: (
    id: string,
    data: Partial<TbRiskCountryInput>,
  ) => Promise<TbRiskCountry>;
  deleteTbRiskCountry: (id: string) => Promise<void>;

  // Step 6 — admission education entries (read-only here) + the visa
  // supplements that hold the INZ-extra columns (live-API upsert).
  educationEntries: EducationEntryRow[];
  educationSupplements: EducationSupplement[];
  upsertEducationSupplement: (
    educationEntryId: string,
    patch: EducationSupplementPatch,
  ) => Promise<EducationSupplement>;

  // Step 7 — employment + unemployment repeating tables.
  employmentEntries: EmploymentEntry[];
  addEmploymentEntry: (entryKind: 'CURRENT' | 'PREVIOUS') => Promise<EmploymentEntry>;
  updateEmploymentEntry: (
    id: string,
    patch: EmploymentEntryPatch,
  ) => Promise<EmploymentEntry>;
  deleteEmploymentEntry: (id: string) => Promise<void>;

  unemploymentEntries: UnemploymentEntry[];
  addUnemploymentEntry: () => Promise<UnemploymentEntry>;
  updateUnemploymentEntry: (
    id: string,
    patch: UnemploymentEntryPatch,
  ) => Promise<UnemploymentEntry>;
  deleteUnemploymentEntry: (id: string) => Promise<void>;

  // Step 8 — Relationships (PR-VISA8). Partner is singleton via upsert;
  // everything else uses the standard add / update / delete shape.
  partner: VisaPartnerRow | null;
  upsertPartner: (patch: VisaPartnerPatch) => Promise<VisaPartnerRow>;
  formerPartners: FormerPartnerRow[];
  addFormerPartner: () => Promise<FormerPartnerRow>;
  updateFormerPartner: (id: string, patch: FormerPartnerPatch) => Promise<FormerPartnerRow>;
  deleteFormerPartner: (id: string) => Promise<void>;
  children: ChildRow[];
  addChild: () => Promise<ChildRow>;
  updateChild: (id: string, patch: ChildPatch) => Promise<ChildRow>;
  deleteChild: (id: string) => Promise<void>;
  parents: ParentRow[];
  addParent: () => Promise<ParentRow>;
  updateParent: (id: string, patch: ParentPatch) => Promise<ParentRow>;
  deleteParent: (id: string) => Promise<void>;
  siblings: SiblingRow[];
  addSibling: () => Promise<SiblingRow>;
  updateSibling: (id: string, patch: SiblingPatch) => Promise<SiblingRow>;
  deleteSibling: (id: string) => Promise<void>;
  nzContacts: NzContactRow[];
  addNzContact: () => Promise<NzContactRow>;
  updateNzContact: (id: string, patch: NzContactPatch) => Promise<NzContactRow>;
  deleteNzContact: (id: string) => Promise<void>;
}

// Total number of Visa Section steps the UI knows how to render. Bumps as
// each later INZ section is built (PR-VISA14 brings this to 14).
export const VISA_TOTAL_STEPS = 14;

const VisaContext = createContext<ContextValue | null>(null);

export function VisaProvider({
  children,
  initialVisa,
  initialReadonly,
  initialOtherCitizenships,
  initialTbRiskCountries,
  initialEducationEntries,
  initialEducationSupplements,
  initialEmploymentEntries,
  initialUnemploymentEntries,
  initialPartner,
  initialFormerPartners,
  initialChildren,
  initialParents,
  initialSiblings,
  initialNzContacts,
}: {
  children: ReactNode;
  initialVisa: VisaApplication;
  initialReadonly: VisaReadonly;
  initialOtherCitizenships: OtherCitizenship[];
  initialTbRiskCountries: TbRiskCountry[];
  initialEducationEntries: EducationEntryRow[];
  initialEducationSupplements: EducationSupplement[];
  initialEmploymentEntries: EmploymentEntry[];
  initialUnemploymentEntries: UnemploymentEntry[];
  initialPartner: VisaPartnerRow | null;
  initialFormerPartners: FormerPartnerRow[];
  initialChildren: ChildRow[];
  initialParents: ParentRow[];
  initialSiblings: SiblingRow[];
  initialNzContacts: NzContactRow[];
}) {
  const [visa, setVisa] = useState<VisaApplication>(initialVisa);
  const [readonlyState] = useState<VisaReadonly>(initialReadonly);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [otherCitizenships, setOtherCitizenships] = useState<OtherCitizenship[]>(
    initialOtherCitizenships ?? [],
  );
  const [tbRiskCountries, setTbRiskCountries] = useState<TbRiskCountry[]>(
    initialTbRiskCountries ?? [],
  );
  const [educationEntries] = useState<EducationEntryRow[]>(initialEducationEntries ?? []);
  const [educationSupplements, setEducationSupplements] = useState<EducationSupplement[]>(
    initialEducationSupplements ?? [],
  );
  const [employmentEntries, setEmploymentEntries] = useState<EmploymentEntry[]>(
    initialEmploymentEntries ?? [],
  );
  const [unemploymentEntries, setUnemploymentEntries] = useState<UnemploymentEntry[]>(
    initialUnemploymentEntries ?? [],
  );
  const [partner, setPartner] = useState<VisaPartnerRow | null>(initialPartner ?? null);
  const [formerPartners, setFormerPartners] = useState<FormerPartnerRow[]>(initialFormerPartners ?? []);
  const [childrenRows, setChildrenRows] = useState<ChildRow[]>(initialChildren ?? []);
  const [parents, setParents] = useState<ParentRow[]>(initialParents ?? []);
  const [siblings, setSiblings] = useState<SiblingRow[]>(initialSiblings ?? []);
  const [nzContacts, setNzContacts] = useState<NzContactRow[]>(initialNzContacts ?? []);
  // Clamp the initial step in case the row has a stale value from before
  // VISA_TOTAL_STEPS bumped — we never want the UI in an off-by-one state.
  const [activeStep, setActiveStepRaw] = useState<number>(() =>
    Math.max(1, Math.min(VISA_TOTAL_STEPS, initialVisa.currentStep ?? 1)),
  );

  // PR-SCROLL-TOP: smoothly scroll the portal <main> back to the top
  // whenever the student crosses to a different step (Save & continue,
  // Back, or stepper jump). Guarded by `hasMountedRef` so the page
  // doesn't smooth-scroll on initial paint, and by an equality check
  // so re-sets to the same step value are no-ops.
  const hasMountedRef = useRef(false);
  useEffect(() => { hasMountedRef.current = true; }, []);

  const setActiveStep = useCallback((next: number) => {
    setActiveStepRaw((prev) => {
      if (next !== prev && hasMountedRef.current) {
        scrollPortalToTop();
      }
      return next;
    });
  }, []);

  const patchVisa = useCallback(async (fields: Record<string, unknown>) => {
    const res = await api.patch<{
      visaApplication: VisaApplication;
      readonly: VisaReadonly;
      otherCitizenships?: OtherCitizenship[];
      tbRiskCountries?: TbRiskCountry[];
      educationSupplements?: EducationSupplement[];
      employmentEntries?: EmploymentEntry[];
      unemploymentEntries?: UnemploymentEntry[];
      partner?: VisaPartnerRow | null;
      formerPartners?: FormerPartnerRow[];
      children?: ChildRow[];
      parents?: ParentRow[];
      siblings?: SiblingRow[];
      nzContacts?: NzContactRow[];
    }>(
      '/students/me/visa/application',
      fields,
    );
    setVisa(res.visaApplication);
    // Backend reconciles the citizenship rows on save (clears them when
    // holdsOtherCitizenships is patched to false). Trust its return value
    // as the new source of truth.
    if (Array.isArray(res.otherCitizenships)) {
      setOtherCitizenships(res.otherCitizenships);
    }
    if (Array.isArray(res.tbRiskCountries)) {
      setTbRiskCountries(res.tbRiskCountries);
    }
    if (Array.isArray(res.educationSupplements)) {
      setEducationSupplements(res.educationSupplements);
    }
    if (Array.isArray(res.employmentEntries)) {
      setEmploymentEntries(res.employmentEntries);
    }
    if (Array.isArray(res.unemploymentEntries)) {
      setUnemploymentEntries(res.unemploymentEntries);
    }
    // PR-VISA8: reconciliations on save (admission status change wipes
    // partner; toggle-No on the three Step-8 gates wipes their lists)
    // are reflected in the response — trust the server's truth.
    if (res.partner !== undefined) setPartner(res.partner);
    if (Array.isArray(res.formerPartners)) setFormerPartners(res.formerPartners);
    if (Array.isArray(res.children))       setChildrenRows(res.children);
    if (Array.isArray(res.parents))        setParents(res.parents);
    if (Array.isArray(res.siblings))       setSiblings(res.siblings);
    if (Array.isArray(res.nzContacts))     setNzContacts(res.nzContacts);
  }, []);

  const addOtherCitizenship = useCallback(async (data: OtherCitizenshipInput) => {
    const row = await api.post<OtherCitizenship>(
      '/students/me/visa/citizenships',
      data,
    );
    setOtherCitizenships(prev =>
      [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder),
    );
    return row;
  }, []);

  const updateOtherCitizenship = useCallback(
    async (id: string, data: Partial<OtherCitizenshipInput>) => {
      const row = await api.patch<OtherCitizenship>(
        `/students/me/visa/citizenships/${id}`,
        data,
      );
      setOtherCitizenships(prev => prev.map(r => (r.id === id ? row : r)));
      return row;
    },
    [],
  );

  const deleteOtherCitizenship = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/citizenships/${id}`);
    setOtherCitizenships(prev => prev.filter(r => r.id !== id));
  }, []);

  const resetOtherCitizenships = useCallback(() => {
    setOtherCitizenships([]);
  }, []);

  const addTbRiskCountry = useCallback(async (data: TbRiskCountryInput) => {
    const row = await api.post<TbRiskCountry>(
      '/students/me/visa/tb-countries',
      data,
    );
    setTbRiskCountries(prev =>
      [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder),
    );
    return row;
  }, []);

  const updateTbRiskCountry = useCallback(
    async (id: string, data: Partial<TbRiskCountryInput>) => {
      const row = await api.patch<TbRiskCountry>(
        `/students/me/visa/tb-countries/${id}`,
        data,
      );
      setTbRiskCountries(prev => prev.map(r => (r.id === id ? row : r)));
      return row;
    },
    [],
  );

  const deleteTbRiskCountry = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/tb-countries/${id}`);
    setTbRiskCountries(prev => prev.filter(r => r.id !== id));
  }, []);

  const addEmploymentEntry = useCallback(
    async (entryKind: 'CURRENT' | 'PREVIOUS') => {
      const row = await api.post<EmploymentEntry>(
        '/students/me/visa/employment-entries',
        { entryKind },
      );
      // CURRENT is singleton at the server — replace any existing one
      // locally; PREVIOUS appends.
      setEmploymentEntries((prev) => {
        if (entryKind === 'CURRENT') {
          const others = prev.filter(e => e.entryKind !== 'CURRENT');
          return [...others, row].sort((a, b) => a.sortOrder - b.sortOrder);
        }
        return [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder);
      });
      return row;
    },
    [],
  );

  const updateEmploymentEntry = useCallback(
    async (id: string, patch: EmploymentEntryPatch) => {
      const row = await api.patch<EmploymentEntry>(
        `/students/me/visa/employment-entries/${id}`,
        patch,
      );
      setEmploymentEntries(prev => prev.map(r => (r.id === id ? row : r)));
      return row;
    },
    [],
  );

  const deleteEmploymentEntry = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/employment-entries/${id}`);
    setEmploymentEntries(prev => prev.filter(r => r.id !== id));
  }, []);

  const addUnemploymentEntry = useCallback(async () => {
    const row = await api.post<UnemploymentEntry>(
      '/students/me/visa/unemployment-entries',
      {},
    );
    setUnemploymentEntries(prev =>
      [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder),
    );
    return row;
  }, []);

  const updateUnemploymentEntry = useCallback(
    async (id: string, patch: UnemploymentEntryPatch) => {
      const row = await api.patch<UnemploymentEntry>(
        `/students/me/visa/unemployment-entries/${id}`,
        patch,
      );
      setUnemploymentEntries(prev => prev.map(r => (r.id === id ? row : r)));
      return row;
    },
    [],
  );

  const deleteUnemploymentEntry = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/unemployment-entries/${id}`);
    setUnemploymentEntries(prev => prev.filter(r => r.id !== id));
  }, []);

  // ── Step 8 — Relationships (PR-VISA8) ─────────────────────────────

  const upsertPartner = useCallback(async (patch: VisaPartnerPatch) => {
    const row = await api.patch<VisaPartnerRow>(
      '/students/me/visa/partner',
      patch,
    );
    setPartner(row);
    return row;
  }, []);

  const addFormerPartner = useCallback(async () => {
    const row = await api.post<FormerPartnerRow>('/students/me/visa/former-partners', {});
    setFormerPartners((prev) => [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder));
    return row;
  }, []);
  const updateFormerPartner = useCallback(async (id: string, patch: FormerPartnerPatch) => {
    const row = await api.patch<FormerPartnerRow>(`/students/me/visa/former-partners/${id}`, patch);
    setFormerPartners((prev) => prev.map((r) => (r.id === id ? row : r)));
    return row;
  }, []);
  const deleteFormerPartner = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/former-partners/${id}`);
    setFormerPartners((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addChild = useCallback(async () => {
    const row = await api.post<ChildRow>('/students/me/visa/children', {});
    setChildrenRows((prev) => [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder));
    return row;
  }, []);
  const updateChild = useCallback(async (id: string, patch: ChildPatch) => {
    const row = await api.patch<ChildRow>(`/students/me/visa/children/${id}`, patch);
    setChildrenRows((prev) => prev.map((r) => (r.id === id ? row : r)));
    return row;
  }, []);
  const deleteChild = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/children/${id}`);
    setChildrenRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addParent = useCallback(async () => {
    const row = await api.post<ParentRow>('/students/me/visa/parents', {});
    setParents((prev) => [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder));
    return row;
  }, []);
  const updateParent = useCallback(async (id: string, patch: ParentPatch) => {
    const row = await api.patch<ParentRow>(`/students/me/visa/parents/${id}`, patch);
    setParents((prev) => prev.map((r) => (r.id === id ? row : r)));
    return row;
  }, []);
  const deleteParent = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/parents/${id}`);
    setParents((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addSibling = useCallback(async () => {
    const row = await api.post<SiblingRow>('/students/me/visa/siblings', {});
    setSiblings((prev) => [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder));
    return row;
  }, []);
  const updateSibling = useCallback(async (id: string, patch: SiblingPatch) => {
    const row = await api.patch<SiblingRow>(`/students/me/visa/siblings/${id}`, patch);
    setSiblings((prev) => prev.map((r) => (r.id === id ? row : r)));
    return row;
  }, []);
  const deleteSibling = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/siblings/${id}`);
    setSiblings((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addNzContact = useCallback(async () => {
    const row = await api.post<NzContactRow>('/students/me/visa/nz-contacts', {});
    setNzContacts((prev) => [...prev, row].sort((a, b) => a.sortOrder - b.sortOrder));
    return row;
  }, []);
  const updateNzContact = useCallback(async (id: string, patch: NzContactPatch) => {
    const row = await api.patch<NzContactRow>(`/students/me/visa/nz-contacts/${id}`, patch);
    setNzContacts((prev) => prev.map((r) => (r.id === id ? row : r)));
    return row;
  }, []);
  const deleteNzContact = useCallback(async (id: string) => {
    await api.delete<void>(`/students/me/visa/nz-contacts/${id}`);
    setNzContacts((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const upsertEducationSupplement = useCallback(
    async (educationEntryId: string, patch: EducationSupplementPatch) => {
      const row = await api.patch<EducationSupplement>(
        `/students/me/visa/education-supplements/${educationEntryId}`,
        patch,
      );
      setEducationSupplements(prev => {
        const idx = prev.findIndex(s => s.educationEntryId === educationEntryId);
        if (idx === -1) return [...prev, row];
        const next = prev.slice();
        next[idx] = row;
        return next;
      });
      return row;
    },
    [],
  );

  return (
    <VisaContext.Provider value={{
      visa,
      readonly: readonlyState,
      patchVisa,
      activeStep,
      setActiveStep,
      savedAt,
      setSavedAt,
      otherCitizenships,
      addOtherCitizenship,
      updateOtherCitizenship,
      deleteOtherCitizenship,
      resetOtherCitizenships,
      tbRiskCountries,
      addTbRiskCountry,
      updateTbRiskCountry,
      deleteTbRiskCountry,
      educationEntries,
      educationSupplements,
      upsertEducationSupplement,
      employmentEntries,
      addEmploymentEntry,
      updateEmploymentEntry,
      deleteEmploymentEntry,
      unemploymentEntries,
      addUnemploymentEntry,
      updateUnemploymentEntry,
      deleteUnemploymentEntry,
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
    }}>
      {children}
    </VisaContext.Provider>
  );
}

export function useVisa() {
  const ctx = useContext(VisaContext);
  if (!ctx) throw new Error('useVisa must be used within VisaProvider');
  return ctx;
}
