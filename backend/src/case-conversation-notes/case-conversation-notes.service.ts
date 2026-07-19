import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hasRole } from '../auth/role.util';
import {
  isEffectivelyEmpty,
  sanitizeRichText,
} from '../common/html/rich-text-sanitizer';
import {
  CreateConversationNoteDto,
  UpdateConversationNoteDto,
} from './dto/conversation-note.dto';

// PR-LIA-CONVO-NOTES — LIA conversation notes on a Case.
//
// SECURITY MODEL (enforced HERE, in the service — not just the controller
// @Roles decorator, and never merely hidden in the UI):
//
//   * READ + WRITE allowlist: LIA, OWNER, SUPER_ADMIN only. A CONSULTANT or
//     SUPPORT user assigned to the very same case gets 403 on every operation.
//     The client role never reaches this service (no client route mounts it).
//   * The actor's role is taken from the verified JWT (req.user), never from the
//     request body. caseId comes from the route and is re-validated against the
//     note on every note-scoped op — a note from another case cannot be read,
//     edited, or deleted through a mismatched caseId.
//   * Edit / delete: the author may modify their own note; OWNER and SUPER_ADMIN
//     may modify anyone's. A CONSULTANT cannot (they fail the allowlist first).
//   * Every create / edit / delete writes an AuditLog row.
//
// Distinct from LegalNote: plain sanitized HTML (not encrypted), mutable, and a
// strictly narrower 3-role audience.

const NOTE_ROLES = ['LIA', 'OWNER', 'SUPER_ADMIN'] as const;
const ELEVATED_ROLES = ['OWNER', 'SUPER_ADMIN'] as const;

export interface NoteActor {
  id: string;
  role?: string | null;
  secondaryRoles?: readonly string[] | null;
  name?: string | null;
}

export interface ConversationNoteOut {
  id: string;
  caseId: string;
  authorId: string;
  authorName: string | null;
  bodyHtml: string;
  createdAt: Date;
  updatedAt: Date;
  // Convenience flags for the client: derived server-side from the actor, so the
  // UI never has to reason about permissions itself (and can't grant more than
  // the server would).
  canEdit: boolean;
}

@Injectable()
export class CaseConversationNotesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForCase(
    caseId: string,
    actor: NoteActor,
  ): Promise<ConversationNoteOut[]> {
    this.assertActorAllowed(actor);
    await this.ensureCaseExists(caseId);

    const rows = await this.prisma.caseConversationNote.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' }, // newest first
      include: { author: { select: { id: true, name: true } } },
    });

    return rows.map((r) => this.toOut(r, r.author?.name ?? null, actor));
  }

  async createNote(
    caseId: string,
    dto: CreateConversationNoteDto,
    actor: NoteActor,
  ): Promise<ConversationNoteOut> {
    this.assertActorAllowed(actor);
    await this.ensureCaseExists(caseId);

    const bodyHtml = this.sanitizeOrThrow(dto.body);

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.caseConversationNote.create({
        data: { caseId, authorId: actor.id, bodyHtml },
      });

      await this.audit(tx, actor, 'CREATE', 'CASE_CONVERSATION_NOTE_CREATED', {
        caseId,
        noteId: row.id,
        bodyLength: bodyHtml.length,
      });

      return this.toOut(row, actor.name ?? null, actor);
    });
  }

  async updateNote(
    caseId: string,
    noteId: string,
    dto: UpdateConversationNoteDto,
    actor: NoteActor,
  ): Promise<ConversationNoteOut> {
    this.assertActorAllowed(actor);
    const note = await this.loadNoteInCase(caseId, noteId);
    this.assertCanMutate(note, actor);

    const bodyHtml = this.sanitizeOrThrow(dto.body);

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.caseConversationNote.update({
        where: { id: noteId },
        data: { bodyHtml },
        include: { author: { select: { id: true, name: true } } },
      });

      await this.audit(tx, actor, 'UPDATE', 'CASE_CONVERSATION_NOTE_EDITED', {
        caseId,
        noteId,
        bodyLength: bodyHtml.length,
      });

      return this.toOut(row, row.author?.name ?? null, actor);
    });
  }

  async deleteNote(
    caseId: string,
    noteId: string,
    actor: NoteActor,
  ): Promise<{ deleted: true; id: string }> {
    this.assertActorAllowed(actor);
    const note = await this.loadNoteInCase(caseId, noteId);
    this.assertCanMutate(note, actor);

    return this.prisma.$transaction(async (tx) => {
      await tx.caseConversationNote.delete({ where: { id: noteId } });

      await this.audit(tx, actor, 'DELETE', 'CASE_CONVERSATION_NOTE_DELETED', {
        caseId,
        noteId,
      });

      return { deleted: true as const, id: noteId };
    });
  }

  // ─── guards / helpers ─────────────────────────────────────────────────────

  /** Strict READ+WRITE allowlist. Primary OR secondary role must be one of the
   *  three. Anyone else (CONSULTANT, SUPPORT, SALES, client, …) → 403. */
  private assertActorAllowed(actor: NoteActor): void {
    if (!actor?.id || !hasRole(actor, ...NOTE_ROLES)) {
      throw new ForbiddenException(
        'Conversation notes are restricted to LIA, OWNER, and SUPER_ADMIN.',
      );
    }
  }

  /** Edit/delete: the author, or an OWNER/SUPER_ADMIN, may mutate. */
  private assertCanMutate(
    note: { authorId: string },
    actor: NoteActor,
  ): void {
    const isAuthor = note.authorId === actor.id;
    const isElevated = hasRole(actor, ...ELEVATED_ROLES);
    if (!isAuthor && !isElevated) {
      throw new ForbiddenException(
        'You can only edit or delete your own conversation notes.',
      );
    }
  }

  /** Load a note and prove it belongs to the case in the route. A caseId that
   *  doesn't match the note's own caseId is treated as "not found" — you cannot
   *  reach a note through the wrong case. */
  private async loadNoteInCase(caseId: string, noteId: string) {
    const note = await this.prisma.caseConversationNote.findUnique({
      where: { id: noteId },
    });
    if (!note || note.caseId !== caseId) {
      throw new NotFoundException('Conversation note not found');
    }
    return note;
  }

  private async ensureCaseExists(caseId: string): Promise<void> {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Case not found');
  }

  private sanitizeOrThrow(dirty: string): string {
    const clean = sanitizeRichText(dirty ?? '');
    if (isEffectivelyEmpty(clean)) {
      throw new ForbiddenException('A note cannot be empty.');
    }
    return clean;
  }

  private toOut(
    row: {
      id: string;
      caseId: string;
      authorId: string;
      bodyHtml: string;
      createdAt: Date;
      updatedAt: Date;
    },
    authorName: string | null,
    actor: NoteActor,
  ): ConversationNoteOut {
    return {
      id: row.id,
      caseId: row.caseId,
      authorId: row.authorId,
      authorName,
      bodyHtml: row.bodyHtml,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      canEdit:
        row.authorId === actor.id || hasRole(actor, ...ELEVATED_ROLES),
    };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: NoteActor,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action,
        eventType,
        entityType: 'CASE',
        entityId: (payload.caseId as string) ?? null,
        newValue: payload as Prisma.InputJsonValue,
        actorNameSnapshot: actor.name ?? null,
        actorRoleSnapshot: actor.role ?? null,
      },
    });
  }
}
