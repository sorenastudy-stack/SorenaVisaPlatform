import { EventSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

// PR-PROVIDER-PORTAL — the rules for a group-scoped rate, in ONE place.
//
// Two screens now write these rows: the per-programme pricing section
// (`programmeId` set) and the group form's default price (`programmeId` null).
// They are the same rows under the same rules, so the rules live here rather
// than in both services:
//
//   • a new amount lands PENDING;
//   • a CHANGED amount returns the row to PENDING;
//   • an unchanged save leaves the approval alone;
//   • clearing the amount DEACTIVATES the row — priced data is never deleted;
//   • re-supplying an unchanged amount reactivates without costing the approval.
//
// The two callers differ only in `programmeId`, which is also what makes them
// compose: the resolver scores a programme-scoped row at 2 and an
// institution-wide one at 0, so an override outranks a default automatically.
// No new matching rules were needed for either feature.

export type RateKind = 'tuition' | 'scholarship';

export interface ReconcileTarget {
  providerId: string;
  /** null = the institution-wide default for this group. */
  programmeId: string | null;
  nationalityGroupId: string;
  /** These rows are written unscoped by level; the importer may hold levelled ones. */
  level: string | null;
}

export interface ReconcileActor {
  providerId: string;
  providerName: string;
  userId: string | null;
}

export interface ReconcileResult {
  action: 'created' | 'changed' | 'reactivated' | 'deactivated' | 'unchanged' | 'absent';
  rowId: string | null;
  previousAmount: number | null;
  amount: number | null;
  returnedToReview: boolean;
}

/**
 * Bring one (provider, programme, group) rate into line with `amount`.
 * `amount == null` means "there should be no rate here".
 */
export async function reconcileGroupRate(
  prisma: PrismaService,
  events: EventsService,
  kind: RateKind,
  target: ReconcileTarget,
  amount: number | null,
  actor: ReconcileActor,
  extra: { groupName: string; programmeName?: string | null; scholarshipName?: string } = { groupName: '' },
): Promise<ReconcileResult> {
  const model: any = kind === 'tuition' ? prisma.providerTuition : prisma.providerScholarship;
  const where = {
    providerId: target.providerId,
    programmeId: target.programmeId,
    nationalityGroupId: target.nationalityGroupId,
    level: target.level as any,
  };

  const existing = await model.findFirst({
    where,
    select: { id: true, amountValue: true, isActive: true, reviewStatus: true, ...(kind === 'scholarship' ? { name: true } : {}) },
    orderBy: { updatedAt: 'desc' },
  });

  const audit = (eventType: string, rowId: string, payload: Record<string, unknown>) =>
    events.emit(
      eventType,
      kind === 'tuition' ? 'PROVIDER_TUITION' : 'PROVIDER_SCHOLARSHIP',
      rowId, null, EventSource.USER, actor.userId,
      {
        ...payload,
        scope: target.programmeId ? 'PROGRAMME' : 'INSTITUTION_DEFAULT',
        programmeId: target.programmeId,
        programmeName: extra.programmeName ?? null,
        groupId: target.nationalityGroupId,
        groupName: extra.groupName,
        providerId: actor.providerId,
        providerName: actor.providerName,
      },
    );

  const verb = kind === 'tuition' ? 'TUITION' : 'SCHOLARSHIP';
  const SET = `PROVIDER_GROUP_${verb}_SET`;
  const OFF = `PROVIDER_GROUP_${verb}_DEACTIVATED`;

  // ── nothing wanted here ────────────────────────────────────────────────────
  if (amount == null) {
    if (!existing || !existing.isActive) {
      return { action: 'absent', rowId: existing?.id ?? null, previousAmount: null, amount: null, returnedToReview: false };
    }
    await model.update({ where: { id: existing.id }, data: { isActive: false, updatedById: actor.userId } });
    await audit(OFF, existing.id, { amountValue: Number(existing.amountValue) });
    return { action: 'deactivated', rowId: existing.id, previousAmount: Number(existing.amountValue), amount: null, returnedToReview: false };
  }

  // ── a rate is wanted ───────────────────────────────────────────────────────
  const name = kind === 'scholarship'
    ? (extra.scholarshipName?.trim() || existing?.name || `${extra.groupName} scholarship`)
    : undefined;

  if (!existing) {
    const created = await model.create({
      data: {
        providerId: target.providerId,
        programmeId: target.programmeId,
        nationalityGroupId: target.nationalityGroupId,
        nationality: null, // the XOR — exactly one side is set
        level: target.level as any,
        amountValue: amount,
        currency: 'NZD',
        isActive: true,
        reviewStatus: 'PENDING',
        updatedById: actor.userId,
        ...(kind === 'scholarship' ? { name, amountType: 'FIXED' } : {}),
      },
      select: { id: true },
    });
    await audit(SET, created.id, { amountValue: amount, previousAmount: null, returnedToReview: true });
    return { action: 'created', rowId: created.id, previousAmount: null, amount, returnedToReview: true };
  }

  const nameChanged = kind === 'scholarship' && name !== existing.name;
  const amountChanged = Number(existing.amountValue) !== Number(amount) || nameChanged;

  await model.update({
    where: { id: existing.id },
    data: {
      amountValue: amount,
      isActive: true,
      updatedById: actor.userId,
      ...(kind === 'scholarship' ? { name } : {}),
      // Content moved → the approval no longer describes what is there. Merely
      // switching the row back on is not content.
      ...(amountChanged ? { reviewStatus: 'PENDING' as const } : {}),
    },
  });

  if (!amountChanged && existing.isActive) {
    return { action: 'unchanged', rowId: existing.id, previousAmount: Number(existing.amountValue), amount, returnedToReview: false };
  }

  const action = amountChanged ? 'changed' : 'reactivated';
  await audit(SET, existing.id, { amountValue: amount, previousAmount: Number(existing.amountValue), returnedToReview: amountChanged });
  return { action, rowId: existing.id, previousAmount: Number(existing.amountValue), amount, returnedToReview: amountChanged };
}
