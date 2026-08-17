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

/** Archived groups are excluded from every place a group can be CHOSEN. */
const ACTIVE_ONLY = { archivedAt: null } as const;

const GROUP_SELECT = {
  id: true, name: true, nationalities: true, archivedAt: true, createdAt: true, updatedAt: true,
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

  /** Scoped AND not archived — for anything that picks a group to price. */
  private selectable(id: string, providerId: string) {
    return { id, providerId, ...ACTIVE_ONLY };
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
      where: { providerId: actor.providerId, ...ACTIVE_ONLY },
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

    // Only an ACTIVE namesake is a clash. An archived one still holds the unique
    // index, so it is renamed out of the way rather than permanently owning a
    // name the institution may want back.
    const clash = await this.prisma.nationalityGroup.findFirst({
      where: { providerId: actor.providerId, name },
      select: { id: true, archivedAt: true },
    });
    if (clash?.archivedAt) {
      await this.prisma.nationalityGroup.update({
        where: { id: clash.id },
        data: { name: `${name} (archived ${clash.archivedAt.toISOString().slice(0, 10)})` },
      });
    } else if (clash) {
      throw new ConflictException('You already have a group with that name.');
    }

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
      where: this.selectable(id, actor.providerId),
      select: { id: true, name: true, nationalities: true },
    });
    if (!existing) throw new NotFoundException('Group not found.');

    const nationalities = this.normaliseCodes(dto.nationalities);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Give the group a name.');

    if (name !== existing.name) {
      const clash = await this.prisma.nationalityGroup.findFirst({
        where: { providerId: actor.providerId, name, id: { not: id }, ...ACTIVE_ONLY },
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
   * ARCHIVE — the portal's "delete".
   *
   * The old behaviour hard-deleted, and the RESTRICT foreign key refused it
   * whenever any rate had EVER referenced the group — including rates the
   * institution had already cleared. So a group could become permanently
   * undeletable by having once been priced, which is the gap this closes.
   *
   * WHAT ARCHIVING DOES NOT DO: touch a single priced row. Every rate the group
   * ever carried stays exactly as it is — same amounts, same review status, same
   * history — and the resolver keeps reading them for as long as they are
   * active. Archiving is about the group leaving the *menu*, not about money
   * changing.
   *
   * WHICH IS WHY IT IS BLOCKED WHILE ANY RATE IS STILL LIVE. The alternative —
   * auto-deactivating the group's prices along with it — would let one click on
   * a button labelled "delete" silently change what real students are quoted
   * across every programme using that group, with nothing in the UI saying so.
   * That is the same judgement slice E already made when it refused to null
   * these references, and slice D made when approval stopped publishing: no
   * single action should quietly move a price in front of a student, or out from
   * under one. Clearing the prices first is a visible, per-rate decision; this
   * is not.
   *
   * Once those rates are cleared (each deactivated, none deleted), archiving
   * succeeds — which is exactly the case that used to be impossible.
   */
  async remove(id: string, actor: GroupActor) {
    const existing = await this.prisma.nationalityGroup.findFirst({
      where: this.selectable(id, actor.providerId),
      select: { id: true, name: true },
    });
    if (!existing) throw new NotFoundException('Group not found.');

    // ACTIVE rates only. A cleared rate still references the group and still
    // holds the FK, but it is not in front of anybody.
    const [liveTuitions, liveScholarships] = await Promise.all([
      this.prisma.providerTuition.count({ where: { nationalityGroupId: id, isActive: true } }),
      this.prisma.providerScholarship.count({ where: { nationalityGroupId: id, isActive: true } }),
    ]);
    const live = liveTuitions + liveScholarships;
    if (live > 0) {
      const bits: string[] = [];
      if (liveTuitions) bits.push(`${liveTuitions} fee${liveTuitions === 1 ? '' : 's'}`);
      if (liveScholarships) bits.push(`${liveScholarships} scholarship${liveScholarships === 1 ? '' : 's'}`);
      throw new ConflictException(
        `“${existing.name}” is still used by ${bits.join(' and ')}. Clear those prices first, then archive the group — nothing will be deleted.`,
      );
    }

    const archivedAt = new Date();
    await this.prisma.nationalityGroup.update({ where: { id }, data: { archivedAt } });
    await this.audit('PROVIDER_NATIONALITY_GROUP_ARCHIVED', id, actor, {
      name: existing.name,
      archivedAt: archivedAt.toISOString(),
      // Counted so the trail records that history was left intact, not removed.
      retainedPricingRows:
        (await this.prisma.providerTuition.count({ where: { nationalityGroupId: id } }))
        + (await this.prisma.providerScholarship.count({ where: { nationalityGroupId: id } })),
    });
    return { archived: true, id, archivedAt };
  }

  // ── Rates attached to a group ──────────────────────────────────────────────

  /** The group must be the caller's own, and the programme too if one is named. */
  private async assertOwnedTargets(dto: { nationalityGroupId: string; programmeId?: string }, actor: GroupActor) {
    // selectable(), not scoped(): an archived group is off the menu, so a rate
    // cannot be attached to one even by id.
    const group = await this.prisma.nationalityGroup.findFirst({
      where: this.selectable(dto.nationalityGroupId, actor.providerId),
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

  /**
   * Every rate the institution has — for the screen that shows current pricing.
   *
   * Rates belonging to an ARCHIVED group are excluded. Leaving them in made the
   * page contradict itself: the group had vanished from the list above while its
   * name still headed a rate below it. The rows themselves are untouched; this
   * is a filter on one view, not a change to the data.
   */
  async listRates(actor: GroupActor) {
    const notArchived = { OR: [{ nationalityGroupId: null }, { nationalityGroup: { archivedAt: null } }] };
    const [tuitions, scholarships] = await Promise.all([
      this.prisma.providerTuition.findMany({
        where: { providerId: actor.providerId, ...notArchived },
        select: {
          id: true, nationality: true, amountValue: true, currency: true, feeYear: true,
          level: true, programmeId: true, isActive: true, reviewStatus: true,
          nationalityGroup: { select: { id: true, name: true, nationalities: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.providerScholarship.findMany({
        where: { providerId: actor.providerId, ...notArchived },
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
