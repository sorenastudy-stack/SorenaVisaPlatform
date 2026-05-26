import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CaseMessageAuthorRole,
  CaseMessageKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import {
  CreateMessageDto,
  FulfilRequestDto,
  LiaMessageKindDto,
  RequestDocumentDto,
} from './dto/case-messages.dto';

// PR-LIA-4 — Direct LIA ↔ client messaging on CRM Cases.
//
// One service backs both the LIA-side and client-side controllers.
// The two viewers share the same thread; the audit-pair pattern from
// PR-DASH-2 (VisaCaseFileNote + AuditLog) is reused, with one caveat:
// VisaCaseFileNote.caseId is FK'd to VisaCase (not the CRM Case),
// so we only write the note when a linked VisaCase resolves through
// the Case → AdmissionApplication → VisaApplication → VisaCase chain.
// AuditLog rows are written unconditionally and are the canonical
// record for cases that have not yet reached the visa phase.

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface CaseMessageOut {
  id: string;
  caseId: string;
  authorId: string;
  authorName: string | null;
  authorRole: CaseMessageAuthorRole;
  kind: CaseMessageKind;
  body: string;
  requestedDocType: string | null;
  fulfilledByFileId: string | null;
  fulfilledByFileName: string | null;
  fulfilledAt: Date | null;
  readByClient: boolean;
  readByLia: boolean;
  createdAt: Date;
}

type ViewerRole = 'LIA' | 'CLIENT';

@Injectable()
export class CaseMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ─── LIA-side ─────────────────────────────────────────────────────────

  async listForCaseAsLia(caseId: string, actor: Actor): Promise<CaseMessageOut[]> {
    await this.ensureCaseExists(caseId);
    const rows = await this.fetchThread(caseId);
    await this.markThreadRead(caseId, 'LIA', actor);
    return rows;
  }

  async createMessageAsLia(
    caseId: string,
    dto: CreateMessageDto,
    actor: Actor,
  ): Promise<CaseMessageOut> {
    await this.ensureCaseExists(caseId);
    const kind: CaseMessageKind =
      dto.kind === LiaMessageKindDto.PROGRESS_UPDATE ? 'PROGRESS_UPDATE' : 'MESSAGE';
    return this.insertMessage({
      caseId,
      actor,
      role: 'LIA',
      body: dto.body,
      kind,
      eventType: 'CASE_MESSAGE_POSTED',
    });
  }

  async requestDocument(
    caseId: string,
    dto: RequestDocumentDto,
    actor: Actor,
  ): Promise<CaseMessageOut> {
    await this.ensureCaseExists(caseId);
    return this.insertMessage({
      caseId,
      actor,
      role: 'LIA',
      body: dto.body,
      kind: 'DOCUMENT_REQUEST',
      requestedDocType: dto.requestedDocType.trim(),
      eventType: 'CASE_DOCUMENT_REQUESTED',
    });
  }

  // ─── Client-side ──────────────────────────────────────────────────────

  async listForCaseAsClient(userId: string, actor: Actor): Promise<CaseMessageOut[]> {
    const caseId = await this.resolveCaseIdForStudent(userId);
    const rows = await this.fetchThread(caseId);
    await this.markThreadRead(caseId, 'CLIENT', actor);
    return rows;
  }

  async createMessageAsClient(
    userId: string,
    dto: CreateMessageDto,
    actor: Actor,
  ): Promise<CaseMessageOut> {
    const caseId = await this.resolveCaseIdForStudent(userId);
    return this.insertMessage({
      caseId,
      actor,
      role: 'CLIENT',
      body: dto.body,
      kind: 'MESSAGE',
      eventType: 'CASE_MESSAGE_POSTED',
    });
  }

  async fulfilRequest(
    userId: string,
    messageId: string,
    dto: FulfilRequestDto,
    actor: Actor,
  ): Promise<CaseMessageOut> {
    const caseId = await this.resolveCaseIdForStudent(userId);

    const msg = await this.prisma.caseMessage.findUnique({ where: { id: messageId } });
    if (!msg || msg.caseId !== caseId) {
      throw new NotFoundException('Document request not found on your case.');
    }
    if (msg.kind !== 'DOCUMENT_REQUEST') {
      throw new BadRequestException('This message is not a document request.');
    }
    if (msg.fulfilledByFileId) {
      throw new BadRequestException('This request has already been fulfilled.');
    }

    // Verify the supporting document belongs to the student's visa
    // application (Case → AdmissionApplication → VisaApplication →
    // VisaSupportingDocument). Skip the doc-type match per the spec
    // ("pick the simpler one") — the client picked it, the LIA can
    // reject in-thread if they wanted something else.
    const visaAppIds = await this.resolveVisaApplicationIdsForCase(caseId);
    const file = await this.prisma.visaSupportingDocument.findUnique({
      where: { id: dto.fileId },
    });
    if (!file || !visaAppIds.includes(file.visaApplicationId)) {
      throw new ForbiddenException('That file does not belong to your case.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.caseMessage.update({
        where: { id: messageId },
        data: {
          fulfilledByFileId: file.id,
          fulfilledAt: new Date(),
          // The client just performed an action on the thread — also
          // counts as a read of their own side.
          readByClient: true,
        },
      });
      await this.writeAuditPair(tx, {
        caseId,
        actor,
        eventType: 'CASE_DOCUMENT_FULFILLED',
        newValue: {
          messageId,
          fileId: file.id,
          documentType: file.documentType,
        },
        noteSummary: `Client fulfilled document request "${msg.requestedDocType ?? ''}" with ${file.originalFilename}`,
        noteType: 'TICKET',
      });
      return this.shapeMessage(
        updated,
        actor,
        file ? file.originalFilename : null,
      );
    });
  }

  async unreadCountForStudent(userId: string): Promise<number> {
    const caseId = await this.resolveCaseIdForStudent(userId).catch(() => null);
    if (!caseId) return 0;
    return this.prisma.caseMessage.count({
      where: { caseId, readByClient: false, authorRole: 'LIA' },
    });
  }

  // ─── Shared ────────────────────────────────────────────────────────────

  async markRead(actorRole: ViewerRole, caseIdInput: string | null, userId: string, actor: Actor) {
    let caseId = caseIdInput;
    if (actorRole === 'CLIENT') {
      caseId = await this.resolveCaseIdForStudent(userId);
    } else {
      if (!caseId) throw new BadRequestException('caseId is required for LIA viewers.');
      await this.ensureCaseExists(caseId);
    }
    return this.markThreadRead(caseId!, actorRole, actor);
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private async insertMessage(args: {
    caseId: string;
    actor: Actor;
    role: ViewerRole;
    body: string;
    kind: CaseMessageKind;
    requestedDocType?: string;
    eventType: string;
  }): Promise<CaseMessageOut> {
    const bodyEncrypted = this.crypto.encrypt(args.body) as never;
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.caseMessage.create({
        data: {
          caseId: args.caseId,
          authorId: args.actor.id,
          authorRole: args.role,
          kind: args.kind,
          bodyEncrypted,
          requestedDocType: args.requestedDocType ?? null,
          // Author sees their own message as read on send.
          readByLia: args.role === 'LIA',
          readByClient: args.role === 'CLIENT',
        },
      });
      await this.writeAuditPair(tx, {
        caseId: args.caseId,
        actor: args.actor,
        eventType: args.eventType,
        newValue: {
          messageId: row.id,
          authorRole: args.role,
          kind: args.kind,
          requestedDocType: args.requestedDocType ?? undefined,
          bodyLength: args.body.length,
        },
        noteSummary:
          args.kind === 'DOCUMENT_REQUEST'
            ? `LIA requested document "${args.requestedDocType ?? ''}"`
            : args.kind === 'PROGRESS_UPDATE'
              ? 'LIA posted a progress update'
              : args.role === 'LIA'
                ? 'LIA sent a message to the client'
                : 'Client replied on the case thread',
        noteType: args.kind === 'DOCUMENT_REQUEST' ? 'TICKET' : 'SYSTEM_EVENT',
      });
      return this.shapeMessage(row, args.actor, null);
    });
  }

  private async fetchThread(caseId: string): Promise<CaseMessageOut[]> {
    const rows = await this.prisma.caseMessage.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: { id: true, name: true } },
        fulfilledByFile: { select: { id: true, originalFilename: true } },
      },
    });
    return rows.map((r) =>
      this.shapeMessage(
        r,
        { id: r.author.id, name: r.author?.name ?? null },
        r.fulfilledByFile?.originalFilename ?? null,
      ),
    );
  }

  private async markThreadRead(caseId: string, viewer: ViewerRole, actor: Actor) {
    const where =
      viewer === 'LIA'
        ? { caseId, readByLia: false, authorRole: 'CLIENT' as const }
        : { caseId, readByClient: false, authorRole: 'LIA' as const };
    const data = viewer === 'LIA' ? { readByLia: true } : { readByClient: true };
    const updated = await this.prisma.caseMessage.updateMany({ where, data });
    if (updated.count > 0) {
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'CASE_MESSAGE_READ',
          entityType: 'CASE',
          entityId: caseId,
          newValue: { caseId, count: updated.count, viewer } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    }
    return { marked: updated.count };
  }

  private async writeAuditPair(
    tx: Prisma.TransactionClient,
    args: {
      caseId: string;
      actor: Actor;
      eventType: string;
      newValue: Record<string, unknown>;
      noteSummary: string;
      noteType: 'TICKET' | 'SYSTEM_EVENT';
    },
  ) {
    await tx.auditLog.create({
      data: {
        userId: args.actor.id,
        action:
          args.eventType === 'CASE_DOCUMENT_FULFILLED' ? 'UPDATE' : 'CREATE',
        eventType: args.eventType,
        entityType: 'CASE',
        entityId: args.caseId,
        newValue: args.newValue as Prisma.InputJsonValue,
        actorNameSnapshot: args.actor.name ?? null,
        actorRoleSnapshot: args.actor.role ?? null,
      },
    });

    // Best-effort companion VisaCaseFileNote. The note's caseId FKs
    // to VisaCase, not CRM Case — so we only write it when the case
    // has reached the visa phase and a VisaCase actually exists.
    const visaCaseId = await this.resolveVisaCaseId(args.caseId);
    if (visaCaseId) {
      await tx.visaCaseFileNote.create({
        data: {
          caseId: visaCaseId,
          noteType: args.noteType,
          referenceId: String(args.newValue['messageId'] ?? args.caseId),
          summaryEncrypted: this.crypto.encrypt(args.noteSummary) as never,
          createdById: args.actor.id,
        },
      });
    }
  }

  private async ensureCaseExists(caseId: string) {
    const c = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundException('Case not found');
  }

  private async resolveCaseIdForStudent(userId: string): Promise<string> {
    const contact = await this.prisma.contact.findUnique({ where: { userId } });
    if (!contact) throw new NotFoundException('No contact record found for this user.');
    const lead = await this.prisma.lead.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead) throw new NotFoundException('No lead linked to this user.');
    const crmCase = await this.prisma.case.findFirst({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!crmCase) throw new NotFoundException('No case found for this user yet.');
    return crmCase.id;
  }

  private async resolveVisaCaseId(caseId: string): Promise<string | null> {
    // Case → AdmissionApplication → VisaApplication → VisaCase. Best-effort.
    const admission = await this.prisma.admissionApplication.findFirst({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
    });
    if (!admission) return null;
    const visa = await this.prisma.visaApplication.findUnique({
      where: { applicationId: admission.id },
    });
    if (!visa) return null;
    const visaCase = await this.prisma.visaCase.findUnique({
      where: { visaApplicationId: visa.id },
    });
    return visaCase?.id ?? null;
  }

  private async resolveVisaApplicationIdsForCase(caseId: string): Promise<string[]> {
    const admissions = await this.prisma.admissionApplication.findMany({
      where: { caseId },
      select: { id: true },
    });
    if (admissions.length === 0) return [];
    const visaApps = await this.prisma.visaApplication.findMany({
      where: { applicationId: { in: admissions.map((a) => a.id) } },
      select: { id: true },
    });
    return visaApps.map((v) => v.id);
  }

  private shapeMessage(
    row: {
      id: string;
      caseId: string;
      authorId: string;
      authorRole: CaseMessageAuthorRole;
      kind: CaseMessageKind;
      bodyEncrypted: Uint8Array | Buffer;
      requestedDocType: string | null;
      fulfilledByFileId: string | null;
      fulfilledAt: Date | null;
      readByClient: boolean;
      readByLia: boolean;
      createdAt: Date;
    },
    author: { id: string; name?: string | null } | Actor,
    fulfilledByFileName: string | null,
  ): CaseMessageOut {
    return {
      id: row.id,
      caseId: row.caseId,
      authorId: row.authorId,
      authorName: author?.name ?? null,
      authorRole: row.authorRole,
      kind: row.kind,
      body: this.safeDecrypt(row.bodyEncrypted),
      requestedDocType: row.requestedDocType,
      fulfilledByFileId: row.fulfilledByFileId,
      fulfilledByFileName,
      fulfilledAt: row.fulfilledAt,
      readByClient: row.readByClient,
      readByLia: row.readByLia,
      createdAt: row.createdAt,
    };
  }

  private safeDecrypt(payload: Uint8Array | Buffer): string {
    try {
      const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      return this.crypto.decrypt(buf);
    } catch {
      return '';
    }
  }
}
