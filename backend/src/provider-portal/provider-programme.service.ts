import { Injectable, NotFoundException } from '@nestjs/common';
import { EventSource, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import {
  CreateOwnProgrammeDto, UpdateOwnProgrammeDto,
} from './dto/provider-programme.dto';

// PR-PROVIDER-PORTAL slice D — an institution managing its own programmes.
//
// THE ID PROBLEM, AND HOW IT IS ANSWERED HERE.
//
// Slices B and C hold a simple invariant: no route accepts an id. That worked
// because those routes act on exactly one thing — the caller. Editing one
// programme out of two hundred needs the caller to say WHICH, so an id has to
// come in from outside for the first time in this portal.
//
// The id therefore means something different: it names a RESOURCE, never a
// TENANT. Every query below is scoped by BOTH the id and the guard-resolved
// providerId, so another institution's id simply does not match any row and the
// caller gets 404 — the same answer they would get for an id that never existed,
// which is also the right answer for "does provider B have a programme called
// X?". There is no code path that reads a programme by id alone.
//
// `scoped()` is that rule in one place. Nothing here builds a where-clause by
// hand, and the boundary spec fails if anything starts to.

/** The fields an institution may write, in one list — used for both the update and the diff. */
const EDITABLE = [
  'name', 'level', 'nzqfLevel', 'intakeMonths', 'durationMonths', 'durationText',
  'campusCity', 'deliveryMode', 'studentVisaSuitable', 'majorStrand', 'qualificationType',
  'subjectAreaRaw', 'tuitionFeeNZD', 'currency', 'feeBasis', 'feeYear', 'descriptionEn',
  'academicPrerequisites', 'englishRequirementRaw', 'otherRequirements', 'programmeUrl',
] as const;

/** What the institution gets back. Never the whole row — `notes` is staff-internal. */
const VISIBLE = {
  id: true, name: true, level: true, nzqfLevel: true, intakeMonths: true,
  durationMonths: true, durationText: true, campusCity: true, deliveryMode: true,
  studentVisaSuitable: true, majorStrand: true, qualificationType: true, subjectAreaRaw: true,
  tuitionFeeNZD: true, currency: true, feeBasis: true, feeYear: true, descriptionEn: true,
  academicPrerequisites: true, englishRequirementRaw: true, otherRequirements: true,
  programmeUrl: true, reviewStatus: true, isActive: true, createdAt: true, updatedAt: true,
} satisfies Prisma.EducationProgrammeSelect;

export interface ProgrammeActor {
  providerId: string;
  providerName: string;
  userId: string | null;
}

@Injectable()
export class ProviderProgrammeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** The ONLY way this file identifies a programme: id AND owner, together. */
  private scoped(programmeId: string, providerId: string) {
    return { id: programmeId, providerId };
  }

  async list(actor: ProgrammeActor) {
    const programmes = await this.prisma.educationProgramme.findMany({
      where: { providerId: actor.providerId },
      select: VISIBLE,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return {
      programmes,
      counts: {
        total: programmes.length,
        live: programmes.filter((p) => p.isActive && p.reviewStatus === 'APPROVED').length,
        awaitingReview: programmes.filter((p) => p.reviewStatus === 'PENDING').length,
      },
    };
  }

  async getOne(programmeId: string, actor: ProgrammeActor) {
    const programme = await this.prisma.educationProgramme.findFirst({
      where: this.scoped(programmeId, actor.providerId),
      select: VISIBLE,
    });
    if (!programme) throw new NotFoundException('Programme not found.');
    return programme;
  }

  /**
   * Create. Lands PENDING and inactive, exactly as the importer does — one
   * standard, not one for spreadsheets and a laxer one for the form.
   */
  async create(dto: CreateOwnProgrammeDto, actor: ProgrammeActor) {
    const data: Record<string, unknown> = { providerId: actor.providerId };
    for (const key of EDITABLE) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }

    const programme = await this.prisma.educationProgramme.create({
      data: {
        ...(data as Prisma.EducationProgrammeUncheckedCreateInput),
        // Stated, not defaulted. A default is a promise someone can change in a
        // migration without reading this file.
        reviewStatus: 'PENDING',
        isActive: false,
        source: 'MANUAL_ENTRY',
        sourceRef: `provider-portal-${actor.providerId}`,
      },
      select: VISIBLE,
    });

    await this.audit('PROVIDER_PROGRAMME_CREATED', programme.id, actor, {
      programmeName: programme.name,
      level: programme.level,
      nzqfLevel: programme.nzqfLevel,
    });

    return programme;
  }

  /**
   * Edit.
   *
   * A CHANGE TO CONTENT COSTS THE APPROVAL. Same rule as the tuition sheet in
   * slice C, for the same reason: approval is a statement about the words that
   * were read, so changing the words makes it a statement about nothing. An edit
   * that changes nothing keeps the approval, because re-saving a form should not
   * throw away a staff decision.
   *
   * REJECTED is left alone deliberately. Moving a rejected programme back to
   * PENDING on any edit would let an institution loop a refused programme back
   * into the queue indefinitely; a rejection is a conversation, not a retry.
   */
  async update(programmeId: string, dto: UpdateOwnProgrammeDto, actor: ProgrammeActor) {
    const existing = await this.prisma.educationProgramme.findFirst({
      where: this.scoped(programmeId, actor.providerId),
      select: { ...VISIBLE, reviewStatus: true },
    });
    if (!existing) throw new NotFoundException('Programme not found.');

    const data: Record<string, unknown> = {};
    const changedFields: string[] = [];
    for (const key of EDITABLE) {
      const next = dto[key];
      if (next === undefined) continue;
      if (this.same((existing as Record<string, unknown>)[key], next)) continue;
      data[key] = typeof next === 'string' && next.trim() === '' ? null : next;
      changedFields.push(key);
    }

    if (changedFields.length === 0) return this.getOne(programmeId, actor);

    const losesApproval = existing.reviewStatus === 'APPROVED';
    if (losesApproval) data.reviewStatus = 'PENDING';

    const updated = await this.prisma.educationProgramme.update({
      // `existing` was found through the scoped read, so this id is proven to be
      // theirs. The update is by id because Prisma requires a unique selector.
      where: { id: programmeId },
      data,
      select: VISIBLE,
    });

    await this.audit('PROVIDER_PROGRAMME_UPDATED', programmeId, actor, {
      programmeName: updated.name,
      changedFields,
      returnedToReview: losesApproval,
      previousStatus: existing.reviewStatus,
    });

    return updated;
  }

  /**
   * Activate / deactivate — `isActive` and NOTHING else.
   *
   * Not a soft delete dressed up: there is no delete route because there cannot
   * be one. `RecommendationItem` and `AdmissionProgrammeChoice` both hold a
   * required FK to a programme with no cascade, so the database refuses the
   * delete outright — and rightly, since a student's recorded choice must not
   * evaporate because an institution tidied its catalogue.
   *
   * The review status is untouched in both directions. Switching a programme off
   * for a year and back on says nothing about whether its content was checked,
   * so it must not cost the approval — otherwise every seasonal intake pause
   * would re-enter the review queue for no reason. (The STAFF toggle does couple
   * these; see the phase doc — that surface presents one switch and has its own
   * reasons. This one presents exactly what it changes.)
   */
  async setActive(programmeId: string, active: boolean, actor: ProgrammeActor) {
    const existing = await this.prisma.educationProgramme.findFirst({
      where: this.scoped(programmeId, actor.providerId),
      select: { id: true, name: true, isActive: true, reviewStatus: true },
    });
    if (!existing) throw new NotFoundException('Programme not found.');

    if (existing.isActive === active) return this.getOne(programmeId, actor);

    const updated = await this.prisma.educationProgramme.update({
      where: { id: programmeId },
      data: { isActive: active },
      select: VISIBLE,
    });

    await this.audit(
      active ? 'PROVIDER_PROGRAMME_ACTIVATED' : 'PROVIDER_PROGRAMME_DEACTIVATED',
      programmeId,
      actor,
      { programmeName: existing.name, reviewStatus: existing.reviewStatus },
    );

    return updated;
  }

  /** Array-aware equality — intakeMonths is the only list, and [3,7] !== [7,3] matters. */
  private same(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return a === b;
  }

  private audit(eventType: string, programmeId: string, actor: ProgrammeActor, payload: Record<string, unknown>) {
    return this.events.emit(
      eventType,
      'EDUCATION_PROGRAMME',
      programmeId,
      null,
      EventSource.USER,
      actor.userId,
      { ...payload, providerId: actor.providerId, providerName: actor.providerName },
    );
  }
}
