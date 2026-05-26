import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import {
  AddObservationDto,
  CreateOfficerDto,
  LinkOfficerDto,
  ListOfficersQueryDto,
  UpdateOfficerDto,
} from './dto/immigration-officers.dto';

// PR-LIA-10 — Immigration Officer module service.
//
// Two non-negotiable decisions:
//   * Decision 1A — encrypt profileDescription, observation body, and
//     linkage note via CryptoService.
//   * Decision 2C — observations are append-only + author-attributed.
//     The author can delete their own; nobody can edit (delete + repost).
//   * Decision 3A — aggregates are computed at read time. No
//     counter columns on ImmigrationOfficer.
//
// All mutations write AuditLog rows. The case-linkage flow also writes
// a VisaCaseFileNote (SYSTEM_EVENT) via the existing visa-case-resolve
// chain — same pattern PR-LIA-7/8 used.

interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface OfficerOut {
  id: string;
  fullName: string;
  officerCode: string | null;
  branch: string | null;
  countryOfPosting: string | null;
  profileDescription: string | null;
  createdById: string;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  totalCases: number;
  approvedCases: number;
  declinedCases: number;
  pendingCases: number;
  observationCount: number;
  topCountries: string[];
  topCaseTypes: string[];
}

export interface ObservationOut {
  id: string;
  officerId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  tags: string[];
  createdAt: Date;
}

export interface LinkageOut {
  id: string;
  caseId: string;
  officerId: string;
  linkedOutcome: 'APPROVED' | 'DECLINED' | null;
  note: string | null;
  linkedById: string;
  linkedByName: string | null;
  linkedAt: Date;
  applicantName?: string | null;
}

export interface ListOfficersResult {
  data: OfficerOut[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class ImmigrationOfficersService {
  private readonly logger = new Logger(ImmigrationOfficersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ─── List ──────────────────────────────────────────────────────────────

  async listOfficers(query: ListOfficersQueryDto): Promise<ListOfficersResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const skip = (page - 1) * pageSize;

    const where: Prisma.ImmigrationOfficerWhereInput = {};
    if (query.search && query.search.trim().length > 0) {
      const q = query.search.trim();
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { branch: { contains: q, mode: 'insensitive' } },
        { countryOfPosting: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (query.branch && query.branch.trim().length > 0) {
      where.branch = query.branch.trim();
    }
    if (query.countryOfPosting && query.countryOfPosting.trim().length > 0) {
      where.countryOfPosting = query.countryOfPosting.trim();
    }

    const sort = query.sort ?? 'mostRecent';

    let orderBy: Prisma.ImmigrationOfficerOrderByWithRelationInput | Prisma.ImmigrationOfficerOrderByWithRelationInput[];
    if (sort === 'name') {
      orderBy = { fullName: 'asc' };
    } else if (sort === 'mostActive') {
      // "Most active" = most linkages. Prisma supports orderBy on relation
      // _count via this shape.
      orderBy = { caseLinkages: { _count: 'desc' } };
    } else {
      orderBy = { updatedAt: 'desc' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.immigrationOfficer.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.immigrationOfficer.count({ where }),
    ]);

    const data = await Promise.all(rows.map((r) => this.hydrateOfficer(r)));

    return {
      data,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // ─── Get one (detail) ──────────────────────────────────────────────────

  async getOfficer(id: string): Promise<{
    officer: OfficerOut;
    observations: ObservationOut[];
    linkages: LinkageOut[];
  }> {
    const row = await this.prisma.immigrationOfficer.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundException('Officer not found');

    const [obsRows, linkRows] = await Promise.all([
      this.prisma.immigrationOfficerObservation.findMany({
        where: { officerId: id },
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { id: true, name: true } } },
      }),
      this.prisma.caseOfficerLinkage.findMany({
        where: { officerId: id },
        orderBy: { linkedAt: 'desc' },
        include: {
          linkedBy: { select: { id: true, name: true } },
          case: {
            include: { lead: { include: { contact: true } } },
          },
        },
      }),
    ]);

    return {
      officer: await this.hydrateOfficer(row),
      observations: obsRows.map((o) => ({
        id: o.id,
        officerId: o.officerId,
        authorId: o.authorId,
        authorName: o.author?.name ?? null,
        body: this.safeDecrypt(o.bodyEncrypted),
        tags: o.tags,
        createdAt: o.createdAt,
      })),
      linkages: linkRows.map((l) => ({
        id: l.id,
        caseId: l.caseId,
        officerId: l.officerId,
        linkedOutcome: l.linkedOutcome,
        note: l.noteEncrypted ? this.safeDecrypt(l.noteEncrypted as unknown as Buffer) : null,
        linkedById: l.linkedById,
        linkedByName: l.linkedBy?.name ?? null,
        linkedAt: l.linkedAt,
        applicantName: l.case.lead?.contact?.fullName ?? null,
      })),
    };
  }

  // ─── Create ────────────────────────────────────────────────────────────

  async createOfficer(
    dto: CreateOfficerDto,
    actor: Actor,
  ): Promise<{ officer: OfficerOut; duplicateHint: OfficerOut | null }> {
    const fullName = dto.fullName.trim();
    const branch = dto.branch?.trim() || null;

    // Loose duplicate check — warn, don't block.
    let duplicate: OfficerOut | null = null;
    if (branch) {
      const dupRow = await this.prisma.immigrationOfficer.findFirst({
        where: { fullName: { equals: fullName, mode: 'insensitive' }, branch: { equals: branch, mode: 'insensitive' } },
        include: { createdBy: { select: { id: true, name: true } } },
      });
      if (dupRow) {
        duplicate = await this.hydrateOfficer(dupRow);
        this.logger.log(
          `[Officers] Duplicate hint on create: "${fullName}" at "${branch}" — existing id=${dupRow.id}`,
        );
      }
    }

    const profileEncrypted =
      dto.profileDescription && dto.profileDescription.trim().length > 0
        ? (this.crypto.encrypt(dto.profileDescription.trim()) as never)
        : null;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.immigrationOfficer.create({
        data: {
          fullName,
          officerCode: dto.officerCode?.trim() || null,
          branch,
          countryOfPosting: dto.countryOfPosting?.trim() || null,
          profileDescriptionEncrypted: profileEncrypted,
          createdById: actor.id,
        },
        include: { createdBy: { select: { id: true, name: true } } },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'CREATE',
          eventType: 'OFFICER_PROFILE_CREATED',
          entityType: 'OFFICER',
          entityId: created.id,
          newValue: {
            officerId: created.id,
            fullName,
            branch,
            duplicateHintId: duplicate?.id ?? null,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      return created;
    });

    return {
      officer: await this.hydrateOfficer(row),
      duplicateHint: duplicate,
    };
  }

  // ─── Update ────────────────────────────────────────────────────────────

  async updateOfficer(
    id: string,
    dto: UpdateOfficerDto,
    actor: Actor,
  ): Promise<OfficerOut> {
    const existing = await this.prisma.immigrationOfficer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Officer not found');

    const data: Prisma.ImmigrationOfficerUpdateInput = {};
    const changedFields: string[] = [];

    if (dto.fullName !== undefined) {
      data.fullName = dto.fullName.trim();
      changedFields.push('fullName');
    }
    if (dto.officerCode !== undefined) {
      data.officerCode = dto.officerCode.trim() || null;
      changedFields.push('officerCode');
    }
    if (dto.branch !== undefined) {
      data.branch = dto.branch.trim() || null;
      changedFields.push('branch');
    }
    if (dto.countryOfPosting !== undefined) {
      data.countryOfPosting = dto.countryOfPosting.trim() || null;
      changedFields.push('countryOfPosting');
    }
    if (dto.profileDescription !== undefined) {
      const trimmed = dto.profileDescription.trim();
      data.profileDescriptionEncrypted =
        trimmed.length > 0 ? (this.crypto.encrypt(trimmed) as never) : null;
      changedFields.push('profileDescription');
    }

    if (changedFields.length === 0) {
      throw new BadRequestException('No editable fields provided.');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.immigrationOfficer.update({
        where: { id },
        data,
        include: { createdBy: { select: { id: true, name: true } } },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE',
          eventType: 'OFFICER_PROFILE_UPDATED',
          entityType: 'OFFICER',
          entityId: id,
          newValue: {
            officerId: id,
            changedFields,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      return updated;
    });

    return this.hydrateOfficer(row);
  }

  // ─── Delete ────────────────────────────────────────────────────────────

  async deleteOfficer(id: string, actor: Actor): Promise<{ deleted: true }> {
    const existing = await this.prisma.immigrationOfficer.findUnique({
      where: { id },
      include: { _count: { select: { caseLinkages: true } } },
    });
    if (!existing) throw new NotFoundException('Officer not found');

    if (existing._count.caseLinkages > 0) {
      throw new ConflictException(
        `Cannot delete: ${existing._count.caseLinkages} case linkage${existing._count.caseLinkages === 1 ? '' : 's'} still attached. Unlink the cases first.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.immigrationOfficer.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'DELETE',
          eventType: 'OFFICER_DELETED',
          entityType: 'OFFICER',
          entityId: id,
          newValue: {
            officerId: id,
            fullName: existing.fullName,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    });

    return { deleted: true };
  }

  // ─── Observations ──────────────────────────────────────────────────────

  async addObservation(
    officerId: string,
    dto: AddObservationDto,
    actor: Actor,
  ): Promise<ObservationOut> {
    const exists = await this.prisma.immigrationOfficer.findUnique({
      where: { id: officerId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Officer not found');

    const bodyEncrypted = this.crypto.encrypt(dto.body.trim()) as never;
    const tags = (dto.tags ?? [])
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 20);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.immigrationOfficerObservation.create({
        data: {
          officerId,
          authorId: actor.id,
          bodyEncrypted,
          tags,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'CREATE',
          eventType: 'OFFICER_OBSERVATION_ADDED',
          entityType: 'OFFICER',
          entityId: officerId,
          newValue: {
            officerId,
            observationId: created.id,
            tagsCount: tags.length,
            bodyLength: dto.body.length,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      return created;
    });

    return {
      id: row.id,
      officerId: row.officerId,
      authorId: row.authorId,
      authorName: actor.name ?? null,
      body: dto.body.trim(),
      tags,
      createdAt: row.createdAt,
    };
  }

  async deleteOwnObservation(
    officerId: string,
    observationId: string,
    actor: Actor,
  ): Promise<{ deleted: true }> {
    const obs = await this.prisma.immigrationOfficerObservation.findUnique({
      where: { id: observationId },
    });
    if (!obs || obs.officerId !== officerId) {
      throw new NotFoundException('Observation not found');
    }
    if (obs.authorId !== actor.id) {
      throw new ForbiddenException(
        'Only the original author can delete their observation.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.immigrationOfficerObservation.delete({ where: { id: observationId } });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'DELETE',
          eventType: 'OFFICER_OBSERVATION_DELETED',
          entityType: 'OFFICER',
          entityId: officerId,
          newValue: {
            officerId,
            observationId,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });
    });

    return { deleted: true };
  }

  // ─── Case linkage ──────────────────────────────────────────────────────

  async getLinkageForCase(caseId: string): Promise<LinkageOut | null> {
    const row = await this.prisma.caseOfficerLinkage.findUnique({
      where: { caseId },
      include: {
        linkedBy: { select: { id: true, name: true } },
        officer: { select: { id: true, fullName: true } },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      caseId: row.caseId,
      officerId: row.officerId,
      linkedOutcome: row.linkedOutcome,
      note: row.noteEncrypted ? this.safeDecrypt(row.noteEncrypted as unknown as Buffer) : null,
      linkedById: row.linkedById,
      linkedByName: row.linkedBy?.name ?? null,
      linkedAt: row.linkedAt,
    };
  }

  async linkCaseToOfficer(
    caseId: string,
    dto: LinkOfficerDto,
    actor: Actor,
  ): Promise<LinkageOut> {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { visa: { select: { outcome: true } } },
    });
    if (!c) throw new NotFoundException('Case not found');

    const officer = await this.prisma.immigrationOfficer.findUnique({
      where: { id: dto.officerId },
      select: { id: true, fullName: true },
    });
    if (!officer) throw new NotFoundException('Officer not found');

    // Existing linkage to a DIFFERENT officer must be unlinked first.
    const existing = await this.prisma.caseOfficerLinkage.findUnique({ where: { caseId } });
    if (existing && existing.officerId !== dto.officerId) {
      throw new ConflictException(
        'This case is already linked to a different officer. Unlink it first to record a new reviewer.',
      );
    }

    const note = dto.note?.trim() || null;
    const noteEncrypted = note ? (this.crypto.encrypt(note) as never) : null;
    const snapshotOutcome = c.visa?.outcome ?? null;

    const row = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.caseOfficerLinkage.upsert({
        where: { caseId },
        create: {
          caseId,
          officerId: dto.officerId,
          linkedOutcome: snapshotOutcome,
          noteEncrypted,
          linkedById: actor.id,
        },
        update: {
          linkedOutcome: snapshotOutcome,
          noteEncrypted,
          linkedById: actor.id,
          linkedAt: new Date(),
        },
        include: { linkedBy: { select: { id: true, name: true } } },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: existing ? 'UPDATE' : 'CREATE',
          eventType: 'CASE_OFFICER_LINKED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: {
            caseId,
            officerId: dto.officerId,
            officerName: officer.fullName,
            linkedOutcome: snapshotOutcome,
            hasNote: !!note,
            reLink: !!existing,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      const visaCaseId = await this.resolveVisaCaseId(tx, caseId);
      if (visaCaseId) {
        await tx.visaCaseFileNote.create({
          data: {
            caseId: visaCaseId,
            noteType: 'SYSTEM_EVENT',
            referenceId: caseId,
            summaryEncrypted: this.crypto.encrypt(
              `Case reviewer recorded: ${officer.fullName}`,
            ) as never,
            createdById: actor.id,
          },
        });
      }

      return upserted;
    });

    return {
      id: row.id,
      caseId: row.caseId,
      officerId: row.officerId,
      linkedOutcome: row.linkedOutcome,
      note,
      linkedById: row.linkedById,
      linkedByName: row.linkedBy?.name ?? null,
      linkedAt: row.linkedAt,
    };
  }

  async unlinkCaseFromOfficer(caseId: string, actor: Actor): Promise<{ unlinked: true }> {
    const existing = await this.prisma.caseOfficerLinkage.findUnique({
      where: { caseId },
      include: { officer: { select: { id: true, fullName: true } } },
    });
    if (!existing) throw new NotFoundException('No officer linked to this case');

    await this.prisma.$transaction(async (tx) => {
      await tx.caseOfficerLinkage.delete({ where: { caseId } });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'DELETE',
          eventType: 'CASE_OFFICER_UNLINKED',
          entityType: 'CASE',
          entityId: caseId,
          newValue: {
            caseId,
            officerId: existing.officerId,
            officerName: existing.officer.fullName,
          } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      const visaCaseId = await this.resolveVisaCaseId(tx, caseId);
      if (visaCaseId) {
        await tx.visaCaseFileNote.create({
          data: {
            caseId: visaCaseId,
            noteType: 'SYSTEM_EVENT',
            referenceId: caseId,
            summaryEncrypted: this.crypto.encrypt(
              `Case reviewer cleared (was ${existing.officer.fullName})`,
            ) as never,
            createdById: actor.id,
          },
        });
      }
    });

    return { unlinked: true };
  }

  // ─── Hydrator + helpers ────────────────────────────────────────────────

  private async hydrateOfficer(
    row: {
      id: string;
      fullName: string;
      officerCode: string | null;
      branch: string | null;
      countryOfPosting: string | null;
      profileDescriptionEncrypted: Buffer | Uint8Array | null;
      createdById: string;
      createdBy?: { id: string; name: string } | null;
      createdAt: Date;
      updatedAt: Date;
    },
  ): Promise<OfficerOut> {
    // Aggregate counts via groupBy on linkedOutcome — one query for
    // total/approved/declined/pending.
    const grouped = await this.prisma.caseOfficerLinkage.groupBy({
      by: ['linkedOutcome'],
      where: { officerId: row.id },
      _count: { _all: true },
    });

    let total = 0;
    let approved = 0;
    let declined = 0;
    let pending = 0;
    for (const g of grouped) {
      const c = g._count?._all ?? 0;
      total += c;
      if (g.linkedOutcome === 'APPROVED') approved = c;
      else if (g.linkedOutcome === 'DECLINED') declined = c;
      else pending = c;
    }

    const observationCount = await this.prisma.immigrationOfficerObservation.count({
      where: { officerId: row.id },
    });

    // Top 3 client countries (from the case's contact) + top 3 case
    // stages at link time. Both derived from a single linkages-with-case
    // query — limited to the most recent 200 linkages so the count
    // stays bounded even for high-volume officers.
    const recent = await this.prisma.caseOfficerLinkage.findMany({
      where: { officerId: row.id },
      orderBy: { linkedAt: 'desc' },
      take: 200,
      include: {
        case: {
          select: {
            stage: true,
            lead: {
              select: {
                contact: { select: { countryOfResidence: true } },
              },
            },
          },
        },
      },
    });
    const topCountries = this.topN(
      recent
        .map((r) => r.case.lead?.contact?.countryOfResidence ?? null)
        .filter((v): v is string => !!v),
      3,
    );
    const topCaseTypes = this.topN(
      recent.map((r) => String(r.case.stage)),
      3,
    );

    return {
      id: row.id,
      fullName: row.fullName,
      officerCode: row.officerCode,
      branch: row.branch,
      countryOfPosting: row.countryOfPosting,
      profileDescription: row.profileDescriptionEncrypted
        ? this.safeDecrypt(row.profileDescriptionEncrypted as unknown as Buffer)
        : null,
      createdById: row.createdById,
      createdByName: row.createdBy?.name ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      totalCases: total,
      approvedCases: approved,
      declinedCases: declined,
      pendingCases: pending,
      observationCount,
      topCountries,
      topCaseTypes,
    };
  }

  private topN(items: string[], n: number): string[] {
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k]) => k);
  }

  private safeDecrypt(payload: Uint8Array | Buffer): string {
    try {
      const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      return this.crypto.decrypt(buf);
    } catch {
      return '';
    }
  }

  private async resolveVisaCaseId(
    tx: Prisma.TransactionClient,
    caseId: string,
  ): Promise<string | null> {
    const admission = await tx.admissionApplication.findFirst({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!admission) return null;
    const visa = await tx.visaApplication.findUnique({
      where: { applicationId: admission.id },
      select: { id: true },
    });
    if (!visa) return null;
    const vc = await tx.visaCase.findUnique({
      where: { visaApplicationId: visa.id },
      select: { id: true },
    });
    return vc?.id ?? null;
  }
}
