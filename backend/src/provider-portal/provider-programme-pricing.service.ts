import { Injectable, NotFoundException } from '@nestjs/common';
import { EventSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { SetProgrammeGroupPricingDto } from './dto/programme-group-pricing.dto';
import { reconcileGroupRate } from './group-rate.reconciler';

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
        // Archived groups are off the menu — they cannot be picked for new
        // pricing. Rates they already carry are untouched and keep resolving.
        where: { providerId: actor.providerId, archivedAt: null },
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

    // Archived groups are excluded here too, which means two things at once: an
    // entry naming one is refused, and the reconcile loop below does not walk
    // it — so archiving never silently deactivates the rates it still holds.
    const groups = await this.prisma.nationalityGroup.findMany({
      where: { providerId: actor.providerId, archivedAt: null },
      select: { id: true, name: true },
    });
    const byId = new Map(groups.map((g) => [g.id, g]));

    // A group the caller does not own is not silently skipped — that would let a
    // typo pass for a save.
    for (const e of dto.entries) {
      if (!byId.has(e.nationalityGroupId)) throw new NotFoundException('Group not found.');
    }
    const wanted = new Map(dto.entries.map((e) => [e.nationalityGroupId, e]));

    const changes: Array<{ group: string; kind: 'tuition' | 'scholarship'; action: string; from?: number | null; to?: number | null }> = [];

    // The create / re-pend / deactivate rules live in ONE place — the same
    // reconciler the group form's default price uses. These two screens write
    // the same kind of row and differ only in `programmeId`, so a second copy of
    // the rules here would be a second thing to keep in step.
    for (const g of groups) {
      const entry = wanted.get(g.id);
      for (const kind of ['tuition', 'scholarship'] as const) {
        const amount = kind === 'tuition'
          ? (entry?.tuitionAmount ?? null)
          : (entry?.scholarshipAmount ?? null);

        const r = await reconcileGroupRate(
          this.prisma, this.events, kind,
          { providerId: actor.providerId, programmeId, nationalityGroupId: g.id, level: null },
          amount, actor,
          { groupName: g.name, programmeName: programme.name, scholarshipName: entry?.scholarshipName },
        );
        if (r.action !== 'unchanged' && r.action !== 'absent') {
          changes.push({ group: g.name, kind, action: r.action, from: r.previousAmount, to: r.amount });
        }
      }
    }

    return { ...(await this.get(programmeId, actor)), changes };
  }

}
