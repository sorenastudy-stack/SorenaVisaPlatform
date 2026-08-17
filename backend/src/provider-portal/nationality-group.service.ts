import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventSource, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import {
  CreateGroupScholarshipDto, CreateGroupTuitionDto, UpsertNationalityGroupDto,
} from './dto/nationality-group.dto';
import { reconcileGroupRate } from './group-rate.reconciler';

// PR-PROVIDER-PORTAL slice E — nationality groups and the rates attached to them.
//
// Same tenancy rule as slice D: an id names a RESOURCE, never a TENANT. Every
// lookup is scoped by `{ id, providerId }` together, so another institution's
// group id matches no row and 404s.
//
// The group is a label; the rate is money. Groups are therefore NOT reviewed and
// rates ARE — the same boundary that already exists between a programme's name
// and its price.

export interface GroupActor {
  providerId: string;
  providerName: string;
  userId: string | null;
}

const GROUP_SELECT = {
  id: true, name: true, nationalities: true, createdAt: true, updatedAt: true,
  _count: { select: { tuitions: true, scholarships: true } },
} satisfies Prisma.NationalityGroupSelect;

@Injectable()
export class NationalityGroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  private scoped(id: string, providerId: string) {
    return { id, providerId };
  }

  /**
   * Upper-case, trim, de-duplicate, drop blanks.
   *
   * Membership is decided by comparing codes, so "ir" and "IR" sitting in one
   * list would make the answer depend on which entry a loop reached first. The
   * codes are normalised once here rather than at every read.
   */
  private normaliseCodes(codes: string[]): string[] {
    const seen = new Set<string>();
    for (const raw of codes) {
      const c = (raw ?? '').trim().toUpperCase();
      if (c.length === 2) seen.add(c);
    }
    if (seen.size === 0) {
      throw new BadRequestException('A group needs at least one valid two-letter country code.');
    }
    return [...seen].sort();
  }

  /**
   * The group's institution-wide DEFAULT price — a row with `programmeId: null`.
   *
   * It composes with the per-programme screen without a single new matching
   * rule: the resolver scores a programme-scoped group row at 2 and this one at
   * 0, so an override outranks a default automatically, and both still lose to
   * any exact-nationality row.
   *
   * `undefined` means "not mentioned, leave it alone"; `null` means "clear it",
   * which deactivates rather than deletes.
   */
  private async applyDefaults(groupId: string, groupName: string, dto: UpsertNationalityGroupDto, actor: GroupActor) {
    const out: Record<string, string> = {};
    for (const [kind, value] of [
      ['tuition', dto.defaultTuitionAmount],
      ['scholarship', dto.defaultScholarshipAmount],
    ] as const) {
      if (value === undefined) continue;
      const r = await reconcileGroupRate(
        this.prisma, this.events, kind,
        { providerId: actor.providerId, programmeId: null, nationalityGroupId: groupId, level: null },
        value ?? null, actor, { groupName },
      );
      out[kind] = r.action;
    }
    return out;
  }

  /** The current default for each group, so the form and the list can show it. */
  private async defaultsFor(groupIds: string[], providerId: string) {
    const [tuitions, scholarships] = await Promise.all([
      this.prisma.providerTuition.findMany({
        where: { providerId, programmeId: null, nationalityGroupId: { in: groupIds }, level: null, isActive: true },
        select: { nationalityGroupId: true, amountValue: true, reviewStatus: true },
      }),
      this.prisma.providerScholarship.findMany({
        where: { providerId, programmeId: null, nationalityGroupId: { in: groupIds }, level: null, isActive: true },
        select: { nationalityGroupId: true, amountValue: true, reviewStatus: true },
      }),
    ]);
    const pick = (rows: any[], gid: string) => {
      const r = rows.find((x) => x.nationalityGroupId === gid);
      return r ? { amount: r.amountValue, reviewStatus: r.reviewStatus } : null;
    };
    return (gid: string) => ({
      defaultTuition: pick(tuitions, gid),
      defaultScholarship: pick(scholarships, gid),
    });
  }

  async list(actor: GroupActor) {
    const groups = await this.prisma.nationalityGroup.findMany({
      where: { providerId: actor.providerId },
      select: GROUP_SELECT,
      orderBy: { name: 'asc' },
    });
    const defaults = await this.defaultsFor(groups.map((g) => g.id), actor.providerId);
    return { groups: groups.map((g) => ({ ...this.shape(g), ...defaults(g.id) })) };
  }

  async create(dto: UpsertNationalityGroupDto, actor: GroupActor) {
    const nationalities = this.normaliseCodes(dto.nationalities);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Give the group a name.');

    const clash = await this.prisma.nationalityGroup.findFirst({
      where: { providerId: actor.providerId, name },
      select: { id: true },
    });
    if (clash) throw new ConflictException('You already have a group with that name.');

    const group = await this.prisma.nationalityGroup.create({
      data: { providerId: actor.providerId, name, nationalities },
      select: GROUP_SELECT,
    });
    await this.audit('PROVIDER_NATIONALITY_GROUP_CREATED', group.id, actor, { name, nationalities });
    await this.applyDefaults(group.id, name, dto, actor);
    const defaults = await this.defaultsFor([group.id], actor.providerId);
    return { ...this.shape(group), ...defaults(group.id) };
  }

  async update(id: string, dto: UpsertNationalityGroupDto, actor: GroupActor) {
    const existing = await this.prisma.nationalityGroup.findFirst({
      where: this.scoped(id, actor.providerId),
      select: { id: true, name: true, nationalities: true },
    });
    if (!existing) throw new NotFoundException('Group not found.');

    const nationalities = this.normaliseCodes(dto.nationalities);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Give the group a name.');

    if (name !== existing.name) {
      const clash = await this.prisma.nationalityGroup.findFirst({
        where: { providerId: actor.providerId, name, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictException('You already have a group with that name.');
    }

    const group = await this.prisma.nationalityGroup.update({
      where: { id },
      data: { name, nationalities },
      select: GROUP_SELECT,
    });

    // Editing the country list silently changes who every attached rate applies
    // to, so the audit records both lists — "why did this student's fee change"
    // is otherwise unanswerable after the fact.
    await this.audit('PROVIDER_NATIONALITY_GROUP_UPDATED', id, actor, {
      name,
      before: { name: existing.name, nationalities: existing.nationalities },
      after: { name, nationalities },
      attachedRates: group._count.tuitions + group._count.scholarships,
    });
    await this.applyDefaults(id, name, dto, actor);
    const defaults = await this.defaultsFor([id], actor.providerId);
    return { ...this.shape(group), ...defaults(id) };
  }

  /**
   * Delete — BLOCKED while any rate still points at the group.
   *
   * The alternative was to null the reference and let those rates fall back to
   * the programme's flat fee. That is worse in a way that does not announce
   * itself: the rows would survive with neither a nationality nor a group (which
   * the CHECK constraint forbids anyway), and if they were instead deleted or
   * ignored, a student would quietly start being quoted a different number with
   * nothing in the audit trail tying it to this action.
   *
   * Blocking makes the institution say what those rates should be first. The
   * message names the count, because "cannot delete" without a number is a dead
   * end rather than an instruction.
   */
  async remove(id: string, actor: GroupActor) {
    const existing = await this.prisma.nationalityGroup.findFirst({
      where: this.scoped(id, actor.providerId),
      select: { id: true, name: true, _count: { select: { tuitions: true, scholarships: true } } },
    });
    if (!existing) throw new NotFoundException('Group not found.');

    const attached = existing._count.tuitions + existing._count.scholarships;
    if (attached > 0) {
      const bits: string[] = [];
      if (existing._count.tuitions) bits.push(`${existing._count.tuitions} fee${existing._count.tuitions === 1 ? '' : 's'}`);
      if (existing._count.scholarships) bits.push(`${existing._count.scholarships} scholarship${existing._count.scholarships === 1 ? '' : 's'}`);
      throw new ConflictException(
        `“${existing.name}” is still used by ${bits.join(' and ')}. Change or remove those first, then delete the group.`,
      );
    }

    await this.prisma.nationalityGroup.delete({ where: { id } });
    await this.audit('PROVIDER_NATIONALITY_GROUP_DELETED', id, actor, { name: existing.name });
    return { deleted: true, id };
  }

  // ── Rates attached to a group ──────────────────────────────────────────────

  /** The group must be the caller's own, and the programme too if one is named. */
  private async assertOwnedTargets(dto: { nationalityGroupId: string; programmeId?: string }, actor: GroupActor) {
    const group = await this.prisma.nationalityGroup.findFirst({
      where: this.scoped(dto.nationalityGroupId, actor.providerId),
      select: { id: true, name: true },
    });
    if (!group) throw new NotFoundException('Group not found.');

    if (dto.programmeId) {
      const programme = await this.prisma.educationProgramme.findFirst({
        where: { id: dto.programmeId, providerId: actor.providerId },
        select: { id: true },
      });
      if (!programme) throw new NotFoundException('Programme not found.');
    }
    return group;
  }

  /**
   * A group tuition rate. Lands PENDING like every other rate — a rate covering
   * twenty countries is not a smaller decision than one covering one.
   */
  async createGroupTuition(dto: CreateGroupTuitionDto, actor: GroupActor) {
    const group = await this.assertOwnedTargets(dto, actor);

    // Routed through the reconciler rather than a bare create: the group form's
    // default price writes the SAME row (provider-wide, this group), so a plain
    // insert here would leave two provider-wide rates for one group and let the
    // resolver's tiebreak decide which a student is quoted.
    const r = await reconcileGroupRate(
      this.prisma, this.events, 'tuition',
      { providerId: actor.providerId, programmeId: dto.programmeId ?? null, nationalityGroupId: group.id, level: (dto.level as any) ?? null },
      dto.amountValue, actor, { groupName: group.name },
    );

    // The extra columns this endpoint accepts and the reconciler does not.
    if (r.rowId && (dto.feeYear != null || dto.term || dto.notes)) {
      await this.prisma.providerTuition.update({
        where: { id: r.rowId },
        data: { feeYear: dto.feeYear ?? null, term: dto.term ?? null, notes: dto.notes ?? null },
      });
    }

    const row = await this.prisma.providerTuition.findUnique({
      where: { id: r.rowId! },
      select: { id: true, amountValue: true, currency: true, reviewStatus: true, feeYear: true },
    });
    return { ...row, group: { id: group.id, name: group.name } };
  }

  /** A group scholarship. Also PENDING. */
  async createGroupScholarship(dto: CreateGroupScholarshipDto, actor: GroupActor) {
    const group = await this.assertOwnedTargets(dto, actor);

    const r = await reconcileGroupRate(
      this.prisma, this.events, 'scholarship',
      { providerId: actor.providerId, programmeId: dto.programmeId ?? null, nationalityGroupId: group.id, level: (dto.level as any) ?? null },
      dto.amountValue, actor, { groupName: group.name, scholarshipName: dto.name },
    );

    if (r.rowId && (dto.amountType || dto.eligibilityNotes)) {
      await this.prisma.providerScholarship.update({
        where: { id: r.rowId },
        data: { amountType: (dto.amountType as any) ?? 'FIXED', eligibilityNotes: dto.eligibilityNotes ?? null },
      });
    }

    const row = await this.prisma.providerScholarship.findUnique({
      where: { id: r.rowId! },
      select: { id: true, name: true, amountType: true, amountValue: true, currency: true, reviewStatus: true },
    });
    return { ...row, group: { id: group.id, name: group.name } };
  }

  /** Every rate the institution has, grouped or not — so the screen can show both. */
  async listRates(actor: GroupActor) {
    const [tuitions, scholarships] = await Promise.all([
      this.prisma.providerTuition.findMany({
        where: { providerId: actor.providerId },
        select: {
          id: true, nationality: true, amountValue: true, currency: true, feeYear: true,
          level: true, programmeId: true, isActive: true, reviewStatus: true,
          nationalityGroup: { select: { id: true, name: true, nationalities: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.providerScholarship.findMany({
        where: { providerId: actor.providerId },
        select: {
          id: true, nationality: true, name: true, amountType: true, amountValue: true,
          currency: true, level: true, programmeId: true, isActive: true, reviewStatus: true,
          nationalityGroup: { select: { id: true, name: true, nationalities: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);
    return { tuitions, scholarships };
  }

  private shape(g: { _count: { tuitions: number; scholarships: number } } & Record<string, any>) {
    const { _count, ...rest } = g;
    return {
      ...rest,
      // Surfaced so the UI can explain why a delete is refused BEFORE it is tried.
      attachedRates: { tuitions: _count.tuitions, scholarships: _count.scholarships },
    };
  }

  private audit(eventType: string, entityId: string, actor: GroupActor, payload: Record<string, unknown>) {
    return this.events.emit(
      eventType,
      'NATIONALITY_GROUP',
      entityId,
      null,
      EventSource.USER,
      actor.userId,
      { ...payload, providerId: actor.providerId, providerName: actor.providerName },
    );
  }
}
