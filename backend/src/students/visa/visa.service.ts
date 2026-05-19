import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { decryptPiiFields } from '../admission/admission-encryption.util';

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

  currentStep:            'int',
};

const VALID_EMPLOYMENT_KINDS = new Set(['CURRENT', 'PREVIOUS']);

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

    return {
      visaApplication: this.decryptVisaRow(visa as Record<string, unknown>),
      readonly: this.buildReadonlySnapshot(contact, admission as Record<string, unknown>, topChoice),
      otherCitizenships: await this.loadOtherCitizenships(visa.id),
      tbRiskCountries: await this.loadTbRiskCountries(visa.id),
      educationEntries: await this.loadEducationEntries(admission.id),
      educationSupplements: await this.loadEducationSupplements(visa.id),
      employmentEntries: await this.loadEmploymentEntries(visa.id),
      unemploymentEntries: await this.loadUnemploymentEntries(visa.id),
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
}
