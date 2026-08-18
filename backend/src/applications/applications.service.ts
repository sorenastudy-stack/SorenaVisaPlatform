import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ApplicationStatus,
  ReviewStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, EventSource } from '../events/events.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';
import { CreateDocumentDto } from './dto/create-document.dto';

@Injectable()
export class ApplicationsService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
  ) {}

  async createApplication(dto: CreateApplicationDto) {
    // Validate programme
    const programme = await this.prisma.educationProgramme.findUnique({
      where: { id: dto.programmeId },
    });

    if (!programme) {
      throw new NotFoundException('Programme not found');
    }

    if (programme.reviewStatus !== ReviewStatus.APPROVED || !programme.isActive) {
      throw new BadRequestException(
        'Programme is not approved or not active',
      );
    }

    // Validate case exists
    await this.ensureCaseExists(dto.caseId);

    // Validate provider matches programme
    if (programme.providerId !== dto.providerId) {
      throw new BadRequestException('Provider does not match programme');
    }

    const application = await this.prisma.application.create({
      data: dto,
    });

    await this.eventsService.emit(
      'APPLICATION_SUBMITTED',
      'APPLICATION',
      application.id,
      null,
      EventSource.USER,
      null,
      { caseId: dto.caseId, programmeId: dto.programmeId },
    );

    return application;
  }

  async findByCase(caseId: string) {
    await this.ensureCaseExists(caseId);

    return this.prisma.application.findMany({
      where: { caseId },
      include: {
        provider: true,
        programme: true,
        documents: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateApplicationStatusDto,
    actorId: string | null,
    actorRole?: string | null,
  ) {
    const application = await this.ensureApplicationExists(id);

    // Validate transition
    if (!this.isValidStatusTransition(application.status, dto.status)) {
      throw new BadRequestException(
        `Invalid status transition from ${application.status} to ${dto.status}`,
      );
    }

    const updated = await this.prisma.application.update({
      where: { id },
      data: {
        status: dto.status,
        ...this.getStatusTimestamps(dto.status),
      },
    });

    // The manual path audits too. It previously emitted only a CrmEvent, which
    // records the new status but not the one it replaced — so the trail could
    // not answer "what was it before?".
    await this.auditStatusChange(
      id, application.caseId, application.status, dto.status,
      'PATCH /applications/:id/status', { id: actorId, role: actorRole ?? null }, false,
    );

    // Emit appropriate event
    const eventType = this.getEventTypeForStatus(dto.status);
    if (eventType) {
      await this.eventsService.emit(
        eventType,
        'APPLICATION',
        id,
        null,
        EventSource.USER,
        actorId,
        { newStatus: dto.status },
      );
    }

    return updated;
  }

  // ─── Case-driven status progression ────────────────────────────────────
  //
  // The transition machine above was already correct and already validated;
  // what was missing was anything calling it. PATCH /applications/:id/status
  // existed but no UI and no workflow ever hit it, so every application sat at
  // PREPARATION forever and "how many visas approved" could only ever be zero.
  //
  // The milestones that matter most already have real staff actions behind
  // them — an LIA submits to INZ, an LIA records the visa outcome — and those
  // actions already move Case.stage. They just never touched Application.status.
  // These methods are what those actions call, so the status advances as a
  // consequence of the work staff already do rather than needing new UI.
  //
  // WHICH applications advance: only those sitting in the expected predecessor
  // state. A case can hold several applications (a student applies to more than
  // one programme) and only the accepted one proceeds to a visa. Advancing all
  // of them would invent facts. If none match, nothing moves and the caller is
  // told — silence here would hide a workflow that has drifted.
  async advanceForCase(
    caseId: string,
    from: ApplicationStatus,
    to: ApplicationStatus,
    trigger: string,
    actor: { id: string | null; role?: string | null },
  ): Promise<{ advanced: number; ids: string[] }> {
    const candidates = await this.prisma.application.findMany({
      where: { caseId, status: from },
      select: { id: true, status: true },
    });
    if (candidates.length === 0) return { advanced: 0, ids: [] };

    const ids: string[] = [];
    for (const app of candidates) {
      // Route through the SAME validation the manual endpoint uses. A second
      // path that skipped it would be how illegal transitions creep in.
      if (!this.isValidStatusTransition(app.status, to)) continue;

      await this.prisma.application.update({
        where: { id: app.id },
        data: { status: to, ...this.getStatusTimestamps(to) },
      });
      await this.auditStatusChange(app.id, caseId, app.status, to, trigger, actor, false);
      ids.push(app.id);

      const eventType = this.getEventTypeForStatus(to);
      if (eventType) {
        await this.eventsService.emit(
          eventType, 'APPLICATION', app.id, null, EventSource.USER, actor.id, { newStatus: to, trigger },
        );
      }
    }
    return { advanced: ids.length, ids };
  }

  /**
   * The correction path, for when a staff member undoes a milestone they had
   * recorded — the existing INZ-submission and visa reverts.
   *
   * This is the ONE place a status moves backwards, so it is deliberately not
   * routed through isValidStatusTransition (which is forward-only by design)
   * and is audited under a DIFFERENT event type, so a reversal can never be
   * mistaken for normal progress when reading the trail. The caller is already
   * role-gated: both revert endpoints are LIA/ADMIN/SUPER_ADMIN/OWNER only.
   */
  async revertForCase(
    caseId: string,
    from: ApplicationStatus,
    to: ApplicationStatus,
    trigger: string,
    actor: { id: string | null; role?: string | null },
  ): Promise<{ reverted: number; ids: string[] }> {
    const candidates = await this.prisma.application.findMany({
      where: { caseId, status: from },
      select: { id: true, status: true },
    });
    const ids: string[] = [];
    for (const app of candidates) {
      await this.prisma.application.update({
        where: { id: app.id },
        data: { status: to, ...this.clearStatusTimestamps(from) },
      });
      await this.auditStatusChange(app.id, caseId, app.status, to, trigger, actor, true);
      ids.push(app.id);
    }
    return { reverted: ids.length, ids };
  }

  /**
   * Every status change writes an AuditLog row: who, when, old value, new
   * value, and the action that triggered it.
   *
   * The pre-existing code emitted a CrmEvent instead, which records the new
   * status but not the old one and lives in a different table from the audit
   * trail the rest of the platform uses. Both are written now — the CrmEvent
   * because the CRM timeline reads it, the AuditLog because "what changed and
   * who changed it" is an audit question.
   */
  private async auditStatusChange(
    applicationId: string,
    caseId: string,
    oldStatus: ApplicationStatus,
    newStatus: ApplicationStatus,
    trigger: string,
    actor: { id: string | null; role?: string | null },
    isReversal: boolean,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id ?? null,
          action: 'UPDATE',
          eventType: isReversal ? 'APPLICATION_STATUS_REVERTED' : 'APPLICATION_STATUS_ADVANCED',
          entityType: 'APPLICATION',
          entityId: applicationId,
          oldValue: { status: oldStatus } as any,
          newValue: { status: newStatus, caseId, trigger } as any,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    } catch {
      // Failing to audit must not undo a status change that already happened;
      // same rule the upload scanner follows.
    }
  }

  /** Undo the timestamp the forward transition set, so a revert leaves no ghost. */
  private clearStatusTimestamps(from: ApplicationStatus) {
    switch (from) {
      case ApplicationStatus.SUBMITTED:      return { submittedAt: null };
      case ApplicationStatus.OFFER_RECEIVED: return { offerReceivedAt: null };
      case ApplicationStatus.OFFER_ACCEPTED: return { offerAcceptedAt: null };
      case ApplicationStatus.VISA_SUBMITTED: return { visaSubmittedAt: null };
      case ApplicationStatus.VISA_APPROVED:
      case ApplicationStatus.VISA_DECLINED:  return { visaDecisionAt: null };
      default: return {};
    }
  }

  async addDocument(applicationId: string, dto: CreateDocumentDto) {
    await this.ensureApplicationExists(applicationId);

    return this.prisma.applicationDocument.create({
      data: {
        applicationId,
        ...dto,
      },
    });
  }

  private async ensureCaseExists(id: string) {
    const caseRecord = await this.prisma.case.findUnique({
      where: { id },
    });
    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }
    return caseRecord;
  }

  private async ensureApplicationExists(id: string) {
    const application = await this.prisma.application.findUnique({
      where: { id },
    });
    if (!application) {
      throw new NotFoundException('Application not found');
    }
    return application;
  }

  private isValidStatusTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
    const transitions: Record<ApplicationStatus, ApplicationStatus[]> = {
      PREPARATION: [ApplicationStatus.SUBMITTED],
      SUBMITTED: [ApplicationStatus.OFFER_RECEIVED, ApplicationStatus.WITHDRAWN],
      OFFER_RECEIVED: [ApplicationStatus.OFFER_ACCEPTED, ApplicationStatus.WITHDRAWN],
      OFFER_ACCEPTED: [ApplicationStatus.VISA_SUBMITTED, ApplicationStatus.WITHDRAWN],
      VISA_SUBMITTED: [ApplicationStatus.VISA_APPROVED, ApplicationStatus.VISA_DECLINED, ApplicationStatus.WITHDRAWN],
      VISA_APPROVED: [],
      VISA_DECLINED: [ApplicationStatus.SUBMITTED], // Can reapply
      WITHDRAWN: [],
    };

    return transitions[from]?.includes(to) ?? false;
  }

  private getStatusTimestamps(status: ApplicationStatus) {
    const now = new Date();
    switch (status) {
      case ApplicationStatus.SUBMITTED:
        return { submittedAt: now };
      case ApplicationStatus.OFFER_RECEIVED:
        return { offerReceivedAt: now };
      case ApplicationStatus.OFFER_ACCEPTED:
        return { offerAcceptedAt: now };
      case ApplicationStatus.VISA_SUBMITTED:
        return { visaSubmittedAt: now };
      case ApplicationStatus.VISA_APPROVED:
      case ApplicationStatus.VISA_DECLINED:
        return { visaDecisionAt: now };
      default:
        return {};
    }
  }

  private getEventTypeForStatus(status: ApplicationStatus): string | null {
    switch (status) {
      case ApplicationStatus.SUBMITTED:
        return 'APPLICATION_SUBMITTED';
      case ApplicationStatus.OFFER_RECEIVED:
        return 'OFFER_RECEIVED';
      case ApplicationStatus.VISA_APPROVED:
        return 'VISA_APPROVED';
      case ApplicationStatus.VISA_DECLINED:
        return 'VISA_DECLINED';
      default:
        return null;
    }
  }
}
