import { Injectable, NotFoundException } from '@nestjs/common';
import { EventSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { SetProgrammeGroupPricingDto } from './dto/programme-group-pricing.dto';

// PR-PROVIDER-PORTAL — tuition and scholarships for ONE programme, by country group.
//
// The rows written here are ordinary ProviderTuition / ProviderScholarship rows
// with BOTH `programmeId` and `nationalityGroupId` set. Slice E's resolver
// already handles exactly that shape — a programme-scoped group row scores
// programme(2) + level(0) on top of a GROUP nationality match, and still loses to
// any exact-nationality row, which is the rule that matters. Nothing in the
// matching logic changed for this.
//
// THREE BEHAVIOURS, and they are the whole feature:
//
//   • create — a new amount lands PENDING, like every other rate.
//   • edit   — a CHANGED amount returns the row to PENDING; an unchanged save
//              leaves the approval alone. Same rule as the tuition sheet in
//              slice C, for the same reason: approval is a statement about a
//              figure, so changing the figure makes it a statement about nothing.
//   • uncheck — DEACTIVATE, never delete. A priced row that a student may already
//              have been quoted from does not get erased; it stops applying.
//
// Reactivating an untouched row does NOT cost its approval, matching slice D's
// rule that activation is not content.

export interface PricingActor {
  providerId: string;
  providerName: string;
  userId: string | null;
}

/**
 * These rows are identified by (provider, programme, group) with no level and no
 * fee year. There is deliberately NO unique index across that trio: staff and the
 * importer may legitimately hold several rows for one programme that differ by
 * level or feeYear, and a unique constraint would make those unwritable. So the
 * lookup narrows on `level: null` — the shape this screen creates — and takes the
 * most recent if history ever produced more than one.
 */
const SCOPE = { level: null as null };

@Injectable()
export class ProviderProgrammePricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** The programme must be the caller's own — id names a resource, never a tenant. */
  private async assertOwnProgramme(programmeId: string, actor: PricingActor) {
    const programme = await this.prisma.educationProgramme.findFirst({
      where: { id: programmeId, providerId: actor.providerId },
      select: { id: true, name: true, tuitionFeeNZD: true },
    });
    if (!programme) throw new NotFoundException('Programme not found.');
    return programme;
  }

  /**
   * What the form needs: every group this institution has, and whatever pricing
   * already exists for this programme against each of them.
   */
  async get(programmeId: string, actor: PricingActor) {
    const programme = await this.assertOwnProgramme(programmeId, actor);

    const [groups, tuitions, scholarships] = await Promise.all([
      this.prisma.nationalityGroup.findMany({
        where: { providerId: actor.providerId },
        select: { id: true, name: true, nationalities: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.providerTuition.findMany({
        where: { providerId: actor.providerId, programmeId, nationalityGroupId: { not: null }, ...SCOPE },
        select: { id: true, nationalityGroupId: true, amountValue: true, reviewStatus: true, isActive: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.providerScholarship.findMany({
        where: { providerId: actor.providerId, programmeId, nationalityGroupId: { not: null }, ...SCOPE },
        select: { id: true, nationalityGroupId: true, name: true, amountValue: true, reviewStatus: true, isActive: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const firstBy = <T extends { nationalityGroupId: string | null }>(rows: T[], gid: string) =>
      rows.find((r) => r.nationalityGroupId === gid) ?? null;

    return {
      programme: { id: programme.id, name: programme.name, flatTuitionNZD: programme.tuitionFeeNZD },
      groups: groups.map((g) => {
        const t = firstBy(tuitions, g.id);
        const s = firstBy(scholarships, g.id);
        return {
          id: g.id,
          name: g.name,
          countryCount: g.nationalities.length,
          nationalities: g.nationalities,
          // `isActive` is surfaced so the UI can show a previously-priced group
          // as unchecked without pretending the row never existed.
          tuition: t ? { id: t.id, amount: t.amountValue, reviewStatus: t.reviewStatus, isActive: t.isActive } : null,
          scholarship: s ? { id: s.id, name: s.name, amount: s.amountValue, reviewStatus: s.reviewStatus, isActive: s.isActive } : null,
        };
      }),
    };
  }

  /** Apply the desired state: create, edit, or deactivate, per group. */
  async set(programmeId: string, dto: SetProgrammeGroupPricingDto, actor: PricingActor) {
    const programme = await this.assertOwnProgramme(programmeId, actor);

    const groups = await this.prisma.nationalityGroup.findMany({
      where: { providerId: actor.providerId },
      select: { id: true, name: true },
    });
    const byId = new Map(groups.map((g) => [g.id, g]));

    // A group the caller does not own is not silently skipped — that would let a
    // typo pass for a save.
    for (const e of dto.entries) {
      if (!byId.has(e.nationalityGroupId)) throw new NotFoundException('Group not found.');
    }
    const wanted = new Map(dto.entries.map((e) => [e.nationalityGroupId, e]));

    const changes: Array<{ group: string; kind: 'tuition' | 'scholarship'; action: string; from?: number; to?: number }> = [];

    for (const g of groups) {
      const entry = wanted.get(g.id);
      const wantTuition = entry?.tuitionAmount ?? null;
      const wantScholarship = entry?.scholarshipAmount ?? null;

      // ── tuition ──────────────────────────────────────────────────────────
      const tRow = await this.prisma.providerTuition.findFirst({
        where: { providerId: actor.providerId, programmeId, nationalityGroupId: g.id, ...SCOPE },
        select: { id: true, amountValue: true, isActive: true, reviewStatus: true },
        orderBy: { updatedAt: 'desc' },
      });

      if (wantTuition != null) {
        if (!tRow) {
          const created = await this.prisma.providerTuition.create({
            data: {
              providerId: actor.providerId, programmeId, nationalityGroupId: g.id, nationality: null,
              level: null, amountValue: wantTuition, currency: 'NZD',
              isActive: true, reviewStatus: 'PENDING', updatedById: actor.userId,
            },
            select: { id: true },
          });
          changes.push({ group: g.name, kind: 'tuition', action: 'created', to: wantTuition });
          await this.audit('PROVIDER_PROGRAMME_GROUP_TUITION_SET', created.id, actor, {
            programmeId, programmeName: programme.name, groupId: g.id, groupName: g.name,
            amountValue: wantTuition, previousAmount: null, returnedToReview: true,
          });
        } else {
          const amountChanged = Number(tRow.amountValue) !== Number(wantTuition);
          await this.prisma.providerTuition.update({
            where: { id: tRow.id },
            data: {
              amountValue: wantTuition,
              isActive: true,
              updatedById: actor.userId,
              // A changed figure costs the approval. Merely switching the row
              // back on does not — nothing about its content moved.
              ...(amountChanged ? { reviewStatus: 'PENDING' as const } : {}),
            },
          });
          if (amountChanged || !tRow.isActive) {
            changes.push({ group: g.name, kind: 'tuition', action: amountChanged ? 'changed' : 'reactivated', from: Number(tRow.amountValue), to: wantTuition });
            await this.audit('PROVIDER_PROGRAMME_GROUP_TUITION_SET', tRow.id, actor, {
              programmeId, programmeName: programme.name, groupId: g.id, groupName: g.name,
              amountValue: wantTuition, previousAmount: Number(tRow.amountValue), returnedToReview: amountChanged,
            });
          }
        }
      } else if (tRow?.isActive) {
        await this.prisma.providerTuition.update({ where: { id: tRow.id }, data: { isActive: false, updatedById: actor.userId } });
        changes.push({ group: g.name, kind: 'tuition', action: 'deactivated', from: Number(tRow.amountValue) });
        await this.audit('PROVIDER_PROGRAMME_GROUP_TUITION_DEACTIVATED', tRow.id, actor, {
          programmeId, programmeName: programme.name, groupId: g.id, groupName: g.name, amountValue: Number(tRow.amountValue),
        });
      }

      // ── scholarship ──────────────────────────────────────────────────────
      const sRow = await this.prisma.providerScholarship.findFirst({
        where: { providerId: actor.providerId, programmeId, nationalityGroupId: g.id, ...SCOPE },
        select: { id: true, name: true, amountValue: true, isActive: true, reviewStatus: true },
        orderBy: { updatedAt: 'desc' },
      });

      if (wantScholarship != null) {
        // The form asks for an amount, not a label, so one is derived. An
        // existing row keeps the name it already had.
        const name = entry?.scholarshipName?.trim() || sRow?.name || `${g.name} scholarship`;
        if (!sRow) {
          const created = await this.prisma.providerScholarship.create({
            data: {
              providerId: actor.providerId, programmeId, nationalityGroupId: g.id, nationality: null,
              level: null, name, amountType: 'FIXED', amountValue: wantScholarship, currency: 'NZD',
              isActive: true, reviewStatus: 'PENDING', updatedById: actor.userId,
            },
            select: { id: true },
          });
          changes.push({ group: g.name, kind: 'scholarship', action: 'created', to: wantScholarship });
          await this.audit('PROVIDER_PROGRAMME_GROUP_SCHOLARSHIP_SET', created.id, actor, {
            programmeId, programmeName: programme.name, groupId: g.id, groupName: g.name,
            amountValue: wantScholarship, previousAmount: null, returnedToReview: true,
          });
        } else {
          const amountChanged = Number(sRow.amountValue) !== Number(wantScholarship) || name !== sRow.name;
          await this.prisma.providerScholarship.update({
            where: { id: sRow.id },
            data: {
              amountValue: wantScholarship, name, isActive: true, updatedById: actor.userId,
              ...(amountChanged ? { reviewStatus: 'PENDING' as const } : {}),
            },
          });
          if (amountChanged || !sRow.isActive) {
            changes.push({ group: g.name, kind: 'scholarship', action: amountChanged ? 'changed' : 'reactivated', from: Number(sRow.amountValue), to: wantScholarship });
            await this.audit('PROVIDER_PROGRAMME_GROUP_SCHOLARSHIP_SET', sRow.id, actor, {
              programmeId, programmeName: programme.name, groupId: g.id, groupName: g.name,
              amountValue: wantScholarship, previousAmount: Number(sRow.amountValue), returnedToReview: amountChanged,
            });
          }
        }
      } else if (sRow?.isActive) {
        await this.prisma.providerScholarship.update({ where: { id: sRow.id }, data: { isActive: false, updatedById: actor.userId } });
        changes.push({ group: g.name, kind: 'scholarship', action: 'deactivated', from: Number(sRow.amountValue) });
        await this.audit('PROVIDER_PROGRAMME_GROUP_SCHOLARSHIP_DEACTIVATED', sRow.id, actor, {
          programmeId, programmeName: programme.name, groupId: g.id, groupName: g.name, amountValue: Number(sRow.amountValue),
        });
      }
    }

    return { ...(await this.get(programmeId, actor)), changes };
  }

  private audit(eventType: string, entityId: string, actor: PricingActor, payload: Record<string, unknown>) {
    return this.events.emit(
      eventType,
      eventType.includes('TUITION') ? 'PROVIDER_TUITION' : 'PROVIDER_SCHOLARSHIP',
      entityId,
      null,
      EventSource.USER,
      actor.userId,
      { ...payload, providerId: actor.providerId, providerName: actor.providerName },
    );
  }
}
