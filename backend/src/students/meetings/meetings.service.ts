import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

// PR-DASH-3 — Meetings + transcripts service.
//
// Three responsibilities:
//   1. Encrypt / decrypt PII at the boundary — locationOrLink,
//      agenda, transcriptNotes. cancelledReason is cleartext per
//      spec (short admin label, not freely-typed PII).
//   2. Ownership enforcement on the student-side: every query
//      filters by studentId = req.user.id. 404 (not 403) when the
//      caller doesn't own a row, to avoid existence leaks.
//   3. Audit-log emission on every mutation, with the structured
//      eventType the dashboard activity feed consumes.
//
// The encryption envelope used here is the project's CryptoService
// (AES-256-GCM). Encrypted blobs are stored as base64 strings in
// nullable TEXT columns rather than BYTEA — the spec called them
// "encrypted text columns" and that's the simpler integration:
// `String?` in Prisma, ciphertext written as `crypto.encrypt(...)
// .toString('base64')` and decrypted symmetrically on read.

type StatusEnum = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ── Crypto helpers ────────────────────────────────────────────────

  private enc(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined || plain === '') return null;
    return this.crypto.encrypt(plain).toString('base64');
  }

  private dec(stored: string | null | undefined): string | null {
    if (!stored) return null;
    try {
      return this.crypto.decrypt(Buffer.from(stored, 'base64'));
    } catch {
      // Defensive — a corrupted ciphertext shouldn't tear the
      // whole detail response down.
      return null;
    }
  }

  // ── Display helpers ───────────────────────────────────────────────

  private displayName(name: string | null | undefined): string | null {
    const n = (name ?? '').trim();
    if (n === '') return null;
    const parts = n.split(/\s+/);
    if (parts.length === 1) return parts[0]!;
    return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
  }

  // Standard shape returned to BOTH student and consultant detail
  // endpoints. Student-side wrapper layers an ownership filter on
  // top; consultant-side returns this directly.
  private serializeMeeting(m: {
    id: string;
    studentId: string;
    consultantId: string | null;
    scheduledAt: Date;
    durationMinutes: number;
    status: string;
    meetingType: string;
    locationOrLink: string | null;
    agenda: string | null;
    transcriptNotes: string | null;
    cancelledAt: Date | null;
    cancelledReason: string | null;
    createdAt: Date;
    updatedAt: Date;
    student?: { id: string; name: string | null } | null;
    consultant?: { id: string; name: string | null } | null;
    transcriptFile?: {
      id: string;
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
      uploadedAt: Date;
      uploadedById: string;
    } | null;
  }) {
    return {
      id:                     m.id,
      studentId:              m.studentId,
      consultantId:           m.consultantId,
      scheduledAt:            m.scheduledAt,
      durationMinutes:        m.durationMinutes,
      status:                 m.status,
      meetingType:            m.meetingType,
      locationOrLink:         this.dec(m.locationOrLink),
      agenda:                 this.dec(m.agenda),
      transcriptNotes:        this.dec(m.transcriptNotes),
      cancelledAt:            m.cancelledAt,
      cancelledReason:        m.cancelledReason,
      createdAt:              m.createdAt,
      updatedAt:              m.updatedAt,
      studentName:            this.displayName(m.student?.name),
      consultantName:         this.displayName(m.consultant?.name),
      transcriptFile:         m.transcriptFile
        ? {
            id:               m.transcriptFile.id,
            originalFilename: m.transcriptFile.originalFilename,
            mimeType:         m.transcriptFile.mimeType,
            sizeBytes:        m.transcriptFile.sizeBytes,
            uploadedAt:       m.transcriptFile.uploadedAt,
          }
        : null,
    };
  }

  // Lightweight list-row shape — no encrypted PII surfaced; the list
  // view doesn't need agenda or transcript notes.
  private serializeListRow(m: {
    id: string;
    studentId: string;
    consultantId: string | null;
    scheduledAt: Date;
    durationMinutes: number;
    status: string;
    meetingType: string;
    cancelledAt: Date | null;
    student?: { id: string; name: string | null } | null;
    consultant?: { id: string; name: string | null } | null;
    transcriptFile?: { id: string } | null;
  }) {
    return {
      id:               m.id,
      studentId:        m.studentId,
      consultantId:     m.consultantId,
      scheduledAt:      m.scheduledAt,
      durationMinutes:  m.durationMinutes,
      status:           m.status,
      meetingType:      m.meetingType,
      cancelledAt:      m.cancelledAt,
      studentName:      this.displayName(m.student?.name),
      consultantName:   this.displayName(m.consultant?.name),
      hasTranscript:    !!m.transcriptFile,
    };
  }

  // Build a Prisma where clause shared by both list endpoints.
  private buildListWhere(filters: {
    statuses?: string[];
    from?: string;
    to?: string;
    studentId?: string;
    consultantId?: string;
  }) {
    const where: Record<string, unknown> = {};
    if (filters.statuses && filters.statuses.length > 0) {
      where.status = { in: filters.statuses };
    }
    if (filters.from || filters.to) {
      const range: Record<string, Date> = {};
      if (filters.from) range.gte = new Date(filters.from);
      if (filters.to) range.lte = new Date(filters.to);
      where.scheduledAt = range;
    }
    if (filters.studentId) where.studentId = filters.studentId;
    if (filters.consultantId) where.consultantId = filters.consultantId;
    return where;
  }

  // ── Audit emit helper ─────────────────────────────────────────────

  private async writeAudit(
    userId: string,
    eventType: string,
    entityId: string,
    extras: { oldValue?: unknown; newValue?: unknown } = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action:     eventType,
        eventType,
        entityType: 'VisaMeeting',
        entityId,
        oldValue:   (extras.oldValue ?? null) as never,
        newValue:   (extras.newValue ?? null) as never,
      },
    });
  }

  // ── STUDENT-side ──────────────────────────────────────────────────

  async studentList(
    userId: string,
    filters: { statuses?: string[]; from?: string; to?: string },
  ) {
    const where = this.buildListWhere({ ...filters, studentId: userId });
    const rows = await this.prisma.visaMeeting.findMany({
      where:   where as never,
      orderBy: { scheduledAt: 'desc' },
      include: {
        consultant:     { select: { id: true, name: true } },
        student:        { select: { id: true, name: true } },
        transcriptFile: { select: { id: true } },
      },
    });
    return rows.map((r) => this.serializeListRow(r));
  }

  async studentDetail(userId: string, id: string) {
    const m = await this.prisma.visaMeeting.findFirst({
      where: { id, studentId: userId },
      include: {
        consultant:     { select: { id: true, name: true } },
        student:        { select: { id: true, name: true } },
        transcriptFile: true,
      },
    });
    if (!m) throw new NotFoundException('Meeting not found');
    return this.serializeMeeting(m);
  }

  async studentUpcomingCount(userId: string): Promise<number> {
    return this.prisma.visaMeeting.count({
      where: {
        studentId: userId,
        status:    'SCHEDULED',
        scheduledAt: { gte: new Date() },
      },
    });
  }

  // Used by DashboardService.
  async getDashboardSummary(userId: string) {
    const [upcomingCount, nextRow] = await Promise.all([
      this.studentUpcomingCount(userId),
      this.prisma.visaMeeting.findFirst({
        where: {
          studentId:   userId,
          status:      'SCHEDULED',
          scheduledAt: { gte: new Date() },
        },
        orderBy: { scheduledAt: 'asc' },
        include: { consultant: { select: { id: true, name: true } } },
      }),
    ]);
    return {
      upcomingCount,
      next: nextRow
        ? {
            id:             nextRow.id,
            scheduledAt:    nextRow.scheduledAt,
            meetingType:    nextRow.meetingType,
            consultantName: this.displayName(nextRow.consultant?.name),
          }
        : null,
    };
  }

  // ── CONSULTANT-side ───────────────────────────────────────────────

  async consultantList(filters: {
    statuses?: string[];
    from?: string;
    to?: string;
    studentId?: string;
  }) {
    const where = this.buildListWhere(filters);
    const rows = await this.prisma.visaMeeting.findMany({
      where:   where as never,
      orderBy: { scheduledAt: 'desc' },
      include: {
        consultant:     { select: { id: true, name: true } },
        student:        { select: { id: true, name: true } },
        transcriptFile: { select: { id: true } },
      },
    });
    return rows.map((r) => this.serializeListRow(r));
  }

  async consultantDetail(id: string) {
    const m = await this.prisma.visaMeeting.findUnique({
      where: { id },
      include: {
        consultant:     { select: { id: true, name: true } },
        student:        { select: { id: true, name: true } },
        transcriptFile: true,
      },
    });
    if (!m) throw new NotFoundException('Meeting not found');
    return this.serializeMeeting(m);
  }

  async consultantCreate(
    staffId: string,
    body: {
      studentId: string;
      scheduledAt: string;
      durationMinutes?: number;
      meetingType: string;
      locationOrLink?: string;
      agenda?: string;
    },
  ) {
    const scheduledAt = new Date(body.scheduledAt);
    if (isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('scheduledAt is not a valid ISO date');
    }

    const student = await this.prisma.user.findUnique({
      where:  { id: body.studentId },
      select: { id: true, role: true },
    });
    if (!student || student.role !== 'STUDENT') {
      throw new BadRequestException('studentId must reference a STUDENT user');
    }

    const data: Record<string, unknown> = {
      studentId:       body.studentId,
      consultantId:    staffId,
      scheduledAt,
      durationMinutes: body.durationMinutes ?? 30,
      meetingType:     body.meetingType,
      locationOrLink:  this.enc(body.locationOrLink),
      agenda:          this.enc(body.agenda),
      status:          'SCHEDULED',
    };

    const created = await this.prisma.visaMeeting.create({
      data: data as never,
    });
    await this.writeAudit(staffId, 'MEETING_CREATED', created.id, {
      newValue: {
        studentId:   body.studentId,
        scheduledAt: scheduledAt.toISOString(),
        meetingType: body.meetingType,
      },
    });
    return this.consultantDetail(created.id);
  }

  async consultantUpdate(
    staffId: string,
    id: string,
    body: {
      scheduledAt?: string;
      durationMinutes?: number;
      meetingType?: string;
      locationOrLink?: string | null;
      agenda?: string | null;
    },
  ) {
    const existing = await this.prisma.visaMeeting.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Meeting not found');

    const data: Record<string, unknown> = {};
    if (body.scheduledAt !== undefined) {
      const d = new Date(body.scheduledAt);
      if (isNaN(d.getTime())) {
        throw new BadRequestException('scheduledAt is not a valid ISO date');
      }
      data.scheduledAt = d;
    }
    if (body.durationMinutes !== undefined) data.durationMinutes = body.durationMinutes;
    if (body.meetingType !== undefined)     data.meetingType     = body.meetingType;
    if (body.locationOrLink !== undefined)  data.locationOrLink  = this.enc(body.locationOrLink ?? '');
    if (body.agenda !== undefined)          data.agenda          = this.enc(body.agenda ?? '');

    const updated = await this.prisma.visaMeeting.update({
      where: { id },
      data:  data as never,
    });
    await this.writeAudit(staffId, 'MEETING_UPDATED', updated.id, {
      newValue: Object.keys(data),
    });
    return this.consultantDetail(updated.id);
  }

  async consultantCancel(staffId: string, id: string, body: { reason?: string }) {
    const existing = await this.prisma.visaMeeting.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Meeting not found');
    if (existing.status === 'CANCELLED') {
      return this.consultantDetail(id); // idempotent
    }
    const previousStatus = existing.status as StatusEnum;
    await this.prisma.visaMeeting.update({
      where: { id },
      data: {
        status:          'CANCELLED',
        cancelledAt:     new Date(),
        cancelledReason: body.reason?.trim() || null,
      },
    });
    await this.writeAudit(staffId, 'MEETING_CANCELLED', id, {
      oldValue: { status: previousStatus },
      newValue: { status: 'CANCELLED', reason: body.reason ?? null },
    });
    return this.consultantDetail(id);
  }

  async consultantComplete(staffId: string, id: string) {
    const existing = await this.prisma.visaMeeting.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Meeting not found');
    if (existing.status === 'COMPLETED') {
      return this.consultantDetail(id); // idempotent
    }
    const previousStatus = existing.status as StatusEnum;
    await this.prisma.visaMeeting.update({
      where: { id },
      data:  { status: 'COMPLETED' },
    });
    await this.writeAudit(staffId, 'MEETING_COMPLETED', id, {
      oldValue: { status: previousStatus },
      newValue: { status: 'COMPLETED' },
    });
    return this.consultantDetail(id);
  }

  async consultantAttachTranscript(
    staffId: string,
    meetingId: string,
    body: { originalFilename: string; mimeType: string; sizeBytes: number },
  ) {
    const meeting = await this.prisma.visaMeeting.findUnique({
      where: { id: meetingId },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    const result = await this.prisma.$transaction(async (tx) => {
      // Replace-on-upload: delete the existing transcript row if any.
      await tx.visaMeetingTranscript.deleteMany({ where: { meetingId } });
      const t = await tx.visaMeetingTranscript.create({
        data: {
          meetingId,
          originalFilename: body.originalFilename,
          mimeType:         body.mimeType,
          sizeBytes:        body.sizeBytes,
          uploadedById:     staffId,
        },
      });
      return t;
    });

    await this.writeAudit(
      staffId,
      'MEETING_TRANSCRIPT_METADATA_ATTACHED',
      meetingId,
      { newValue: { transcriptId: result.id, originalFilename: result.originalFilename } },
    );
    return this.consultantDetail(meetingId);
  }

  async consultantRemoveTranscript(staffId: string, meetingId: string) {
    const meeting = await this.prisma.visaMeeting.findUnique({
      where: { id: meetingId },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    const existing = await this.prisma.visaMeetingTranscript.findUnique({
      where: { meetingId },
    });
    if (!existing) return { deleted: false };

    await this.prisma.visaMeetingTranscript.delete({ where: { meetingId } });
    await this.writeAudit(
      staffId,
      'MEETING_TRANSCRIPT_METADATA_REMOVED',
      meetingId,
      { oldValue: { transcriptId: existing.id } },
    );
    return { deleted: true };
  }

  async consultantUpdateNotes(
    staffId: string,
    meetingId: string,
    body: { transcriptNotes: string },
  ) {
    const meeting = await this.prisma.visaMeeting.findUnique({
      where: { id: meetingId },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    const encrypted = this.enc(body.transcriptNotes);
    await this.prisma.visaMeeting.update({
      where: { id: meetingId },
      data:  { transcriptNotes: encrypted },
    });
    await this.writeAudit(staffId, 'MEETING_TRANSCRIPT_NOTES_UPDATED', meetingId);
    return this.consultantDetail(meetingId);
  }
}
