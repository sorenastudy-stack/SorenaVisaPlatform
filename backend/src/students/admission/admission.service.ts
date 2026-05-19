import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { createSignedDownloadToken } from '../../common/signed-url.util';
import { CryptoService } from '../../common/crypto/crypto.service';
import { encryptPiiFields, decryptPiiFields } from './admission-encryption.util';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

const VALID_DOCUMENT_TYPES = [
  'PASSPORT',
  'NZ_VISA_HISTORY',
  'VISA_REFUSAL_LETTER',
  'ENGLISH_TEST_EVIDENCE',
  'EDUCATION_TRANSCRIPTS',
  'SUPPORTING_DOCUMENT',
  'NOTARIZED_CERTIFICATE',
  'NOTARIZED_TRANSCRIPT',
] as const;

const VALID_QUALIFICATION_LEVELS = [
  'INTERMEDIATE',
  'HIGH_SCHOOL',
  'CERTIFICATE',
  'DIPLOMA',
  'ASSOCIATE_DEGREE',
  'BACHELORS',
  'MASTERS',
  'DOCTORATE',
  'OTHER',
] as const;

const VALID_MARITAL_STATUSES = [
  'SINGLE',
  'MARRIED',
  'DE_FACTO',
  'WIDOWED',
  'DIVORCED',
  'SEPARATED',
] as const;

// ── Auto-ticket triggers ──────────────────────────────────────────────────────

const ENGLISH_PRECOURSE_TICKET_SUBJECT = 'English pre-course consultation requested';
const ENGLISH_PRECOURSE_TICKET_BODY =
  'This applicant indicated they will study an English language course before starting their intended programme. A consultant should reach out to discuss English pathway options.';

// ── PATCH allow-list ──────────────────────────────────────────────────────────

const PATCHABLE_FIELDS: Record<string, 'text' | 'boolean' | 'int' | 'datetime'> = {
  currentStep:            'int',
  // Step 2
  dateOfBirth:            'datetime',
  maritalStatus:          'text',
  hasChildren:            'boolean',
  phone:                  'text',
  phoneType:              'text',
  countryOfBirth:         'text',
  citizenship:            'text',
  ethnicity:              'text',
  passportNumber:         'text',
  visaRefused:            'boolean',
  visaRefusalDetails:     'text',
  // Step 3A
  englishTestSat:         'boolean',
  englishTestName:        'text',
  englishPreCourse:       'boolean',
  // Step 3B
  hasDisability:          'boolean',
  disabilityDetails:      'text',
  needsEvacAssistance:    'boolean',
  evacDetails:            'text',
  medicalNotes:           'text',
  otherStudyNotes:        'text',
  // Step 3C
  schoolCountry:          'text',
  schoolName:             'text',
  schoolQualification:    'text',
  qualificationCompleted: 'boolean',
  qualYearStart:          'int',
  qualYearEnd:            'int',
  lastYearOfSchool:       'int',
  highestQualification:   'text',
  // Step 3D
  sponsorshipProgramme:   'text',
  // Step 5
  guardianRelationship:   'text',
  guardianFirstName:      'text',
  guardianLastName:       'text',
  guardianEmail:          'text',
  guardianMobile:         'text',
  guardianHomePhone:      'text',
  guardianAddressSameAs:  'boolean',
  guardianStreet:         'text',
  guardianSuburb:         'text',
  guardianCity:           'text',
  guardianState:          'text',
  guardianCountry:        'text',
  guardianPostcode:       'text',
  // Step 6
  accommodationType:      'text',
  // Step 7
  counsellorFirstName:    'text',
  counsellorLastName:     'text',
  counsellorEmail:        'text',
  anotherBranch:          'boolean',
  branchAgentCode:        'text',
  branchName:             'text',
  agentDeclarationAgreed: 'boolean',
  agentComments:          'text',
  // Step 8
  termsAgreedAt:          'datetime',
};

function coerceField(key: string, value: unknown, type: 'text' | 'boolean' | 'int' | 'datetime'): unknown {
  if (value === null || value === undefined) return null;
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

function stripAndCoerce(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const type = PATCHABLE_FIELDS[key];
    if (!type) continue;
    result[key] = coerceField(key, value, type);
  }
  return result;
}

// ── Submit validation ─────────────────────────────────────────────────────────

/**
 * Whole-years age today, or null when DOB is missing/invalid.
 * Mirrors the frontend's stepVisibility.calculateAge logic.
 */
function calculateAge(dob: Date | null | undefined): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  if (age < 0 || age > 150) return null;
  return age;
}

/**
 * Fail-safe: missing/invalid DOB is treated as under-18 (so guardian and
 * accommodation fields stay required when we don't know the age).
 */
function isApplicantUnder18(dob: Date | null | undefined): boolean {
  const age = calculateAge(dob);
  if (age === null) return true;
  return age < 18;
}

function validateRequiredFields(application: any, role: string): string[] {
  const missing: string[] = [];

  // Steps 5 (Guardian) and 6 (Accommodation) are hidden from the UI for 18+
  // applicants — their fields are therefore not required at submit either.
  // This must mirror the frontend stepVisibility.isUnder18 logic.
  const under18 = isApplicantUnder18(application.dateOfBirth);

  const textChecks: Array<{ field: string; label: string; condition?: boolean }> = [
    { field: 'maritalStatus',        label: 'maritalStatus' },
    { field: 'phone',                label: 'phone' },
    { field: 'phoneType',            label: 'phoneType' },
    { field: 'countryOfBirth',       label: 'countryOfBirth' },
    { field: 'citizenship',          label: 'citizenship' },
    { field: 'ethnicity',            label: 'ethnicity' },
    { field: 'passportNumber',       label: 'passportNumber' },
    { field: 'schoolCountry',        label: 'schoolCountry' },
    { field: 'schoolName',           label: 'schoolName' },
    { field: 'schoolQualification',  label: 'schoolQualification' },
    { field: 'highestQualification', label: 'highestQualification' },
    { field: 'sponsorshipProgramme', label: 'sponsorshipProgramme' },
    { field: 'lastYearOfSchool',     label: 'lastYearOfSchool' },
    { field: 'guardianRelationship', label: 'guardianRelationship', condition: under18 },
    { field: 'guardianFirstName',    label: 'guardianFirstName',    condition: under18 },
    { field: 'guardianLastName',     label: 'guardianLastName',     condition: under18 },
    { field: 'guardianEmail',        label: 'guardianEmail',        condition: under18 },
    { field: 'guardianMobile',       label: 'guardianMobile',       condition: under18 },
    { field: 'guardianStreet',       label: 'guardianStreet',       condition: under18 },
    { field: 'guardianSuburb',       label: 'guardianSuburb',       condition: under18 },
    { field: 'guardianCity',         label: 'guardianCity',         condition: under18 },
    { field: 'guardianCountry',      label: 'guardianCountry',      condition: under18 },
    { field: 'guardianPostcode',     label: 'guardianPostcode',     condition: under18 },
    { field: 'accommodationType',    label: 'accommodationType',    condition: under18 },
    { field: 'counsellorFirstName',  label: 'counsellorFirstName',  condition: role === 'AGENT' },
    { field: 'counsellorLastName',   label: 'counsellorLastName',   condition: role === 'AGENT' },
    { field: 'counsellorEmail',      label: 'counsellorEmail',      condition: role === 'AGENT' },
  ];

  for (const { field, label, condition } of textChecks) {
    if (condition === false) continue;
    const value = application[field];
    if (value === null || value === undefined || value === '') missing.push(label);
  }

  // Boolean fields: false IS a valid answer — only null/undefined means unanswered
  for (const field of ['hasChildren', 'englishTestSat', 'hasDisability', 'needsEvacAssistance'] as const) {
    if (application[field] === null || application[field] === undefined) missing.push(field);
  }

  if (!application.dateOfBirth) missing.push('dateOfBirth');
  if (!application.termsAgreedAt) missing.push('termsAgreedAt');

  if (role === 'AGENT' && !application.agentDeclarationAgreed) {
    missing.push('agentDeclarationAgreed');
  }

  return missing;
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class AdmissionService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private crypto: CryptoService,
  ) {}

  // ── Private helpers ───────────────────────────────────────────────────────

  private async resolveContactAndCase(userId: string) {
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

    return { contact, caseRecord };
  }

  private async findOrCreateApplication(caseId: string, contactId: string) {
    const existing = await this.prisma.admissionApplication.findFirst({
      where: { caseId },
    });
    if (existing) return existing;

    return this.prisma.admissionApplication.create({
      data: { caseId, contactId, status: 'DRAFT', currentStep: 1 },
    });
  }

  private async assertDocumentOwnership(documentId: string, userId: string) {
    const doc = await this.prisma.admissionDocument.findUnique({
      where: { id: documentId },
      include: {
        admissionApplication: {
          include: { contact: true },
        },
      },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.admissionApplication.contact.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return doc;
  }

  private async loadFullApplication(caseId: string) {
    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId },
      include: {
        documents: true,
        programmeChoices: {
          orderBy: { priority: 'asc' },
          include: { programme: { select: { name: true } } },
        },
        educationEntries: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!application) return { exists: false as const };

    const { documents, programmeChoices, educationEntries, ...appData } = application;
    const decryptedAppData = decryptPiiFields(this.crypto, appData as Record<string, unknown>);

    return {
      exists: true as const,
      application: decryptedAppData,
      programmeChoices: programmeChoices.map((c) => ({
        id: c.id,
        programmeId: c.programmeId,
        programmeName: c.programme.name,
        intakeMonth: c.intakeMonth,
        intakeYear: c.intakeYear,
        priority: c.priority,
      })),
      educationEntries: educationEntries.map((e) => ({
        id: e.id,
        qualificationLevel: e.qualificationLevel,
        institutionName: e.institutionName,
        country: e.country,
        fieldOfStudy: e.fieldOfStudy,
        startYear: e.startYear,
        endYear: e.endYear,
        completed: e.completed,
        certificateNotReceived: e.certificateNotReceived,
        sortOrder: e.sortOrder,
      })),
      documents: documents.map((doc) => ({
        id: doc.id,
        documentType: doc.documentType,
        educationEntryId: doc.educationEntryId,
        fileName: doc.fileName,
        fileUrl: `/files/signed/${createSignedDownloadToken({ fileUrl: doc.fileUrl, fileName: doc.fileName, mimeType: doc.mimeType })}`,
        mimeType: doc.mimeType,
        fileSizeBytes: doc.fileSizeBytes,
        uploadedAt: doc.uploadedAt,
      })),
    };
  }

  // ── Document endpoints (PR 2) ─────────────────────────────────────────────

  async uploadDocument(
    userId: string,
    file: Express.Multer.File,
    documentType: string,
    educationEntryId?: string,
  ) {
    if (!VALID_DOCUMENT_TYPES.includes(documentType as any)) {
      throw new BadRequestException(
        `Invalid documentType. Valid values: ${VALID_DOCUMENT_TYPES.join(', ')}`,
      );
    }

    const { contact, caseRecord } = await this.resolveContactAndCase(userId);
    const application = await this.findOrCreateApplication(caseRecord.id, contact.id);

    // If linking to an education entry, verify it belongs to this application.
    if (educationEntryId) {
      const entry = await this.prisma.admissionEducationEntry.findUnique({
        where: { id: educationEntryId },
      });
      if (!entry || entry.admissionApplicationId !== application.id) {
        throw new ForbiddenException('Education entry not found or does not belong to this application');
      }
    }

    const destDir = path.join(UPLOAD_DIR, 'admission-documents', application.id);
    await fs.promises.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, path.basename(file.path));
    await fs.promises.rename(file.path, destPath);

    const doc = await this.prisma.admissionDocument.create({
      data: {
        admissionApplicationId: application.id,
        educationEntryId: educationEntryId ?? null,
        documentType: documentType as any,
        fileName: file.originalname,
        fileUrl: destPath,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ADMISSION_DOCUMENT_UPLOADED',
        entityType: 'AdmissionDocument',
        entityId: doc.id,
        newValue: {
          documentType,
          fileName: file.originalname,
          fileSizeBytes: file.size,
          admissionApplicationId: application.id,
          educationEntryId: educationEntryId ?? null,
        },
      },
    });

    return {
      id: doc.id,
      documentType: doc.documentType,
      educationEntryId: doc.educationEntryId,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes,
      uploadedAt: doc.uploadedAt,
    };
  }

  async listDocuments(userId: string, documentType?: string, educationEntryId?: string) {
    const { caseRecord } = await this.resolveContactAndCase(userId);

    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
    });
    if (!application) return [];

    const docs = await this.prisma.admissionDocument.findMany({
      where: {
        admissionApplicationId: application.id,
        ...(documentType ? { documentType: documentType as any } : {}),
        ...(educationEntryId !== undefined ? { educationEntryId } : {}),
      },
      orderBy: { uploadedAt: 'desc' },
    });

    return docs.map((doc) => ({
      id: doc.id,
      documentType: doc.documentType,
      educationEntryId: doc.educationEntryId,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes,
      uploadedAt: doc.uploadedAt,
    }));
  }

  async getDownloadUrl(userId: string, documentId: string) {
    const doc = await this.assertDocumentOwnership(documentId, userId);
    const token = createSignedDownloadToken({
      fileUrl: doc.fileUrl,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
    });
    return { url: `/files/signed/${token}`, expiresInSeconds: 300 };
  }

  async deleteDocument(userId: string, documentId: string) {
    const doc = await this.assertDocumentOwnership(documentId, userId);

    const absPath = path.resolve(doc.fileUrl);
    try {
      await fs.promises.unlink(absPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        console.warn(`File already gone, skipping unlink: ${absPath}`);
      } else {
        throw err;
      }
    }

    await this.prisma.admissionDocument.delete({ where: { id: documentId } });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ADMISSION_DOCUMENT_DELETED',
        entityType: 'AdmissionDocument',
        entityId: documentId,
        oldValue: {
          documentType: doc.documentType,
          fileName: doc.fileName,
        },
      },
    });
  }

  // ── Application endpoints (PR 3) ──────────────────────────────────────────

  async getApplication(userId: string) {
    const { caseRecord } = await this.resolveContactAndCase(userId);
    return this.loadFullApplication(caseRecord.id);
  }

  async getOrCreateApplication(userId: string) {
    const { contact, caseRecord } = await this.resolveContactAndCase(userId);
    await this.findOrCreateApplication(caseRecord.id, contact.id);
    return this.loadFullApplication(caseRecord.id);
  }

  async updateApplication(userId: string, body: Record<string, unknown>) {
    const { contact, caseRecord } = await this.resolveContactAndCase(userId);

    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status === 'SUBMITTED' || application.status === 'LOCKED') {
      throw new ConflictException('Application is read-only after submission');
    }

    const data = stripAndCoerce(body);

    // Allow-list validation for fields that have a fixed value set on the
    // frontend (server is the final authority).
    if (data.maritalStatus !== undefined && data.maritalStatus !== null) {
      if (!VALID_MARITAL_STATUSES.includes(data.maritalStatus as any)) {
        throw new BadRequestException(
          `Invalid maritalStatus. Valid values: ${VALID_MARITAL_STATUSES.join(', ')}`,
        );
      }
    }

    const changedKeys = Object.keys(data);
    // PII fields in `data` are still plaintext; encryptPiiFields renames each
    // accepted PII key to `<name>Encrypted` with an AES-256-GCM Buffer value
    // (or null when the user is clearing the field).
    const persistedData = encryptPiiFields(this.crypto, data);

    if (changedKeys.length > 0) {
      await this.prisma.admissionApplication.update({
        where: { id: application.id },
        data: persistedData,
      });

      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'ADMISSION_APPLICATION_UPDATED',
          entityType: 'AdmissionApplication',
          entityId: application.id,
          // Audit log records the plaintext field names (PII-redacted shape),
          // not the encrypted column names. The values are never logged.
          newValue: { updatedFields: changedKeys },
        },
      });

      // Auto-ticket: trigger when englishPreCourse is set to true in this PATCH.
      // Idempotency guarded inside the helper.
      if (data.englishPreCourse === true) {
        await this.maybeCreateEnglishPreCourseTicket(userId, caseRecord.id, contact.id);
      }
    }

    return this.loadFullApplication(caseRecord.id);
  }

  private async maybeCreateEnglishPreCourseTicket(
    userId: string,
    caseId: string,
    contactId: string,
  ): Promise<void> {
    try {
      const existing = await this.prisma.ticket.findFirst({
        where: {
          caseId,
          subject: ENGLISH_PRECOURSE_TICKET_SUBJECT,
          status: { not: 'CLOSED' },
        },
      });
      if (existing) return;

      await this.prisma.ticket.create({
        data: {
          caseId,
          contactId,
          subject: ENGLISH_PRECOURSE_TICKET_SUBJECT,
          createdById: userId,
          messages: {
            create: {
              senderId: userId,
              body: ENGLISH_PRECOURSE_TICKET_BODY,
              attachments: [],
              isInternal: false,
            },
          },
        },
      });

      // TODO: in-app notification — Notification model not yet created (tracked in docs/known_issues.md)
    } catch (err) {
      console.warn('English pre-course auto-ticket creation failed (non-fatal):', err);
    }
  }

  async addProgrammeChoice(
    userId: string,
    body: { programmeId: string; intakeMonth: number; intakeYear: number },
  ) {
    const { caseRecord } = await this.resolveContactAndCase(userId);

    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
      include: { programmeChoices: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status !== 'DRAFT') {
      throw new ConflictException('Cannot modify a submitted application');
    }

    const programme = await this.prisma.educationProgramme.findUnique({
      where: { id: body.programmeId },
    });
    if (!programme) throw new NotFoundException('Programme not found');

    const { programmeId, intakeMonth, intakeYear } = body;

    const exactDuplicate = application.programmeChoices.find(
      (c) => c.programmeId === programmeId && c.intakeMonth === intakeMonth && c.intakeYear === intakeYear,
    );
    if (exactDuplicate) {
      throw new ConflictException('This programme + intake combination is already selected');
    }

    const sameProgramme = application.programmeChoices.find(
      (c) => c.programmeId === programmeId,
    );
    if (sameProgramme) {
      throw new ConflictException(
        'This programme is already selected. Only one intake per programme is allowed.',
      );
    }

    const priority = application.programmeChoices.length + 1;

    const choice = await this.prisma.admissionProgrammeChoice.create({
      data: {
        admissionApplicationId: application.id,
        programmeId,
        intakeMonth,
        intakeYear,
        priority,
      },
      include: { programme: { select: { name: true } } },
    });

    return {
      id: choice.id,
      programmeId: choice.programmeId,
      programmeName: choice.programme.name,
      intakeMonth: choice.intakeMonth,
      intakeYear: choice.intakeYear,
      priority: choice.priority,
    };
  }

  async deleteProgrammeChoice(userId: string, choiceId: string) {
    const { caseRecord } = await this.resolveContactAndCase(userId);

    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
      include: { programmeChoices: { orderBy: { priority: 'asc' } } },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status !== 'DRAFT') {
      throw new ConflictException('Cannot modify a submitted application');
    }

    const choice = application.programmeChoices.find((c) => c.id === choiceId);
    if (!choice) throw new NotFoundException('Programme choice not found');

    await this.prisma.admissionProgrammeChoice.delete({ where: { id: choiceId } });

    const remaining = application.programmeChoices.filter((c) => c.id !== choiceId);
    await Promise.all(
      remaining.map((c, i) =>
        this.prisma.admissionProgrammeChoice.update({
          where: { id: c.id },
          data: { priority: i + 1 },
        }),
      ),
    );
  }

  async reorderProgrammeChoices(userId: string, orderedIds: string[]) {
    const { caseRecord } = await this.resolveContactAndCase(userId);

    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
      include: {
        programmeChoices: {
          include: { programme: { select: { name: true } } },
        },
      },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status !== 'DRAFT') {
      throw new ConflictException('Cannot modify a submitted application');
    }

    const currentIds = new Set(application.programmeChoices.map((c) => c.id));
    const incomingIds = new Set(orderedIds);

    if (
      currentIds.size !== incomingIds.size ||
      ![...currentIds].every((id) => incomingIds.has(id))
    ) {
      throw new BadRequestException(
        'orderedIds must contain exactly the same IDs as current programme choices',
      );
    }

    await Promise.all(
      orderedIds.map((id, i) =>
        this.prisma.admissionProgrammeChoice.update({
          where: { id },
          data: { priority: i + 1 },
        }),
      ),
    );

    return this.loadFullApplication(caseRecord.id);
  }

  // ── Education entry CRUD (PR-EDU1) ────────────────────────────────────────

  private async assertEducationEntryOwnership(entryId: string, applicationId: string) {
    const entry = await this.prisma.admissionEducationEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry) throw new NotFoundException('Education entry not found');
    if (entry.admissionApplicationId !== applicationId) {
      throw new ForbiddenException('Education entry does not belong to this application');
    }
    return entry;
  }

  async addEducationEntry(
    userId: string,
    body: {
      qualificationLevel: string;
      institutionName: string;
      country: string;
      fieldOfStudy?: string | null;
      startYear?: number | null;
      endYear?: number | null;
      completed?: boolean;
      certificateNotReceived?: boolean;
    },
  ) {
    const { contact, caseRecord } = await this.resolveContactAndCase(userId);

    if (!body?.qualificationLevel || !VALID_QUALIFICATION_LEVELS.includes(body.qualificationLevel as any)) {
      throw new BadRequestException(
        `Invalid qualificationLevel. Valid values: ${VALID_QUALIFICATION_LEVELS.join(', ')}`,
      );
    }
    if (!body.institutionName?.trim()) {
      throw new BadRequestException('institutionName is required');
    }
    if (!body.country?.trim()) {
      throw new BadRequestException('country is required');
    }
    // PR-C1: fieldOfStudy is now app-required (column stays nullable for
    // backward compat with rows created before the rule).
    if (!body.fieldOfStudy?.trim()) {
      throw new BadRequestException('fieldOfStudy is required');
    }

    const application = await this.findOrCreateApplication(caseRecord.id, contact.id);

    // sortOrder = current max + 1 (append to the end)
    const last = await this.prisma.admissionEducationEntry.findFirst({
      where: { admissionApplicationId: application.id },
      orderBy: { sortOrder: 'desc' },
    });
    const sortOrder = (last?.sortOrder ?? -1) + 1;

    const entry = await this.prisma.admissionEducationEntry.create({
      data: {
        admissionApplicationId: application.id,
        qualificationLevel: body.qualificationLevel,
        institutionName: body.institutionName.trim(),
        country: body.country.trim(),
        fieldOfStudy: body.fieldOfStudy.trim(),
        startYear: body.startYear ?? null,
        endYear: body.endYear ?? null,
        completed: body.completed ?? false,
        certificateNotReceived: body.certificateNotReceived ?? false,
        sortOrder,
      },
    });

    return {
      id: entry.id,
      qualificationLevel: entry.qualificationLevel,
      institutionName: entry.institutionName,
      country: entry.country,
      fieldOfStudy: entry.fieldOfStudy,
      startYear: entry.startYear,
      endYear: entry.endYear,
      completed: entry.completed,
      certificateNotReceived: entry.certificateNotReceived,
      sortOrder: entry.sortOrder,
    };
  }

  async updateEducationEntry(userId: string, entryId: string, body: Record<string, unknown>) {
    const { caseRecord } = await this.resolveContactAndCase(userId);
    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status !== 'DRAFT') {
      throw new ConflictException('Cannot modify a submitted application');
    }

    await this.assertEducationEntryOwnership(entryId, application.id);

    const data: Record<string, unknown> = {};
    if (body.qualificationLevel !== undefined) {
      if (typeof body.qualificationLevel !== 'string'
        || !VALID_QUALIFICATION_LEVELS.includes(body.qualificationLevel as any)) {
        throw new BadRequestException(
          `Invalid qualificationLevel. Valid values: ${VALID_QUALIFICATION_LEVELS.join(', ')}`,
        );
      }
      data.qualificationLevel = body.qualificationLevel;
    }
    if (body.institutionName !== undefined) {
      const v = String(body.institutionName).trim();
      if (!v) throw new BadRequestException('institutionName cannot be empty');
      data.institutionName = v;
    }
    if (body.country !== undefined) {
      const v = String(body.country).trim();
      if (!v) throw new BadRequestException('country cannot be empty');
      data.country = v;
    }
    if (body.fieldOfStudy !== undefined) {
      // PR-C1: fieldOfStudy is now app-required. If a client tries to clear
      // it (passes null or empty), reject — they can never PATCH it to empty.
      const v = body.fieldOfStudy === null ? '' : String(body.fieldOfStudy).trim();
      if (!v) throw new BadRequestException('fieldOfStudy cannot be empty');
      data.fieldOfStudy = v;
    }
    if (body.startYear !== undefined) {
      data.startYear = body.startYear === null ? null : Number(body.startYear);
    }
    if (body.endYear !== undefined) {
      data.endYear = body.endYear === null ? null : Number(body.endYear);
    }
    if (body.completed !== undefined) {
      data.completed = Boolean(body.completed);
    }
    if (body.certificateNotReceived !== undefined) {
      data.certificateNotReceived = Boolean(body.certificateNotReceived);
    }

    const entry = await this.prisma.admissionEducationEntry.update({
      where: { id: entryId },
      data,
    });

    return {
      id: entry.id,
      qualificationLevel: entry.qualificationLevel,
      institutionName: entry.institutionName,
      country: entry.country,
      fieldOfStudy: entry.fieldOfStudy,
      startYear: entry.startYear,
      endYear: entry.endYear,
      completed: entry.completed,
      certificateNotReceived: entry.certificateNotReceived,
      sortOrder: entry.sortOrder,
    };
  }

  async deleteEducationEntry(userId: string, entryId: string) {
    const { caseRecord } = await this.resolveContactAndCase(userId);
    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status !== 'DRAFT') {
      throw new ConflictException('Cannot modify a submitted application');
    }

    await this.assertEducationEntryOwnership(entryId, application.id);

    // Cascade in the DB removes any AdmissionDocument rows linked to this entry
    // (FK ON DELETE CASCADE on admission_documents.educationEntryId). The
    // physical files on disk are NOT cleaned up here; that's a separate
    // janitorial concern matching the existing deleteProgrammeChoice pattern.
    await this.prisma.admissionEducationEntry.delete({ where: { id: entryId } });

    // Re-number sortOrder for the remaining entries to keep them contiguous.
    const remaining = await this.prisma.admissionEducationEntry.findMany({
      where: { admissionApplicationId: application.id },
      orderBy: { sortOrder: 'asc' },
    });
    await Promise.all(
      remaining.map((e, i) =>
        this.prisma.admissionEducationEntry.update({
          where: { id: e.id },
          data: { sortOrder: i },
        }),
      ),
    );
  }

  async reorderEducationEntries(userId: string, orderedIds: string[]) {
    const { caseRecord } = await this.resolveContactAndCase(userId);
    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
      include: { educationEntries: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status !== 'DRAFT') {
      throw new ConflictException('Cannot modify a submitted application');
    }

    const currentIds = new Set(application.educationEntries.map((e) => e.id));
    const incomingIds = new Set(orderedIds);
    if (
      currentIds.size !== incomingIds.size ||
      ![...currentIds].every((id) => incomingIds.has(id))
    ) {
      throw new BadRequestException(
        'orderedIds must contain exactly the same IDs as current education entries',
      );
    }

    await Promise.all(
      orderedIds.map((id, i) =>
        this.prisma.admissionEducationEntry.update({
          where: { id },
          data: { sortOrder: i },
        }),
      ),
    );

    return this.loadFullApplication(caseRecord.id);
  }

  async submitApplication(userId: string, role: string) {
    const { contact, caseRecord } = await this.resolveContactAndCase(userId);

    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
      include: {
        documents: true,
        programmeChoices: { orderBy: { priority: 'asc' } },
      },
    });

    if (!application) throw new NotFoundException('Application not found');
    if (application.status !== 'DRAFT') {
      throw new ConflictException('Application has already been submitted');
    }

    if (application.programmeChoices.length === 0) {
      throw new BadRequestException('At least one programme choice is required');
    }

    // Decrypt PII columns before required-field validation so the existing
    // textChecks logic (which reads plaintext field names like passportNumber)
    // sees the same shape it did pre-encryption.
    const decryptedForValidation = decryptPiiFields(this.crypto, application as unknown as Record<string, unknown>);
    const missingFields = validateRequiredFields(decryptedForValidation, role);
    if (missingFields.length > 0) {
      throw new BadRequestException(`Missing required fields: ${missingFields.join(', ')}`);
    }

    const docTypes = application.documents.map((d) => d.documentType);
    const missingDocs: string[] = [];
    if (!docTypes.includes('PASSPORT' as any))              missingDocs.push('PASSPORT');
    if (!docTypes.includes('EDUCATION_TRANSCRIPTS' as any)) missingDocs.push('EDUCATION_TRANSCRIPTS');
    if (missingDocs.length > 0) {
      throw new BadRequestException(`Missing required documents: ${missingDocs.join(', ')}`);
    }

    // Atomic: application status + case status + audit log
    const [submitted] = await this.prisma.$transaction([
      this.prisma.admissionApplication.update({
        where: { id: application.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      }),
      this.prisma.case.update({
        where: { id: caseRecord.id },
        data: { status: 'APPLICATION_SUBMITTED' },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'ADMISSION_APPLICATION_SUBMITTED',
          entityType: 'AdmissionApplication',
          entityId: application.id,
        },
      }),
    ]);

    // Post-commit side effects — failures are non-fatal
    try {
      await this.emailService.sendEmail({
        to: contact.email,
        subject: 'Your Sorena application has been submitted',
        html: `<p>Hi ${contact.fullName},</p>
<p>Your application to Sorena has been successfully submitted. Our team will review it and be in touch within 3–5 business days.</p>
<p>If you have any questions in the meantime, please contact us via the support portal.</p>
<p>The Sorena Team</p>`,
      });
    } catch (err) {
      console.warn('Student confirmation email failed (non-fatal):', err);
    }

    if (caseRecord.ownerId) {
      try {
        const owner = await this.prisma.user.findUnique({
          where: { id: caseRecord.ownerId },
          select: { id: true, email: true, name: true },
        });
        if (owner) {
          await this.emailService.sendEmail({
            to: owner.email,
            subject: `New application submitted: ${contact.fullName}`,
            html: `<p>Hi ${owner.name},</p>
<p>${contact.fullName} has submitted their admission application. Please review it in the staff portal.</p>`,
          });
        }
      } catch (err) {
        console.warn('Consultant notification email failed (non-fatal):', err);
      }
      // TODO: in-app notification — Notification model not yet created (tracked in docs/known_issues.md)
      console.log(`TODO: in-app notification to consultant ${caseRecord.ownerId}`);
    }

    return {
      application: {
        id: submitted.id,
        status: submitted.status,
        submittedAt: submitted.submittedAt,
      },
      message: 'Application submitted successfully',
    };
  }
}
