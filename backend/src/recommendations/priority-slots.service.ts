import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Prisma, type InstitutionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, EventSource } from '../events/events.service';
import {
  assignPrioritySlots, validateSlotSelection,
  type SlotRule, type SlotSelectionEntry,
} from '../matching/matching.logic';

// PR-RECS-2 (slice 2) — priority-slot selection (PRD_4 §8).
//
// Flow (corrected): assignPrioritySlots auto-fills the slate → the Admission
// Specialist (staff) may SWAP which programme sits in a position → the client only
// REORDERS the finished set into their priority sequence → confirm locks it.
//
// The safety gate (validateSlotSelection) runs on EVERY write path, because a
// permutation preserves the SET but not per-position type rules (moving the
// mandatory-ITP programme aside can drop a College into the Polytechnic slot).
// institutionType is always resolved SERVER-SIDE from the programme — never the
// client's claim.
//
// Asymmetry, by design:
//   • staffSwap   — validates the CHANGED position only (incremental: staff build
//                   the slate one swap at a time; unrelated incomplete slots don't block).
//   • clientReorder — full validation (they only permute a finished slate, so the
//                   result must be entirely valid) + a set-equality guard (can't
//                   add/remove/substitute — that's staff-only).
//   • confirm     — full validation, the final gate regardless of who last edited.

interface Actor { id: string | null; name?: string | null; role?: string | null }

// All programmes are NZ today (matches the matcher's slice-b choice). Multi-
// destination would key this off the case's programmes' provider.country.
const DESTINATION = 'NZ';

@Injectable()
export class PrioritySlotsService {
  private readonly logger = new Logger(PrioritySlotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  // ── Config + type resolution (server-authoritative) ────────────────────────

  private async loadSlotConfig(): Promise<{ slotCount: number; slotRules: SlotRule[] }> {
    const cfg = await this.prisma.countryExecutionConfig.findUnique({ where: { countryCode: DESTINATION } });
    if (!cfg) throw new BadRequestException('No execution config for this country. Slot rules are unset.');
    return { slotCount: cfg.slotCount, slotRules: this.coerceSlotRules(cfg.slotRules) };
  }

  // The config JSON is validated on WRITE (country-config service), but the read
  // side still fails closed on a malformed shape rather than trusting it.
  private coerceSlotRules(raw: unknown): SlotRule[] {
    if (!Array.isArray(raw)) throw new BadRequestException('slotRules config is malformed.');
    return raw.map((r) => {
      const o = r as Record<string, unknown>;
      if (typeof o.position !== 'number' || !Array.isArray(o.allowedTypes)) {
        throw new BadRequestException('slotRules config entry is malformed.');
      }
      return {
        position: o.position,
        allowedTypes: o.allowedTypes as InstitutionType[],
        mandatory: o.mandatory === true,
        preferred: (o.preferred as InstitutionType | undefined) ?? undefined,
      };
    });
  }

  // Real institution types from the programmes' providers — NEVER the client's claim.
  private async resolveTypes(programmeIds: string[]): Promise<Map<string, InstitutionType | null>> {
    const ids = [...new Set(programmeIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const progs = await this.prisma.educationProgramme.findMany({
      where: { id: { in: ids } },
      select: { id: true, provider: { select: { institutionType: true } } },
    });
    return new Map(progs.map((p) => [p.id, p.provider.institutionType]));
  }

  // ── Active list + slots ────────────────────────────────────────────────────

  private async activeList(caseId: string) {
    const list = await this.prisma.recommendationList.findFirst({
      where: { caseId, status: { in: ['GENERATED', 'VIEWED', 'CONFIRMED'] } },
      orderBy: { generatedAt: 'desc' },
    });
    if (!list) throw new NotFoundException('No recommendation list for this case yet. Generate recommendations first.');
    return list;
  }

  // Auto-seed the draft from assignPrioritySlots on first access (the slate the
  // Specialist then reviews). Idempotent — only seeds when no slots exist.
  private async ensureSeeded(listId: string, slotRules: SlotRule[], slotCount: number) {
    const existing = await this.prisma.prioritySlot.count({ where: { recommendationListId: listId } });
    if (existing > 0) return;
    const items = await this.prisma.recommendationItem.findMany({
      where: { recommendationListId: listId }, orderBy: { rank: 'asc' },
      select: { programmeId: true, institutionType: true },
    });
    const assigned = assignPrioritySlots(
      items.map((i) => ({ programmeId: i.programmeId, institutionType: i.institutionType })),
      slotRules, slotCount,
    );
    await this.prisma.prioritySlot.createMany({
      data: assigned.map((s) => ({ recommendationListId: listId, position: s.position, programmeId: s.programmeId })),
    });
  }

  private async currentSlots(listId: string) {
    return this.prisma.prioritySlot.findMany({ where: { recommendationListId: listId }, orderBy: { position: 'asc' } });
  }

  // Build the server-authoritative SlotSelectionEntry[] for the current slots.
  private async buildSelection(slots: { position: number; programmeId: string | null }[]): Promise<SlotSelectionEntry[]> {
    const types = await this.resolveTypes(slots.map((s) => s.programmeId).filter((x): x is string => !!x));
    return slots.map((s) => ({
      position: s.position,
      programmeId: s.programmeId,
      institutionType: s.programmeId ? types.get(s.programmeId) ?? null : null,
    }));
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  async getPicker(caseId: string) {
    const list = await this.activeList(caseId);
    const { slotCount, slotRules } = await this.loadSlotConfig();
    await this.ensureSeeded(list.id, slotRules, slotCount);

    const slots = await this.prisma.prioritySlot.findMany({
      where: { recommendationListId: list.id }, orderBy: { position: 'asc' },
      include: { programme: { include: { provider: { select: { name: true, city: true, institutionType: true } } } } },
    });
    const rulesByPos = new Map(slotRules.map((r) => [r.position, r]));

    const items = await this.prisma.recommendationItem.findMany({
      where: { recommendationListId: list.id }, orderBy: { rank: 'asc' },
      include: { programme: { include: { provider: { select: { name: true, city: true, institutionType: true } } } } },
    });

    return {
      listId: list.id,
      listStatus: list.status,
      locked: list.status === 'CONFIRMED',
      confirmedAt: list.confirmedAt,
      slotCount,
      slots: slots.map((s) => {
        const rule = rulesByPos.get(s.position);
        return {
          position: s.position,
          mandatory: rule?.mandatory ?? false,
          allowedTypes: rule?.allowedTypes ?? [],
          preferred: rule?.preferred ?? null,
          programme: s.programme ? this.shapeProgramme(s.programme) : null,
        };
      }),
      availablePool: items.map((it) => ({ ...this.shapeProgramme(it.programme), rank: it.rank, fitScore: it.fitScore })),
    };
  }

  private shapeProgramme(p: any) {
    return {
      programmeId: p.id, programmeName: p.name, providerName: p.provider.name,
      city: p.provider.city, institutionType: p.provider.institutionType,
      level: p.level, nzqfLevel: p.nzqfLevel, tuitionFeeNZD: p.tuitionFeeNZD,
      currency: p.currency, durationMonths: p.durationMonths, durationText: p.durationText,
    };
  }

  // ── Staff swap (CONSULTANT/admin) — change which programme sits at a position ─
  async staffSwap(caseId: string, position: number, programmeId: string | null, actor: Actor) {
    const list = await this.assertEditable(caseId);
    const { slotCount, slotRules } = await this.loadSlotConfig();
    await this.ensureSeeded(list.id, slotRules, slotCount);

    if (position < 1 || position > slotCount) throw new BadRequestException(`Position must be 1..${slotCount}.`);
    if (programmeId) await this.assertProgrammeInList(list.id, programmeId);

    const slots = await this.currentSlots(list.id);
    const next = slots.map((s) => (s.position === position ? { position: s.position, programmeId } : { position: s.position, programmeId: s.programmeId }));
    const selection = await this.buildSelection(next);

    // Validate the CHANGED position only (incremental editing — unrelated
    // incomplete slots don't block a staff swap).
    const result = validateSlotSelection(selection, slotRules, slotCount);
    const here = result.errors.filter((e) => e.position === position);
    if (here.length > 0) throw new BadRequestException({ message: 'Slot rule violation.', errors: here });

    await this.prisma.prioritySlot.update({
      where: { recommendationListId_position: { recommendationListId: list.id, position } },
      data: { programmeId },
    });
    this.logger.log(`Staff ${actor.id} swapped slot ${position} on list ${list.id} → ${programmeId ?? 'empty'}`);
    return this.getPicker(caseId);
  }

  // ── Client reorder (STUDENT) — permute the finished set into priority order ──
  async clientReorder(caseId: string, orderedProgrammeIds: (string | null)[], actor: Actor) {
    const list = await this.assertEditable(caseId);
    const { slotCount, slotRules } = await this.loadSlotConfig();
    await this.ensureSeeded(list.id, slotRules, slotCount);

    if (orderedProgrammeIds.length !== slotCount) {
      throw new BadRequestException(`Reorder must list exactly ${slotCount} positions.`);
    }
    const slots = await this.currentSlots(list.id);

    // SET-EQUALITY — the client may only permute; adding/removing/substituting a
    // programme is staff-only. Compare multisets of non-null ids.
    const currentSet = multiset(slots.map((s) => s.programmeId).filter((x): x is string => !!x));
    const incomingSet = multiset(orderedProgrammeIds.filter((x): x is string => !!x));
    if (!multisetEqual(currentSet, incomingSet)) {
      throw new BadRequestException('Reorder may only change the order of your existing programmes, not which programmes are selected.');
    }

    const next = orderedProgrammeIds.map((programmeId, i) => ({ position: i + 1, programmeId }));
    const selection = await this.buildSelection(next);

    // FULL validation — a permutation can drop a wrong type into a mandatory slot.
    const result = validateSlotSelection(selection, slotRules, slotCount);
    if (!result.valid) throw new BadRequestException({ message: 'That order isn’t allowed by the slot rules.', errors: result.errors });

    await this.prisma.$transaction(
      next.map((s) => this.prisma.prioritySlot.update({
        where: { recommendationListId_position: { recommendationListId: list.id, position: s.position } },
        data: { programmeId: s.programmeId },
      })),
    );
    this.logger.log(`Client ${actor.id} reordered slots on list ${list.id}`);
    return this.getPicker(caseId);
  }

  // ── Confirm (STUDENT) — the final gate + lock + event ────────────────────────
  async confirm(caseId: string, actor: Actor) {
    const list = await this.activeList(caseId);
    if (list.status === 'CONFIRMED') throw new ConflictException('Your priority slots are already confirmed.');
    const { slotCount, slotRules } = await this.loadSlotConfig();
    await this.ensureSeeded(list.id, slotRules, slotCount);

    const slots = await this.currentSlots(list.id);
    const selection = await this.buildSelection(slots);
    const result = validateSlotSelection(selection, slotRules, slotCount);
    if (!result.valid) throw new BadRequestException({ message: 'Your slots can’t be confirmed yet.', errors: result.errors });

    const kase = await this.prisma.case.findUnique({ where: { id: caseId }, select: { leadId: true } });

    await this.prisma.recommendationList.update({
      where: { id: list.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });

    // The event payload is the immutable audit: enforced rules + final selection.
    await this.events.emit(
      'PRIORITY_SLOTS_CONFIRMED', 'CASE', caseId, kase?.leadId ?? null, EventSource.USER, actor.id,
      {
        listId: list.id,
        slotCount,
        enforcedRules: slotRules as unknown as Record<string, unknown>,
        selection: selection.map((s) => ({ position: s.position, programmeId: s.programmeId, institutionType: s.institutionType })),
      },
    );
    this.logger.log(`Priority slots CONFIRMED for case ${caseId} (list ${list.id}) by ${actor.id}`);
    return this.getPicker(caseId);
  }

  // Staff read (Admission Specialist).
  async getForStaff(caseId: string) {
    return this.getPicker(caseId);
  }

  // ── Guards ───────────────────────────────────────────────────────────────
  private async assertEditable(caseId: string) {
    const list = await this.activeList(caseId);
    if (list.status === 'CONFIRMED') {
      throw new ForbiddenException('These priority slots are confirmed and locked. Ask your advisor to reopen them to make changes.');
    }
    return list;
  }

  private async assertProgrammeInList(listId: string, programmeId: string) {
    const item = await this.prisma.recommendationItem.findUnique({
      where: { recommendationListId_programmeId: { recommendationListId: listId, programmeId } },
      select: { id: true },
    });
    if (!item) throw new BadRequestException('That programme isn’t in this recommendation list.');
  }
}

function multiset(ids: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}
function multisetEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
