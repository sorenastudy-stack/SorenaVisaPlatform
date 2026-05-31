import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { createSignedDownloadToken } from '../../common/signed-url.util';
import { decryptPiiFields } from '../admission/admission-encryption.util';
import { isValidCountryCode } from '../../common/country-codes';

// PR-FILES-1 — same UPLOAD_DIR convention as admission.service.ts:16.
// Stored fileUrls are the rename target produced by path.join() — the
// existing files/signed/:token controller path.resolve()'s the value
// when serving downloads, so a relative path here is safe.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

// PII fields stored encrypted on the row. Each lands in its `<field>Encrypted`
// BYTEA column via the standard AES-256-GCM envelope.
//   - otherNames, nationalId            (PR-VISA1)
//   - physicalStreet, postalStreet      (PR-VISA2 — street addresses)
//   - homeCommitments, studyRelatesDetails, whyStudyNz, whyThisProvider,
//     howCourseBenefits, plansAfterStudy  (PR-VISA3 — Section 3 free-text)
const VISA_ENCRYPTED_FIELDS = new Set([
  'otherNames',
  'nationalId',
  'physicalStreet',
  'postalStreet',
  'homeCommitments',
  'studyRelatesDetails',
  'whyStudyNz',
  'whyThisProvider',
  'howCourseBenefits',
  'plansAfterStudy',
]);

// PATCH allow-list. Fields are stored as-is on the row except the PII fields
// in VISA_ENCRYPTED_FIELDS, which go through CryptoService.encrypt and land in
// their `<field>Encrypted` column. middleNames has a max-30-char length cap to
// match the INZ form; passportGender is restricted to the three INZ values;
// preferred/alternativeContactNumber are capped at 16 chars per INZ helper.
const PATCHABLE_VISA_FIELDS: Record<string, 'text' | 'boolean' | 'int' | 'datetime'> = {
  // Section 1 — Identity (PR-VISA1)
  hasMononym:             'boolean',
  middleNames:            'text',
  hasUsedOtherNames:      'boolean',
  otherNames:             'text',
  countryWhenSubmitting:  'text',
  prevAppliedNzVisa:      'boolean',
  prevRequestedNzeta:     'boolean',
  everTravelledNz:        'boolean',
  totalNzTime24Plus:      'boolean',
  passportIssueDate:      'datetime',
  passportExpiryDate:     'datetime',
  passportCountryOfIssue: 'text',
  passportGender:         'text',
  stateOfBirth:           'text',
  cityOfBirth:            'text',
  hasNationalId:          'boolean',
  nationalId:             'text',
  nationalIdCountry:      'text',
  // Section 2 — Address and contact (PR-VISA2)
  physicalStreet:           'text',
  physicalSuburb:           'text',
  physicalCity:             'text',
  physicalState:            'text',
  physicalPostcode:         'text',
  physicalCountry:          'text',
  postalSameAsPhysical:     'boolean',
  postalStreet:             'text',
  postalSuburb:             'text',
  postalCity:               'text',
  postalState:              'text',
  postalPostcode:           'text',
  postalCountry:            'text',
  preferredContactCountryCode:    'text',
  preferredContactNumber:         'text',
  alternativeContactCountryCode:  'text',
  alternativeContactNumber:       'text',

  // Section 3 — Eligibility (PR-VISA3)
  holdsNzStudentVisa:           'boolean',
  usedEducationAgent:           'boolean',
  agentOrganisationName:        'text',
  agentCountry:                 'text',
  agentGivenName:               'text',
  agentSurname:                 'text',
  agentEmail:                   'text',
  studyingSchoolLevel:          'boolean',
  studyingMastersOrPhd:         'text',
  educationProviderName:        'text',
  studyLocation:                'text',
  courseRequiresOtherLocation:  'boolean',
  courseProgrammeName:          'text',
  courseStartDate:              'datetime',
  courseEndDate:                'datetime',
  intendedArrivalDate:          'datetime',
  phdDiscipline:                'text',
  phdSubject:                   'text',
  phdSupervisorTitle:           'text',
  phdSupervisorGivenName:       'text',
  phdSupervisorSurname:         'text',
  phdSupervisorOrganisation:    'text',
  phdPublishedPapers:           'boolean',
  phdSupervisorOutsideNz:       'boolean',
  providerIssuedStudentId:      'boolean',
  studentIdNumber:              'text',
  homeCommitments:              'text',
  studyRelatesToPrevious:       'boolean',
  studyRelatesDetails:          'text',
  whyStudyNz:                   'text',
  whyThisProvider:              'text',
  howCourseBenefits:            'text',
  plansAfterStudy:              'text',
  studyingMultiYear:            'boolean',

  // Section 4 — Character (PR-VISA4)
  everConvicted:                'boolean',
  underInvestigation:           'boolean',
  everDeportedExcluded:         'boolean',
  everRefusedVisa:              'boolean',
  policeCertIssueDate:          'datetime',
  policeCertCountryOfIssue:     'text',
  policeCertInEnglish:          'boolean',
  holdsOtherCitizenships:       'boolean',
  livedOtherCountry5Years:      'boolean',

  // Section 5 — Health (PR-VISA5)
  hasTuberculosis:              'boolean',
  needsRenalDialysis:           'boolean',
  hasMedicalCondition:          'boolean',
  needsResidentialCare:         'boolean',
  isPregnant:                   'boolean',
  intendedLengthOfStay:         'text',
  hadMedicalExam:               'boolean',
  medicalRefNumber:             'text',
  tbCountriesNoMore:            'boolean',
  insuranceDeclarationAgreed:   'boolean',
  publicHealthAckAgreed:        'boolean',

  // Section 7 — Employment history (PR-VISA7) — five screening Y/Ns.
  everGovernmentEmployed:       'boolean',
  everPrisonGuard:              'boolean',
  currentlyWorking:             'boolean',
  hadPreviousEmployment:        'boolean',
  everUnemployed:               'boolean',

  // Section 8 — Relationships (PR-VISA8). Note: relationshipStatus +
  // hasChildren are NOT here — they're sourced read-only from admission.
  hasFormerPartners:            'boolean',
  hasSiblings:                  'boolean',
  hasNzContacts:                'boolean',

  // Section 9 — Background details (PR-VISA9). Flat set of Y/Ns.
  heldReligiousCulturalPosition: 'boolean',
  heldPoliticalAppointment:      'boolean',
  hadPoliticalAssociation:       'boolean',
  associatedIntelligenceAgency:  'boolean',
  witnessedIllTreatment:         'boolean',
  involvedArmedConflict:         'boolean',
  associatedViolentGroup:        'boolean',
  involvedWarCrimes:             'boolean',
  memberLiberationMilitia:       'boolean',
  everDetainedImprisoned:        'boolean',

  currentStep:            'int',
};

const VALID_EMPLOYMENT_KINDS = new Set(['CURRENT', 'PREVIOUS']);

// PR-COUNTRY-CONSOLIDATE — country-code validation helpers. The repeating-
// table CRUD already allows empty-string country on create (draft state),
// so the validator must too: null/undefined/'' pass through; anything else
// must match the ISO 3166-1 alpha-2 catalogue exposed by
// `backend/src/common/country-codes.ts`.
function assertCountryCodeOrEmpty(value: unknown, fieldName: string): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return;
  if (!isValidCountryCode(trimmed)) {
    throw new BadRequestException(
      `${fieldName} must be a valid ISO 3166-1 alpha-2 country code`,
    );
  }
}

// Country fields stored directly on visa_applications. Validated by
// updateApplication after the standard coercion pass.
const VISA_APPLICATION_COUNTRY_FIELDS = [
  'countryWhenSubmitting',
  'passportCountryOfIssue',
  'nationalIdCountry',
  'physicalCountry',
  'postalCountry',
  'agentCountry',
  'policeCertCountryOfIssue',
] as const;

const VALID_GENDERS = new Set(['MALE', 'FEMALE', 'GENDER_DIVERSE']);
const VALID_MASTERS_OR_PHD = new Set(['MASTERS', 'PHD', 'NEITHER']);
const VALID_LENGTHS_OF_STAY = new Set([
  'SIX_MONTHS_OR_LESS',
  'SIX_TO_TWELVE_MONTHS',
  'MORE_THAN_TWELVE_MONTHS',
]);
const MIDDLE_NAMES_MAX = 30;
const CONTACT_NUMBER_MAX = 16;

function coerceField(
  key: string,
  value: unknown,
  type: 'text' | 'boolean' | 'int' | 'datetime',
): unknown {
  if (value === null || value === undefined || value === '') return null;
  switch (type) {
    case 'text':
      return String(value);
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new BadRequestException(`Field '${key}' must be a boolean`);
    case 'int': {
      const n = parseInt(String(value), 10);
      if (isNaN(n)) throw new BadRequestException(`Field '${key}' must be an integer`);
      return n;
    }
    case 'datetime': {
      const d = new Date(value as string);
      if (isNaN(d.getTime())) throw new BadRequestException(`Field '${key}' must be a valid ISO date`);
      return d;
    }
  }
}

@Injectable()
export class VisaService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  // ── Auth helper — same shape as AdmissionService.resolveContactAndCase ──
  // Resolves the admission_applications row the student owns, which is the
  // anchor every visa_applications row hangs off. Throws Forbidden if the
  // caller does not own a matching admission application.
  private async resolveAdmissionApplication(userId: string) {
    const contact = await this.prisma.contact.findUnique({ where: { userId } });
    if (!contact) throw new NotFoundException('Student profile not found');

    const lead = await this.prisma.lead.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead) throw new NotFoundException('No lead found for this student');

    const caseRecord = await this.prisma.case.findFirst({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!caseRecord) throw new NotFoundException('No case found for this student');

    const admission = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!admission) {
      throw new NotFoundException(
        'No admission application found. Please complete admission before starting the visa section.',
      );
    }

    // First-priority programme choice — used by PR-VISA3 to pre-fill the
    // education provider + course/programme names read-only.
    const topChoice = await this.prisma.admissionProgrammeChoice.findFirst({
      where:   { admissionApplicationId: admission.id },
      orderBy: { priority: 'asc' },
      include: { programme: { include: { provider: true } } },
    });

    return { contact, admission, topChoice };
  }

  // Pull the values that the Visa Section displays read-only — these are
  // collected during admission/intake and must not be re-asked here (per
  // docs/VISA_FIELD_INVENTORY.md). passportNumber comes back decrypted.
  // PR-VISA2: email + countryOfResidence are also exposed for Section 2.
  // PR-VISA3: programmeName + providerName are derived from the student's
  // first-priority admission programme choice (lowest priority number) so
  // Step 3 doesn't have to re-ask the same provider/course question.
  private buildReadonlySnapshot(
    contact: { fullName: string; email: string | null; countryOfResidence: string | null },
    admission: Record<string, unknown>,
    topChoice: { programme: { name: string; provider: { name: string } } } | null,
  ) {
    const decryptedAdmission = decryptPiiFields(
      this.crypto,
      admission as Record<string, unknown>,
    );
    return {
      fullName:           contact.fullName,
      email:              contact.email,
      countryOfResidence: contact.countryOfResidence,
      passportNumber:     (decryptedAdmission.passportNumber as string | null) ?? null,
      citizenship:        (admission.citizenship as string | null) ?? null,
      dateOfBirth:        (admission.dateOfBirth as Date | null) ?? null,
      countryOfBirth:     (admission.countryOfBirth as string | null) ?? null,
      programmeName:      topChoice?.programme.name          ?? null,
      providerName:       topChoice?.programme.provider.name ?? null,
      // PR-VISA8: Step 8 reads these admission values read-only to gate
      // the partner block (maritalStatus === MARRIED|DE_FACTO) and the
      // children block (hasChildren === true). No visa-side duplicates.
      maritalStatus:      (admission.maritalStatus as string | null) ?? null,
      hasChildren:        (admission.hasChildren   as boolean | null) ?? null,
    };
  }

  // Decrypt PII fields back into plaintext keys for the API response. The set
  // matches VISA_ENCRYPTED_FIELDS — same envelope, same plaintext key shape.
  private decryptVisaRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const toBuf = (v: unknown) =>
      Buffer.isBuffer(v) ? v : Buffer.from(v as Uint8Array);
    for (const [key, value] of Object.entries(row)) {
      if (key.endsWith('Encrypted')) {
        const plainKey = key.slice(0, -'Encrypted'.length);
        if (VISA_ENCRYPTED_FIELDS.has(plainKey)) {
          out[plainKey] = value ? this.crypto.decrypt(toBuf(value)) : null;
          continue;
        }
      }
      out[key] = value;
    }
    return out;
  }

  // Fetch and shape the otherCitizenships rows for a visa application.
  // Sorted ascending by sortOrder so the UI renders in the order the
  // student created them.
  private async loadOtherCitizenships(visaApplicationId: string) {
    const rows = await this.prisma.visaOtherCitizenship.findMany({
      where: { visaApplicationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      country: r.country,
      holdsPassport: r.holdsPassport,
      sortOrder: r.sortOrder,
    }));
  }

  // PR-VISA5: same shape for the TB-risk countries repeating table.
  private async loadTbRiskCountries(visaApplicationId: string) {
    const rows = await this.prisma.visaTbRiskCountry.findMany({
      where: { visaApplicationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      country: r.country,
      totalDurationDays: r.totalDurationDays,
      sortOrder: r.sortOrder,
    }));
  }

  // PR-VISA6: education entries (read-only, from admission) + their visa
  // supplements (editable, this step's own data). Returned as two parallel
  // arrays; the frontend joins them on educationEntry.id ===
  // supplement.educationEntryId.
  private async loadEducationEntries(admissionApplicationId: string) {
    const rows = await this.prisma.admissionEducationEntry.findMany({
      where: { admissionApplicationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      qualificationLevel: r.qualificationLevel,
      institutionName: r.institutionName,
      country: r.country,
      fieldOfStudy: r.fieldOfStudy,
      startYear: r.startYear,
      endYear: r.endYear,
      completed: r.completed,
      sortOrder: r.sortOrder,
    }));
  }

  private async loadEducationSupplements(visaApplicationId: string) {
    const rows = await this.prisma.visaEducationSupplement.findMany({
      where: { visaApplicationId },
    });
    return rows.map((r) => ({
      id: r.id,
      educationEntryId: r.educationEntryId,
      startMonth: r.startMonth,
      endMonth: r.endMonth,
      institutionState: r.institutionState,
      institutionTown: r.institutionTown,
      qualificationAwarded: r.qualificationAwarded,
    }));
  }

  // PR-VISA7: employment + unemployment loaders. duties / activity /
  // financialSupport are encrypted on disk; this returns plaintext keys.
  private async loadEmploymentEntries(visaApplicationId: string) {
    const rows = await this.prisma.visaEmploymentEntry.findMany({
      where: { visaApplicationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      entryKind: r.entryKind,
      startDate: r.startDate,
      endDate: r.endDate,
      roleTitle: r.roleTitle,
      duties: r.dutiesEncrypted ? this.crypto.decrypt(Buffer.from(r.dutiesEncrypted)) : null,
      countryOfWork: r.countryOfWork,
      stateOfWork: r.stateOfWork,
      supervisorName: r.supervisorName,
      organisationField: r.organisationField,
      organisationCountry: r.organisationCountry,
      organisationState: r.organisationState,
      employerName: r.employerName,
      employerStreet: r.employerStreet,
      employerSuburb: r.employerSuburb,
      employerTownCity: r.employerTownCity,
      employerSubregion: r.employerSubregion,
      employerRegion: r.employerRegion,
      employerPostcode: r.employerPostcode,
      employerPhone: r.employerPhone,
      employerEmail: r.employerEmail,
      sortOrder: r.sortOrder,
    }));
  }

  private async loadUnemploymentEntries(visaApplicationId: string) {
    const rows = await this.prisma.visaUnemploymentEntry.findMany({
      where: { visaApplicationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      startDate: r.startDate,
      endDate: r.endDate,
      activity: r.activityEncrypted
        ? this.crypto.decrypt(Buffer.from(r.activityEncrypted))
        : null,
      financialSupport: r.financialSupportEncrypted
        ? this.crypto.decrypt(Buffer.from(r.financialSupportEncrypted))
        : null,
      sortOrder: r.sortOrder,
    }));
  }

  // Ownership helper for the citizenship CRUD routes — the row must belong
  // to a visa_application whose admission chain resolves to this userId.
  // Mirrors AdmissionService.assertEducationEntryOwnership.
  private async assertCitizenshipOwnership(citizenshipId: string, userId: string) {
    const row = await this.prisma.visaOtherCitizenship.findUnique({
      where: { id: citizenshipId },
      include: {
        visaApplication: {
          include: {
            admissionApplication: {
              include: { contact: true },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Citizenship row not found');
    if (row.visaApplication.admissionApplication.contact.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return row;
  }

  // Same ownership shape for the TB-risk-country rows (PR-VISA5).
  private async assertTbRiskCountryOwnership(rowId: string, userId: string) {
    const row = await this.prisma.visaTbRiskCountry.findUnique({
      where: { id: rowId },
      include: {
        visaApplication: {
          include: {
            admissionApplication: {
              include: { contact: true },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('TB-risk-country row not found');
    if (row.visaApplication.admissionApplication.contact.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return row;
  }

  // PR-VISA6: ownership check for an admission education entry. We
  // verify the chain admission_education_entry → admission_application
  // → contact.userId, then return the entry along with the resolved
  // visa application (creating it lazily on first supplement upsert is
  // out of scope — the visa row already exists by Step 6).
  private async resolveEducationEntryForUser(
    educationEntryId: string,
    userId: string,
  ) {
    const entry = await this.prisma.admissionEducationEntry.findUnique({
      where: { id: educationEntryId },
      include: {
        admissionApplication: {
          include: { contact: true, visaApplication: true },
        },
      },
    });
    if (!entry) throw new NotFoundException('Education entry not found');
    if (entry.admissionApplication.contact.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    const visa = entry.admissionApplication.visaApplication;
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    return { entry, visaApplicationId: visa.id };
  }

  // PR-VISA7: ownership helpers for employment + unemployment rows.
  private async assertEmploymentEntryOwnership(rowId: string, userId: string) {
    const row = await this.prisma.visaEmploymentEntry.findUnique({
      where: { id: rowId },
      include: {
        visaApplication: {
          include: {
            admissionApplication: { include: { contact: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Employment entry not found');
    if (row.visaApplication.admissionApplication.contact.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return row;
  }

  private async assertUnemploymentEntryOwnership(rowId: string, userId: string) {
    const row = await this.prisma.visaUnemploymentEntry.findUnique({
      where: { id: rowId },
      include: {
        visaApplication: {
          include: {
            admissionApplication: { include: { contact: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Unemployment entry not found');
    if (row.visaApplication.admissionApplication.contact.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return row;
  }

  // GET — returns { exists, visaApplication?, readonly, otherCitizenships }.
  // Does not auto-create the row; the client POSTs explicitly. This mirrors
  // the admission pattern.
  async getApplication(userId: string) {
    const { contact, admission, topChoice } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });

    const readonly = this.buildReadonlySnapshot(contact, admission as Record<string, unknown>, topChoice);

    if (!visa) {
      return {
        exists: false as const,
        readonly,
        otherCitizenships: [],
        tbRiskCountries: [],
        educationEntries: await this.loadEducationEntries(admission.id),
        educationSupplements: [],
        employmentEntries: [],
        unemploymentEntries: [],
        partner: null,
        formerPartners: [],
        children: [],
        parents: [],
        siblings: [],
        nzContacts: [],
      };
    }
    return {
      exists: true as const,
      visaApplication: this.decryptVisaRow(visa as Record<string, unknown>),
      readonly,
      otherCitizenships: await this.loadOtherCitizenships(visa.id),
      tbRiskCountries: await this.loadTbRiskCountries(visa.id),
      educationEntries: await this.loadEducationEntries(admission.id),
      educationSupplements: await this.loadEducationSupplements(visa.id),
      employmentEntries: await this.loadEmploymentEntries(visa.id),
      unemploymentEntries: await this.loadUnemploymentEntries(visa.id),
      partner: await this.loadPartner(visa.id),
      formerPartners: await this.loadFormerPartners(visa.id),
      children: await this.loadChildren(visa.id),
      parents: await this.loadParents(visa.id),
      siblings: await this.loadSiblings(visa.id),
      nzContacts: await this.loadNzContacts(visa.id),
    };
  }

  // POST — idempotent get-or-create. Returns the row plus the readonly
  // snapshot plus any existing citizenship rows.
  async getOrCreateApplication(userId: string) {
    const { contact, admission, topChoice } = await this.resolveAdmissionApplication(userId);
    let visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      visa = await this.prisma.visaApplication.create({
        data: { applicationId: admission.id, currentStep: 1 },
      });
    }
    return {
      visaApplication: this.decryptVisaRow(visa as Record<string, unknown>),
      readonly: this.buildReadonlySnapshot(contact, admission as Record<string, unknown>, topChoice),
      otherCitizenships: await this.loadOtherCitizenships(visa.id),
      tbRiskCountries: await this.loadTbRiskCountries(visa.id),
      educationEntries: await this.loadEducationEntries(admission.id),
      educationSupplements: await this.loadEducationSupplements(visa.id),
      employmentEntries: await this.loadEmploymentEntries(visa.id),
      unemploymentEntries: await this.loadUnemploymentEntries(visa.id),
      partner: await this.loadPartner(visa.id),
      formerPartners: await this.loadFormerPartners(visa.id),
      children: await this.loadChildren(visa.id),
      parents: await this.loadParents(visa.id),
      siblings: await this.loadSiblings(visa.id),
      nzContacts: await this.loadNzContacts(visa.id),
    };
  }

  // PATCH — allow-listed field update with per-type coercion and PII
  // encryption. Plaintext PII keys (`otherNames`, `nationalId`) are encrypted
  // and written to their `<field>Encrypted` BYTEA column.
  async updateApplication(userId: string, body: Record<string, unknown>) {
    const { contact, admission, topChoice } = await this.resolveAdmissionApplication(userId);

    // Coerce + allow-list filter
    const sanitized: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(body)) {
      const type = PATCHABLE_VISA_FIELDS[key];
      if (!type) continue;
      sanitized[key] = coerceField(key, rawValue, type);
    }

    // Per-field validation
    if (
      typeof sanitized.middleNames === 'string' &&
      sanitized.middleNames.length > MIDDLE_NAMES_MAX
    ) {
      throw new BadRequestException(
        `middleNames must be ${MIDDLE_NAMES_MAX} characters or fewer`,
      );
    }
    // PR-COUNTRY-CONSOLIDATE: validate every country-storing field as
    // an ISO 3166-1 alpha-2 code (or null / empty). Runs after coercion
    // so we're checking the string-form value, not raw input.
    for (const field of VISA_APPLICATION_COUNTRY_FIELDS) {
      assertCountryCodeOrEmpty(sanitized[field], field);
    }
    if (
      sanitized.passportGender !== null &&
      sanitized.passportGender !== undefined &&
      !VALID_GENDERS.has(sanitized.passportGender as string)
    ) {
      throw new BadRequestException(
        'passportGender must be one of MALE, FEMALE, GENDER_DIVERSE',
      );
    }
    for (const k of [
      'preferredContactNumber',
      'alternativeContactNumber',
      'preferredContactCountryCode',
      'alternativeContactCountryCode',
    ] as const) {
      const v = sanitized[k];
      if (typeof v === 'string' && v.length > CONTACT_NUMBER_MAX) {
        throw new BadRequestException(
          `${k} must be ${CONTACT_NUMBER_MAX} characters or fewer`,
        );
      }
    }
    if (
      sanitized.studyingMastersOrPhd !== null &&
      sanitized.studyingMastersOrPhd !== undefined &&
      !VALID_MASTERS_OR_PHD.has(sanitized.studyingMastersOrPhd as string)
    ) {
      throw new BadRequestException(
        'studyingMastersOrPhd must be one of MASTERS, PHD, NEITHER',
      );
    }
    if (
      sanitized.intendedLengthOfStay !== null &&
      sanitized.intendedLengthOfStay !== undefined &&
      !VALID_LENGTHS_OF_STAY.has(sanitized.intendedLengthOfStay as string)
    ) {
      throw new BadRequestException(
        'intendedLengthOfStay must be one of SIX_MONTHS_OR_LESS, SIX_TO_TWELVE_MONTHS, MORE_THAN_TWELVE_MONTHS',
      );
    }
    // PR-VISA5: when the student answers No to "had a medical exam",
    // clear the reference number so a stale value can't linger after a
    // Yes→No toggle.
    if (
      Object.prototype.hasOwnProperty.call(sanitized, 'hadMedicalExam') &&
      sanitized.hadMedicalExam === false
    ) {
      sanitized.medicalRefNumber = null;
    }

    // PII encryption — move plaintext keys to `<field>Encrypted: Buffer | null`
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sanitized)) {
      if (VISA_ENCRYPTED_FIELDS.has(key)) {
        if (value === null) {
          data[`${key}Encrypted`] = null;
        } else if (typeof value === 'string') {
          data[`${key}Encrypted`] = this.crypto.encrypt(value);
        }
      } else {
        data[key] = value;
      }
    }

    // Upsert keyed on applicationId. The row is owned by the admission
    // application we already verified belongs to this caller — no extra
    // ownership check needed at the DB layer.
    const visa = await this.prisma.visaApplication.upsert({
      where:  { applicationId: admission.id },
      create: { applicationId: admission.id, ...data },
      update: data,
    });

    // PR-VISA4 fix: reconcile the other-citizenships rows. If the save
    // sets holdsOtherCitizenships to false (or clears it to null), wipe
    // every child row so we don't leave orphans visible the next time
    // the student toggles back to Yes.
    if (
      Object.prototype.hasOwnProperty.call(sanitized, 'holdsOtherCitizenships') &&
      sanitized.holdsOtherCitizenships !== true
    ) {
      await this.prisma.visaOtherCitizenship.deleteMany({
        where: { visaApplicationId: visa.id },
      });
    }
    // PR-VISA7: same reconcile pattern for the three Step-7 child sets.
    if (
      Object.prototype.hasOwnProperty.call(sanitized, 'currentlyWorking') &&
      sanitized.currentlyWorking !== true
    ) {
      await this.prisma.visaEmploymentEntry.deleteMany({
        where: { visaApplicationId: visa.id, entryKind: 'CURRENT' },
      });
    }
    if (
      Object.prototype.hasOwnProperty.call(sanitized, 'hadPreviousEmployment') &&
      sanitized.hadPreviousEmployment !== true
    ) {
      await this.prisma.visaEmploymentEntry.deleteMany({
        where: { visaApplicationId: visa.id, entryKind: 'PREVIOUS' },
      });
    }
    if (
      Object.prototype.hasOwnProperty.call(sanitized, 'everUnemployed') &&
      sanitized.everUnemployed !== true
    ) {
      await this.prisma.visaUnemploymentEntry.deleteMany({
        where: { visaApplicationId: visa.id },
      });
    }
    // PR-VISA8: same reconcile for the three relationships gates.
    if (
      Object.prototype.hasOwnProperty.call(sanitized, 'hasFormerPartners') &&
      sanitized.hasFormerPartners !== true
    ) {
      await this.prisma.visaFormerPartner.deleteMany({
        where: { visaApplicationId: visa.id },
      });
    }
    if (
      Object.prototype.hasOwnProperty.call(sanitized, 'hasSiblings') &&
      sanitized.hasSiblings !== true
    ) {
      await this.prisma.visaSibling.deleteMany({
        where: { visaApplicationId: visa.id },
      });
    }
    if (
      Object.prototype.hasOwnProperty.call(sanitized, 'hasNzContacts') &&
      sanitized.hasNzContacts !== true
    ) {
      await this.prisma.visaNzContact.deleteMany({
        where: { visaApplicationId: visa.id },
      });
    }
    // Children block is gated by admission.hasChildren (read-only).
    // When that flips to false (or null), wipe any orphan child rows so
    // re-toggling later starts fresh.
    if (admission.hasChildren !== true) {
      await this.prisma.visaChild.deleteMany({
        where: { visaApplicationId: visa.id },
      });
    }
    // Partner block is gated by admission.maritalStatus. If the student
    // is no longer in a partnered status, drop the singleton row so a
    // future re-partnering starts fresh.
    if (
      admission.maritalStatus !== 'MARRIED' &&
      admission.maritalStatus !== 'DE_FACTO'
    ) {
      await this.prisma.visaPartner.deleteMany({
        where: { visaApplicationId: visa.id },
      });
    }

    return {
      visaApplication: this.decryptVisaRow(visa as Record<string, unknown>),
      readonly: this.buildReadonlySnapshot(contact, admission as Record<string, unknown>, topChoice),
      otherCitizenships: await this.loadOtherCitizenships(visa.id),
      tbRiskCountries: await this.loadTbRiskCountries(visa.id),
      educationEntries: await this.loadEducationEntries(admission.id),
      educationSupplements: await this.loadEducationSupplements(visa.id),
      employmentEntries: await this.loadEmploymentEntries(visa.id),
      unemploymentEntries: await this.loadUnemploymentEntries(visa.id),
      partner: await this.loadPartner(visa.id),
      formerPartners: await this.loadFormerPartners(visa.id),
      children: await this.loadChildren(visa.id),
      parents: await this.loadParents(visa.id),
      siblings: await this.loadSiblings(visa.id),
      nzContacts: await this.loadNzContacts(visa.id),
    };
  }

  // ── Other citizenships CRUD (PR-VISA4 fix) ───────────────────────────
  // Live-API pattern matching admission.education-entries: each add /
  // update / delete is its own endpoint, the parent visa row is fetched
  // once via the standard get/getOrCreate.

  async addOtherCitizenship(
    userId: string,
    body: { country?: string; holdsPassport?: boolean },
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    // Rows are created empty and filled in via subsequent PATCHes — same
    // shape as the admission "draft entry" UX. country is not required at
    // create-time; the Step 4 frontend save-validator enforces non-empty
    // country before the Save and continue button accepts the step.
    // holdsPassport defaults to false when omitted (the DB column is NOT
    // NULL); the frontend Y/N pill toggles it on first click.
    if (
      body?.holdsPassport !== undefined &&
      typeof body.holdsPassport !== 'boolean'
    ) {
      throw new BadRequestException('holdsPassport must be a boolean');
    }
    // PR-COUNTRY-CONSOLIDATE: ISO-code validation for the optional
    // create-time country. Empty/missing stays allowed for the draft state.
    assertCountryCodeOrEmpty(body?.country, 'country');
    // sortOrder = current max + 1 — append to the end, same shape as
    // admission's education entries.
    const last = await this.prisma.visaOtherCitizenship.findFirst({
      where: { visaApplicationId: visa.id },
      orderBy: { sortOrder: 'desc' },
    });
    const sortOrder = (last?.sortOrder ?? -1) + 1;

    const row = await this.prisma.visaOtherCitizenship.create({
      data: {
        visaApplicationId: visa.id,
        country: body?.country?.trim() ?? '',
        holdsPassport: body?.holdsPassport ?? false,
        sortOrder,
      },
    });
    return {
      id: row.id,
      country: row.country,
      holdsPassport: row.holdsPassport,
      sortOrder: row.sortOrder,
    };
  }

  async updateOtherCitizenship(
    userId: string,
    citizenshipId: string,
    body: { country?: string; holdsPassport?: boolean },
  ) {
    await this.assertCitizenshipOwnership(citizenshipId, userId);
    // PR-COUNTRY-CONSOLIDATE: update may set country (must be valid),
    // but the existing "must not be empty" guard runs first so an empty
    // string still raises a clearer 400 than the ISO-code message.
    assertCountryCodeOrEmpty(body?.country, 'country');
    const data: Record<string, unknown> = {};
    if (body.country !== undefined) {
      if (!body.country.trim()) {
        throw new BadRequestException('country must not be empty');
      }
      data.country = body.country.trim();
    }
    if (body.holdsPassport !== undefined) {
      if (typeof body.holdsPassport !== 'boolean') {
        throw new BadRequestException('holdsPassport must be a boolean');
      }
      data.holdsPassport = body.holdsPassport;
    }
    const row = await this.prisma.visaOtherCitizenship.update({
      where: { id: citizenshipId },
      data,
    });
    return {
      id: row.id,
      country: row.country,
      holdsPassport: row.holdsPassport,
      sortOrder: row.sortOrder,
    };
  }

  async deleteOtherCitizenship(userId: string, citizenshipId: string) {
    await this.assertCitizenshipOwnership(citizenshipId, userId);
    await this.prisma.visaOtherCitizenship.delete({
      where: { id: citizenshipId },
    });
  }

  // ── TB-risk countries CRUD (PR-VISA5) ────────────────────────────────
  // Same draft-then-fill pattern as the citizenship rows from PR-VISA4:
  // empty rows allowed on create, the Step 5 save validator on the
  // frontend enforces non-empty country + positive duration before the
  // student can advance.

  async addTbRiskCountry(
    userId: string,
    body: { country?: string; totalDurationDays?: number },
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    if (
      body?.totalDurationDays !== undefined &&
      (typeof body.totalDurationDays !== 'number' ||
        !Number.isInteger(body.totalDurationDays) ||
        body.totalDurationDays < 0)
    ) {
      throw new BadRequestException(
        'totalDurationDays must be a non-negative integer',
      );
    }
    // PR-COUNTRY-CONSOLIDATE: ISO-code validation. Empty allowed for draft.
    assertCountryCodeOrEmpty(body?.country, 'country');
    const last = await this.prisma.visaTbRiskCountry.findFirst({
      where: { visaApplicationId: visa.id },
      orderBy: { sortOrder: 'desc' },
    });
    const sortOrder = (last?.sortOrder ?? -1) + 1;

    const row = await this.prisma.visaTbRiskCountry.create({
      data: {
        visaApplicationId: visa.id,
        country: body?.country?.trim() ?? '',
        totalDurationDays: body?.totalDurationDays ?? 0,
        sortOrder,
      },
    });
    return {
      id: row.id,
      country: row.country,
      totalDurationDays: row.totalDurationDays,
      sortOrder: row.sortOrder,
    };
  }

  async updateTbRiskCountry(
    userId: string,
    rowId: string,
    body: { country?: string; totalDurationDays?: number },
  ) {
    await this.assertTbRiskCountryOwnership(rowId, userId);
    // PR-COUNTRY-CONSOLIDATE: ISO-code validation. Empty allowed for draft.
    assertCountryCodeOrEmpty(body?.country, 'country');
    const data: Record<string, unknown> = {};
    if (body.country !== undefined) {
      data.country = body.country.trim();
    }
    if (body.totalDurationDays !== undefined) {
      if (
        typeof body.totalDurationDays !== 'number' ||
        !Number.isInteger(body.totalDurationDays) ||
        body.totalDurationDays < 0
      ) {
        throw new BadRequestException(
          'totalDurationDays must be a non-negative integer',
        );
      }
      data.totalDurationDays = body.totalDurationDays;
    }
    const row = await this.prisma.visaTbRiskCountry.update({
      where: { id: rowId },
      data,
    });
    return {
      id: row.id,
      country: row.country,
      totalDurationDays: row.totalDurationDays,
      sortOrder: row.sortOrder,
    };
  }

  async deleteTbRiskCountry(userId: string, rowId: string) {
    await this.assertTbRiskCountryOwnership(rowId, userId);
    await this.prisma.visaTbRiskCountry.delete({
      where: { id: rowId },
    });
  }

  // ── Education supplements (PR-VISA6) ─────────────────────────────────
  // One supplement row per admission_education_entry, holding only the
  // INZ Section-6 extras (start/end month, institution state/town,
  // qualificationAwarded). PATCH is upsert — creates the row on first
  // call, updates thereafter. Per-field validation keeps month in 1..12
  // and qualificationAwarded a strict boolean.

  async upsertEducationSupplement(
    userId: string,
    educationEntryId: string,
    body: {
      startMonth?: number | null;
      endMonth?: number | null;
      institutionState?: string | null;
      institutionTown?: string | null;
      qualificationAwarded?: boolean | null;
    },
  ) {
    const { visaApplicationId } = await this.resolveEducationEntryForUser(
      educationEntryId,
      userId,
    );

    const data: Record<string, unknown> = {};
    if (body.startMonth !== undefined) {
      if (body.startMonth === null) {
        data.startMonth = null;
      } else if (
        !Number.isInteger(body.startMonth) ||
        body.startMonth < 1 ||
        body.startMonth > 12
      ) {
        throw new BadRequestException('startMonth must be an integer between 1 and 12');
      } else {
        data.startMonth = body.startMonth;
      }
    }
    if (body.endMonth !== undefined) {
      if (body.endMonth === null) {
        data.endMonth = null;
      } else if (
        !Number.isInteger(body.endMonth) ||
        body.endMonth < 1 ||
        body.endMonth > 12
      ) {
        throw new BadRequestException('endMonth must be an integer between 1 and 12');
      } else {
        data.endMonth = body.endMonth;
      }
    }
    if (body.institutionState !== undefined) {
      data.institutionState = body.institutionState === null ? null : String(body.institutionState).trim();
    }
    if (body.institutionTown !== undefined) {
      data.institutionTown = body.institutionTown === null ? null : String(body.institutionTown).trim();
    }
    if (body.qualificationAwarded !== undefined) {
      if (body.qualificationAwarded === null) {
        data.qualificationAwarded = null;
      } else if (typeof body.qualificationAwarded !== 'boolean') {
        throw new BadRequestException('qualificationAwarded must be a boolean');
      } else {
        data.qualificationAwarded = body.qualificationAwarded;
      }
    }

    const row = await this.prisma.visaEducationSupplement.upsert({
      where:  { educationEntryId },
      create: { visaApplicationId, educationEntryId, ...data },
      update: data,
    });

    return {
      id: row.id,
      educationEntryId: row.educationEntryId,
      startMonth: row.startMonth,
      endMonth: row.endMonth,
      institutionState: row.institutionState,
      institutionTown: row.institutionTown,
      qualificationAwarded: row.qualificationAwarded,
    };
  }

  // ── Employment entries CRUD (PR-VISA7) ───────────────────────────────
  // Same draft-then-fill pattern as the citizenship / TB tables: empty
  // rows allowed on create, the Step 7 save validator on the frontend
  // enforces required fields. duties is the only PII column; encrypted
  // via CryptoService on every write, decrypted on every read in the
  // loader above.

  private serializeEmploymentEntry(r: {
    id: string; entryKind: string;
    startDate: Date | null; endDate: Date | null;
    roleTitle: string | null;
    dutiesEncrypted: Buffer | Uint8Array | null;
    countryOfWork: string | null; stateOfWork: string | null;
    supervisorName: string | null;
    organisationField: string | null; organisationCountry: string | null; organisationState: string | null;
    employerName: string | null;
    employerStreet: string | null; employerSuburb: string | null; employerTownCity: string | null;
    employerSubregion: string | null; employerRegion: string | null; employerPostcode: string | null;
    employerPhone: string | null; employerEmail: string | null;
    sortOrder: number;
  }) {
    return {
      id: r.id,
      entryKind: r.entryKind,
      startDate: r.startDate,
      endDate: r.endDate,
      roleTitle: r.roleTitle,
      duties: r.dutiesEncrypted ? this.crypto.decrypt(Buffer.from(r.dutiesEncrypted)) : null,
      countryOfWork: r.countryOfWork,
      stateOfWork: r.stateOfWork,
      supervisorName: r.supervisorName,
      organisationField: r.organisationField,
      organisationCountry: r.organisationCountry,
      organisationState: r.organisationState,
      employerName: r.employerName,
      employerStreet: r.employerStreet,
      employerSuburb: r.employerSuburb,
      employerTownCity: r.employerTownCity,
      employerSubregion: r.employerSubregion,
      employerRegion: r.employerRegion,
      employerPostcode: r.employerPostcode,
      employerPhone: r.employerPhone,
      employerEmail: r.employerEmail,
      sortOrder: r.sortOrder,
    };
  }

  // Shared coercion for the employment editable columns. Returns a Prisma
  // data object with `dutiesEncrypted` already encrypted when duties is
  // provided. Throws BadRequest for invalid shapes.
  private buildEmploymentData(body: Record<string, unknown>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    const passText = (k: string) => {
      if (body[k] === undefined) return;
      data[k] = body[k] === null ? null : String(body[k]).trim();
    };
    if (body.startDate !== undefined) {
      data.startDate = body.startDate === null ? null : new Date(body.startDate as string);
      if (data.startDate instanceof Date && isNaN(data.startDate.getTime())) {
        throw new BadRequestException('startDate must be a valid ISO date');
      }
    }
    if (body.endDate !== undefined) {
      data.endDate = body.endDate === null ? null : new Date(body.endDate as string);
      if (data.endDate instanceof Date && isNaN(data.endDate.getTime())) {
        throw new BadRequestException('endDate must be a valid ISO date');
      }
    }
    passText('roleTitle');
    if (body.duties !== undefined) {
      if (body.duties === null || body.duties === '') {
        data.dutiesEncrypted = null;
      } else if (typeof body.duties === 'string') {
        data.dutiesEncrypted = this.crypto.encrypt(body.duties);
      } else {
        throw new BadRequestException('duties must be a string');
      }
    }
    // PR-COUNTRY-CONSOLIDATE: ISO-code validation on the two country
    // fields here. Validated from raw body so we surface a 400 before
    // anything writes — passText() trims and passes through, so by the
    // time data.* is set we've already accepted the value.
    assertCountryCodeOrEmpty(body.countryOfWork, 'countryOfWork');
    assertCountryCodeOrEmpty(body.organisationCountry, 'organisationCountry');
    passText('countryOfWork');
    passText('stateOfWork');
    passText('supervisorName');
    passText('organisationField');
    passText('organisationCountry');
    passText('organisationState');
    passText('employerName');
    passText('employerStreet');
    passText('employerSuburb');
    passText('employerTownCity');
    passText('employerSubregion');
    passText('employerRegion');
    passText('employerPostcode');
    passText('employerPhone');
    passText('employerEmail');
    return data;
  }

  async addEmploymentEntry(
    userId: string,
    body: { entryKind: string; [k: string]: unknown },
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    if (!body?.entryKind || !VALID_EMPLOYMENT_KINDS.has(body.entryKind)) {
      throw new BadRequestException(
        'entryKind must be one of CURRENT, PREVIOUS',
      );
    }
    // CURRENT is meant to be singleton — refuse to create a second.
    if (body.entryKind === 'CURRENT') {
      const existing = await this.prisma.visaEmploymentEntry.findFirst({
        where: { visaApplicationId: visa.id, entryKind: 'CURRENT' },
      });
      if (existing) {
        return this.serializeEmploymentEntry(existing);
      }
    }
    const last = await this.prisma.visaEmploymentEntry.findFirst({
      where: { visaApplicationId: visa.id },
      orderBy: { sortOrder: 'desc' },
    });
    const sortOrder = (last?.sortOrder ?? -1) + 1;
    const data = this.buildEmploymentData(body);
    const row = await this.prisma.visaEmploymentEntry.create({
      data: {
        visaApplicationId: visa.id,
        entryKind: body.entryKind,
        sortOrder,
        ...data,
      },
    });
    return this.serializeEmploymentEntry(row);
  }

  async updateEmploymentEntry(
    userId: string,
    rowId: string,
    body: Record<string, unknown>,
  ) {
    await this.assertEmploymentEntryOwnership(rowId, userId);
    const data = this.buildEmploymentData(body);
    const row = await this.prisma.visaEmploymentEntry.update({
      where: { id: rowId },
      data,
    });
    return this.serializeEmploymentEntry(row);
  }

  async deleteEmploymentEntry(userId: string, rowId: string) {
    await this.assertEmploymentEntryOwnership(rowId, userId);
    await this.prisma.visaEmploymentEntry.delete({ where: { id: rowId } });
  }

  // ── Unemployment entries CRUD (PR-VISA7) ─────────────────────────────

  private serializeUnemploymentEntry(r: {
    id: string;
    startDate: Date | null;
    endDate: Date | null;
    activityEncrypted: Buffer | Uint8Array | null;
    financialSupportEncrypted: Buffer | Uint8Array | null;
    sortOrder: number;
  }) {
    return {
      id: r.id,
      startDate: r.startDate,
      endDate: r.endDate,
      activity: r.activityEncrypted
        ? this.crypto.decrypt(Buffer.from(r.activityEncrypted))
        : null,
      financialSupport: r.financialSupportEncrypted
        ? this.crypto.decrypt(Buffer.from(r.financialSupportEncrypted))
        : null,
      sortOrder: r.sortOrder,
    };
  }

  private buildUnemploymentData(body: Record<string, unknown>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (body.startDate !== undefined) {
      data.startDate = body.startDate === null ? null : new Date(body.startDate as string);
      if (data.startDate instanceof Date && isNaN(data.startDate.getTime())) {
        throw new BadRequestException('startDate must be a valid ISO date');
      }
    }
    if (body.endDate !== undefined) {
      data.endDate = body.endDate === null ? null : new Date(body.endDate as string);
      if (data.endDate instanceof Date && isNaN(data.endDate.getTime())) {
        throw new BadRequestException('endDate must be a valid ISO date');
      }
    }
    if (body.activity !== undefined) {
      if (body.activity === null || body.activity === '') {
        data.activityEncrypted = null;
      } else if (typeof body.activity === 'string') {
        data.activityEncrypted = this.crypto.encrypt(body.activity);
      } else {
        throw new BadRequestException('activity must be a string');
      }
    }
    if (body.financialSupport !== undefined) {
      if (body.financialSupport === null || body.financialSupport === '') {
        data.financialSupportEncrypted = null;
      } else if (typeof body.financialSupport === 'string') {
        data.financialSupportEncrypted = this.crypto.encrypt(body.financialSupport);
      } else {
        throw new BadRequestException('financialSupport must be a string');
      }
    }
    return data;
  }

  async addUnemploymentEntry(userId: string, body: Record<string, unknown>) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    const last = await this.prisma.visaUnemploymentEntry.findFirst({
      where: { visaApplicationId: visa.id },
      orderBy: { sortOrder: 'desc' },
    });
    const sortOrder = (last?.sortOrder ?? -1) + 1;
    const data = this.buildUnemploymentData(body);
    const row = await this.prisma.visaUnemploymentEntry.create({
      data: { visaApplicationId: visa.id, sortOrder, ...data },
    });
    return this.serializeUnemploymentEntry(row);
  }

  async updateUnemploymentEntry(
    userId: string,
    rowId: string,
    body: Record<string, unknown>,
  ) {
    await this.assertUnemploymentEntryOwnership(rowId, userId);
    const data = this.buildUnemploymentData(body);
    const row = await this.prisma.visaUnemploymentEntry.update({
      where: { id: rowId },
      data,
    });
    return this.serializeUnemploymentEntry(row);
  }

  async deleteUnemploymentEntry(userId: string, rowId: string) {
    await this.assertUnemploymentEntryOwnership(rowId, userId);
    await this.prisma.visaUnemploymentEntry.delete({ where: { id: rowId } });
  }

  // ── Step 8 — Relationships (PR-VISA8) ────────────────────────────────
  // Every third-party row goes through the same encryption pattern:
  // givenName / middleNames / surname are stored encrypted; everything
  // else plaintext (or, for VisaPartner.passportNumber and
  // VisaNzContact.phone + street, additional encrypted columns). The
  // helpers below DRY the encrypt-on-write / decrypt-on-read flow so
  // each table's CRUD body stays short.

  private encryptOrNull(value: unknown): Buffer | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') {
      throw new BadRequestException('Encrypted field must be a string');
    }
    return this.crypto.encrypt(value);
  }
  private decryptOrNull(value: Buffer | Uint8Array | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return this.crypto.decrypt(Buffer.isBuffer(value) ? value : Buffer.from(value));
  }

  // Generic ownership check by visa application — looks up the row,
  // resolves its visa app's admission chain to the caller's userId.
  // We use a small dispatcher rather than 6 near-identical methods.
  private async assertRelationshipOwnership(
    table: 'formerPartner' | 'child' | 'parent' | 'sibling' | 'nzContact',
    rowId: string,
    userId: string,
  ) {
    const include = {
      visaApplication: {
        include: { admissionApplication: { include: { contact: true } } },
      },
    } as const;
    let row;
    switch (table) {
      case 'formerPartner':
        row = await this.prisma.visaFormerPartner.findUnique({ where: { id: rowId }, include });
        break;
      case 'child':
        row = await this.prisma.visaChild.findUnique({ where: { id: rowId }, include });
        break;
      case 'parent':
        row = await this.prisma.visaParent.findUnique({ where: { id: rowId }, include });
        break;
      case 'sibling':
        row = await this.prisma.visaSibling.findUnique({ where: { id: rowId }, include });
        break;
      case 'nzContact':
        row = await this.prisma.visaNzContact.findUnique({ where: { id: rowId }, include });
        break;
    }
    if (!row) throw new NotFoundException(`${table} row not found`);
    if (row.visaApplication.admissionApplication.contact.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return row;
  }

  // ── Partner (singleton, upsert) ─────────────────────────────────────

  private serializePartner(r: any) {
    if (!r) return null;
    return {
      id: r.id,
      relationshipToApplicant: r.relationshipToApplicant,
      givenName:    this.decryptOrNull(r.givenNameEncrypted),
      middleNames:  this.decryptOrNull(r.middleNamesEncrypted),
      surname:      this.decryptOrNull(r.surnameEncrypted),
      gender: r.gender,
      dateOfBirth: r.dateOfBirth,
      relationshipStatus: r.relationshipStatus,
      countryOfBirth: r.countryOfBirth,
      stateOfBirth: r.stateOfBirth,
      cityOfBirth: r.cityOfBirth,
      nationality: r.nationality,
      countryOfResidence: r.countryOfResidence,
      occupation: r.occupation,
      holdsPassport: r.holdsPassport,
      passportNumber: this.decryptOrNull(r.passportNumberEncrypted),
      passportCountryOfIssue: r.passportCountryOfIssue,
      passportIssueDate: r.passportIssueDate,
      passportExpiryDate: r.passportExpiryDate,
    };
  }

  private buildPartnerData(body: Record<string, unknown>): Record<string, unknown> {
    // TODO PR-COUNTRY-ENCRYPTED: VisaPartner stores country fields
    // (countryOfBirth, nationality, countryOfResidence,
    // passportCountryOfIssue) as encrypted Bytes columns. Migrating them
    // needs a decrypt → map → re-encrypt pass and a separate audit log;
    // tracked as the PR-COUNTRY-ENCRYPTED follow-up. Plaintext relations
    // (formerPartners, children, parents, siblings) are validated below.
    const data: Record<string, unknown> = {};
    const passText = (k: string) => {
      if (body[k] === undefined) return;
      data[k] = body[k] === null ? null : String(body[k]).trim();
    };
    const passDate = (k: string) => {
      if (body[k] === undefined) return;
      if (body[k] === null) { data[k] = null; return; }
      const d = new Date(body[k] as string);
      if (isNaN(d.getTime())) throw new BadRequestException(`${k} must be a valid ISO date`);
      data[k] = d;
    };
    const passBool = (k: string) => {
      if (body[k] === undefined) return;
      if (body[k] === null) { data[k] = null; return; }
      if (typeof body[k] !== 'boolean') throw new BadRequestException(`${k} must be a boolean`);
      data[k] = body[k];
    };
    passText('relationshipToApplicant');
    if (body.givenName !== undefined)    data.givenNameEncrypted    = this.encryptOrNull(body.givenName);
    if (body.middleNames !== undefined)  data.middleNamesEncrypted  = this.encryptOrNull(body.middleNames);
    if (body.surname !== undefined)      data.surnameEncrypted      = this.encryptOrNull(body.surname);
    passText('gender');
    passDate('dateOfBirth');
    passText('relationshipStatus');
    passText('countryOfBirth');
    passText('stateOfBirth');
    passText('cityOfBirth');
    passText('nationality');
    passText('countryOfResidence');
    passText('occupation');
    passBool('holdsPassport');
    if (body.passportNumber !== undefined) data.passportNumberEncrypted = this.encryptOrNull(body.passportNumber);
    passText('passportCountryOfIssue');
    passDate('passportIssueDate');
    passDate('passportExpiryDate');
    return data;
  }

  private async loadPartner(visaApplicationId: string) {
    const r = await this.prisma.visaPartner.findUnique({ where: { visaApplicationId } });
    return this.serializePartner(r);
  }

  async upsertPartner(userId: string, body: Record<string, unknown>) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) throw new NotFoundException('Visa application not found.');
    const data = this.buildPartnerData(body);
    const row = await this.prisma.visaPartner.upsert({
      where:  { visaApplicationId: visa.id },
      create: { visaApplicationId: visa.id, ...data },
      update: data,
    });
    return this.serializePartner(row);
  }

  // ── Former partner / child / parent / sibling / NZ contact CRUD ──────
  // Six near-identical method families. Each uses its own data builder
  // (to keep the encrypted-field set explicit) but the shape is uniform.

  private serializeFormerPartner(r: any) {
    return {
      id: r.id,
      givenName:   this.decryptOrNull(r.givenNameEncrypted),
      middleNames: this.decryptOrNull(r.middleNamesEncrypted),
      surname:     this.decryptOrNull(r.surnameEncrypted),
      gender: r.gender,
      dateOfBirth: r.dateOfBirth,
      relationshipStatus: r.relationshipStatus,
      countryOfBirth: r.countryOfBirth,
      nationality: r.nationality,
      sortOrder: r.sortOrder,
    };
  }
  private buildFormerPartnerData(body: Record<string, unknown>): Record<string, unknown> {
    // PR-COUNTRY-CONSOLIDATE: ISO-code validation for the plaintext
    // country fields on visa_former_partners.
    assertCountryCodeOrEmpty(body.countryOfBirth, 'countryOfBirth');
    assertCountryCodeOrEmpty(body.nationality, 'nationality');
    const data: Record<string, unknown> = {};
    if (body.givenName !== undefined)    data.givenNameEncrypted    = this.encryptOrNull(body.givenName);
    if (body.middleNames !== undefined)  data.middleNamesEncrypted  = this.encryptOrNull(body.middleNames);
    if (body.surname !== undefined)      data.surnameEncrypted      = this.encryptOrNull(body.surname);
    if (body.gender !== undefined)       data.gender             = body.gender === null ? null : String(body.gender).trim();
    if (body.dateOfBirth !== undefined) {
      if (body.dateOfBirth === null) data.dateOfBirth = null;
      else {
        const d = new Date(body.dateOfBirth as string);
        if (isNaN(d.getTime())) throw new BadRequestException('dateOfBirth must be a valid ISO date');
        data.dateOfBirth = d;
      }
    }
    if (body.relationshipStatus !== undefined) data.relationshipStatus = body.relationshipStatus === null ? null : String(body.relationshipStatus).trim();
    if (body.countryOfBirth !== undefined)     data.countryOfBirth     = body.countryOfBirth === null ? null : String(body.countryOfBirth).trim();
    if (body.nationality !== undefined)        data.nationality        = body.nationality === null ? null : String(body.nationality).trim();
    return data;
  }

  private serializeChild(r: any) {
    return {
      id: r.id,
      givenName:   this.decryptOrNull(r.givenNameEncrypted),
      middleNames: this.decryptOrNull(r.middleNamesEncrypted),
      surname:     this.decryptOrNull(r.surnameEncrypted),
      gender: r.gender,
      dateOfBirth: r.dateOfBirth,
      countryOfBirth: r.countryOfBirth,
      nationality: r.nationality,
      relationshipToApplicant: r.relationshipToApplicant,
      livesWithApplicant: r.livesWithApplicant,
      sortOrder: r.sortOrder,
    };
  }
  private buildChildData(body: Record<string, unknown>): Record<string, unknown> {
    // PR-COUNTRY-CONSOLIDATE: ISO-code validation for visa_children.
    assertCountryCodeOrEmpty(body.countryOfBirth, 'countryOfBirth');
    assertCountryCodeOrEmpty(body.nationality, 'nationality');
    const data: Record<string, unknown> = {};
    if (body.givenName !== undefined)    data.givenNameEncrypted    = this.encryptOrNull(body.givenName);
    if (body.middleNames !== undefined)  data.middleNamesEncrypted  = this.encryptOrNull(body.middleNames);
    if (body.surname !== undefined)      data.surnameEncrypted      = this.encryptOrNull(body.surname);
    if (body.gender !== undefined)       data.gender             = body.gender === null ? null : String(body.gender).trim();
    if (body.dateOfBirth !== undefined) {
      if (body.dateOfBirth === null) data.dateOfBirth = null;
      else {
        const d = new Date(body.dateOfBirth as string);
        if (isNaN(d.getTime())) throw new BadRequestException('dateOfBirth must be a valid ISO date');
        data.dateOfBirth = d;
      }
    }
    if (body.countryOfBirth !== undefined)         data.countryOfBirth         = body.countryOfBirth === null ? null : String(body.countryOfBirth).trim();
    if (body.nationality !== undefined)            data.nationality            = body.nationality === null ? null : String(body.nationality).trim();
    if (body.relationshipToApplicant !== undefined) data.relationshipToApplicant = body.relationshipToApplicant === null ? null : String(body.relationshipToApplicant).trim();
    if (body.livesWithApplicant !== undefined) {
      if (body.livesWithApplicant === null) data.livesWithApplicant = null;
      else if (typeof body.livesWithApplicant !== 'boolean') throw new BadRequestException('livesWithApplicant must be a boolean');
      else data.livesWithApplicant = body.livesWithApplicant;
    }
    return data;
  }

  private serializeParent(r: any) {
    return {
      id: r.id,
      givenName:   this.decryptOrNull(r.givenNameEncrypted),
      middleNames: this.decryptOrNull(r.middleNamesEncrypted),
      surname:     this.decryptOrNull(r.surnameEncrypted),
      relationshipToApplicant: r.relationshipToApplicant,
      isDeceased: r.isDeceased,
      gender: r.gender,
      dateOfBirth: r.dateOfBirth,
      dateOfBirthUnknown: r.dateOfBirthUnknown,
      relationshipStatus: r.relationshipStatus,
      countryOfBirth: r.countryOfBirth,
      citizenship: r.citizenship,
      countryOfResidence: r.countryOfResidence,
      occupation: r.occupation,
      sortOrder: r.sortOrder,
    };
  }
  private buildPersonWithDobData(body: Record<string, unknown>, extraTextKeys: string[]): Record<string, unknown> {
    // Shared builder for VisaParent / VisaSibling — same shape minus a
    // couple of fields each.
    // PR-COUNTRY-CONSOLIDATE: ISO-code validation for the three
    // plaintext country fields on visa_parents / visa_siblings.
    assertCountryCodeOrEmpty(body.countryOfBirth, 'countryOfBirth');
    assertCountryCodeOrEmpty(body.citizenship, 'citizenship');
    assertCountryCodeOrEmpty(body.countryOfResidence, 'countryOfResidence');
    const data: Record<string, unknown> = {};
    if (body.givenName !== undefined)    data.givenNameEncrypted    = this.encryptOrNull(body.givenName);
    if (body.middleNames !== undefined)  data.middleNamesEncrypted  = this.encryptOrNull(body.middleNames);
    if (body.surname !== undefined)      data.surnameEncrypted      = this.encryptOrNull(body.surname);
    const passText = (k: string) => {
      if (body[k] === undefined) return;
      data[k] = body[k] === null ? null : String(body[k]).trim();
    };
    const passBool = (k: string) => {
      if (body[k] === undefined) return;
      if (body[k] === null) { data[k] = null; return; }
      if (typeof body[k] !== 'boolean') throw new BadRequestException(`${k} must be a boolean`);
      data[k] = body[k];
    };
    if (body.dateOfBirth !== undefined) {
      if (body.dateOfBirth === null) data.dateOfBirth = null;
      else {
        const d = new Date(body.dateOfBirth as string);
        if (isNaN(d.getTime())) throw new BadRequestException('dateOfBirth must be a valid ISO date');
        data.dateOfBirth = d;
      }
    }
    passBool('dateOfBirthUnknown');
    passText('relationshipToApplicant');
    passText('gender');
    passText('relationshipStatus');
    passText('countryOfBirth');
    passText('citizenship');
    passText('countryOfResidence');
    passText('occupation');
    for (const k of extraTextKeys) passText(k);
    if (body.isDeceased !== undefined) {
      if (body.isDeceased === null) data.isDeceased = null;
      else if (typeof body.isDeceased !== 'boolean') throw new BadRequestException('isDeceased must be a boolean');
      else data.isDeceased = body.isDeceased;
    }
    return data;
  }

  private serializeSibling(r: any) {
    return {
      id: r.id,
      givenName:   this.decryptOrNull(r.givenNameEncrypted),
      middleNames: this.decryptOrNull(r.middleNamesEncrypted),
      surname:     this.decryptOrNull(r.surnameEncrypted),
      relationshipToApplicant: r.relationshipToApplicant,
      gender: r.gender,
      dateOfBirth: r.dateOfBirth,
      dateOfBirthUnknown: r.dateOfBirthUnknown,
      relationshipStatus: r.relationshipStatus,
      countryOfBirth: r.countryOfBirth,
      citizenship: r.citizenship,
      countryOfResidence: r.countryOfResidence,
      occupation: r.occupation,
      sortOrder: r.sortOrder,
    };
  }

  private serializeNzContact(r: any) {
    return {
      id: r.id,
      givenName:   this.decryptOrNull(r.givenNameEncrypted),
      middleNames: this.decryptOrNull(r.middleNamesEncrypted),
      surname:     this.decryptOrNull(r.surnameEncrypted),
      relationshipToApplicant: r.relationshipToApplicant,
      phone:       this.decryptOrNull(r.phoneEncrypted),
      email: r.email,
      street:      this.decryptOrNull(r.streetEncrypted),
      suburb: r.suburb,
      townCity: r.townCity,
      region: r.region,
      postcode: r.postcode,
      sortOrder: r.sortOrder,
    };
  }
  private buildNzContactData(body: Record<string, unknown>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (body.givenName !== undefined)    data.givenNameEncrypted    = this.encryptOrNull(body.givenName);
    if (body.middleNames !== undefined)  data.middleNamesEncrypted  = this.encryptOrNull(body.middleNames);
    if (body.surname !== undefined)      data.surnameEncrypted      = this.encryptOrNull(body.surname);
    if (body.phone !== undefined)        data.phoneEncrypted        = this.encryptOrNull(body.phone);
    if (body.street !== undefined)       data.streetEncrypted       = this.encryptOrNull(body.street);
    const passText = (k: string) => {
      if (body[k] === undefined) return;
      data[k] = body[k] === null ? null : String(body[k]).trim();
    };
    passText('relationshipToApplicant');
    passText('email');
    passText('suburb');
    passText('townCity');
    passText('region');
    passText('postcode');
    return data;
  }

  // Loaders for all six tables.
  private async loadFormerPartners(visaApplicationId: string) {
    const rows = await this.prisma.visaFormerPartner.findMany({
      where: { visaApplicationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => this.serializeFormerPartner(r));
  }
  private async loadChildren(visaApplicationId: string) {
    const rows = await this.prisma.visaChild.findMany({
      where: { visaApplicationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => this.serializeChild(r));
  }
  private async loadParents(visaApplicationId: string) {
    const rows = await this.prisma.visaParent.findMany({
      where: { visaApplicationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => this.serializeParent(r));
  }
  private async loadSiblings(visaApplicationId: string) {
    const rows = await this.prisma.visaSibling.findMany({
      where: { visaApplicationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => this.serializeSibling(r));
  }
  private async loadNzContacts(visaApplicationId: string) {
    const rows = await this.prisma.visaNzContact.findMany({
      where: { visaApplicationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => this.serializeNzContact(r));
  }

  // Shared next-sortOrder helper.
  private async nextRelationshipSortOrder(
    table: 'formerPartner' | 'child' | 'parent' | 'sibling' | 'nzContact',
    visaApplicationId: string,
  ): Promise<number> {
    let last: { sortOrder: number } | null = null;
    const where = { visaApplicationId };
    const orderBy = { sortOrder: 'desc' as const };
    switch (table) {
      case 'formerPartner': last = await this.prisma.visaFormerPartner.findFirst({ where, orderBy }); break;
      case 'child':         last = await this.prisma.visaChild.findFirst({ where, orderBy }); break;
      case 'parent':        last = await this.prisma.visaParent.findFirst({ where, orderBy }); break;
      case 'sibling':       last = await this.prisma.visaSibling.findFirst({ where, orderBy }); break;
      case 'nzContact':     last = await this.prisma.visaNzContact.findFirst({ where, orderBy }); break;
    }
    return (last?.sortOrder ?? -1) + 1;
  }

  // Resolves the caller's visaApplicationId for add operations on a
  // child table.
  private async resolveVisaApplicationIdForAdd(userId: string): Promise<string> {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    return visa.id;
  }

  // ── Former partner CRUD ─────────────────────────────────────────────
  async addFormerPartner(userId: string, body: Record<string, unknown>) {
    const visaApplicationId = await this.resolveVisaApplicationIdForAdd(userId);
    const sortOrder = await this.nextRelationshipSortOrder('formerPartner', visaApplicationId);
    const data = this.buildFormerPartnerData(body);
    const row = await this.prisma.visaFormerPartner.create({
      data: { visaApplicationId, sortOrder, ...data },
    });
    return this.serializeFormerPartner(row);
  }
  async updateFormerPartner(userId: string, rowId: string, body: Record<string, unknown>) {
    await this.assertRelationshipOwnership('formerPartner', rowId, userId);
    const data = this.buildFormerPartnerData(body);
    const row = await this.prisma.visaFormerPartner.update({ where: { id: rowId }, data });
    return this.serializeFormerPartner(row);
  }
  async deleteFormerPartner(userId: string, rowId: string) {
    await this.assertRelationshipOwnership('formerPartner', rowId, userId);
    await this.prisma.visaFormerPartner.delete({ where: { id: rowId } });
  }

  // ── Child CRUD ──────────────────────────────────────────────────────
  async addChild(userId: string, body: Record<string, unknown>) {
    const visaApplicationId = await this.resolveVisaApplicationIdForAdd(userId);
    const sortOrder = await this.nextRelationshipSortOrder('child', visaApplicationId);
    const data = this.buildChildData(body);
    const row = await this.prisma.visaChild.create({
      data: { visaApplicationId, sortOrder, ...data },
    });
    return this.serializeChild(row);
  }
  async updateChild(userId: string, rowId: string, body: Record<string, unknown>) {
    await this.assertRelationshipOwnership('child', rowId, userId);
    const data = this.buildChildData(body);
    const row = await this.prisma.visaChild.update({ where: { id: rowId }, data });
    return this.serializeChild(row);
  }
  async deleteChild(userId: string, rowId: string) {
    await this.assertRelationshipOwnership('child', rowId, userId);
    await this.prisma.visaChild.delete({ where: { id: rowId } });
  }

  // ── Parent CRUD ─────────────────────────────────────────────────────
  async addParent(userId: string, body: Record<string, unknown>) {
    const visaApplicationId = await this.resolveVisaApplicationIdForAdd(userId);
    const sortOrder = await this.nextRelationshipSortOrder('parent', visaApplicationId);
    const data = this.buildPersonWithDobData(body, ['isDeceased']);
    const row = await this.prisma.visaParent.create({
      data: { visaApplicationId, sortOrder, ...data },
    });
    return this.serializeParent(row);
  }
  async updateParent(userId: string, rowId: string, body: Record<string, unknown>) {
    await this.assertRelationshipOwnership('parent', rowId, userId);
    const data = this.buildPersonWithDobData(body, ['isDeceased']);
    const row = await this.prisma.visaParent.update({ where: { id: rowId }, data });
    return this.serializeParent(row);
  }
  async deleteParent(userId: string, rowId: string) {
    await this.assertRelationshipOwnership('parent', rowId, userId);
    await this.prisma.visaParent.delete({ where: { id: rowId } });
  }

  // ── Sibling CRUD ────────────────────────────────────────────────────
  async addSibling(userId: string, body: Record<string, unknown>) {
    const visaApplicationId = await this.resolveVisaApplicationIdForAdd(userId);
    const sortOrder = await this.nextRelationshipSortOrder('sibling', visaApplicationId);
    const data = this.buildPersonWithDobData(body, []);
    const row = await this.prisma.visaSibling.create({
      data: { visaApplicationId, sortOrder, ...data },
    });
    return this.serializeSibling(row);
  }
  async updateSibling(userId: string, rowId: string, body: Record<string, unknown>) {
    await this.assertRelationshipOwnership('sibling', rowId, userId);
    const data = this.buildPersonWithDobData(body, []);
    const row = await this.prisma.visaSibling.update({ where: { id: rowId }, data });
    return this.serializeSibling(row);
  }
  async deleteSibling(userId: string, rowId: string) {
    await this.assertRelationshipOwnership('sibling', rowId, userId);
    await this.prisma.visaSibling.delete({ where: { id: rowId } });
  }

  // ── NZ contact CRUD ─────────────────────────────────────────────────
  async addNzContact(userId: string, body: Record<string, unknown>) {
    const visaApplicationId = await this.resolveVisaApplicationIdForAdd(userId);
    const sortOrder = await this.nextRelationshipSortOrder('nzContact', visaApplicationId);
    const data = this.buildNzContactData(body);
    const row = await this.prisma.visaNzContact.create({
      data: { visaApplicationId, sortOrder, ...data },
    });
    return this.serializeNzContact(row);
  }
  async updateNzContact(userId: string, rowId: string, body: Record<string, unknown>) {
    await this.assertRelationshipOwnership('nzContact', rowId, userId);
    const data = this.buildNzContactData(body);
    const row = await this.prisma.visaNzContact.update({ where: { id: rowId }, data });
    return this.serializeNzContact(row);
  }
  async deleteNzContact(userId: string, rowId: string) {
    await this.assertRelationshipOwnership('nzContact', rowId, userId);
    await this.prisma.visaNzContact.delete({ where: { id: rowId } });
  }

  // ── Step 10 — Military service (PR-VISA10) ───────────────────────────
  // Replace-on-save shape (unlike Step 8's live-API per row). The
  // controller's PATCH /students/me/visa/military-history receives the
  // three D1/D2/D3 booleans + the conditional D3 explanation + the
  // full D4 array; the service validates, encrypts, wipes any prior
  // visa_military_services rows, and re-inserts.

  // Shape returned to the frontend on GET / after PATCH. Plaintext
  // values for the encrypted columns are decrypted here.
  private serializeMilitaryService(r: {
    id: string;
    dateStarted: Date | null;
    dateFinished: Date | null;
    location: string | null;
    corps: string | null;
    division: string | null;
    brigade: string | null;
    battalion: string | null;
    unit: string | null;
    rank: string | null;
    dutiesEncrypted: Buffer | Uint8Array | null;
    commandingOfficer: string | null;
    sortOrder: number;
  }) {
    return {
      id: r.id,
      dateStarted: r.dateStarted,
      dateFinished: r.dateFinished,
      location: r.location,
      corps: r.corps,
      division: r.division,
      brigade: r.brigade,
      battalion: r.battalion,
      unit: r.unit,
      rank: r.rank,
      duties: this.decryptOrNull(r.dutiesEncrypted),
      commandingOfficer: r.commandingOfficer,
      sortOrder: r.sortOrder,
    };
  }

  // GET /students/me/visa/military-history
  async getMilitaryHistory(userId: string) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    const rows = await this.prisma.visaMilitaryService.findMany({
      where: { visaApplicationId: visa.id },
      orderBy: { sortOrder: 'asc' },
    });
    return {
      militaryServiceCompulsoryHome: visa.militaryServiceCompulsoryHome,
      everUndertakenMilitaryService: visa.everUndertakenMilitaryService,
      wasExemptFromMilitaryService:  visa.wasExemptFromMilitaryService,
      exemptExplanation:             this.decryptOrNull(visa.exemptExplanationEncrypted),
      militaryServices: rows.map((r) => this.serializeMilitaryService(r)),
    };
  }

  // PATCH /students/me/visa/military-history
  // Single replace-on-save endpoint. Validates the three Y/Ns + the
  // conditional D3 explanation + (when D2 = true) every required field
  // on every D4 entry. Wipes the entries table for this visa app and
  // re-inserts in one transaction. Bumps currentStep to max(current, 11)
  // so the stepper unlocks Step 11.
  async saveMilitaryHistory(
    userId: string,
    body: {
      militaryServiceCompulsoryHome: boolean;
      everUndertakenMilitaryService: boolean;
      wasExemptFromMilitaryService: boolean;
      exemptExplanation?: string | null;
      militaryServices?: Array<{
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
      }>;
    },
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    // D1/D2/D3 are required booleans (the ValidationPipe enforces type,
    // but we re-check for truthy presence here so a missing key on a
    // half-typed body fails closed with a clear message).
    if (typeof body.militaryServiceCompulsoryHome !== 'boolean') {
      throw new BadRequestException('militaryServiceCompulsoryHome is required');
    }
    if (typeof body.everUndertakenMilitaryService !== 'boolean') {
      throw new BadRequestException('everUndertakenMilitaryService is required');
    }
    if (typeof body.wasExemptFromMilitaryService !== 'boolean') {
      throw new BadRequestException('wasExemptFromMilitaryService is required');
    }

    // D3 explanation gating — only required (and only stored) when
    // wasExemptFromMilitaryService = true. Min 20 chars after trim.
    let explanationBuf: Buffer | null = null;
    if (body.wasExemptFromMilitaryService === true) {
      const expl = (body.exemptExplanation ?? '').trim();
      if (expl.length < 20) {
        throw new BadRequestException(
          'exemptExplanation must be at least 20 characters when wasExemptFromMilitaryService = true',
        );
      }
      explanationBuf = this.crypto.encrypt(expl);
    }

    // D4 gating — when D2 = true, require ≥1 entry and every field on
    // each entry must be non-empty (12 columns total).
    const entries = body.militaryServices ?? [];
    if (body.everUndertakenMilitaryService === true) {
      if (entries.length === 0) {
        throw new BadRequestException(
          'At least one military service entry is required when everUndertakenMilitaryService = true',
        );
      }
      entries.forEach((entry, i) => {
        const required: Array<keyof typeof entry> = [
          'dateStarted', 'dateFinished', 'location', 'corps', 'division',
          'brigade', 'battalion', 'unit', 'rank', 'duties', 'commandingOfficer',
        ];
        for (const k of required) {
          const v = entry[k];
          if (v === undefined || v === null || String(v).trim() === '') {
            throw new BadRequestException(
              `militaryServices[${i}].${k} is required`,
            );
          }
        }
        // Validate dates parse cleanly
        for (const k of ['dateStarted', 'dateFinished'] as const) {
          const d = new Date(entry[k]);
          if (isNaN(d.getTime())) {
            throw new BadRequestException(
              `militaryServices[${i}].${k} must be a valid ISO date`,
            );
          }
        }
      });
    } else if (entries.length > 0) {
      // D2 = false → no entries allowed in the payload (defensive — the
      // frontend won't send them, but a hand-rolled curl could).
      throw new BadRequestException(
        'militaryServices must be empty when everUndertakenMilitaryService = false',
      );
    }

    const nextStep = Math.max(visa.currentStep ?? 1, 11);

    // Transactional replace-on-save: clear existing rows, write the
    // booleans + explanation, insert the new rows. Wrapped in a single
    // transaction so a partial write can't leave the row count out of
    // sync with the D2 flag.
    await this.prisma.$transaction(async (tx) => {
      await tx.visaMilitaryService.deleteMany({
        where: { visaApplicationId: visa.id },
      });
      // Prisma's generated input types expect Uint8Array<ArrayBuffer>
      // specifically; Node's Buffer is Uint8Array<ArrayBufferLike>. We
      // cast at the boundary — runtime is identical, this is purely a
      // structural-typing escape hatch matching the pattern used by
      // the Step 8 encrypted-field code paths.
      const updateData: Record<string, unknown> = {
        militaryServiceCompulsoryHome: body.militaryServiceCompulsoryHome,
        everUndertakenMilitaryService: body.everUndertakenMilitaryService,
        wasExemptFromMilitaryService:  body.wasExemptFromMilitaryService,
        exemptExplanationEncrypted:    explanationBuf,
        currentStep:                   nextStep,
      };
      await tx.visaApplication.update({
        where: { id: visa.id },
        data: updateData as never,
      });
      if (body.everUndertakenMilitaryService === true) {
        const rows: Record<string, unknown>[] = entries.map((entry, i) => ({
          visaApplicationId: visa.id,
          dateStarted:       new Date(entry.dateStarted),
          dateFinished:      new Date(entry.dateFinished),
          location:          String(entry.location).trim(),
          corps:             String(entry.corps).trim(),
          division:          String(entry.division).trim(),
          brigade:           String(entry.brigade).trim(),
          battalion:         String(entry.battalion).trim(),
          unit:              String(entry.unit).trim(),
          rank:              String(entry.rank).trim(),
          dutiesEncrypted:   this.crypto.encrypt(String(entry.duties).trim()),
          commandingOfficer: String(entry.commandingOfficer).trim(),
          sortOrder:         i,
        }));
        await tx.visaMilitaryService.createMany({
          data: rows as never,
        });
      }
    });

    return this.getMilitaryHistory(userId);
  }

  // ── Step 11 — Travel history (PR-VISA11) ────────────────────────────
  // Mirrors PR-10's replace-on-save shape. The controller's PATCH
  // /students/me/visa/travel-history receives the gate boolean + the
  // full entries array; the service validates, encrypts destination /
  // pointOfEntry / otherPurpose, wipes any prior
  // visa_travel_history_entries rows, and re-inserts atomically.

  private serializeTravelHistoryEntry(r: {
    id: string;
    destinationEncrypted: Buffer | Uint8Array | null;
    dateEnteredMonth: number | null;
    dateEnteredYear: number | null;
    dateExitedMonth: number | null;
    dateExitedYear: number | null;
    arrivalMode: 'AIR' | 'SEA' | 'LAND' | null;
    pointOfEntryEncrypted: Buffer | Uint8Array | null;
    purposeOfTravel:
      | 'EDUCATION' | 'TOURISM' | 'BUSINESS' | 'FAMILY'
      | 'MEDICAL'   | 'TRANSIT' | 'WORK'     | 'OTHER'
      | null;
    otherPurposeEncrypted: Buffer | Uint8Array | null;
    sortOrder: number;
  }) {
    return {
      id: r.id,
      destination:      this.decryptOrNull(r.destinationEncrypted),
      dateEnteredMonth: r.dateEnteredMonth,
      dateEnteredYear:  r.dateEnteredYear,
      dateExitedMonth:  r.dateExitedMonth,
      dateExitedYear:   r.dateExitedYear,
      arrivalMode:      r.arrivalMode,
      pointOfEntry:     this.decryptOrNull(r.pointOfEntryEncrypted),
      purposeOfTravel:  r.purposeOfTravel,
      otherPurpose:     this.decryptOrNull(r.otherPurposeEncrypted),
      sortOrder:        r.sortOrder,
    };
  }

  // GET /students/me/visa/travel-history
  async getTravelHistory(userId: string) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    const rows = await this.prisma.visaTravelHistoryEntry.findMany({
      where: { visaApplicationId: visa.id },
      orderBy: { sortOrder: 'asc' },
    });
    return {
      hasTravelledInternationally: visa.hasTravelledInternationally,
      entries: rows.map((r) => this.serializeTravelHistoryEntry(r)),
    };
  }

  // PATCH /students/me/visa/travel-history
  // Single replace-on-save endpoint. Validates the gate boolean +
  // (when gate = true) every required field on every entry + the
  // conditional otherPurpose + the month/year ranges + the exit-date-
  // after-entered-date rule. Wipes the entries table for this visa
  // app and re-inserts in one transaction. Bumps currentStep to
  // max(current, 12) so the stepper unlocks Step 12.
  async saveTravelHistory(
    userId: string,
    body: {
      hasTravelledInternationally: boolean;
      entries?: Array<{
        destination: string;
        dateEnteredMonth: number;
        dateEnteredYear: number;
        dateExitedMonth?: number | null;
        dateExitedYear?: number | null;
        arrivalMode: 'AIR' | 'SEA' | 'LAND';
        pointOfEntry: string;
        purposeOfTravel:
          | 'EDUCATION' | 'TOURISM' | 'BUSINESS' | 'FAMILY'
          | 'MEDICAL'   | 'TRANSIT' | 'WORK'     | 'OTHER';
        otherPurpose?: string | null;
      }>;
    },
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    // Gate flag is required. ValidationPipe enforces type; we re-check
    // for truthy presence so a half-typed body fails closed with a
    // clear message (same defensive pattern as Step 10).
    if (typeof body.hasTravelledInternationally !== 'boolean') {
      throw new BadRequestException('hasTravelledInternationally is required');
    }

    const entries = body.entries ?? [];
    const currentYear = new Date().getUTCFullYear();

    if (body.hasTravelledInternationally === true) {
      if (entries.length === 0) {
        throw new BadRequestException(
          'At least one travel history entry is required when hasTravelledInternationally = true',
        );
      }
      entries.forEach((entry, i) => {
        // Required strings.
        for (const k of ['destination', 'pointOfEntry'] as const) {
          const v = entry[k];
          if (typeof v !== 'string' || v.trim() === '') {
            throw new BadRequestException(
              `entries[${i}].${k} is required`,
            );
          }
        }
        // Required enums.
        if (!entry.arrivalMode) {
          throw new BadRequestException(`entries[${i}].arrivalMode is required`);
        }
        if (!entry.purposeOfTravel) {
          throw new BadRequestException(
            `entries[${i}].purposeOfTravel is required`,
          );
        }
        // Required date-entered fields + range.
        if (!Number.isInteger(entry.dateEnteredMonth) ||
            entry.dateEnteredMonth < 1 || entry.dateEnteredMonth > 12) {
          throw new BadRequestException(
            `entries[${i}].dateEnteredMonth must be between 1 and 12`,
          );
        }
        if (!Number.isInteger(entry.dateEnteredYear) ||
            entry.dateEnteredYear < 1900 || entry.dateEnteredYear > currentYear) {
          throw new BadRequestException(
            `entries[${i}].dateEnteredYear must be between 1900 and ${currentYear}`,
          );
        }
        // Optional date-exited pair: both or neither, validate together.
        const exitMonth = entry.dateExitedMonth;
        const exitYear  = entry.dateExitedYear;
        const exitMonthPresent = exitMonth !== null && exitMonth !== undefined;
        const exitYearPresent  = exitYear  !== null && exitYear  !== undefined;
        if (exitMonthPresent !== exitYearPresent) {
          throw new BadRequestException(
            `entries[${i}].dateExited month and year must be provided together`,
          );
        }
        if (exitMonthPresent && exitYearPresent) {
          if (!Number.isInteger(exitMonth) || exitMonth! < 1 || exitMonth! > 12) {
            throw new BadRequestException(
              `entries[${i}].dateExitedMonth must be between 1 and 12`,
            );
          }
          if (!Number.isInteger(exitYear) ||
              exitYear! < 1900 || exitYear! > currentYear) {
            throw new BadRequestException(
              `entries[${i}].dateExitedYear must be between 1900 and ${currentYear}`,
            );
          }
          // Exit must be >= entered (month/year comparison).
          const enteredKey = entry.dateEnteredYear * 12 + (entry.dateEnteredMonth - 1);
          const exitKey    = exitYear! * 12 + (exitMonth! - 1);
          if (exitKey < enteredKey) {
            throw new BadRequestException(
              `entries[${i}].dateExited cannot be before dateEntered`,
            );
          }
        }
        // Conditional otherPurpose.
        if (entry.purposeOfTravel === 'OTHER') {
          const op = (entry.otherPurpose ?? '').trim();
          if (op === '') {
            throw new BadRequestException(
              `entries[${i}].otherPurpose is required when purposeOfTravel = OTHER`,
            );
          }
        }
      });
    } else if (entries.length > 0) {
      // gate = false → no entries allowed (defensive; the frontend
      // won't send them, but a hand-rolled curl could).
      throw new BadRequestException(
        'entries must be empty when hasTravelledInternationally = false',
      );
    }

    const nextStep = Math.max(visa.currentStep ?? 1, 12);

    // Transactional replace-on-save (same pattern as Step 10). Prisma's
    // generated input types want Uint8Array<ArrayBuffer>; Node's Buffer
    // is Uint8Array<ArrayBufferLike> — cast at the boundary as the
    // existing visa code paths do.
    await this.prisma.$transaction(async (tx) => {
      await tx.visaTravelHistoryEntry.deleteMany({
        where: { visaApplicationId: visa.id },
      });
      const updateData: Record<string, unknown> = {
        hasTravelledInternationally: body.hasTravelledInternationally,
        currentStep:                 nextStep,
      };
      await tx.visaApplication.update({
        where: { id: visa.id },
        data: updateData as never,
      });
      if (body.hasTravelledInternationally === true) {
        const rows: Record<string, unknown>[] = entries.map((entry, i) => ({
          visaApplicationId:     visa.id,
          destinationEncrypted:  this.crypto.encrypt(String(entry.destination).trim()),
          dateEnteredMonth:      entry.dateEnteredMonth,
          dateEnteredYear:       entry.dateEnteredYear,
          dateExitedMonth:       entry.dateExitedMonth ?? null,
          dateExitedYear:        entry.dateExitedYear  ?? null,
          arrivalMode:           entry.arrivalMode,
          pointOfEntryEncrypted: this.crypto.encrypt(String(entry.pointOfEntry).trim()),
          purposeOfTravel:       entry.purposeOfTravel,
          otherPurposeEncrypted: entry.purposeOfTravel === 'OTHER'
            ? this.crypto.encrypt(String(entry.otherPurpose ?? '').trim())
            : null,
          sortOrder:             i,
        }));
        await tx.visaTravelHistoryEntry.createMany({
          data: rows as never,
        });
      }
    });

    return this.getTravelHistory(userId);
  }

  // ── Step 12 — Immigration assistance (PR-VISA12) ────────────────────
  // Single-instance (no child table) so all 7 fields live on
  // visa_applications. PATCH /students/me/visa/immigration-assistance
  // receives the gate boolean + optional capacity + the optional
  // five-field adviser block. The service validates, encrypts the
  // four PII strings, and *clears* downstream fields server-side when
  // the gate flag or capacity removes their need (so a stale adviser
  // block can't linger after a Yes→No toggle).

  // Capacities that unlock the five-field adviser block. The other
  // three (FAMILY_MEMBER, FRIEND, OTHER) only need the gate +
  // capacity selection.
  private readonly ADVISER_CAPACITIES = new Set<string>([
    'LICENSED_IMMIGRATION_ADVISER',
    'EXEMPT_PERSON',
  ]);

  // GET /students/me/visa/immigration-assistance
  async getImmigrationAssistance(userId: string) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    return {
      completingOnBehalf:      visa.completingOnBehalf,
      capacity:                visa.immigrationAssistanceCapacity,
      adviserNumber:           this.decryptOrNull(visa.adviserNumberEncrypted),
      adviserFullName:         this.decryptOrNull(visa.adviserFullNameEncrypted),
      adviserEmail:            this.decryptOrNull(visa.adviserEmailEncrypted),
      adviserContactNumber:    this.decryptOrNull(visa.adviserContactNumberEncrypted),
      adviserIsPrimaryContact: visa.adviserIsPrimaryContact,
    };
  }

  // PATCH /students/me/visa/immigration-assistance
  // Validates the gate + the conditional capacity + (when capacity ∈
  // ADVISER_CAPACITIES) the five adviser fields. Encrypts the four
  // PII strings, clears unused downstream fields, bumps currentStep
  // to max(current, 13).
  async saveImmigrationAssistance(
    userId: string,
    body: {
      completingOnBehalf: boolean;
      capacity?:
        | 'LICENSED_IMMIGRATION_ADVISER' | 'EXEMPT_PERSON'
        | 'FAMILY_MEMBER' | 'FRIEND' | 'OTHER'
        | null;
      adviserNumber?: string | null;
      adviserFullName?: string | null;
      adviserEmail?: string | null;
      adviserContactNumber?: string | null;
      adviserIsPrimaryContact?: boolean | null;
    },
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    if (typeof body.completingOnBehalf !== 'boolean') {
      throw new BadRequestException('completingOnBehalf is required');
    }

    // When gate = false: capacity + all adviser fields must clear.
    let capacity: typeof body.capacity = null;
    let adviserNumber: string | null = null;
    let adviserFullName: string | null = null;
    let adviserEmail: string | null = null;
    let adviserContactNumber: string | null = null;
    let adviserIsPrimaryContact: boolean | null = null;

    if (body.completingOnBehalf === true) {
      if (!body.capacity) {
        throw new BadRequestException(
          'capacity is required when completingOnBehalf = true',
        );
      }
      capacity = body.capacity;

      if (this.ADVISER_CAPACITIES.has(capacity!)) {
        // All five adviser fields required.
        adviserNumber  = (body.adviserNumber  ?? '').trim();
        adviserFullName = (body.adviserFullName ?? '').trim();
        adviserEmail   = (body.adviserEmail   ?? '').trim();
        adviserContactNumber = (body.adviserContactNumber ?? '').trim();
        if (adviserNumber === '') {
          throw new BadRequestException(
            'adviserNumber is required when capacity ∈ {LICENSED_IMMIGRATION_ADVISER, EXEMPT_PERSON}',
          );
        }
        if (adviserFullName === '') {
          throw new BadRequestException(
            'adviserFullName is required when capacity ∈ {LICENSED_IMMIGRATION_ADVISER, EXEMPT_PERSON}',
          );
        }
        if (adviserEmail === '') {
          throw new BadRequestException(
            'adviserEmail is required when capacity ∈ {LICENSED_IMMIGRATION_ADVISER, EXEMPT_PERSON}',
          );
        }
        // Defensive email format check — class-validator already ran
        // @IsEmail, but it's @IsOptional, so a missing value reaches
        // here as ''. A loose RFC-ish check matching the DTO contract.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adviserEmail)) {
          throw new BadRequestException('adviserEmail must be a valid email address');
        }
        if (adviserContactNumber === '') {
          throw new BadRequestException(
            'adviserContactNumber is required when capacity ∈ {LICENSED_IMMIGRATION_ADVISER, EXEMPT_PERSON}',
          );
        }
        if (!/^[+\d\s]{1,16}$/.test(adviserContactNumber)) {
          throw new BadRequestException(
            'adviserContactNumber must contain only digits, +, spaces (max 16 characters)',
          );
        }
        if (typeof body.adviserIsPrimaryContact !== 'boolean') {
          throw new BadRequestException(
            'adviserIsPrimaryContact is required when capacity ∈ {LICENSED_IMMIGRATION_ADVISER, EXEMPT_PERSON}',
          );
        }
        adviserIsPrimaryContact = body.adviserIsPrimaryContact;
      }
      // capacity ∈ {FAMILY_MEMBER, FRIEND, OTHER}: adviser fields stay null.
    }
    // gate = false: capacity + all adviser fields stay null.

    const nextStep = Math.max(visa.currentStep ?? 1, 13);

    // Single update — no child table to wipe. Prisma's generated
    // input types expect Uint8Array<ArrayBuffer>; Node's Buffer is
    // Uint8Array<ArrayBufferLike>. Cast at the boundary, matching
    // the Step 10 / 11 pattern.
    const updateData: Record<string, unknown> = {
      completingOnBehalf:            body.completingOnBehalf,
      immigrationAssistanceCapacity: capacity,
      adviserNumberEncrypted:        adviserNumber === null
        ? null
        : this.crypto.encrypt(adviserNumber),
      adviserFullNameEncrypted:      adviserFullName === null
        ? null
        : this.crypto.encrypt(adviserFullName),
      adviserEmailEncrypted:         adviserEmail === null
        ? null
        : this.crypto.encrypt(adviserEmail),
      adviserContactNumberEncrypted: adviserContactNumber === null
        ? null
        : this.crypto.encrypt(adviserContactNumber),
      adviserIsPrimaryContact:       adviserIsPrimaryContact,
      currentStep:                   nextStep,
    };
    await this.prisma.visaApplication.update({
      where: { id: visa.id },
      data: updateData as never,
    });

    return this.getImmigrationAssistance(userId);
  }

  // ── Step 13 — Supporting documents page 1 ──────────────────────────
  //
  // PR-FILES-2 — each visa_supporting_documents row is a REQUIREMENT
  // (one per documentType per application, UNIQUE-constrained). Files
  // live in the visa_supporting_document_files child; a parent can
  // hold many child files. Uploads add a child row, never replace.
  // The legacy PUT .../metadata endpoint is gone — uploads always
  // carry bytes now.

  // GET /students/me/visa/supporting-documents
  // Returns each parent requirement with its files[] array.
  async getSupportingDocuments(userId: string) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    const documents = await this.prisma.visaSupportingDocument.findMany({
      where: { visaApplicationId: visa.id },
      include: {
        files: {
          orderBy: { uploadedAt: 'asc' },
          select: {
            id: true,
            originalFilename: true,
            mimeType: true,
            sizeBytes: true,
            uploadedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      livingInDifferentCountry: visa.livingInDifferentCountry,
      countryOfResidence:       this.decryptOrNull(visa.countryOfResidenceEncrypted),
      areAllDocsInEnglish:      visa.areAllDocsInEnglish,
      documents: documents.map((d) => ({
        id:           d.id,
        documentType: d.documentType,
        // PR-FILES-2 — each parent now exposes its children. The raw
        // fileUrl never leaves the backend; downloads use the per-file
        // signed-URL endpoint and pass a child file id.
        files: d.files,
      })),
    };
  }

  // PATCH /students/me/visa/supporting-documents
  // Saves the three parent-row fields. Server-side clearing:
  // livingInDifferentCountry = false → nulls countryOfResidence +
  // deletes any stale RESIDENCE_VISA metadata row in the same
  // transaction. Bumps currentStep to max(current, 14).
  async saveSupportingDocuments(
    userId: string,
    body: {
      livingInDifferentCountry?: boolean | null;
      countryOfResidence?: string | null;
      areAllDocsInEnglish?: boolean | null;
    },
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    // Resolve gate + country reconciliation. We accept null/undefined
    // on a draft save (partial) but, when livingInDifferentCountry
    // explicitly = true on this PATCH, require countryOfResidence to
    // be non-empty so we don't persist a half-state.
    const living =
      body.livingInDifferentCountry === undefined
        ? visa.livingInDifferentCountry
        : body.livingInDifferentCountry;

    let countryOfResidence: string | null = null;
    if (living === true) {
      const c = (body.countryOfResidence ?? '').trim();
      if (c === '') {
        // Allow saving the gate alone (so a user can flip the toggle
        // and come back to fill country) only if the persisted
        // countryOfResidence was already set. Otherwise reject.
        const existing = this.decryptOrNull(visa.countryOfResidenceEncrypted);
        if (!existing || existing.trim() === '') {
          throw new BadRequestException(
            'countryOfResidence is required when livingInDifferentCountry = true',
          );
        }
        countryOfResidence = existing;
      } else {
        countryOfResidence = c;
      }
    }
    // living === false / null: countryOfResidence stays null; the
    // RESIDENCE_VISA metadata row is wiped in the transaction below.

    const areAllDocsInEnglish =
      body.areAllDocsInEnglish === undefined
        ? visa.areAllDocsInEnglish
        : body.areAllDocsInEnglish;

    const nextStep = Math.max(visa.currentStep ?? 1, 14);

    await this.prisma.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {
        livingInDifferentCountry:    living,
        countryOfResidenceEncrypted: countryOfResidence === null
          ? null
          : this.crypto.encrypt(countryOfResidence),
        areAllDocsInEnglish:         areAllDocsInEnglish,
        currentStep:                 nextStep,
      };
      await tx.visaApplication.update({
        where: { id: visa.id },
        data: updateData as never,
      });
      // Reconcile child metadata row when gate flips to false.
      if (living !== true) {
        await tx.visaSupportingDocument.deleteMany({
          where: { visaApplicationId: visa.id, documentType: 'RESIDENCE_VISA' },
        });
      }
    });

    return this.getSupportingDocuments(userId);
  }

  // DELETE /students/me/visa/supporting-documents/metadata/:documentType
  // PR-FILES-2 — "clear the entire requirement". Drops the parent row,
  // which cascades to every child file on disk (the FK is
  // ON DELETE CASCADE in Postgres + best-effort fs.unlink per child
  // below so we don't leak bytes). The route path keeps the legacy
  // ".../metadata/" segment to avoid a frontend churn in this step;
  // the frontend will be repointed in PR-FILES-2 step 3.
  async deleteSupportingDocumentRequirement(
    userId: string,
    documentType:
      | 'PASSPORT' | 'NATIONAL_ID' | 'RESIDENCE_VISA'
      | 'MILITARY_RECORD' | 'TRAVEL_HISTORY' | 'AUTHORITY_DOC',
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    const parent = await this.prisma.visaSupportingDocument.findFirst({
      where: { visaApplicationId: visa.id, documentType },
      include: { files: { select: { id: true, fileUrl: true, originalFilename: true } } },
    });
    if (!parent) {
      // Nothing to clear — return the current state idempotently.
      return this.getSupportingDocuments(userId);
    }

    // Snapshot before delete so the audit log can record what was wiped.
    const removedFiles = parent.files.map((f) => ({
      id:               f.id,
      originalFilename: f.originalFilename,
      fileUrl:          f.fileUrl,
    }));

    await this.prisma.visaSupportingDocument.delete({ where: { id: parent.id } });

    // Best-effort cleanup of bytes on disk. The DB cascade already
    // removed the child rows; this just keeps the uploads dir tidy.
    for (const f of removedFiles) {
      try {
        await fs.promises.unlink(path.resolve(f.fileUrl));
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.warn(`Failed to unlink visa supporting file ${f.fileUrl}`, err);
        }
      }
    }

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'VISA_DOC_REQUIREMENT_CLEARED',
        entityType: 'VisaSupportingDocument',
        entityId: parent.id,
        oldValue: {
          documentType,
          visaApplicationId: visa.id,
          removedFiles: removedFiles.map((f) => ({ id: f.id, fileName: f.originalFilename })),
        },
      },
    });

    return this.getSupportingDocuments(userId);
  }

  // ── Step 14 — Supporting documents page 2 (PR-VISA14) ───────────────
  // FINAL Visa Section step. File storage still deferred — metadata
  // only. 28 parent flags driving a tree of conditional sections plus
  // a repeating "Other evidence" child table. Server-side cascade
  // clearing is the load-bearing piece here: when a higher gate flips
  // false the service nulls every downstream flag and deletes the
  // dependent metadata rows in the same transaction so stale data
  // can't linger.

  // PR-FILES-2 — each entry is a classification (evidenceType +
  // optional customLabel) and carries its own files[] array; the
  // entry's own row no longer has file metadata.
  private serializeOtherEvidence(r: {
    id: string;
    evidenceType:
      | 'COVER_LETTER' | 'STATEMENT_OF_PURPOSE'
      | 'ADDITIONAL_FUNDS_EVIDENCE' | 'FAMILY_TIES_EVIDENCE' | 'OTHER';
    customLabelEncrypted: Buffer | Uint8Array | null;
    files: Array<{
      id: string;
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
      uploadedAt: Date;
    }>;
  }) {
    return {
      id:           r.id,
      evidenceType: r.evidenceType,
      customLabel:  this.decryptOrNull(r.customLabelEncrypted),
      files:        r.files,
    };
  }

  // GET /students/me/visa/supporting-documents-2
  async getSupportingDocuments2(userId: string) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    const otherEvidence = await this.prisma.visaOtherEvidenceEntry.findMany({
      where: { visaApplicationId: visa.id },
      include: {
        files: {
          orderBy: { uploadedAt: 'asc' },
          select: {
            id: true,
            originalFilename: true,
            mimeType: true,
            sizeBytes: true,
            uploadedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      tuitionFeesPaid:                 visa.tuitionFeesPaid,
      tuitionPaymentMethod:            visa.tuitionPaymentMethod,
      fundsSourceSavings:              visa.fundsSourceSavings,
      fundsSourceNZSponsor:            visa.fundsSourceNZSponsor,
      fundsSourceInz1014:              visa.fundsSourceInz1014,
      fundsSourcePrepaidAccom:         visa.fundsSourcePrepaidAccom,
      fundsSourceScholarship:          visa.fundsSourceScholarship,
      outwardSourceSufficientFunds:    visa.outwardSourceSufficientFunds,
      outwardSourceInz1014:            visa.outwardSourceInz1014,
      outwardSourcePrepaidBooking:     visa.outwardSourcePrepaidBooking,
      outwardSourceScholarship:        visa.outwardSourceScholarship,
      fundsFormatBankAccount:          visa.fundsFormatBankAccount,
      fundsFormatProvidentFund:        visa.fundsFormatProvidentFund,
      fundsFormatEducationLoan:        visa.fundsFormatEducationLoan,
      fundsFormatFixedTermDeposit:     visa.fundsFormatFixedTermDeposit,
      fundsFormatOther:                visa.fundsFormatOther,
      savingsSourceWages:              visa.savingsSourceWages,
      savingsSourceSelfEmployment:     visa.savingsSourceSelfEmployment,
      savingsSourceRentalIncome:       visa.savingsSourceRentalIncome,
      savingsSourceOther:              visa.savingsSourceOther,
      depositExplanation:              this.decryptOrNull(visa.depositExplanationEncrypted),
      scholarshipName:                 this.decryptOrNull(visa.scholarshipNameEncrypted),
      scholarshipOrganisation:         this.decryptOrNull(visa.scholarshipOrganisationEncrypted),
      studyIs120CreditsOrMore:         visa.studyIs120CreditsOrMore,
      courseRequiresPracticalWork:     visa.courseRequiresPracticalWork,
      tookEnglishTest:                 visa.tookEnglishTest,
      declarationChecked:              visa.declarationChecked,
      otherEvidence: otherEvidence.map((r) => this.serializeOtherEvidence(r)),
    };
  }

  // PATCH /students/me/visa/supporting-documents-2
  // Applies every cascade-clear rule the frontend enforces, so a
  // hand-rolled curl can't leave the row in an inconsistent state.
  // Single transaction wraps the parent update + every dependent
  // metadata row delete. Bumps currentStep to max(current, 15).
  async saveSupportingDocuments2(
    userId: string,
    body: {
      tuitionFeesPaid?: boolean | null;
      tuitionPaymentMethod?:
        | 'SELF_PAID' | 'PARTNER_PROVIDER_OR_GOVT_LOAN'
        | 'THIRD_PARTY_SPONSOR' | 'SCHOLARSHIP' | null;
      fundsSourceSavings?: boolean | null;
      fundsSourceNZSponsor?: boolean | null;
      fundsSourceInz1014?: boolean | null;
      fundsSourcePrepaidAccom?: boolean | null;
      fundsSourceScholarship?: boolean | null;
      outwardSourceSufficientFunds?: boolean | null;
      outwardSourceInz1014?: boolean | null;
      outwardSourcePrepaidBooking?: boolean | null;
      outwardSourceScholarship?: boolean | null;
      fundsFormatBankAccount?: boolean | null;
      fundsFormatProvidentFund?: boolean | null;
      fundsFormatEducationLoan?: boolean | null;
      fundsFormatFixedTermDeposit?: boolean | null;
      fundsFormatOther?: boolean | null;
      savingsSourceWages?: boolean | null;
      savingsSourceSelfEmployment?: boolean | null;
      savingsSourceRentalIncome?: boolean | null;
      savingsSourceOther?: boolean | null;
      depositExplanation?: string | null;
      scholarshipName?: string | null;
      scholarshipOrganisation?: string | null;
      studyIs120CreditsOrMore?: boolean | null;
      courseRequiresPracticalWork?: boolean | null;
      tookEnglishTest?: boolean | null;
      declarationChecked?: boolean | null;
    },
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    // Resolve the effective value of each field: caller value if
    // present, otherwise the persisted value. This way a PATCH can
    // send a partial body without nuking unrelated fields.
    const pick = <K extends keyof typeof body, V>(key: K, fallback: V): V =>
      (body[key] === undefined ? fallback : (body[key] as unknown as V));

    let tuitionFeesPaid             = pick('tuitionFeesPaid',             visa.tuitionFeesPaid);
    let tuitionPaymentMethod        = pick('tuitionPaymentMethod',        visa.tuitionPaymentMethod);
    let fundsSourceSavings          = pick('fundsSourceSavings',          visa.fundsSourceSavings);
    const fundsSourceNZSponsor        = pick('fundsSourceNZSponsor',        visa.fundsSourceNZSponsor);
    const fundsSourceInz1014          = pick('fundsSourceInz1014',          visa.fundsSourceInz1014);
    let fundsSourcePrepaidAccom     = pick('fundsSourcePrepaidAccom',     visa.fundsSourcePrepaidAccom);
    const fundsSourceScholarship      = pick('fundsSourceScholarship',      visa.fundsSourceScholarship);
    const outwardSourceSufficientFunds = pick('outwardSourceSufficientFunds', visa.outwardSourceSufficientFunds);
    const outwardSourceInz1014         = pick('outwardSourceInz1014',         visa.outwardSourceInz1014);
    let outwardSourcePrepaidBooking = pick('outwardSourcePrepaidBooking', visa.outwardSourcePrepaidBooking);
    const outwardSourceScholarship     = pick('outwardSourceScholarship',     visa.outwardSourceScholarship);
    let fundsFormatBankAccount      = pick('fundsFormatBankAccount',      visa.fundsFormatBankAccount);
    let fundsFormatProvidentFund    = pick('fundsFormatProvidentFund',    visa.fundsFormatProvidentFund);
    let fundsFormatEducationLoan    = pick('fundsFormatEducationLoan',    visa.fundsFormatEducationLoan);
    let fundsFormatFixedTermDeposit = pick('fundsFormatFixedTermDeposit', visa.fundsFormatFixedTermDeposit);
    let fundsFormatOther            = pick('fundsFormatOther',            visa.fundsFormatOther);
    let savingsSourceWages          = pick('savingsSourceWages',          visa.savingsSourceWages);
    let savingsSourceSelfEmployment = pick('savingsSourceSelfEmployment', visa.savingsSourceSelfEmployment);
    let savingsSourceRentalIncome   = pick('savingsSourceRentalIncome',   visa.savingsSourceRentalIncome);
    let savingsSourceOther          = pick('savingsSourceOther',          visa.savingsSourceOther);

    let depositExplanation       = body.depositExplanation       === undefined
      ? this.decryptOrNull(visa.depositExplanationEncrypted)
      : (body.depositExplanation ?? null);
    let scholarshipName          = body.scholarshipName          === undefined
      ? this.decryptOrNull(visa.scholarshipNameEncrypted)
      : (body.scholarshipName ?? null);
    let scholarshipOrganisation  = body.scholarshipOrganisation  === undefined
      ? this.decryptOrNull(visa.scholarshipOrganisationEncrypted)
      : (body.scholarshipOrganisation ?? null);

    const studyIs120CreditsOrMore     = pick('studyIs120CreditsOrMore',     visa.studyIs120CreditsOrMore);
    const courseRequiresPracticalWork = pick('courseRequiresPracticalWork', visa.courseRequiresPracticalWork);
    const tookEnglishTest             = pick('tookEnglishTest',             visa.tookEnglishTest);
    const declarationChecked          = pick('declarationChecked',          visa.declarationChecked);

    // ── Cascade-clear rules ───────────────────────────────────────────
    const docsToDelete = new Set<string>();

    // tuitionFeesPaid = true → tuitionPaymentMethod cleared.
    if (tuitionFeesPaid === true) {
      tuitionPaymentMethod = null;
    }

    // fundsSourceSavings = false → wipe entire savings subtree.
    if (fundsSourceSavings !== true) {
      fundsFormatBankAccount      = null;
      fundsFormatProvidentFund    = null;
      fundsFormatEducationLoan    = null;
      fundsFormatFixedTermDeposit = null;
      fundsFormatOther            = null;
      savingsSourceWages          = null;
      savingsSourceSelfEmployment = null;
      savingsSourceRentalIncome   = null;
      savingsSourceOther          = null;
      depositExplanation          = null;
      docsToDelete.add('BANK_STATEMENTS');
      docsToDelete.add('EMPLOYMENT_INCOME_EVIDENCE');
    } else if (fundsFormatBankAccount !== true) {
      // savings on but no bank account → savings-source subtree clears.
      savingsSourceWages          = null;
      savingsSourceSelfEmployment = null;
      savingsSourceRentalIncome   = null;
      savingsSourceOther          = null;
      depositExplanation          = null;
      docsToDelete.add('BANK_STATEMENTS');
      docsToDelete.add('EMPLOYMENT_INCOME_EVIDENCE');
    } else if (savingsSourceWages !== true && savingsSourceSelfEmployment !== true) {
      // bank account on but neither wages nor self-emp → income evidence cleared.
      docsToDelete.add('EMPLOYMENT_INCOME_EVIDENCE');
    }

    // INZ1014 document only needed when either funds or outward source flag = true.
    if (fundsSourceInz1014 !== true && outwardSourceInz1014 !== true) {
      docsToDelete.add('INZ1014_FINANCIAL_UNDERTAKING');
    }
    if (fundsSourcePrepaidAccom !== true) {
      docsToDelete.add('PREPAID_ACCOMMODATION_EVIDENCE');
    } else {
      // Defensive: not strictly required to set, but keeps the
      // intent explicit if a stray local var was nulled above.
      fundsSourcePrepaidAccom = true;
    }
    if (outwardSourcePrepaidBooking !== true) {
      docsToDelete.add('OUTWARD_TRAVEL_EVIDENCE');
    } else {
      outwardSourcePrepaidBooking = true;
    }

    // Scholarship "active" = any of the three triggers.
    const scholarshipActive =
      fundsSourceScholarship  === true ||
      outwardSourceScholarship === true ||
      tuitionPaymentMethod    === 'SCHOLARSHIP';
    if (!scholarshipActive) {
      scholarshipName         = null;
      scholarshipOrganisation = null;
      docsToDelete.add('SCHOLARSHIP_EVIDENCE');
    }

    if (tookEnglishTest !== true) {
      docsToDelete.add('ENGLISH_TEST_RESULTS');
    }

    const nextStep = Math.max(visa.currentStep ?? 1, 15);

    await this.prisma.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {
        tuitionFeesPaid,
        tuitionPaymentMethod,
        fundsSourceSavings,
        fundsSourceNZSponsor,
        fundsSourceInz1014,
        fundsSourcePrepaidAccom,
        fundsSourceScholarship,
        outwardSourceSufficientFunds,
        outwardSourceInz1014,
        outwardSourcePrepaidBooking,
        outwardSourceScholarship,
        fundsFormatBankAccount,
        fundsFormatProvidentFund,
        fundsFormatEducationLoan,
        fundsFormatFixedTermDeposit,
        fundsFormatOther,
        savingsSourceWages,
        savingsSourceSelfEmployment,
        savingsSourceRentalIncome,
        savingsSourceOther,
        depositExplanationEncrypted: depositExplanation === null || depositExplanation === ''
          ? null
          : this.crypto.encrypt(depositExplanation),
        scholarshipNameEncrypted: scholarshipName === null || scholarshipName === ''
          ? null
          : this.crypto.encrypt(scholarshipName),
        scholarshipOrganisationEncrypted: scholarshipOrganisation === null || scholarshipOrganisation === ''
          ? null
          : this.crypto.encrypt(scholarshipOrganisation),
        studyIs120CreditsOrMore,
        courseRequiresPracticalWork,
        tookEnglishTest,
        declarationChecked,
        currentStep: nextStep,
      };
      await tx.visaApplication.update({
        where: { id: visa.id },
        data: updateData as never,
      });

      if (docsToDelete.size > 0) {
        await tx.visaSupportingDocument.deleteMany({
          where: {
            visaApplicationId: visa.id,
            documentType: { in: Array.from(docsToDelete) as never },
          },
        });
      }
    });

    return this.getSupportingDocuments2(userId);
  }

  // PUT /students/me/visa/supporting-documents-2/other-evidence
  // PR-FILES-2 — entries are now PURE classifications (evidenceType +
  // optional encrypted customLabel). Files attach via the separate
  // POST .../other-evidence/:entryId/file endpoint. customLabel is
  // required iff evidenceType = OTHER (encrypted at the boundary).
  async upsertOtherEvidenceEntry(
    userId: string,
    body: {
      id?: string;
      evidenceType:
        | 'COVER_LETTER' | 'STATEMENT_OF_PURPOSE'
        | 'ADDITIONAL_FUNDS_EVIDENCE' | 'FAMILY_TIES_EVIDENCE' | 'OTHER';
      customLabel?: string | null;
    },
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    const label = (body.customLabel ?? '').trim();
    if (body.evidenceType === 'OTHER' && label === '') {
      throw new BadRequestException(
        'customLabel is required when evidenceType = OTHER',
      );
    }

    const customLabelEncrypted = body.evidenceType === 'OTHER'
      ? this.crypto.encrypt(label)
      : null;

    if (body.id) {
      // Verify the row belongs to this application before updating.
      const existing = await this.prisma.visaOtherEvidenceEntry.findUnique({
        where: { id: body.id },
      });
      if (!existing || existing.visaApplicationId !== visa.id) {
        throw new ForbiddenException('Entry does not belong to this application');
      }
      await this.prisma.visaOtherEvidenceEntry.update({
        where: { id: body.id },
        data: {
          evidenceType:         body.evidenceType,
          customLabelEncrypted: customLabelEncrypted as never,
        },
      });
    } else {
      await this.prisma.visaOtherEvidenceEntry.create({
        data: {
          visaApplicationId:    visa.id,
          evidenceType:         body.evidenceType,
          customLabelEncrypted: customLabelEncrypted as never,
        },
      });
    }

    return this.getSupportingDocuments2(userId);
  }

  // DELETE /students/me/visa/supporting-documents-2/other-evidence/:entryId
  async deleteOtherEvidenceEntry(userId: string, entryId: string) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }
    const existing = await this.prisma.visaOtherEvidenceEntry.findUnique({
      where: { id: entryId },
    });
    if (!existing || existing.visaApplicationId !== visa.id) {
      throw new ForbiddenException('Entry does not belong to this application');
    }
    await this.prisma.visaOtherEvidenceEntry.delete({ where: { id: entryId } });
    return this.getSupportingDocuments2(userId);
  }

  // ── PR-FILES-2: per-file upload / download / delete ───────────────
  //
  // Uploads ADD a child file row under a parent requirement (or other-
  // evidence entry) — never replace. Deletes operate on a single child
  // file id and leave the parent row intact (it represents the
  // requirement). Downloads materialise a 5-min signed URL pointing at
  // /files/signed/:token. Owner-only (layer 2) flows from
  // resolveAdmissionApplication, audit (layer 6) is written on every
  // successful mutation/download, layer-7 input limits live in the
  // multer config in visa.controller.ts.

  // POST /students/me/visa/supporting-documents/:documentType/file
  // Find-or-create the parent (visaApplicationId, documentType), then
  // INSERT a new child file. Multiple uploads under the same type
  // produce multiple child rows.
  async uploadSupportingDocumentFile(
    userId: string,
    documentType:
      | 'PASSPORT' | 'NATIONAL_ID' | 'RESIDENCE_VISA'
      | 'MILITARY_RECORD' | 'TRAVEL_HISTORY' | 'AUTHORITY_DOC',
    file: Express.Multer.File,
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    // Move pending → final dir. The pending sweep in main.ts deletes
    // anything left behind in PENDING_DIR older than 1 h, so a crash
    // between multer write and this rename self-heals.
    const destDir = path.join(UPLOAD_DIR, 'visa-supporting', visa.id);
    await fs.promises.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, path.basename(file.path));
    await fs.promises.rename(file.path, destPath);

    // Find-or-create the parent requirement. The UNIQUE constraint on
    // (visaApplicationId, documentType) means a concurrent create
    // would error — wrapped in a single transaction so the find-then-
    // create is atomic for the purposes of any subsequent child write
    // in this request. The race window for two near-simultaneous
    // uploads on the same type is still narrow but tolerable: the
    // second one would just retry or be handled by the unique catch.
    const { parentId, childFile } = await this.prisma.$transaction(async (tx) => {
      let parent = await tx.visaSupportingDocument.findFirst({
        where: { visaApplicationId: visa.id, documentType },
        select: { id: true },
      });
      if (!parent) {
        parent = await tx.visaSupportingDocument.create({
          data: { visaApplicationId: visa.id, documentType },
          select: { id: true },
        });
      }
      const child = await tx.visaSupportingDocumentFile.create({
        data: {
          visaSupportingDocumentId: parent.id,
          originalFilename:         file.originalname,
          mimeType:                 file.mimetype,
          sizeBytes:                file.size,
          fileUrl:                  destPath,
        },
      });
      return { parentId: parent.id, childFile: child };
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'VISA_DOC_UPLOADED',
        entityType: 'VisaSupportingDocumentFile',
        entityId: childFile.id,
        newValue: {
          documentType,
          parentId,
          fileName:          file.originalname,
          sizeBytes:         file.size,
          visaApplicationId: visa.id,
        },
      },
    });

    return this.getSupportingDocuments(userId);
  }

  // DELETE /students/me/visa/supporting-documents/files/:fileId
  // Delete a single child file row and its bytes from disk. The
  // parent requirement is left intact even if it ends up with zero
  // files (the requirement itself is what the LIA may still need
  // recorded; per-file delete is not a requirement-clearing op).
  async deleteSupportingDocumentFile(userId: string, fileId: string) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    // Ownership: file → parent.visaApplicationId must equal visa.id.
    // Mismatched / unknown ids return 404 (not 403) so the existence
    // of files on other applications never leaks.
    const file = await this.prisma.visaSupportingDocumentFile.findUnique({
      where: { id: fileId },
      include: { document: { select: { id: true, documentType: true, visaApplicationId: true } } },
    });
    if (!file || file.document.visaApplicationId !== visa.id) {
      throw new NotFoundException('File not found');
    }

    await this.prisma.visaSupportingDocumentFile.delete({ where: { id: fileId } });

    try {
      await fs.promises.unlink(path.resolve(file.fileUrl));
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn(`Failed to unlink visa supporting file ${file.fileUrl}`, err);
      }
    }

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'VISA_DOC_DELETED',
        entityType: 'VisaSupportingDocumentFile',
        entityId: fileId,
        oldValue: {
          documentType:      file.document.documentType,
          parentId:          file.document.id,
          fileName:          file.originalFilename,
          visaApplicationId: visa.id,
        },
      },
    });

    return this.getSupportingDocuments(userId);
  }

  // GET /students/me/visa/supporting-documents/files/:fileId/download
  // Mint a signed URL for a single child file. Same owner-scoping +
  // 404-not-403 rule as delete.
  async getSupportingDocumentFileDownloadUrl(userId: string, fileId: string) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    const file = await this.prisma.visaSupportingDocumentFile.findUnique({
      where: { id: fileId },
      include: { document: { select: { id: true, documentType: true, visaApplicationId: true } } },
    });
    if (!file || file.document.visaApplicationId !== visa.id) {
      throw new NotFoundException('File not found');
    }

    const token = createSignedDownloadToken({
      fileUrl:  file.fileUrl,
      fileName: file.originalFilename,
      mimeType: file.mimeType,
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'VISA_DOC_DOWNLOADED',
        entityType: 'VisaSupportingDocumentFile',
        entityId: file.id,
        newValue: {
          documentType:      file.document.documentType,
          parentId:          file.document.id,
          fileName:          file.originalFilename,
          visaApplicationId: visa.id,
        },
      },
    });

    return { url: `/files/signed/${token}`, expiresInSeconds: 300 };
  }

  // POST /students/me/visa/supporting-documents-2/other-evidence/:entryId/file
  // Add a new child file under an existing other-evidence entry. The
  // entry must already exist (created via PUT .../other-evidence).
  async uploadOtherEvidenceFile(
    userId: string,
    entryId: string,
    file: Express.Multer.File,
  ) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    const entry = await this.prisma.visaOtherEvidenceEntry.findUnique({
      where: { id: entryId },
      select: { id: true, evidenceType: true, visaApplicationId: true },
    });
    if (!entry || entry.visaApplicationId !== visa.id) {
      throw new NotFoundException('Entry not found');
    }

    const destDir = path.join(UPLOAD_DIR, 'visa-other-evidence', visa.id);
    await fs.promises.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, path.basename(file.path));
    await fs.promises.rename(file.path, destPath);

    const childFile = await this.prisma.visaOtherEvidenceFile.create({
      data: {
        visaOtherEvidenceEntryId: entry.id,
        originalFilename:         file.originalname,
        mimeType:                 file.mimetype,
        sizeBytes:                file.size,
        fileUrl:                  destPath,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'VISA_DOC_UPLOADED',
        entityType: 'VisaOtherEvidenceFile',
        entityId: childFile.id,
        newValue: {
          evidenceType:      entry.evidenceType,
          entryId:           entry.id,
          fileName:          file.originalname,
          sizeBytes:         file.size,
          visaApplicationId: visa.id,
        },
      },
    });

    return this.getSupportingDocuments2(userId);
  }

  // DELETE /students/me/visa/supporting-documents-2/other-evidence/files/:fileId
  async deleteOtherEvidenceFile(userId: string, fileId: string) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    const file = await this.prisma.visaOtherEvidenceFile.findUnique({
      where: { id: fileId },
      include: { entry: { select: { id: true, evidenceType: true, visaApplicationId: true } } },
    });
    if (!file || file.entry.visaApplicationId !== visa.id) {
      throw new NotFoundException('File not found');
    }

    await this.prisma.visaOtherEvidenceFile.delete({ where: { id: fileId } });

    try {
      await fs.promises.unlink(path.resolve(file.fileUrl));
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn(`Failed to unlink visa other-evidence file ${file.fileUrl}`, err);
      }
    }

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'VISA_DOC_DELETED',
        entityType: 'VisaOtherEvidenceFile',
        entityId: fileId,
        oldValue: {
          evidenceType:      file.entry.evidenceType,
          entryId:           file.entry.id,
          fileName:          file.originalFilename,
          visaApplicationId: visa.id,
        },
      },
    });

    return this.getSupportingDocuments2(userId);
  }

  // GET /students/me/visa/supporting-documents-2/other-evidence/files/:fileId/download
  async getOtherEvidenceFileDownloadUrl(userId: string, fileId: string) {
    const { admission } = await this.resolveAdmissionApplication(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      throw new NotFoundException(
        'Visa application not found. Save Step 1 first to create it.',
      );
    }

    const file = await this.prisma.visaOtherEvidenceFile.findUnique({
      where: { id: fileId },
      include: { entry: { select: { id: true, evidenceType: true, visaApplicationId: true } } },
    });
    if (!file || file.entry.visaApplicationId !== visa.id) {
      throw new NotFoundException('File not found');
    }

    const token = createSignedDownloadToken({
      fileUrl:  file.fileUrl,
      fileName: file.originalFilename,
      mimeType: file.mimeType,
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'VISA_DOC_DOWNLOADED',
        entityType: 'VisaOtherEvidenceFile',
        entityId: file.id,
        newValue: {
          evidenceType:      file.entry.evidenceType,
          entryId:           file.entry.id,
          fileName:          file.originalFilename,
          visaApplicationId: visa.id,
        },
      },
    });

    return { url: `/files/signed/${token}`, expiresInSeconds: 300 };
  }
}
