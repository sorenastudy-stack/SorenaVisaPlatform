import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  CommissionType,
  NZQFLevel,
  QualificationLevel,
  ProviderStatus,
  ProviderType,
  ReviewStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, EventSource } from '../events/events.service';
import { ProgrammeImportService } from './import/programme-import.service';
import { providerTypeFor } from './import/programme-import.logic';
import { R2Service } from '../common/r2/r2.service';
import { CatalogSyncService } from './websync/catalog-sync.service';
import { changeProposalToUpdate, type ChangedFields } from './websync/catalog-sync.logic';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateAgreementDto } from './dto/update-agreement.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { CreateProgrammeDto } from './dto/create-programme.dto';
import { ProviderListQueryDto } from './dto/provider-list-filter.dto';
import { ProgrammeListQueryDto } from './dto/programme-filter.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { CreateScholarshipDto } from './dto/create-scholarship.dto';
import { UpdateScholarshipDto } from './dto/update-scholarship.dto';

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    private prisma: PrismaService,
    private eventsService: EventsService,
    private programmeImport: ProgrammeImportService,
    private catalogSync: CatalogSyncService,
    private r2: R2Service,
  ) {}

  // PR-EXPLORE (Round 2) — Owner-uploaded programme cover image, shown on the
  // Explore map result cards and the programme detail page.
  // Security mirrors the documents feature: image mime-types ONLY, size-capped,
  // stored in R2 under a server-derived key (never a client-supplied path), and
  // the DB holds the KEY — not a public client URL — so access stays brokered.
  async setProgrammeCoverImage(
    programmeId: string,
    file: { buffer?: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
    actorId: string | null,
  ) {
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
    const MAX = 2 * 1024 * 1024; // 2 MB — a card image, not a document
    if (!file?.buffer) throw new BadRequestException('No image uploaded.');
    if (!file.mimetype || !ALLOWED.includes(file.mimetype)) {
      throw new BadRequestException('Please upload a JPG, PNG or WebP image.');
    }
    if ((file.size ?? file.buffer.length) > MAX) {
      throw new BadRequestException('That image is too large. Please keep it under 2 MB.');
    }
    const programme = await this.prisma.educationProgramme.findUnique({
      where: { id: programmeId },
      select: { id: true, name: true, providerId: true },
    });
    if (!programme) throw new NotFoundException('Programme not found.');

    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const key = `programme-covers/${programme.providerId}/${programmeId}.${ext}`;
    await this.r2.putObject(key, file.buffer, file.mimetype);

    const updated = await this.prisma.educationProgramme.update({
      where: { id: programmeId },
      data: { coverImageUrl: key },
      select: { id: true, coverImageUrl: true },
    });

    await this.eventsService.emit(
      'PROGRAMME_COVER_IMAGE_SET',
      'EDUCATION_PROGRAMME',
      programmeId,
      null,
      EventSource.USER,
      actorId,
      { programmeName: programme.name, key, bytes: file.size ?? file.buffer.length },
    );
    return updated;
  }

  // PR-CATALOG-1 — Owner-panel Excel import for ONE institution. Runs the shared
  // importer with a fixed providerId → all programmes land PENDING, source
  // MANUAL_EXCEL, invisible to students until per-programme approval.
  async importProgrammes(providerId: string, file: { buffer?: Buffer; originalname?: string } | undefined, dryRun: boolean) {
    if (!file?.buffer) throw new BadRequestException('No file uploaded.');
    const provider = await this.prisma.educationProvider.findUnique({ where: { id: providerId }, select: { id: true, institutionType: true } });
    if (!provider) throw new NotFoundException('Institution not found.');
    try {
      return await this.programmeImport.importFromXlsx(file.buffer, {
        institutionType: provider.institutionType ?? 'ITP',
        providerId,
        sourceRef: `upload-${provider.id}-${(file.originalname ?? 'file').replace(/[^\w.-]/g, '_')}`,
        dryRun,
      });
    } catch (e) {
      throw new BadRequestException(`Could not read the spreadsheet: ${(e as Error).message}`);
    }
  }

  // PR-CATALOG-1 — cross-institution pending-programme review queue.
  async pendingProgrammes() {
    const rows = await this.prisma.educationProgramme.findMany({
      where: { reviewStatus: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: {
        provider: { select: { id: true, name: true, status: true, institutionType: true } },
        studyFields: { take: 1, include: { studyField: { select: { key: true, nameEn: true } } } },
        _count: { select: { intakes: true } },
      },
    });
    return rows.map((p) => ({
      id: p.id, name: p.name, level: p.level, nzqfLevel: p.nzqfLevel,
      campusCity: p.campusCity, tuitionFeeNZD: p.tuitionFeeNZD, currency: p.currency,
      source: p.source, sourceRef: p.sourceRef, createdAt: p.createdAt,
      provider: { id: p.provider.id, name: p.provider.name, status: p.provider.status, institutionType: p.provider.institutionType },
      studyField: p.studyFields[0]?.studyField ?? null,
      intakeCount: p._count.intakes,
    }));
  }

  // PR-CATALOG-2 — the ONE Owner review queue, unioning three PENDING kinds:
  //   programmes  — Excel-imported programmes awaiting first approval (existing).
  //   changes     — field changes the web check found on an approved programme.
  //   candidates  — new programmes the web check discovered (highest-confidence first).
  // Nothing here is visible to students until per-item approval.
  async reviewQueue() {
    const provider = { select: { id: true, name: true, status: true, institutionType: true } };
    const [programmes, changes, candidates, tuitions, scholarships] = await Promise.all([
      this.pendingProgrammes(),
      this.prisma.programmeChangeProposal.findMany({
        where: { status: 'PENDING' },
        orderBy: { detectedAt: 'desc' },
        include: { programme: { select: { id: true, name: true, campusCity: true, nzqfLevel: true, provider } } },
      }),
      this.prisma.programmeCandidate.findMany({
        where: { status: 'PENDING' },
        orderBy: [{ confidence: 'desc' }, { detectedAt: 'desc' }],
        include: { provider },
      }),
      // PR-PROVIDER-PORTAL slice A — pending PRICING. Carries the actual figures,
      // because "approve this tuition row" is not a decision anyone can make from
      // an id: the reviewer needs the institution, the nationality it applies to,
      // the amount, and which programme/level it is scoped to.
      this.prisma.providerTuition.findMany({
        where: { reviewStatus: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        // PR-PROVIDER-PORTAL slice E — the group too. A grouped rate has a NULL
        // nationality, so without this the reviewer sees a blank in the "who does
        // this apply to" column on precisely the rows that cover twenty countries
        // at once.
        include: { provider, programme: { select: { id: true, name: true } }, nationalityGroup: { select: { name: true, nationalities: true } } },
        take: 200,
      }),
      this.prisma.providerScholarship.findMany({
        where: { reviewStatus: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        include: { provider, programme: { select: { id: true, name: true } }, nationalityGroup: { select: { name: true, nationalities: true } } },
        take: 200,
      }),
    ]);
    return {
      programmes,
      tuitions: tuitions.map((t) => ({
        id: t.id,
        provider: t.provider,
        programmeId: t.programmeId,
        programmeName: t.programme?.name ?? null,
        level: t.level,
        nationality: t.nationality,
        nationalityGroup: t.nationalityGroup
          ? { name: t.nationalityGroup.name, nationalities: t.nationalityGroup.nationalities }
          : null,
        amountValue: t.amountValue,
        currency: t.currency,
        feeYear: t.feeYear,
        term: t.term,
        notes: t.notes,
        isActive: t.isActive,
        createdAt: t.createdAt,
      })),
      scholarships: scholarships.map((sc) => ({
        id: sc.id,
        provider: sc.provider,
        programmeId: sc.programmeId,
        programmeName: sc.programme?.name ?? null,
        level: sc.level,
        nationality: sc.nationality,
        nationalityGroup: sc.nationalityGroup
          ? { name: sc.nationalityGroup.name, nationalities: sc.nationalityGroup.nationalities }
          : null,
        name: sc.name,
        amountType: sc.amountType,
        amountValue: sc.amountValue,
        currency: sc.currency,
        eligibilityNotes: sc.eligibilityNotes,
        isActive: sc.isActive,
        createdAt: sc.createdAt,
      })),
      changes: changes.map((c) => ({
        id: c.id,
        programmeId: c.programmeId,
        programmeName: c.programme.name,
        campusCity: c.programme.campusCity,
        nzqfLevel: c.programme.nzqfLevel,
        changedFields: c.changedFields,
        sourceUrl: c.sourceUrl,
        detectedAt: c.detectedAt,
        provider: c.programme.provider,
      })),
      candidates: candidates.map((c) => {
        const prog = ((c.proposedData as any)?.programme ?? {}) as Record<string, unknown>;
        return {
          id: c.id,
          name: (prog.name as string) ?? '(unnamed)',
          level: (prog.level as string) ?? null,
          nzqfLevel: c.nzqfLevel,
          campusCity: c.campusCity,
          tuitionFeeNZD: (prog.tuitionFeeNZD as number) ?? null,
          studyFieldKey: ((c.proposedData as any)?.studyFieldKey as string) ?? null,
          detectedFields: c.detectedFields,
          confidence: c.confidence,
          sourceUrl: c.sourceUrl,
          detectedAt: c.detectedAt,
          provider: c.provider,
        };
      }),
    };
  }

  // Manual "sync now" for one institution (Owner) — the same sweep the monthly cron runs,
  // scoped to this provider. Returns the run report so the Owner sees what it found.
  async syncNow(providerId: string) {
    await this.ensureProviderExists(providerId);
    return this.catalogSync.runSweep({ providerId });
  }

  // Approve a web-detected field change → apply it to the live (already-approved) programme.
  async approveChange(id: string, actorId: string | null) {
    const proposal = await this.prisma.programmeChangeProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('Change proposal not found');
    if (proposal.status !== 'PENDING') throw new BadRequestException('Change proposal already reviewed');

    const update = changeProposalToUpdate(proposal.changedFields as ChangedFields);
    await this.prisma.$transaction([
      this.prisma.educationProgramme.update({ where: { id: proposal.programmeId }, data: update }),
      this.prisma.programmeChangeProposal.update({
        where: { id },
        data: { status: 'APPROVED', reviewedById: actorId, reviewedAt: new Date() },
      }),
    ]);
    await this.eventsService.emit(
      'PROGRAMME_UPDATED', 'EDUCATION_PROGRAMME', proposal.programmeId, null,
      EventSource.USER, actorId, { via: 'web-sync change', fields: Object.keys(update) },
    );
    return { ok: true };
  }

  async rejectChange(id: string, actorId: string | null) {
    const proposal = await this.prisma.programmeChangeProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('Change proposal not found');
    if (proposal.status !== 'PENDING') throw new BadRequestException('Change proposal already reviewed');
    await this.prisma.programmeChangeProposal.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: actorId, reviewedAt: new Date() },
    });
    return { ok: true };
  }

  // Approve a discovered new-programme candidate → materialise a real APPROVED programme via
  // the same shape the Excel importer produces (proposedData.programme). Rejecting keeps the
  // row REJECTED so the dedupe never re-surfaces it next sweep.
  async approveCandidate(id: string, actorId: string | null) {
    const cand = await this.prisma.programmeCandidate.findUnique({ where: { id } });
    if (!cand) throw new NotFoundException('Candidate not found');
    if (cand.status !== 'PENDING') throw new BadRequestException('Candidate already reviewed');

    const data = (cand.proposedData as any)?.programme as Record<string, any> | undefined;
    if (!data?.name) throw new BadRequestException('Candidate has no usable programme data');
    const studyFieldKey = (cand.proposedData as any)?.studyFieldKey as string | undefined;
    const intakes = ((cand.proposedData as any)?.intakes ?? []) as Array<Record<string, any>>;

    const created = await this.prisma.$transaction(async (tx) => {
      const prog = await tx.educationProgramme.create({
        // proposedData is dynamic JSON (rowToProgrammeData output incl. providerId/name/
        // level/nzqfLevel) — the fields are all present at runtime; cast past the static check.
        data: {
          ...data,
          verifiedAt: data.verifiedAt ? new Date(data.verifiedAt) : null,
          reviewStatus: ReviewStatus.APPROVED,
          isActive: true,
        } as any,
      });
      if (studyFieldKey) {
        const sf = await tx.studyField.findFirst({ where: { key: studyFieldKey }, select: { id: true } });
        if (sf) {
          await tx.programmeStudyField.create({ data: { programmeId: prog.id, studyFieldId: sf.id, isPrimary: true } });
        }
      }
      if (intakes.length) {
        await tx.programmeIntake.createMany({ data: intakes.map((it) => ({ ...it, programmeId: prog.id })) as any });
      }
      await tx.programmeCandidate.update({
        where: { id },
        data: { status: 'APPROVED', reviewedById: actorId, reviewedAt: new Date() },
      });
      return prog;
    });

    await this.eventsService.emit(
      'PROGRAMME_CREATED', 'EDUCATION_PROGRAMME', created.id, null,
      EventSource.USER, actorId, { via: 'web-sync candidate', programmeName: created.name },
    );
    return created;
  }

  async rejectCandidate(id: string, actorId: string | null) {
    const cand = await this.prisma.programmeCandidate.findUnique({ where: { id } });
    if (!cand) throw new NotFoundException('Candidate not found');
    if (cand.status !== 'PENDING') throw new BadRequestException('Candidate already reviewed');
    await this.prisma.programmeCandidate.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: actorId, reviewedAt: new Date() },
    });
    return { ok: true };
  }

  async createProvider(dto: CreateProviderDto, actorId: string | null) {
    const provider = await this.prisma.educationProvider.create({
      data: dto,
    });

    await this.eventsService.emit(
      'PROVIDER_CREATED',
      'EDUCATION_PROVIDER',
      provider.id,
      null,
      EventSource.USER,
      actorId,
      { providerName: provider.name },
    );

    return provider;
  }

  async findAll(query: ProviderListQueryDto) {
    const where: any = {};

    if (query.providerType) {
      where.providerType = query.providerType;
    }
    if (query.status) {
      where.status = query.status;
    }

    return this.prisma.educationProvider.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const provider = await this.prisma.educationProvider.findUnique({
      where: { id },
      include: {
        faculties: true,
        programmes: {
          include: {
            requirements: true,
          },
        },
      },
    });

    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    return provider;
  }

  // PR-PROVIDER-PORTAL slice B — give an institution a login.
  //
  // Reuses the agent pattern exactly: a User with an UNUSABLE password, so the
  // password door does not exist for this account and magic-link is the only way
  // in. Nothing here sets a real password, and nothing later should.
  //
  // Refuses rather than overwrites when a login already exists. Silently
  // repointing EducationProvider.userId would orphan the previous login while
  // leaving it able to authenticate — a live credential attached to nothing,
  // which is the worst of both outcomes.
  //
  // OWNER-only, re-checked here and not merely at the route: this hands an
  // external party a way into the system.
  async provisionLogin(
    providerId: string,
    email: string,
    actor: { userId: string | null; name: string | null; role?: string | null },
  ) {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Only the Owner can provision an institution login.');
    }
    const normalized = (email ?? '').trim().toLowerCase();
    if (!normalized || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new BadRequestException('A valid email address is required for the login.');
    }

    const provider = await this.prisma.educationProvider.findUnique({
      where: { id: providerId },
      select: { id: true, name: true, userId: true },
    });
    if (!provider) throw new NotFoundException('Institution not found.');
    if (provider.userId) {
      throw new BadRequestException('That institution already has a login.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: normalized },
        select: { id: true, role: true, educationProvider: { select: { id: true } } },
      });
      if (existingUser?.educationProvider) {
        throw new ConflictException('That email already belongs to another institution.');
      }
      // A REUSED ACCOUNT MUST ALREADY BE A PROVIDER ACCOUNT.
      //
      // Reusing by email was written for the case of re-provisioning an
      // institution whose User row already exists. It silently accepted ANY
      // existing account: pointing an institution at a client's or a staff
      // member's address would attach their personal account to that
      // institution, leaving their role untouched — so they would sign in,
      // land on their own portal, and never reach the provider portal, while
      // `educationProvider.userId` now pointed at them.
      //
      // Found by trying to provision a real address on production that turned
      // out to be an existing LEAD. Refuse it, and say what to do instead.
      if (existingUser && existingUser.role !== 'PROVIDER') {
        throw new ConflictException(
          'That email already belongs to a Sorena account that is not an institution login. Use a different address for this institution.',
        );
      }

      // 48 random bytes as the password hash: not a password anyone can present,
      // and not a null that some future code path might treat as "no password
      // required". Identical to provisionLogin() for agents.
      const userId = existingUser
        ? existingUser.id
        : (await tx.user.create({
            data: {
              name: provider.name,
              email: normalized,
              passwordHash: randomBytes(48).toString('base64'),
              role: 'PROVIDER',
              isActive: true,
            },
            select: { id: true },
          })).id;

      await tx.educationProvider.update({ where: { id: providerId }, data: { userId } });

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'CREATE',
          eventType: 'EDUCATION_PROVIDER_LOGIN_PROVISIONED',
          entityType: 'EDUCATION_PROVIDER',
          entityId: providerId,
          newValue: { providerId, providerName: provider.name, loginUserId: userId } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name,
          actorRoleSnapshot: actor.role ?? null,
        },
      });

      return { providerId, providerName: provider.name, userId, email: normalized };
    });

    return result;
  }

  async updateProvider(id: string, dto: UpdateProviderDto, actorId?: string | null) {
    const before = await this.prisma.educationProvider.findUnique({
      where: { id },
      select: { id: true, name: true, status: true },
    });
    if (!before) throw new NotFoundException('Provider not found.');

    // PR-RECS-PHASE0 — institutionType and providerType are two spellings of the
    // same fact (UNIVERSITY / ITP->POLYTECHNIC / PTE->COLLEGE), and the importer
    // has always written them together. Setting one here without the other would
    // create exactly the inconsistency the importer avoids, so providerType
    // follows — UNLESS the caller stated it explicitly, in which case they win.
    const data: UpdateProviderDto & { providerType?: ProviderType } = { ...dto };
    if (dto.institutionType && dto.providerType === undefined) {
      data.providerType = providerTypeFor(dto.institutionType);
    }

    const updated = await this.prisma.educationProvider.update({
      where: { id },
      data,
    });

    // PR-AUDIT — an institution's status is a CONTRACTUAL state, and it is the
    // third condition in the matching gate (reviewStatus + isActive +
    // provider.status === 'ACTIVE'), so flipping it decides what students can
    // see. Until now it wrote no trace anywhere: during the catalogue import an
    // institution moved PENDING → ACTIVE and neither audit_logs nor crm_events
    // recorded who did it or when — the only evidence was the row's own
    // updatedAt. This closes that.
    //
    // Only a genuine status TRANSITION is logged. Saving the form without
    // touching status writes nothing, so the trail answers "who made this live"
    // rather than "someone pressed Save".
    if (updated.status !== before.status) {
      await this.recordStatusChange(before, updated.status, actorId ?? null);
    }

    return updated;
  }

  /**
   * Best-effort by design: an audit failure must never roll back or block a
   * status change the Owner successfully made. Same stance as the auth service
   * takes on PASSWORD_CHANGED.
   */
  private async recordStatusChange(
    before: { id: string; name: string; status: string },
    nextStatus: string,
    actorId: string | null,
  ) {
    try {
      const actor = actorId
        ? await this.prisma.user.findUnique({
            where: { id: actorId },
            select: { name: true, role: true },
          })
        : null;

      await this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: 'UPDATE',
          eventType: 'PROVIDER_STATUS_CHANGED',
          entityType: 'EDUCATION_PROVIDER',
          entityId: before.id,
          oldValue: { status: before.status } as Prisma.InputJsonValue,
          newValue: {
            status: nextStatus,
            providerName: before.name,
          } as Prisma.InputJsonValue,
          // Snapshotted so the trail still reads correctly if the actor is
          // later renamed or their role changes.
          actorNameSnapshot: actor?.name ?? null,
          actorRoleSnapshot: actor?.role ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(
        `provider status audit failed for ${before.id}: ${(e as Error)?.message}`,
      );
    }
  }

  async updateAgreement(id: string, dto: UpdateAgreementDto) {
    await this.ensureProviderExists(id);

    return this.prisma.educationProvider.update({
      where: { id },
      data: dto,
    });
  }

  async addFaculty(providerId: string, dto: CreateFacultyDto) {
    await this.ensureProviderExists(providerId);

    return this.prisma.educationFaculty.create({
      data: {
        providerId,
        name: dto.name,
      },
    });
  }

  async findFaculties(providerId: string) {
    await this.ensureProviderExists(providerId);

    return this.prisma.educationFaculty.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addProgramme(providerId: string, dto: CreateProgrammeDto) {
    await this.ensureProviderExists(providerId);

    if (dto.facultyId) {
      const faculty = await this.prisma.educationFaculty.findUnique({
        where: { id: dto.facultyId },
      });
      if (!faculty || faculty.providerId !== providerId) {
        throw new BadRequestException('Faculty does not belong to the provider');
      }
    }

    return this.prisma.educationProgramme.create({
      data: {
        providerId,
        facultyId: dto.facultyId,
        name: dto.name,
        level: dto.level,
        nzqfLevel: dto.nzqfLevel,
        durationMonths: dto.durationMonths,
        tuitionFeeNZD: dto.tuitionFeeNZD,
        intakeMonths: dto.intakeMonths,
        reviewStatus: ReviewStatus.PENDING,
        isActive: false,
      },
    });
  }

  async findProgrammes(providerId: string, query: ProgrammeListQueryDto) {
    await this.ensureProviderExists(providerId);

    const where: any = { providerId };
    if (query.level) {
      where.level = query.level;
    }
    if (query.reviewStatus) {
      where.reviewStatus = query.reviewStatus;
    }

    return this.prisma.educationProgramme.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        faculty: true,
        requirements: true,
      },
    });
  }

  // ─── PR-PROVIDER-PORTAL slice A — pricing review ────────────────────────
  //
  // Mirrors approveProgramme/rejectProgramme deliberately, including emitting an
  // event per decision: a price becoming visible to clients is at least as
  // consequential as a programme doing so, and the trail has to say who made it
  // visible and when.
  //
  // Unlike a programme, approving does NOT flip `isActive`. The two mean
  // different things here: isActive is "this rate is current" (an institution can
  // retire a rate without it being rejected), reviewStatus is "somebody checked
  // it". Coupling them would silently republish a retired price on approval.
  private async setPricingReview(
    kind: 'tuition' | 'scholarship',
    id: string,
    status: 'APPROVED' | 'REJECTED',
    actorId: string | null,
  ) {
    const model = kind === 'tuition' ? this.prisma.providerTuition : this.prisma.providerScholarship;
    const existing = await (model as any).findUnique({
      where: { id },
      select: { id: true, providerId: true, nationality: true, amountValue: true, currency: true, reviewStatus: true },
    });
    if (!existing) throw new NotFoundException('Pricing row not found.');

    const updated = await (model as any).update({
      where: { id },
      data: { reviewStatus: status },
    });

    await this.eventsService.emit(
      kind === 'tuition'
        ? (status === 'APPROVED' ? 'PROVIDER_TUITION_APPROVED' : 'PROVIDER_TUITION_REJECTED')
        : (status === 'APPROVED' ? 'PROVIDER_SCHOLARSHIP_APPROVED' : 'PROVIDER_SCHOLARSHIP_REJECTED'),
      kind === 'tuition' ? 'PROVIDER_TUITION' : 'PROVIDER_SCHOLARSHIP',
      id,
      null,
      EventSource.USER,
      actorId,
      {
        providerId: existing.providerId,
        nationality: existing.nationality,
        amountValue: existing.amountValue,
        currency: existing.currency,
        previousStatus: existing.reviewStatus,
      },
    );

    return updated;
  }

  approveTuition(id: string, actorId: string | null) { return this.setPricingReview('tuition', id, 'APPROVED', actorId); }
  rejectTuition(id: string, actorId: string | null) { return this.setPricingReview('tuition', id, 'REJECTED', actorId); }
  approveScholarship(id: string, actorId: string | null) { return this.setPricingReview('scholarship', id, 'APPROVED', actorId); }
  rejectScholarship(id: string, actorId: string | null) { return this.setPricingReview('scholarship', id, 'REJECTED', actorId); }

  // PR-PROVIDER-PORTAL slice D — APPROVAL SETS reviewStatus AND NOTHING ELSE.
  //
  // This used to set `isActive: true` in the same breath, which quietly made
  // approval a publish button. The two answer different questions — reviewStatus
  // is "has somebody checked this", isActive is "is this being offered" — and an
  // institution that deactivates a programme has answered the second one. Under
  // the old behaviour the next approval on that programme republished it, with
  // nothing in the UI to suggest that would happen.
  //
  // This is the same coupling slice A refused for pricing, in the same words:
  // "Coupling them would silently republish a retired price on approval." A
  // retired programme deserves the same treatment, and now gets it.
  //
  // ⚠ WORKFLOW CHANGE: approving no longer publishes. A first-time approved
  // programme stays isActive:false until somebody activates it on the
  // institution's programmes screen (or the institution does, slice D). The
  // approvals queue says so rather than leaving it to be discovered.
  async approveProgramme(programmeId: string, actorId: string | null) {
    const programme = await this.ensureProgrammeExists(programmeId);

    const updated = await this.prisma.educationProgramme.update({
      where: { id: programmeId },
      data: {
        reviewStatus: ReviewStatus.APPROVED,
      },
    });

    await this.eventsService.emit(
      'PROGRAMME_APPROVED',
      'EDUCATION_PROGRAMME',
      programmeId,
      null,
      EventSource.USER,
      actorId,
      { programmeName: programme.name },
    );

    return updated;
  }

  async rejectProgramme(programmeId: string, actorId: string | null) {
    const programme = await this.ensureProgrammeExists(programmeId);

    const updated = await this.prisma.educationProgramme.update({
      where: { id: programmeId },
      data: {
        reviewStatus: ReviewStatus.REJECTED,
      },
    });

    await this.eventsService.emit(
      'PROGRAMME_REJECTED',
      'EDUCATION_PROGRAMME',
      programmeId,
      null,
      EventSource.USER,
      actorId,
      { programmeName: programme.name },
    );

    return updated;
  }

  async addRequirement(programmeId: string, dto: CreateRequirementDto) {
    await this.ensureProgrammeExists(programmeId);

    const existing = await this.prisma.programmeRequirement.findUnique({
      where: { programmeId },
    });
    if (existing) {
      throw new BadRequestException('Requirements already exist for this programme');
    }

    return this.prisma.programmeRequirement.create({
      data: {
        programmeId,
        minQualificationLevel: dto.minQualificationLevel,
        minGpa: dto.minGpa,
        englishTestType: dto.englishTestType,
        englishOverallMin: dto.englishOverallMin,
        englishComponentMins: dto.englishComponentMins,
        workExperienceRequired: dto.workExperienceRequired,
        portfolioRequired: dto.portfolioRequired,
        interviewRequired: dto.interviewRequired,
        documentsRequired: dto.documentsRequired,
        additionalNotes: dto.additionalNotes,
      },
    });
  }

  async findRequirement(programmeId: string) {
    await this.ensureProgrammeExists(programmeId);

    const requirements = await this.prisma.programmeRequirement.findUnique({
      where: { programmeId },
    });

    if (!requirements) {
      throw new NotFoundException('Requirements not found');
    }

    return requirements;
  }

  // ── Scholarships (PR-UNIVERSITIES) ──────────────────────────────────────
  // Owner-managed reference data: what Sorena can offer per provider, scoped by
  // applicant nationality and (optionally) a programme or qualification level.

  async findScholarships(providerId: string) {
    await this.ensureProviderExists(providerId);
    return this.prisma.providerScholarship.findMany({
      where: { providerId },
      orderBy: [{ isActive: 'desc' }, { nationality: 'asc' }, { createdAt: 'desc' }],
      include: { programme: { select: { id: true, name: true, level: true } } },
    });
  }

  async addScholarship(providerId: string, dto: CreateScholarshipDto, actorId: string | null) {
    await this.ensureProviderExists(providerId);
    await this.assertProgrammeBelongsToProvider(dto.programmeId, providerId);

    const scholarship = await this.prisma.providerScholarship.create({
      data: {
        providerId,
        nationality: dto.nationality.trim().toUpperCase(),
        programmeId: dto.programmeId ?? null,
        level: dto.level ?? null,
        name: dto.name.trim(),
        amountType: dto.amountType ?? CommissionType.FIXED,
        amountValue: dto.amountValue,
        currency: dto.currency?.trim().toUpperCase() ?? 'NZD',
        eligibilityNotes: dto.eligibilityNotes?.trim() || null,
        isActive: dto.isActive ?? true,
        updatedById: actorId,
      },
    });

    await this.eventsService.emit(
      'SCHOLARSHIP_CREATED',
      'PROVIDER_SCHOLARSHIP',
      scholarship.id,
      null,
      EventSource.USER,
      actorId,
      { providerId, nationality: scholarship.nationality, name: scholarship.name },
    );

    return scholarship;
  }

  async updateScholarship(scholarshipId: string, dto: UpdateScholarshipDto, actorId: string | null) {
    const existing = await this.ensureScholarshipExists(scholarshipId);
    if (dto.programmeId !== undefined) {
      await this.assertProgrammeBelongsToProvider(dto.programmeId, existing.providerId);
    }

    const scholarship = await this.prisma.providerScholarship.update({
      where: { id: scholarshipId },
      data: {
        ...(dto.nationality !== undefined ? { nationality: dto.nationality.trim().toUpperCase() } : {}),
        ...(dto.programmeId !== undefined ? { programmeId: dto.programmeId ?? null } : {}),
        ...(dto.level !== undefined ? { level: dto.level ?? null } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.amountType !== undefined ? { amountType: dto.amountType } : {}),
        ...(dto.amountValue !== undefined ? { amountValue: dto.amountValue } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency?.trim().toUpperCase() ?? 'NZD' } : {}),
        ...(dto.eligibilityNotes !== undefined ? { eligibilityNotes: dto.eligibilityNotes?.trim() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedById: actorId,
      },
    });

    await this.eventsService.emit(
      'SCHOLARSHIP_UPDATED',
      'PROVIDER_SCHOLARSHIP',
      scholarshipId,
      null,
      EventSource.USER,
      actorId,
      { providerId: existing.providerId },
    );

    return scholarship;
  }

  async deleteScholarship(scholarshipId: string, actorId: string | null) {
    const existing = await this.ensureScholarshipExists(scholarshipId);
    await this.prisma.providerScholarship.delete({ where: { id: scholarshipId } });

    await this.eventsService.emit(
      'SCHOLARSHIP_DELETED',
      'PROVIDER_SCHOLARSHIP',
      scholarshipId,
      null,
      EventSource.USER,
      actorId,
      { providerId: existing.providerId, name: existing.name },
    );

    return { id: scholarshipId, deleted: true };
  }

  // A programme reference (when given) must belong to the same provider.
  private async assertProgrammeBelongsToProvider(programmeId: string | null | undefined, providerId: string) {
    if (!programmeId) return;
    const programme = await this.prisma.educationProgramme.findUnique({
      where: { id: programmeId },
      select: { providerId: true },
    });
    if (!programme || programme.providerId !== providerId) {
      throw new BadRequestException('Programme does not belong to this provider');
    }
  }

  private async ensureScholarshipExists(id: string) {
    const scholarship = await this.prisma.providerScholarship.findUnique({ where: { id } });
    if (!scholarship) {
      throw new NotFoundException('Scholarship not found');
    }
    return scholarship;
  }

  private async ensureProviderExists(id: string) {
    const provider = await this.prisma.educationProvider.findUnique({
      where: { id },
    });
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }
    return provider;
  }

  private async ensureProgrammeExists(id: string) {
    const programme = await this.prisma.educationProgramme.findUnique({
      where: { id },
    });
    if (!programme) {
      throw new NotFoundException('Programme not found');
    }
    return programme;
  }
}
