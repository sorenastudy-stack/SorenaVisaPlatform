import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { TicketsService } from '../tickets/tickets.service';
import { MeetingsService } from '../meetings/meetings.service';

// PR-DASH-1 — Client-dashboard service.
//
// One payload assembles everything the dashboard renders so the
// frontend only does a single GET. The internal flow:
//
//   1. Resolve the User row + admission chain (same pattern visa
//      service uses — Contact → Lead → Case → AdmissionApplication →
//      VisaApplication). Throws if the chain is broken.
//   2. Auto-create the missing pieces idempotently inside one
//      transaction: VisaApplication (if absent), VisaCase (status =
//      DRAFT), and an empty AssessmentReport. Existing rows are left
//      untouched.
//   3. Read in parallel: case, assessment, supporting documents,
//      recent audit-log rows for this user.
//   4. Build the required-documents list from the visa flags using
//      the same conditional logic PR-13 / PR-14 use on the frontend.
//   5. Decrypt the AssessmentReport's summaryNarrative.
//
// Reads are not audit-logged (would flood the table); the
// auto-creation transaction does emit one STATUS_CHANGED row when a
// VisaCase row is freshly created (system event, statusChangedBy =
// null).

type DocType =
  | 'PASSPORT' | 'NATIONAL_ID' | 'RESIDENCE_VISA'
  | 'MILITARY_RECORD' | 'TRAVEL_HISTORY' | 'AUTHORITY_DOC'
  | 'OFFER_OF_PLACE' | 'PHD_RESEARCH_PROPOSAL' | 'PUBLICATIONS_LIST'
  | 'PERSONAL_CIRCUMSTANCES_EVIDENCE' | 'PREVIOUS_TERTIARY_EVIDENCE'
  | 'CURRENT_EMPLOYMENT_EVIDENCE' | 'PREVIOUS_EMPLOYMENT_EVIDENCE'
  | 'ENGLISH_TEST_RESULTS' | 'TUITION_PAYMENT_CONFIRMATION'
  | 'INZ1014_FINANCIAL_UNDERTAKING' | 'PREPAID_ACCOMMODATION_EVIDENCE'
  | 'SCHOLARSHIP_EVIDENCE' | 'OUTWARD_TRAVEL_EVIDENCE'
  | 'BANK_STATEMENTS' | 'EMPLOYMENT_INCOME_EVIDENCE'
  | 'SCHEDULED_HOLIDAY_EVIDENCE' | 'OTHER_EVIDENCE';

const TOTAL_VISA_STEPS = 14;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    // PR-DASH-2: pulled in so the dashboard payload can include a
    // tickets summary block without duplicating ownership logic.
    private readonly tickets: TicketsService,
    // PR-DASH-3: meetings summary block.
    private readonly meetings: MeetingsService,
  ) {}

  // Same chain visa.service uses. Returns the admission row and the
  // user's name; throws if any link is missing.
  private async resolveContext(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const contact = await this.prisma.contact.findUnique({ where: { userId } });
    if (!contact) throw new NotFoundException('Student profile not found');

    const lead = await this.prisma.lead.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead) throw new NotFoundException('No lead found for this student');

    const crmCase = await this.prisma.case.findFirst({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!crmCase) throw new NotFoundException('No case found for this student');

    const admission = await this.prisma.admissionApplication.findFirst({
      where: { caseId: crmCase.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!admission) {
      throw new NotFoundException(
        'No admission application found. Complete admission before opening the dashboard.',
      );
    }
    return { user, admission };
  }

  // Idempotent first-load setup. Wrapped in a transaction so a partial
  // failure can't leave the dashboard with a VisaApplication but no
  // VisaCase / AssessmentReport. Existing rows are left untouched.
  private async ensureDashboardRows(
    userId: string,
    admissionId: string,
  ): Promise<{ visaApplicationId: string; createdVisaCase: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. VisaApplication — same shape as the visa controller's
      //    POST /application route (PR-VISA1).
      let visa = await tx.visaApplication.findUnique({
        where: { applicationId: admissionId },
      });
      if (!visa) {
        visa = await tx.visaApplication.create({
          data: { applicationId: admissionId },
        });
      }

      // 2. VisaCase — one row per visa application.
      const existingCase = await tx.visaCase.findUnique({
        where: { visaApplicationId: visa.id },
      });
      let createdVisaCase = false;
      if (!existingCase) {
        await tx.visaCase.create({
          data: {
            visaApplicationId: visa.id,
            clientId:          userId,
            status:            'DRAFT',
            // statusChangedBy is null on system creation.
          },
        });
        createdVisaCase = true;
      }

      // 3. AssessmentReport — empty placeholder until the Friday bot
      //    posts a real report.
      const existingReport = await tx.assessmentReport.findUnique({
        where: { clientId: userId },
      });
      if (!existingReport) {
        await tx.assessmentReport.create({
          data: { clientId: userId },
        });
      }

      // 4. Single STATUS_CHANGED audit row on fresh VisaCase creation
      //    so the activity feed has at least one entry on first load.
      if (createdVisaCase) {
        await tx.auditLog.create({
          data: {
            userId,
            action:     'VISA_CASE_CREATED',
            eventType:  'STATUS_CHANGED',
            entityType: 'VisaCase',
            entityId:   visa.id,
            newValue:   { status: 'DRAFT' },
          },
        });
      }

      return { visaApplicationId: visa.id, createdVisaCase };
    });
  }

  // Builds the list of required document types from the persisted
  // visa flags. Mirrors the conditional logic in
  // Step14SupportingDocuments2.tsx (validate fn) — keep the two in
  // sync if a future PR changes the gates.
  private buildRequiredDocs(
    visa: Record<string, unknown>,
    educationCount: number,
    employmentEntries: { entryKind: string }[],
  ): DocType[] {
    const required = new Set<DocType>(['PASSPORT']);

    // PR-13 conditionals
    if (visa.livingInDifferentCountry === true) {
      required.add('RESIDENCE_VISA');
    }
    if (visa.everUndertakenMilitaryService === true) {
      required.add('MILITARY_RECORD');
    }
    if (visa.completingOnBehalf === true) {
      required.add('AUTHORITY_DOC');
    }

    // PR-14 always-required
    required.add('OFFER_OF_PLACE');
    required.add('PERSONAL_CIRCUMSTANCES_EVIDENCE');

    // PR-14 conditionals
    if (visa.studyingMastersOrPhd === 'PHD') {
      required.add('PHD_RESEARCH_PROPOSAL');
    }
    if (visa.phdPublishedPapers === true) {
      required.add('PUBLICATIONS_LIST');
    }
    if (educationCount > 0) {
      required.add('PREVIOUS_TERTIARY_EVIDENCE');
    }
    if (employmentEntries.some((e) => e.entryKind === 'CURRENT')) {
      required.add('CURRENT_EMPLOYMENT_EVIDENCE');
    }
    if (employmentEntries.some((e) => e.entryKind === 'PREVIOUS')) {
      required.add('PREVIOUS_EMPLOYMENT_EVIDENCE');
    }
    if (visa.tookEnglishTest === true) {
      required.add('ENGLISH_TEST_RESULTS');
    }

    const requireTuitionConfirmation =
      visa.tuitionFeesPaid === true ||
      visa.tuitionPaymentMethod === 'PARTNER_PROVIDER_OR_GOVT_LOAN' ||
      visa.tuitionPaymentMethod === 'THIRD_PARTY_SPONSOR' ||
      visa.tuitionPaymentMethod === 'SCHOLARSHIP';
    if (requireTuitionConfirmation) {
      required.add('TUITION_PAYMENT_CONFIRMATION');
    }

    if (visa.fundsSourceInz1014 === true || visa.outwardSourceInz1014 === true) {
      required.add('INZ1014_FINANCIAL_UNDERTAKING');
    }
    if (visa.fundsSourcePrepaidAccom === true) {
      required.add('PREPAID_ACCOMMODATION_EVIDENCE');
    }
    if (visa.outwardSourcePrepaidBooking === true) {
      required.add('OUTWARD_TRAVEL_EVIDENCE');
    }
    if (visa.fundsFormatBankAccount === true) {
      required.add('BANK_STATEMENTS');
      if (visa.savingsSourceWages === true || visa.savingsSourceSelfEmployment === true) {
        required.add('EMPLOYMENT_INCOME_EVIDENCE');
      }
    }

    const scholarshipActive =
      visa.fundsSourceScholarship === true ||
      visa.outwardSourceScholarship === true ||
      visa.tuitionPaymentMethod === 'SCHOLARSHIP';
    if (scholarshipActive) {
      required.add('SCHOLARSHIP_EVIDENCE');
    }

    return Array.from(required);
  }

  // Maps an audit-log row to the activity-feed shape the frontend
  // expects. eventType (the new column) wins if populated; existing
  // rows fall back to deriving from the legacy `action` string.
  private mapAuditRow(row: {
    eventType: string | null;
    action: string;
    createdAt: Date;
    entityType: string | null;
    entityId: string | null;
    newValue: unknown;
  }) {
    const KNOWN_EVENTS = new Set([
      'STEP_STARTED',
      'STEP_SAVED',
      'DOCUMENT_RECORDED',
      'DOCUMENT_REMOVED',
      'STATUS_CHANGED',
    ]);
    let eventType = row.eventType && KNOWN_EVENTS.has(row.eventType)
      ? row.eventType
      : null;
    if (!eventType) {
      // Best-effort fallback from the legacy `action` column.
      if (/document/i.test(row.action) && /remove|delete/i.test(row.action)) {
        eventType = 'DOCUMENT_REMOVED';
      } else if (/document/i.test(row.action)) {
        eventType = 'DOCUMENT_RECORDED';
      } else if (/status|case/i.test(row.action)) {
        eventType = 'STATUS_CHANGED';
      } else if (/save|update/i.test(row.action)) {
        eventType = 'STEP_SAVED';
      } else {
        eventType = 'STEP_STARTED';
      }
    }
    return {
      type:       eventType,
      timestamp:  row.createdAt,
      // The frontend resolves the i18n key + interpolation args
      // (`dashboard.activity.event.<TYPE>`) using these placeholders.
      message: {
        key:  `dashboard.activity.event.${eventType}`,
        args: {
          step:         row.entityType ?? '',
          documentType: row.entityId ?? '',
          status:       typeof row.newValue === 'object' && row.newValue !== null && 'status' in row.newValue
            ? String((row.newValue as Record<string, unknown>).status)
            : '',
        },
      },
      entityRef: row.entityId ?? undefined,
    };
  }

  // ── Public API ────────────────────────────────────────────────────

  async getDashboard(userId: string) {
    const { user, admission } = await this.resolveContext(userId);

    // Ensure dashboard rows exist; capture the visa application id for
    // the parallel reads below.
    const { visaApplicationId } = await this.ensureDashboardRows(
      userId,
      admission.id,
    );

    // Parallel reads — every query is scoped to this user / this
    // visa application, so a leaky filter can't return another
    // student's data.
    const [
      visa,
      visaCase,
      report,
      documents,
      educationCount,
      employmentEntries,
      auditRows,
    ] = await Promise.all([
      this.prisma.visaApplication.findUnique({ where: { id: visaApplicationId } }),
      this.prisma.visaCase.findUnique({ where: { visaApplicationId } }),
      this.prisma.assessmentReport.findUnique({ where: { clientId: userId } }),
      this.prisma.visaSupportingDocument.findMany({ where: { visaApplicationId } }),
      this.prisma.admissionEducationEntry.count({
        where: { admissionApplicationId: admission.id },
      }),
      this.prisma.visaEmploymentEntry.findMany({
        where:  { visaApplicationId },
        select: { entryKind: true },
      }),
      this.prisma.auditLog.findMany({
        where:   { userId },
        orderBy: { createdAt: 'desc' },
        take:    5,
      }),
    ]);

    if (!visa) {
      // Should never happen — ensureDashboardRows just created it.
      throw new NotFoundException('Visa application unexpectedly missing');
    }
    if (!visaCase) {
      throw new NotFoundException('Visa case unexpectedly missing');
    }

    // Build required-docs list, then merge with the actual metadata
    // rows so the frontend gets one entry per documentType the
    // student should provide. Each row carries provided=true/false
    // plus the original filename when present.
    const requiredTypes = this.buildRequiredDocs(
      visa as unknown as Record<string, unknown>,
      educationCount,
      employmentEntries,
    );
    const providedMap = new Map<string, { originalFilename: string }>();
    for (const d of documents) {
      providedMap.set(d.documentType, { originalFilename: d.originalFilename });
    }
    const docs = requiredTypes.map((documentType) => {
      const row = providedMap.get(documentType);
      return {
        documentType,
        provided:         !!row,
        originalFilename: row?.originalFilename,
      };
    });

    const currentStep = visa.currentStep ?? 1;
    const isComplete = currentStep > TOTAL_VISA_STEPS;

    return {
      user: {
        // The User model stores a single `name` field; expose firstName
        // by splitting on the first whitespace. Empty fallback keeps
        // the welcome line safe for users with mononyms or odd data.
        firstName: (user.name ?? '').trim().split(/\s+/)[0] ?? '',
      },
      assessmentReport: report && (report.score !== null || report.band !== null || report.route !== null)
        ? {
            hasReport:        true,
            score:            report.score,
            band:             report.band,
            route:            report.route,
            summaryNarrative: report.summaryNarrativeEncrypted
              ? this.crypto.decrypt(
                  Buffer.isBuffer(report.summaryNarrativeEncrypted)
                    ? report.summaryNarrativeEncrypted
                    : Buffer.from(report.summaryNarrativeEncrypted as Uint8Array),
                )
              : null,
            aiRecommendations: report.aiRecommendations ?? null,
          }
        : { hasReport: false },
      visaProgress: {
        currentStep,
        totalSteps: TOTAL_VISA_STEPS,
        isComplete,
      },
      case: {
        status:            visaCase.status,
        statusLabel:       `dashboard.caseStatus.${visaCase.status}.label`,
        statusChangedAt:   visaCase.statusChangedAt,
      },
      documents: docs,
      recentActivity: auditRows.map((r) => this.mapAuditRow(r)),
      // PR-DASH-2: tickets summary block. Delegates to the tickets
      // service so the ownership-chain logic lives in one place. The
      // shape matches the spec's `tickets: { openCount, latestOpen }`
      // contract.
      tickets: await this.tickets.getDashboardSummary(userId),
      // PR-DASH-3: meetings summary block. zoomJoinUrl on
      // nextUpcoming is already redacted per the 24h-window rule
      // inside MeetingsService.getDashboardSummary.
      meetings: await this.meetings.getDashboardSummary(userId),
    };
  }

  // Lightweight endpoint for components that only need the case row.
  async getCase(userId: string) {
    const { admission } = await this.resolveContext(userId);
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) {
      // Auto-create on first /case hit too (covers a client that
      // somehow calls /case before /dashboard).
      const { visaApplicationId } = await this.ensureDashboardRows(
        userId,
        admission.id,
      );
      const visaCase = await this.prisma.visaCase.findUnique({
        where: { visaApplicationId },
      });
      if (!visaCase) throw new ForbiddenException('Visa case not found');
      return visaCase;
    }
    const visaCase = await this.prisma.visaCase.findUnique({
      where: { visaApplicationId: visa.id },
    });
    if (!visaCase) {
      const { visaApplicationId } = await this.ensureDashboardRows(
        userId,
        admission.id,
      );
      return this.prisma.visaCase.findUnique({
        where: { visaApplicationId },
      });
    }
    return visaCase;
  }
}
