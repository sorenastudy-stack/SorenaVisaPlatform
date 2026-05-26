import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, RiskLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, EventSource } from '../events/events.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { UpdateCaseDto } from './dto/update-case.dto';
import { CaseListQueryDto } from './dto/case-list-filter.dto';
import { OverrideRiskDto, ClearHardStopDto } from './dto/lia-actions.dto';

interface LiaActor {
  id: string;
  name?: string | null;
  role?: string | null;
}

@Injectable()
export class CasesService {
  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
    private crypto: CryptoService,
  ) {}

  async createCase(dto: CreateCaseDto, actorId: string | null) {
    // Check execution gate
    const lead = await this.prisma.lead.findUnique({
      where: { id: dto.leadId },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (!lead.executionAllowed || lead.hardStopFlag) {
      throw new BadRequestException(
        'Lead does not pass execution gate: execution not allowed or hard stop flag is set',
      );
    }

    // Check if case already exists for this lead
    const existingCase = await this.prisma.case.findFirst({
      where: { leadId: dto.leadId },
    });

    if (existingCase) {
      throw new BadRequestException('Case already exists for this lead');
    }

    const caseRecord = await this.prisma.case.create({
      data: {
        leadId: dto.leadId,
        ownerId: lead.ownerId,
        riskLevel: lead.riskLevel,
      },
    });

    await this.eventsService.emit(
      'CASE_CREATED',
      'CASE',
      caseRecord.id,
      dto.leadId,
      EventSource.USER,
      actorId,
      { leadId: dto.leadId },
    );

    return caseRecord;
  }

  async findAll(query: CaseListQueryDto) {
    const where: any = {};

    if (query.stage) {
      where.stage = query.stage;
    }
    if (query.ownerId) {
      where.ownerId = query.ownerId;
    }

    return this.prisma.case.findMany({
      where,
      include: {
        lead: {
          include: { contact: true },
        },
        owner: true,
        // PR-LIA-2/3: surface the assigned LIA on every list row so the
        // queue's LIA column + Assignment filter chip work without an
        // extra round-trip per row.
        lia: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const caseRecord = await this.prisma.case.findUnique({
      where: { id },
      include: {
        lead: {
          include: { contact: true },
        },
        owner: true,
        // PR-LIA-2/3: same — case detail needs the LIA card to show
        // a real assignee, and PR-LIA-3 reads `liaAssignedAt` for
        // the "Assigned N days ago" line.
        lia: { select: { id: true, name: true, email: true } },
        applications: {
          include: {
            provider: true,
            programme: true,
            documents: true,
          },
        },
        contract: true,
      },
    });

    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }

    return caseRecord;
  }

  async updateCase(id: string, dto: UpdateCaseDto) {
    await this.ensureCaseExists(id);

    return this.prisma.case.update({
      where: { id },
      data: dto,
    });
  }

  // ─── PR-LIA-1 — LIA override actions ──────────────────────────────────

  // PATCH /cases/:id/risk — LIA changes the risk level on both the
  // Case and the underlying Lead. Audited; paired with a LegalNote
  // row that captures the reason (free-form, encrypted at rest).
  async overrideRisk(
    caseId: string,
    dto: OverrideRiskDto,
    actor: LiaActor,
  ) {
    const existing = await this.ensureCaseExists(caseId);
    const previousRisk = existing.riskLevel;

    const noteBody = `Risk overridden from ${previousRisk} to ${dto.riskLevel}. Reason: ${dto.reason}`;
    const bodyEncrypted = this.crypto.encrypt(noteBody) as never;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.case.update({
        where: { id: caseId },
        data: { riskLevel: dto.riskLevel },
      });

      await tx.lead.update({
        where: { id: existing.leadId },
        data: { riskLevel: dto.riskLevel },
      });

      const note = await tx.legalNote.create({
        data: {
          caseId,
          authorId: actor.id,
          bodyEncrypted,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'LIA_RISK_OVERRIDDEN',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: { riskLevel: previousRisk } as Prisma.InputJsonValue,
          newValue: {
            riskLevel: dto.riskLevel,
            legalNoteId: note.id,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      return updated;
    });
  }

  // PATCH /cases/:id/clear-hard-stop — LIA clears a Lead's hard-stop
  // flag (the gate that prevents execution). Sets executionAllowed=true,
  // clears hardStopFlag + hardStopReason. Audited; paired with a
  // LegalNote that records the LIA's written justification.
  async clearHardStop(
    caseId: string,
    dto: ClearHardStopDto,
    actor: LiaActor,
  ) {
    const existing = await this.ensureCaseExists(caseId);

    const lead = await this.prisma.lead.findUnique({
      where: { id: existing.leadId },
    });
    if (!lead) {
      throw new NotFoundException('Underlying lead not found');
    }

    const noteBody = `Hard stop cleared. Previous reason: ${lead.hardStopReason ?? '(none)'}. Justification: ${dto.reason}`;
    const bodyEncrypted = this.crypto.encrypt(noteBody) as never;

    return this.prisma.$transaction(async (tx) => {
      const previousState = {
        hardStopFlag: lead.hardStopFlag,
        hardStopReason: lead.hardStopReason,
        executionAllowed: lead.executionAllowed,
      };

      await tx.lead.update({
        where: { id: lead.id },
        data: {
          hardStopFlag: false,
          hardStopReason: null,
          executionAllowed: true,
        },
      });

      const note = await tx.legalNote.create({
        data: {
          caseId,
          authorId: actor.id,
          bodyEncrypted,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'LIA_HARD_STOP_CLEARED',
          entityType: 'CASE',
          entityId: caseId,
          oldValue: previousState as Prisma.InputJsonValue,
          newValue: {
            hardStopFlag: false,
            executionAllowed: true,
            legalNoteId: note.id,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      return { id: caseId, leadId: lead.id, hardStopFlag: false, executionAllowed: true };
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
}

export type { RiskLevel };
