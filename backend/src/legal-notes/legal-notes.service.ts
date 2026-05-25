import { Injectable, NotFoundException } from '@nestjs/common';
import { LegalDecision, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import {
  CreateLegalNoteDto,
  LegalDecisionDto,
  RecordDecisionDto,
} from './dto/legal-notes.dto';

// PR-LIA-1 — Legal notes + formal decisions on CRM Cases.
//
// Two shape variants share the same row:
//   * Note      — decision IS NULL, decisionReasonEncrypted IS NULL.
//   * Decision  — decision IS NOT NULL. Reason carries the LIA's
//                 written justification.
//
// Every mutation also writes an AuditLog row (PR-CONSULT-4 snapshot
// columns populated at write time) so the case-detail Activity feed
// surfaces the action without having to query legal_notes directly.

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface LegalNoteOut {
  id: string;
  caseId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  decision: LegalDecision | null;
  decisionReason: string | null;
  createdAt: Date;
}

@Injectable()
export class LegalNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async listForCase(caseId: string): Promise<LegalNoteOut[]> {
    await this.ensureCaseExists(caseId);

    const rows = await this.prisma.legalNote.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true } } },
    });

    return rows.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      authorId: r.authorId,
      authorName: r.author?.name ?? null,
      body: this.safeDecrypt(r.bodyEncrypted),
      decision: r.decision,
      decisionReason: r.decisionReasonEncrypted
        ? this.safeDecrypt(r.decisionReasonEncrypted)
        : null,
      createdAt: r.createdAt,
    }));
  }

  async createNote(
    caseId: string,
    dto: CreateLegalNoteDto,
    actor: Actor,
  ): Promise<LegalNoteOut> {
    await this.ensureCaseExists(caseId);

    const bodyEncrypted = this.crypto.encrypt(dto.body) as never;

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.legalNote.create({
        data: {
          caseId,
          authorId: actor.id,
          bodyEncrypted,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'CREATE',
          eventType: 'LEGAL_NOTE_ADDED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: {
            legalNoteId: row.id,
            bodyLength: dto.body.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      return {
        id: row.id,
        caseId: row.caseId,
        authorId: row.authorId,
        authorName: actor.name ?? null,
        body: dto.body,
        decision: null,
        decisionReason: null,
        createdAt: row.createdAt,
      };
    });
  }

  async recordDecision(
    caseId: string,
    dto: RecordDecisionDto,
    actor: Actor,
  ): Promise<LegalNoteOut> {
    await this.ensureCaseExists(caseId);

    const decision = dto.decision as unknown as LegalDecision;
    const summary = this.decisionSummary(dto.decision);
    const bodyEncrypted = this.crypto.encrypt(summary) as never;
    const reasonEncrypted = this.crypto.encrypt(dto.reason) as never;

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.legalNote.create({
        data: {
          caseId,
          authorId: actor.id,
          bodyEncrypted,
          decision,
          decisionReasonEncrypted: reasonEncrypted,
        },
      });

      if (dto.decision === LegalDecisionDto.WITHDRAWN) {
        await tx.case.update({
          where: { id: caseId },
          data: { stage: 'WITHDRAWN' },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'CREATE',
          eventType: 'LEGAL_DECISION_RECORDED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: {
            legalNoteId: row.id,
            decision: dto.decision,
            reasonLength: dto.reason.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      return {
        id: row.id,
        caseId: row.caseId,
        authorId: row.authorId,
        authorName: actor.name ?? null,
        body: summary,
        decision,
        decisionReason: dto.reason,
        createdAt: row.createdAt,
      };
    });
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  private async ensureCaseExists(caseId: string): Promise<void> {
    const c = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundException('Case not found');
  }

  private safeDecrypt(payload: Uint8Array | Buffer): string {
    try {
      const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      return this.crypto.decrypt(buf);
    } catch {
      return '';
    }
  }

  private decisionSummary(d: LegalDecisionDto): string {
    switch (d) {
      case LegalDecisionDto.APPROVED:
        return 'Decision recorded: APPROVED';
      case LegalDecisionDto.REJECTED:
        return 'Decision recorded: REJECTED';
      case LegalDecisionDto.NEEDS_MORE_INFO:
        return 'Decision recorded: NEEDS_MORE_INFO';
      case LegalDecisionDto.WITHDRAWN:
        return 'Decision recorded: WITHDRAWN';
    }
  }
}
