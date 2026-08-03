import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// PR-ADMISSION-OFFER (step 6) — the offer-of-place record lifecycle. Staff record the formal offer
// detail (conditional/unconditional, conditions, offered/expiry dates, letter, notes) + the client's
// decision (accept/decline), for a programme choice whose submission came back OFFER. CRUD only — the
// sequential "offer halts the sequence" behaviour lives in the submission gate; a DECLINE of the
// APPLICATION is a SubmissionRecord.outcome=DECLINED, not an OfferRecord.

const OFFER_TYPES = ['CONDITIONAL', 'UNCONDITIONAL'] as const;
const OFFER_DECISIONS = ['PENDING', 'ACCEPTED', 'DECLINED'] as const;
type OfferType = (typeof OFFER_TYPES)[number];
type OfferDecision = (typeof OFFER_DECISIONS)[number];

interface OfferInput {
  choiceId?: string;
  offerType?: string;
  conditions?: string | null;
  offeredAt?: string | null;
  expiresAt?: string | null;
  letterFileName?: string | null;
  notes?: string | null;
  decision?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

@Injectable()
export class OfferService {
  constructor(private readonly prisma: PrismaService) {}

  private toDate = (s?: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);
  private ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  private shape(o: any) {
    return {
      id: o.id, choiceId: o.admissionProgrammeChoiceId, offerType: o.offerType, conditions: o.conditions,
      offeredAt: this.ymd(o.offeredAt), expiresAt: this.ymd(o.expiresAt), letterFileName: o.letterFileName,
      notes: o.notes, decision: o.decision, createdAt: o.createdAt.toISOString(),
    };
  }

  // Validate the mutable offer fields. `requireType` on create (offerType is mandatory there).
  private validate(dto: OfferInput, requireType: boolean): string[] {
    const errors: string[] = [];
    if (requireType || dto.offerType !== undefined) {
      if (!OFFER_TYPES.includes(dto.offerType as OfferType)) errors.push('Choose a valid offer type (conditional / unconditional).');
    }
    if (dto.decision != null && dto.decision !== '' && !OFFER_DECISIONS.includes(dto.decision as OfferDecision)) {
      errors.push('Choose a valid decision.');
    }
    for (const [label, v] of [['offer date', dto.offeredAt], ['expiry date', dto.expiresAt]] as const) {
      if (v != null && v !== '' && !validDate(v)) errors.push(`The ${label} is not a valid date.`);
    }
    if (dto.offeredAt && dto.expiresAt && validDate(dto.offeredAt) && validDate(dto.expiresAt) && dto.expiresAt < dto.offeredAt) {
      errors.push('The expiry date cannot be before the offer date.');
    }
    return errors;
  }

  async list(caseId: string) {
    const app = await this.prisma.admissionApplication.findFirst({
      where: { caseId },
      include: { programmeChoices: { orderBy: { priority: 'asc' }, include: { programme: { select: { name: true, provider: { select: { name: true } } } } } } },
    });
    const choices = app?.programmeChoices ?? [];
    const offers = choices.length
      ? await this.prisma.offerRecord.findMany({ where: { admissionProgrammeChoiceId: { in: choices.map((c: any) => c.id) } }, orderBy: { createdAt: 'desc' } })
      : [];
    const byChoice = new Map<string, any>();
    for (const o of offers) if (!byChoice.has(o.admissionProgrammeChoiceId)) byChoice.set(o.admissionProgrammeChoiceId, o); // latest (desc) wins
    return {
      applicationStatus: app?.status ?? null,
      choices: choices.map((ch: any) => ({
        choiceId: ch.id, priority: ch.priority, programme: ch.programme.name, provider: ch.programme.provider?.name ?? null,
        offer: byChoice.has(ch.id) ? this.shape(byChoice.get(ch.id)) : null,
      })),
    };
  }

  async create(caseId: string, dto: OfferInput, actorId: string | null) {
    const app = await this.prisma.admissionApplication.findFirst({ where: { caseId }, select: { status: true, programmeChoices: { select: { id: true } } } });
    if (app?.status !== 'SUBMITTED' && app?.status !== 'LOCKED') throw new BadRequestException('Record offers after the client submits their programme choices.');
    const choice = (app?.programmeChoices ?? []).find((c) => c.id === dto.choiceId);
    if (!choice) throw new NotFoundException('Programme choice not found on this case.');
    const errors = this.validate(dto, true);
    if (errors.length) throw new BadRequestException(errors.join(' '));

    const created = await this.prisma.offerRecord.create({
      data: {
        caseId, admissionProgrammeChoiceId: choice.id,
        offerType: dto.offerType as OfferType,
        conditions: dto.conditions?.trim() || null,
        offeredAt: this.toDate(dto.offeredAt), expiresAt: this.toDate(dto.expiresAt),
        letterFileName: dto.letterFileName?.trim() || null,
        notes: dto.notes?.trim() || null,
        decision: (dto.decision as OfferDecision) || 'PENDING',
        createdById: actorId,
      },
    });
    return this.shape(created);
  }

  async update(caseId: string, offerId: string, dto: OfferInput) {
    const rec = await this.prisma.offerRecord.findUnique({ where: { id: offerId } });
    if (!rec || rec.caseId !== caseId) throw new NotFoundException('Offer record not found on this case.');
    const errors = this.validate(dto, false);
    if (errors.length) throw new BadRequestException(errors.join(' '));
    const data: any = {};
    if (dto.offerType !== undefined) data.offerType = dto.offerType;
    if (dto.conditions !== undefined) data.conditions = dto.conditions?.trim() || null;
    if (dto.offeredAt !== undefined) data.offeredAt = this.toDate(dto.offeredAt);
    if (dto.expiresAt !== undefined) data.expiresAt = this.toDate(dto.expiresAt);
    if (dto.letterFileName !== undefined) data.letterFileName = dto.letterFileName?.trim() || null;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (dto.decision !== undefined) data.decision = (dto.decision as OfferDecision) || 'PENDING';
    const updated = await this.prisma.offerRecord.update({ where: { id: offerId }, data });
    return this.shape(updated);
  }

  async remove(caseId: string, offerId: string) {
    const rec = await this.prisma.offerRecord.findUnique({ where: { id: offerId } });
    if (!rec || rec.caseId !== caseId) throw new NotFoundException('Offer record not found on this case.');
    await this.prisma.offerRecord.delete({ where: { id: offerId } });
    return { deleted: true };
  }
}
