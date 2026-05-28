import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { createSignedDownloadToken } from '../common/signed-url.util';

// PR-LIA-6 — Consolidated INZ application data viewer (read-only).
//
// Surfaces every INZ-relevant field from the ~20 visa-* models in
// one structured payload so the LIA can copy values straight into
// the official INZ portal without hunting through 20 student-side
// pages.
//
// The data lives in two domains:
//   * Admission (Contact, AdmissionApplication, AdmissionEducationEntry)
//   * Visa (VisaApplication + 15 child tables)
//
// Resolver chain (CRM Case → VisaApplication):
//   Case → AdmissionApplication.caseId → VisaApplication.applicationId
//
// Naming bridge — the user's PR spec used some convenience names that
// don't quite match the actual model names. Bridge documented in §3
// of the PR-LIA-6 handover:
//   citizenships         → VisaOtherCitizenship
//   tbCountries          → VisaTbRiskCountry
//   educationEntries     → AdmissionEducationEntry + visaSupplement
//   travelHistory        → VisaTravelHistoryEntry
//   militaryHistory      → boolean flags on VisaApplication + VisaMilitaryService[]
//   immigrationAssistance → adviser* fields on VisaApplication
//
// All `*Encrypted` Bytes columns are decrypted server-side. The wire
// response is plaintext. A failed decrypt produces an empty string
// (defensive against a key rotation) rather than crashing the page.

interface FieldCompleteness {
  filled: number;
  total: number;
}

interface CountCompleteness {
  count: number;
}

interface BoolCompleteness {
  filled: boolean;
}

interface FamilyCompleteness {
  partner: boolean;
  formerPartners: number;
  children: number;
  parents: number;
  siblings: number;
}

export interface InzDataPayload {
  generatedAt: string;
  // PR-LIA-7: surface the INZ submission timestamp + reference number
  // so the inz-data viewer can show a "submitted" banner. Both null
  // for cases that haven't reached the INZ_SUBMITTED stage.
  case: {
    id: string;
    stage: string;
    createdAt: Date;
    inzApplicationNumber: string | null;
    inzSubmittedAt: Date | null;
    // PR-LIA-8: visa outcome banner on the inz-data viewer.
    // Both null on cases that haven't reached COMPLETED with a visa
    // record (or that haven't been issued / declined at all).
    visaOutcome: 'APPROVED' | 'DECLINED' | null;
    visaEndDate: Date | null;
    visaIssuedAt: Date | null;
  } | null;
  applicant: {
    fullName: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    email: string | null;
    phone: string | null;
    countryOfBirth: string | null;
    countryOfResidence: string | null;
    passportNumber: string | null;
    passportExpiry: string | null;
    passportCountry: string | null;
  };
  citizenships: Array<{
    id: string;
    country: string;
    holdsPassport: boolean | null;
  }>;
  tbCountries: Array<{
    id: string;
    country: string;
    totalDurationDays: number | null;
  }>;
  educationEntries: Array<{
    id: string;
    institution: string;
    qualification: string;
    fieldOfStudy: string | null;
    startYear: number | null;
    endYear: number | null;
    country: string;
    completed: boolean;
    supplement: {
      startMonth: number | null;
      endMonth: number | null;
      institutionState: string | null;
      institutionTown: string | null;
      qualificationAwarded: boolean | null;
    } | null;
  }>;
  employmentEntries: Array<{
    id: string;
    entryKind: string;
    employer: string | null;
    role: string | null;
    duties: string | null;
    startDate: Date | null;
    endDate: Date | null;
    country: string | null;
    state: string | null;
    supervisorName: string | null;
  }>;
  unemploymentEntries: Array<{
    id: string;
    startDate: Date | null;
    endDate: Date | null;
    activity: string | null;
    financialSupport: string | null;
  }>;
  partner: {
    id: string;
    fullName: string;
    dateOfBirth: Date | null;
    gender: string | null;
    relationshipStatus: string | null;
    countryOfBirth: string | null;
    nationality: string | null;
    countryOfResidence: string | null;
    occupation: string | null;
    passportNumber: string | null;
    passportCountry: string | null;
  } | null;
  formerPartners: Array<{
    id: string;
    fullName: string;
    dateOfBirth: Date | null;
    relationshipStatus: string | null;
    countryOfBirth: string | null;
    nationality: string | null;
  }>;
  children: Array<{
    id: string;
    fullName: string;
    dateOfBirth: Date | null;
    countryOfBirth: string | null;
    nationality: string | null;
    livesWithApplicant: boolean | null;
  }>;
  parents: Array<{
    id: string;
    fullName: string;
    relationshipToApplicant: string | null;
    isDeceased: boolean | null;
    dateOfBirth: Date | null;
    countryOfResidence: string | null;
    occupation: string | null;
  }>;
  siblings: Array<{
    id: string;
    fullName: string;
    relationshipToApplicant: string | null;
    dateOfBirth: Date | null;
    countryOfResidence: string | null;
    occupation: string | null;
  }>;
  nzContacts: Array<{
    id: string;
    fullName: string;
    relationshipToApplicant: string | null;
    phone: string | null;
    email: string | null;
    street: string | null;
    suburb: string | null;
    townCity: string | null;
    region: string | null;
    postcode: string | null;
  }>;
  militaryHistory: {
    everUndertakenMilitaryService: boolean | null;
    militaryServiceCompulsoryHome: boolean | null;
    wasExemptFromMilitaryService: boolean | null;
    exemptExplanation: string | null;
    services: Array<{
      id: string;
      dateStarted: Date | null;
      dateFinished: Date | null;
      location: string | null;
      corps: string | null;
      rank: string | null;
      duties: string | null;
      commandingOfficer: string | null;
    }>;
  } | null;
  travelHistory: Array<{
    id: string;
    destination: string;
    dateEnteredMonth: number | null;
    dateEnteredYear: number | null;
    dateExitedMonth: number | null;
    dateExitedYear: number | null;
    arrivalMode: string | null;
    pointOfEntry: string | null;
    purposeOfTravel: string | null;
    otherPurpose: string | null;
  }>;
  immigrationAssistance: {
    completingOnBehalf: boolean | null;
    capacity: string | null;
    adviserNumber: string | null;
    adviserFullName: string | null;
    adviserEmail: string | null;
    adviserContactNumber: string | null;
    adviserIsPrimaryContact: boolean | null;
  } | null;
  // PR-FILES-2 — each supporting-document parent now exposes a files[]
  // array. The LIA frontend renders one row per child file with its
  // own download button (the download endpoint takes a child-file id).
  // Raw fileUrl never leaves the backend.
  supportingDocuments: Array<{
    id: string;
    docType: string;
    files: Array<{
      id: string;
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
      uploadedAt: Date;
    }>;
  }>;
  // PR-FILES-2 — same per-parent files[] treatment for other-evidence
  // entries. customLabel is decrypted at the boundary (populated only
  // when evidenceType = OTHER).
  otherEvidence: Array<{
    id: string;
    evidenceType: string;
    customLabel: string | null;
    files: Array<{
      id: string;
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
      uploadedAt: Date;
    }>;
  }>;
  completeness: {
    applicant: FieldCompleteness;
    citizenships: CountCompleteness;
    tbCountries: CountCompleteness;
    educationEntries: CountCompleteness;
    employmentEntries: CountCompleteness;
    unemploymentEntries: CountCompleteness;
    family: FamilyCompleteness;
    nzContacts: CountCompleteness;
    militaryHistory: BoolCompleteness;
    travelHistory: CountCompleteness;
    immigrationAssistance: BoolCompleteness;
    supportingDocuments: CountCompleteness;
    otherEvidence: CountCompleteness;
  };
}

@Injectable()
export class InzDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async getInzDataForCase(caseId: string): Promise<InzDataPayload> {
    const crmCase = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        stage: true,
        createdAt: true,
        // PR-LIA-7: project the INZ submission columns so the response
        // can include them for the inz-data viewer's "submitted" banner.
        inzApplicationNumber: true,
        inzSubmittedAt: true,
        // PR-LIA-8: visa outcome row for the "issued / declined" banner.
        visa: {
          select: {
            outcome: true,
            visaEndDate: true,
            issuedAt: true,
          },
        },
        lead: {
          select: {
            contact: {
              select: {
                fullName: true,
                email: true,
                phone: true,
                dateOfBirth: true,
                gender: true,
                nationality: true,
                countryOfResidence: true,
              },
            },
          },
        },
      },
    });
    if (!crmCase) throw new NotFoundException('Case not found');

    const contact = crmCase.lead?.contact ?? null;

    // Resolve the visa application via Case → AdmissionApplication →
    // VisaApplication. Missing rows are non-fatal — every section
    // simply renders empty.
    const admission = await this.prisma.admissionApplication.findFirst({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const visa = admission
      ? await this.prisma.visaApplication.findUnique({
          where: { applicationId: admission.id },
        })
      : null;

    // Education lives on the admission side; pull the supplement
    // when present.
    const educationRaw = admission
      ? await this.prisma.admissionEducationEntry.findMany({
          where: { admissionApplicationId: admission.id },
          orderBy: { sortOrder: 'asc' },
          include: { visaSupplement: true },
        })
      : [];

    // Visa child collections — only if a VisaApplication exists.
    const [
      otherCitizenships,
      tbRiskCountries,
      employmentEntries,
      unemploymentEntries,
      partner,
      formerPartners,
      children,
      parents,
      siblings,
      nzContacts,
      militaryServices,
      travelHistoryEntries,
      supportingDocuments,
      otherEvidenceEntries,
    ] = visa
      ? await Promise.all([
          this.prisma.visaOtherCitizenship.findMany({
            where: { visaApplicationId: visa.id },
            orderBy: { sortOrder: 'asc' },
          }),
          this.prisma.visaTbRiskCountry.findMany({
            where: { visaApplicationId: visa.id },
            orderBy: { sortOrder: 'asc' },
          }),
          this.prisma.visaEmploymentEntry.findMany({
            where: { visaApplicationId: visa.id },
            orderBy: { sortOrder: 'asc' },
          }),
          this.prisma.visaUnemploymentEntry.findMany({
            where: { visaApplicationId: visa.id },
            orderBy: { sortOrder: 'asc' },
          }),
          this.prisma.visaPartner.findUnique({
            where: { visaApplicationId: visa.id },
          }),
          this.prisma.visaFormerPartner.findMany({
            where: { visaApplicationId: visa.id },
            orderBy: { sortOrder: 'asc' },
          }),
          this.prisma.visaChild.findMany({
            where: { visaApplicationId: visa.id },
            orderBy: { sortOrder: 'asc' },
          }),
          this.prisma.visaParent.findMany({
            where: { visaApplicationId: visa.id },
            orderBy: { sortOrder: 'asc' },
          }),
          this.prisma.visaSibling.findMany({
            where: { visaApplicationId: visa.id },
            orderBy: { sortOrder: 'asc' },
          }),
          this.prisma.visaNzContact.findMany({
            where: { visaApplicationId: visa.id },
            orderBy: { sortOrder: 'asc' },
          }),
          this.prisma.visaMilitaryService.findMany({
            where: { visaApplicationId: visa.id },
            orderBy: { sortOrder: 'asc' },
          }),
          this.prisma.visaTravelHistoryEntry.findMany({
            where: { visaApplicationId: visa.id },
            orderBy: { sortOrder: 'asc' },
          }),
          // PR-FILES-2: each parent now exposes a files[] child array.
          this.prisma.visaSupportingDocument.findMany({
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
          }),
          // PR-FILES-1: surface Step-14 other-evidence entries too.
          this.prisma.visaOtherEvidenceEntry.findMany({
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
          }),
        ])
      : [[], [], [], [], null, [], [], [], [], [], [], [], [], []] as const;

    // ─── Build applicant block ──────────────────────────────────────────
    const applicant: InzDataPayload['applicant'] = {
      fullName: contact?.fullName ?? null,
      dateOfBirth: contact?.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      gender: visa?.passportGender ?? contact?.gender ?? null,
      email: contact?.email ?? null,
      phone:
        visa?.preferredContactNumber
          ? this.formatPhone(visa.preferredContactCountryCode, visa.preferredContactNumber)
          : contact?.phone ?? null,
      countryOfBirth: visa
        ? visa.stateOfBirth || visa.cityOfBirth
          ? `${visa.cityOfBirth ?? ''}${visa.cityOfBirth && visa.stateOfBirth ? ', ' : ''}${visa.stateOfBirth ?? ''}`
          : null
        : null,
      countryOfResidence: visa?.physicalCountry ?? contact?.countryOfResidence ?? null,
      passportNumber: null, // PR-VISA passportNumber lives on admission as encrypted; not surfaced here.
      passportExpiry: visa?.passportExpiryDate?.toISOString().slice(0, 10) ?? null,
      passportCountry: visa?.passportCountryOfIssue ?? null,
    };

    // ─── Build sections ─────────────────────────────────────────────────
    const citizenships = (otherCitizenships ?? []).map((c) => ({
      id: c.id,
      country: c.country,
      holdsPassport: c.holdsPassport ?? null,
    }));

    const tbCountries = (tbRiskCountries ?? []).map((c) => ({
      id: c.id,
      country: c.country,
      totalDurationDays: c.totalDurationDays ?? null,
    }));

    const educationEntries = educationRaw.map((e) => ({
      id: e.id,
      institution: e.institutionName,
      qualification: e.qualificationLevel,
      fieldOfStudy: e.fieldOfStudy ?? null,
      startYear: e.startYear ?? null,
      endYear: e.endYear ?? null,
      country: e.country,
      completed: e.completed,
      supplement: e.visaSupplement
        ? {
            startMonth: e.visaSupplement.startMonth ?? null,
            endMonth: e.visaSupplement.endMonth ?? null,
            institutionState: e.visaSupplement.institutionState ?? null,
            institutionTown: e.visaSupplement.institutionTown ?? null,
            qualificationAwarded: e.visaSupplement.qualificationAwarded ?? null,
          }
        : null,
    }));

    const employmentEntriesOut = (employmentEntries ?? []).map((emp) => ({
      id: emp.id,
      entryKind: String(emp.entryKind),
      employer: emp.employerName ?? null,
      role: emp.roleTitle ?? null,
      duties: this.safeDecrypt(emp.dutiesEncrypted),
      startDate: emp.startDate ?? null,
      endDate: emp.endDate ?? null,
      country: emp.countryOfWork ?? null,
      state: emp.stateOfWork ?? null,
      supervisorName: emp.supervisorName ?? null,
    }));

    const unemploymentEntriesOut = (unemploymentEntries ?? []).map((u) => ({
      id: u.id,
      startDate: u.startDate ?? null,
      endDate: u.endDate ?? null,
      activity: this.safeDecrypt(u.activityEncrypted),
      financialSupport: this.safeDecrypt(u.financialSupportEncrypted),
    }));

    const partnerOut = partner
      ? {
          id: partner.id,
          fullName: this.composeFullName(
            partner.givenNameEncrypted,
            partner.middleNamesEncrypted,
            partner.surnameEncrypted,
          ),
          dateOfBirth: partner.dateOfBirth ?? null,
          gender: partner.gender ?? null,
          relationshipStatus: partner.relationshipStatus ?? null,
          countryOfBirth: partner.countryOfBirth ?? null,
          nationality: partner.nationality ?? null,
          countryOfResidence: partner.countryOfResidence ?? null,
          occupation: partner.occupation ?? null,
          passportNumber: this.safeDecrypt(partner.passportNumberEncrypted),
          passportCountry: partner.passportCountryOfIssue ?? null,
        }
      : null;

    const formerPartnersOut = (formerPartners ?? []).map((p) => ({
      id: p.id,
      fullName: this.composeFullName(
        p.givenNameEncrypted,
        p.middleNamesEncrypted,
        p.surnameEncrypted,
      ),
      dateOfBirth: p.dateOfBirth ?? null,
      relationshipStatus: p.relationshipStatus ?? null,
      countryOfBirth: p.countryOfBirth ?? null,
      nationality: p.nationality ?? null,
    }));

    const childrenOut = (children ?? []).map((c) => ({
      id: c.id,
      fullName: this.composeFullName(
        c.givenNameEncrypted,
        c.middleNamesEncrypted,
        c.surnameEncrypted,
      ),
      dateOfBirth: c.dateOfBirth ?? null,
      countryOfBirth: c.countryOfBirth ?? null,
      nationality: c.nationality ?? null,
      livesWithApplicant: c.livesWithApplicant ?? null,
    }));

    const parentsOut = (parents ?? []).map((p) => ({
      id: p.id,
      fullName: this.composeFullName(
        p.givenNameEncrypted,
        p.middleNamesEncrypted,
        p.surnameEncrypted,
      ),
      relationshipToApplicant: p.relationshipToApplicant ?? null,
      isDeceased: p.isDeceased ?? null,
      dateOfBirth: p.dateOfBirth ?? null,
      countryOfResidence: p.countryOfResidence ?? null,
      occupation: p.occupation ?? null,
    }));

    const siblingsOut = (siblings ?? []).map((s) => ({
      id: s.id,
      fullName: this.composeFullName(
        s.givenNameEncrypted,
        s.middleNamesEncrypted,
        s.surnameEncrypted,
      ),
      relationshipToApplicant: s.relationshipToApplicant ?? null,
      dateOfBirth: s.dateOfBirth ?? null,
      countryOfResidence: s.countryOfResidence ?? null,
      occupation: s.occupation ?? null,
    }));

    const nzContactsOut = (nzContacts ?? []).map((c) => ({
      id: c.id,
      fullName: this.composeFullName(
        c.givenNameEncrypted,
        c.middleNamesEncrypted,
        c.surnameEncrypted,
      ),
      relationshipToApplicant: c.relationshipToApplicant ?? null,
      phone: this.safeDecrypt(c.phoneEncrypted),
      email: c.email ?? null,
      street: this.safeDecrypt(c.streetEncrypted),
      suburb: c.suburb ?? null,
      townCity: c.townCity ?? null,
      region: c.region ?? null,
      postcode: c.postcode ?? null,
    }));

    const militaryHistory =
      visa
        ? {
            everUndertakenMilitaryService: visa.everUndertakenMilitaryService ?? null,
            militaryServiceCompulsoryHome: visa.militaryServiceCompulsoryHome ?? null,
            wasExemptFromMilitaryService: visa.wasExemptFromMilitaryService ?? null,
            exemptExplanation: this.safeDecrypt(visa.exemptExplanationEncrypted),
            services: (militaryServices ?? []).map((m) => ({
              id: m.id,
              dateStarted: m.dateStarted ?? null,
              dateFinished: m.dateFinished ?? null,
              location: m.location ?? null,
              corps: m.corps ?? null,
              rank: m.rank ?? null,
              duties: this.safeDecrypt(m.dutiesEncrypted),
              commandingOfficer: m.commandingOfficer ?? null,
            })),
          }
        : null;

    const travelHistory = (travelHistoryEntries ?? []).map((t) => ({
      id: t.id,
      destination: this.safeDecrypt(t.destinationEncrypted) || '',
      dateEnteredMonth: t.dateEnteredMonth ?? null,
      dateEnteredYear: t.dateEnteredYear ?? null,
      dateExitedMonth: t.dateExitedMonth ?? null,
      dateExitedYear: t.dateExitedYear ?? null,
      arrivalMode: t.arrivalMode ? String(t.arrivalMode) : null,
      pointOfEntry: this.safeDecrypt(t.pointOfEntryEncrypted),
      purposeOfTravel: t.purposeOfTravel ? String(t.purposeOfTravel) : null,
      otherPurpose: this.safeDecrypt(t.otherPurposeEncrypted),
    }));

    const immigrationAssistance =
      visa
        ? {
            completingOnBehalf: visa.completingOnBehalf ?? null,
            capacity: visa.immigrationAssistanceCapacity
              ? String(visa.immigrationAssistanceCapacity)
              : null,
            adviserNumber: this.safeDecrypt(visa.adviserNumberEncrypted),
            adviserFullName: this.safeDecrypt(visa.adviserFullNameEncrypted),
            adviserEmail: this.safeDecrypt(visa.adviserEmailEncrypted),
            adviserContactNumber: this.safeDecrypt(visa.adviserContactNumberEncrypted),
            adviserIsPrimaryContact: visa.adviserIsPrimaryContact ?? null,
          }
        : null;

    // PR-FILES-2 — each parent emits a files[] of its child file rows.
    const supportingDocumentsOut = (supportingDocuments ?? []).map((d) => ({
      id: d.id,
      docType: String(d.documentType),
      files: d.files,
    }));

    const otherEvidenceOut = (otherEvidenceEntries ?? []).map((d) => ({
      id: d.id,
      evidenceType: String(d.evidenceType),
      customLabel: this.safeDecrypt(d.customLabelEncrypted),
      files: d.files,
    }));

    // ─── Pre-compute completeness ──────────────────────────────────────
    const applicantFields = Object.values(applicant);
    const completeness: InzDataPayload['completeness'] = {
      applicant: {
        filled: applicantFields.filter(
          (v) => v !== null && v !== '' && v !== undefined,
        ).length,
        total: applicantFields.length,
      },
      citizenships: { count: citizenships.length },
      tbCountries: { count: tbCountries.length },
      educationEntries: { count: educationEntries.length },
      employmentEntries: { count: employmentEntriesOut.length },
      unemploymentEntries: { count: unemploymentEntriesOut.length },
      family: {
        partner: !!partnerOut,
        formerPartners: formerPartnersOut.length,
        children: childrenOut.length,
        parents: parentsOut.length,
        siblings: siblingsOut.length,
      },
      nzContacts: { count: nzContactsOut.length },
      militaryHistory: {
        filled: militaryHistory
          ? Object.values(militaryHistory).some(
              (v) => v !== null && !(Array.isArray(v) && v.length === 0),
            )
          : false,
      },
      travelHistory: { count: travelHistory.length },
      immigrationAssistance: {
        filled: immigrationAssistance
          ? Object.values(immigrationAssistance).some((v) => v !== null && v !== '')
          : false,
      },
      supportingDocuments: { count: supportingDocumentsOut.length },
      otherEvidence: { count: otherEvidenceOut.length },
    };

    return {
      generatedAt: new Date().toISOString(),
      case: {
        id: crmCase.id,
        stage: String(crmCase.stage),
        createdAt: crmCase.createdAt,
        inzApplicationNumber: crmCase.inzApplicationNumber ?? null,
        inzSubmittedAt: crmCase.inzSubmittedAt ?? null,
        visaOutcome: crmCase.visa?.outcome ?? null,
        visaEndDate: crmCase.visa?.visaEndDate ?? null,
        visaIssuedAt: crmCase.visa?.issuedAt ?? null,
      },
      applicant,
      citizenships,
      tbCountries,
      educationEntries,
      employmentEntries: employmentEntriesOut,
      unemploymentEntries: unemploymentEntriesOut,
      partner: partnerOut,
      formerPartners: formerPartnersOut,
      children: childrenOut,
      parents: parentsOut,
      siblings: siblingsOut,
      nzContacts: nzContactsOut,
      militaryHistory,
      travelHistory,
      immigrationAssistance,
      supportingDocuments: supportingDocumentsOut,
      otherEvidence: otherEvidenceOut,
      completeness,
    };
  }

  // ─── PR-FILES-1: LIA-side download URLs ────────────────────────────
  //
  // The LIA hits these from the INZ-data viewer when they click
  // Download next to a document row. Each method:
  //   - layer 2 (case-scoped): resolves the row and verifies it
  //     belongs to the requested caseId through the
  //     Case → AdmissionApplication → VisaApplication chain. A
  //     mismatched/unknown id throws 404, NOT 403 — we don't leak
  //     whether the doc id exists on another case.
  //   - layer 7 (output): mints a signed URL with a 5-min TTL via
  //     createSignedDownloadToken; the existing /files/signed/:token
  //     controller validates the JWT before streaming bytes. The raw
  //     fileUrl never crosses the API boundary.
  //   - layer 6 (audit): writes LIA_VISA_DOC_DOWNLOADED with the
  //     caseId + entityId + fileName so we have a who-downloaded-what
  //     trail for every successful call.

  async createVisaSupportingDocDownloadUrl(
    caseId: string,
    fileId: string,
    actor: { id: string | null; name: string | null; role: string | null },
  ): Promise<{ url: string; expiresInSeconds: number }> {
    // PR-FILES-2 — walk child file → parent (documentType) → visa
    // application (applicationId) → admission (caseId). Two queries
    // because schema has no inverse relation from VisaApplication →
    // AdmissionApplication. 404 (not 403) on mismatched ownership.
    const file = await this.prisma.visaSupportingDocumentFile.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        originalFilename: true,
        mimeType: true,
        fileUrl: true,
        document: {
          select: {
            id: true,
            documentType: true,
            visaApplication: { select: { applicationId: true } },
          },
        },
      },
    });
    if (!file) {
      throw new NotFoundException('Document not found on this case.');
    }
    const admission = await this.prisma.admissionApplication.findUnique({
      where: { id: file.document.visaApplication.applicationId },
      select: { caseId: true },
    });
    if (!admission || admission.caseId !== caseId) {
      throw new NotFoundException('Document not found on this case.');
    }

    const token = createSignedDownloadToken({
      fileUrl:  file.fileUrl,
      fileName: file.originalFilename,
      mimeType: file.mimeType,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'DOWNLOAD',
        eventType: 'LIA_VISA_DOC_DOWNLOADED',
        entityType: 'VisaSupportingDocumentFile',
        entityId: file.id,
        newValue: {
          caseId,
          fileId: file.id,
          parentId: file.document.id,
          documentType: String(file.document.documentType),
          fileName: file.originalFilename,
        } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });

    return { url: `/files/signed/${token}`, expiresInSeconds: 5 * 60 };
  }

  async createVisaOtherEvidenceDownloadUrl(
    caseId: string,
    fileId: string,
    actor: { id: string | null; name: string | null; role: string | null },
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const file = await this.prisma.visaOtherEvidenceFile.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        originalFilename: true,
        mimeType: true,
        fileUrl: true,
        entry: {
          select: {
            id: true,
            evidenceType: true,
            visaApplication: { select: { applicationId: true } },
          },
        },
      },
    });
    if (!file) {
      throw new NotFoundException('Document not found on this case.');
    }
    const admission = await this.prisma.admissionApplication.findUnique({
      where: { id: file.entry.visaApplication.applicationId },
      select: { caseId: true },
    });
    if (!admission || admission.caseId !== caseId) {
      throw new NotFoundException('Document not found on this case.');
    }

    const token = createSignedDownloadToken({
      fileUrl:  file.fileUrl,
      fileName: file.originalFilename,
      mimeType: file.mimeType,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        action: 'DOWNLOAD',
        eventType: 'LIA_VISA_DOC_DOWNLOADED',
        entityType: 'VisaOtherEvidenceFile',
        entityId: file.id,
        newValue: {
          caseId,
          fileId: file.id,
          entryId: file.entry.id,
          evidenceType: String(file.entry.evidenceType),
          fileName: file.originalFilename,
        } as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });

    return { url: `/files/signed/${token}`, expiresInSeconds: 5 * 60 };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private safeDecrypt(payload: Uint8Array | Buffer | null | undefined): string | null {
    if (!payload) return null;
    try {
      const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      const out = this.crypto.decrypt(buf);
      return out === '' ? null : out;
    } catch {
      // Defensive: a failed decrypt (e.g. across a key rotation)
      // shouldn't crash the page — return empty so the field renders
      // as "—" and the rest of the payload still ships.
      return '';
    }
  }

  private composeFullName(
    given: Uint8Array | Buffer | null,
    middles: Uint8Array | Buffer | null,
    surname: Uint8Array | Buffer | null,
  ): string {
    const parts = [
      this.safeDecrypt(given),
      this.safeDecrypt(middles),
      this.safeDecrypt(surname),
    ].filter((p): p is string => !!p && p.length > 0);
    return parts.join(' ') || '(name unknown)';
  }

  private formatPhone(countryCode: string | null, number: string | null): string | null {
    const trimmed = (number ?? '').trim();
    if (!trimmed) return null;
    const cc = (countryCode ?? '').trim();
    return cc ? `${cc.startsWith('+') ? '' : '+'}${cc} ${trimmed}` : trimmed;
  }
}
