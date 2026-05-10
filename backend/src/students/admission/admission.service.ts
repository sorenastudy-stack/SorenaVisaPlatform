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

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

const VALID_DOCUMENT_TYPES = [
  'PASSPORT',
  'NZ_VISA_HISTORY',
  'VISA_REFUSAL_LETTER',
  'ENGLISH_TEST_EVIDENCE',
  'EDUCATION_TRANSCRIPTS',
  'SUPPORTING_DOCUMENT',
] as const;

// ── PATCH allow-list ──────────────────────────────────────────────────────────

const PATCHABLE_FIELDS: Record<string, 'text' | 'boolean' | 'int' | 'datetime'> = {
  currentStep:            'int',
  // Step 2
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

function validateRequiredFields(application: any, role: string): string[] {
  const missing: string[] = [];

  const textChecks: Array<{ field: string; label: string; condition?: boolean }> = [
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
    { field: 'guardianRelationship', label: 'guardianRelationship' },
    { field: 'guardianFirstName',    label: 'guardianFirstName' },
    { field: 'guardianLastName',     label: 'guardianLastName' },
    { field: 'guardianEmail',        label: 'guardianEmail' },
    { field: 'guardianMobile',       label: 'guardianMobile' },
    { field: 'guardianStreet',       label: 'guardianStreet' },
    { field: 'guardianSuburb',       label: 'guardianSuburb' },
    { field: 'guardianCity',         label: 'guardianCity' },
    { field: 'guardianCountry',      label: 'guardianCountry' },
    { field: 'guardianPostcode',     label: 'guardianPostcode' },
    { field: 'accommodationType',    label: 'accommodationType' },
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
  for (const field of ['englishTestSat', 'hasDisability', 'needsEvacAssistance'] as const) {
    if (application[field] === null || application[field] === undefined) missing.push(field);
  }

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
      },
    });

    if (!application) return { exists: false as const };

    const { documents, programmeChoices, ...appData } = application;

    return {
      exists: true as const,
      application: appData,
      programmeChoices: programmeChoices.map((c) => ({
        id: c.id,
        programmeId: c.programmeId,
        programmeName: c.programme.name,
        intakeMonth: c.intakeMonth,
        intakeYear: c.intakeYear,
        priority: c.priority,
      })),
      documents: documents.map((doc) => ({
        id: doc.id,
        documentType: doc.documentType,
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
  ) {
    if (!VALID_DOCUMENT_TYPES.includes(documentType as any)) {
      throw new BadRequestException(
        `Invalid documentType. Valid values: ${VALID_DOCUMENT_TYPES.join(', ')}`,
      );
    }

    const { contact, caseRecord } = await this.resolveContactAndCase(userId);
    const application = await this.findOrCreateApplication(caseRecord.id, contact.id);

    const destDir = path.join(UPLOAD_DIR, 'admission-documents', application.id);
    await fs.promises.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, path.basename(file.path));
    await fs.promises.rename(file.path, destPath);

    const doc = await this.prisma.admissionDocument.create({
      data: {
        admissionApplicationId: application.id,
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
        },
      },
    });

    return {
      id: doc.id,
      documentType: doc.documentType,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes,
      uploadedAt: doc.uploadedAt,
    };
  }

  async listDocuments(userId: string, documentType?: string) {
    const { caseRecord } = await this.resolveContactAndCase(userId);

    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
    });
    if (!application) return [];

    const docs = await this.prisma.admissionDocument.findMany({
      where: {
        admissionApplicationId: application.id,
        ...(documentType ? { documentType: documentType as any } : {}),
      },
      orderBy: { uploadedAt: 'desc' },
    });

    return docs.map((doc) => ({
      id: doc.id,
      documentType: doc.documentType,
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
    const { caseRecord } = await this.resolveContactAndCase(userId);

    const application = await this.prisma.admissionApplication.findFirst({
      where: { caseId: caseRecord.id },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status === 'SUBMITTED' || application.status === 'LOCKED') {
      throw new ConflictException('Application is read-only after submission');
    }

    const data = stripAndCoerce(body);
    const changedKeys = Object.keys(data);

    if (changedKeys.length > 0) {
      await this.prisma.admissionApplication.update({
        where: { id: application.id },
        data,
      });

      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'ADMISSION_APPLICATION_UPDATED',
          entityType: 'AdmissionApplication',
          entityId: application.id,
          newValue: { updatedFields: changedKeys },
        },
      });
    }

    return this.loadFullApplication(caseRecord.id);
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

    const missingFields = validateRequiredFields(application, role);
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
