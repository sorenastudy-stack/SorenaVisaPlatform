import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { AIAgentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INSTITUTION_TYPES } from './dto/country-config.dto';

// PR-OWNER-1 (slice a) — Country Intelligence & Monetisation Config service.
//
// Owner-editable, per-country. Scoped to two RPD_16 sections this phase:
//   • CountryExecutionConfig — slotCount / slotRules / institutionTypeWeighting.
//   • CountryAIConfig + AIAgentConfig — per-agent settings.
// NO matcher wiring here (that is slice b) — this layer only stores + serves
// config. Every mutation writes an audit_logs row (actor snapshot included),
// matching PlatformSettingsService / SlaService.

interface Actor {
  id: string | null;
  name?: string | null;
  role?: string | null;
}

const VALID_TYPES = new Set<string>(INSTITUTION_TYPES);

@Injectable()
export class CountryConfigService {
  private readonly logger = new Logger(CountryConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Reads ───────────────────────────────────────────────────────────────

  // Summary list of every country that has either config row — drives the UI
  // country picker.
  async listCountries() {
    const [execs, ais] = await Promise.all([
      this.prisma.countryExecutionConfig.findMany({
        select: { countryCode: true, slotCount: true, updatedAt: true },
      }),
      this.prisma.countryAIConfig.findMany({
        select: { countryCode: true, guidanceLevel: true, updatedAt: true, _count: { select: { agents: true } } },
      }),
    ]);
    const codes = new Set<string>([...execs.map((e) => e.countryCode), ...ais.map((a) => a.countryCode)]);
    const execByCode = new Map(execs.map((e) => [e.countryCode, e]));
    const aiByCode = new Map(ais.map((a) => [a.countryCode, a]));
    return [...codes].sort().map((countryCode) => ({
      countryCode,
      slotCount: execByCode.get(countryCode)?.slotCount ?? null,
      guidanceLevel: aiByCode.get(countryCode)?.guidanceLevel ?? null,
      agentCount: aiByCode.get(countryCode)?._count.agents ?? 0,
    }));
  }

  // Full config for one country (execution + AI + agents). 404 if neither exists.
  async getCountry(countryCode: string) {
    const code = this.normCode(countryCode);
    const [execution, ai] = await Promise.all([
      this.prisma.countryExecutionConfig.findUnique({ where: { countryCode: code } }),
      this.prisma.countryAIConfig.findUnique({
        where: { countryCode: code },
        include: { agents: { orderBy: { agentType: 'asc' } } },
      }),
    ]);
    if (!execution && !ai) {
      throw new NotFoundException(`No config for country ${code}. Seed it first.`);
    }
    return { countryCode: code, execution, ai };
  }

  // ─── Mutations (OWNER only at the controller; audited here) ────────────────

  async updateExecution(
    countryCode: string,
    dto: { slotCount?: number; slotRules?: Record<string, unknown>; institutionTypeWeighting?: Record<string, unknown> },
    actor: Actor,
  ) {
    const code = this.normCode(countryCode);
    const existing = await this.prisma.countryExecutionConfig.findUnique({ where: { countryCode: code } });
    if (!existing) throw new NotFoundException(`No execution config for country ${code}. Seed it first.`);

    const data: Prisma.CountryExecutionConfigUpdateInput = { updatedById: actor.id };
    const changed: string[] = [];

    if (dto.slotCount !== undefined) {
      // (DTO already bounds-checks 1..20; re-assert defensively.)
      if (!Number.isInteger(dto.slotCount) || dto.slotCount < 1 || dto.slotCount > 20) {
        throw new BadRequestException('slotCount must be a whole number between 1 and 20.');
      }
      data.slotCount = dto.slotCount;
      changed.push('slotCount');
    }
    if (dto.slotRules !== undefined) {
      this.validateSlotRules(dto.slotRules, dto.slotCount ?? existing.slotCount);
      data.slotRules = dto.slotRules as Prisma.InputJsonValue;
      changed.push('slotRules');
    }
    if (dto.institutionTypeWeighting !== undefined) {
      this.validateWeighting(dto.institutionTypeWeighting);
      data.institutionTypeWeighting = dto.institutionTypeWeighting as Prisma.InputJsonValue;
      changed.push('institutionTypeWeighting');
    }
    // PR-INTAKE-1 — intake-timing tunables (months).
    for (const f of ['intakeMinLeadMonths', 'intakeMaxWindowMonths', 'liaLeadMonths'] as const) {
      const v = dto[f];
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < 0 || v > 60) throw new BadRequestException(`${f} must be a whole number of months (0–60).`);
      (data as Record<string, unknown>)[f] = v;
      changed.push(f);
    }
    if (changed.length === 0) throw new BadRequestException('No editable fields supplied.');

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.countryExecutionConfig.update({ where: { countryCode: code }, data });
      await tx.auditLog.create({
        data: {
          userId: actor.id, action: 'UPDATE',
          eventType: 'COUNTRY_EXECUTION_CONFIG_UPDATED',
          entityType: 'COUNTRY_EXECUTION_CONFIG', entityId: updated.id,
          newValue: { countryCode: code, changedFields: changed } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null, actorRoleSnapshot: actor.role ?? null,
        },
      });
      return updated;
    });
    this.logger.log(`Execution config ${code} updated (${changed.join(', ')}) by ${actor.id} (${actor.role ?? '?'})`);
    return row;
  }

  async updateAIConfig(
    countryCode: string,
    dto: { guidanceLevel?: string; sopGateEnforcement?: boolean; activePromptVersionId?: string | null },
    actor: Actor,
  ) {
    const code = this.normCode(countryCode);
    const existing = await this.prisma.countryAIConfig.findUnique({ where: { countryCode: code } });
    if (!existing) throw new NotFoundException(`No AI config for country ${code}. Seed it first.`);

    const data: Prisma.CountryAIConfigUpdateInput = { updatedById: actor.id };
    const changed: string[] = [];
    if (dto.guidanceLevel !== undefined) { data.guidanceLevel = dto.guidanceLevel as any; changed.push('guidanceLevel'); }
    if (dto.sopGateEnforcement !== undefined) { data.sopGateEnforcement = dto.sopGateEnforcement; changed.push('sopGateEnforcement'); }
    if (dto.activePromptVersionId !== undefined) {
      await this.assertPromptExists(dto.activePromptVersionId);
      data.activePromptVersion = dto.activePromptVersionId
        ? { connect: { id: dto.activePromptVersionId } }
        : { disconnect: true };
      changed.push('activePromptVersionId');
    }
    if (changed.length === 0) throw new BadRequestException('No editable fields supplied.');

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.countryAIConfig.update({ where: { countryCode: code }, data });
      await tx.auditLog.create({
        data: {
          userId: actor.id, action: 'UPDATE',
          eventType: 'COUNTRY_AI_CONFIG_UPDATED',
          entityType: 'COUNTRY_AI_CONFIG', entityId: updated.id,
          newValue: { countryCode: code, changedFields: changed } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null, actorRoleSnapshot: actor.role ?? null,
        },
      });
      return updated;
    });
    this.logger.log(`AI config ${code} updated (${changed.join(', ')}) by ${actor.id} (${actor.role ?? '?'})`);
    return row;
  }

  async updateAgent(
    countryCode: string,
    agentTypeRaw: string,
    dto: { enabled?: boolean; maxOptionsShown?: number | null; promptVersionId?: string | null; settingsJson?: Record<string, unknown> | null },
    actor: Actor,
  ) {
    const code = this.normCode(countryCode);
    const agentType = this.parseAgentType(agentTypeRaw);
    const ai = await this.prisma.countryAIConfig.findUnique({ where: { countryCode: code }, select: { id: true } });
    if (!ai) throw new NotFoundException(`No AI config for country ${code}. Seed it first.`);
    const existing = await this.prisma.aIAgentConfig.findUnique({
      where: { countryAIConfigId_agentType: { countryAIConfigId: ai.id, agentType } },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Agent ${agentType} not configured for ${code}. Seed it first.`);

    const data: Prisma.AIAgentConfigUpdateInput = { updatedById: actor.id };
    const changed: string[] = [];
    if (dto.enabled !== undefined) { data.enabled = dto.enabled; changed.push('enabled'); }
    if (dto.maxOptionsShown !== undefined) {
      if (dto.maxOptionsShown !== null && (!Number.isInteger(dto.maxOptionsShown) || dto.maxOptionsShown < 0 || dto.maxOptionsShown > 50)) {
        throw new BadRequestException('maxOptionsShown must be null or a whole number 0..50.');
      }
      data.maxOptionsShown = dto.maxOptionsShown;
      changed.push('maxOptionsShown');
    }
    if (dto.promptVersionId !== undefined) {
      await this.assertPromptExists(dto.promptVersionId);
      data.promptVersion = dto.promptVersionId
        ? { connect: { id: dto.promptVersionId } }
        : { disconnect: true };
      changed.push('promptVersionId');
    }
    if (dto.settingsJson !== undefined) { data.settingsJson = (dto.settingsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue; changed.push('settingsJson'); }
    if (changed.length === 0) throw new BadRequestException('No editable fields supplied.');

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aIAgentConfig.update({
        where: { countryAIConfigId_agentType: { countryAIConfigId: ai.id, agentType } },
        data,
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id, action: 'UPDATE',
          eventType: 'AI_AGENT_CONFIG_UPDATED',
          entityType: 'AI_AGENT_CONFIG', entityId: updated.id,
          newValue: { countryCode: code, agentType, changedFields: changed } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name ?? null, actorRoleSnapshot: actor.role ?? null,
        },
      });
      return updated;
    });
    this.logger.log(`Agent ${agentType}@${code} updated (${changed.join(', ')}) by ${actor.id} (${actor.role ?? '?'})`);
    return row;
  }

  // ─── Validation helpers ────────────────────────────────────────────────────

  private normCode(code: string): string {
    const c = (code ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) throw new BadRequestException('countryCode must be an ISO 3166-1 alpha-2 code.');
    return c;
  }

  // PR-SLOTRULES — validate the Owner-configurable mandatory-type rule object:
  //   { enabled: bool, mandatorySlots: [{ position: 1..slotCount, institutionType: valid }] }.
  // All three types are equal, symmetric values. Empty mandatorySlots is allowed (rule off).
  private validateSlotRules(rules: unknown, slotCount: number) {
    if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
      throw new BadRequestException('slotRules must be an object { enabled, mandatorySlots }.');
    }
    const r = rules as Record<string, unknown>;
    if (typeof r.enabled !== 'boolean') throw new BadRequestException('slotRules.enabled must be a boolean.');
    if (!Array.isArray(r.mandatorySlots)) throw new BadRequestException('slotRules.mandatorySlots must be an array.');

    const positions = new Set<number>();
    for (const m of r.mandatorySlots) {
      if (typeof m !== 'object' || m === null) throw new BadRequestException('Each mandatory slot must be an object.');
      const slot = m as Record<string, unknown>;
      const pos = slot.position;
      if (!Number.isInteger(pos) || (pos as number) < 1) throw new BadRequestException('Each mandatory slot needs a positive integer position.');
      if ((pos as number) > slotCount) throw new BadRequestException(`Mandatory slot position ${pos} exceeds the total slot count (${slotCount}).`);
      if (positions.has(pos as number)) throw new BadRequestException(`Duplicate mandatory slot position ${pos}.`);
      positions.add(pos as number);
      if (typeof slot.institutionType !== 'string' || !VALID_TYPES.has(slot.institutionType)) {
        throw new BadRequestException(`Mandatory slot ${pos}: invalid institution type. Allowed: ${[...VALID_TYPES].join(', ')}.`);
      }
    }
  }

  private validateWeighting(w: Record<string, unknown>) {
    const keys = Object.keys(w);
    if (keys.length === 0) throw new BadRequestException('institutionTypeWeighting must have at least one entry.');
    for (const [k, v] of Object.entries(w)) {
      if (!VALID_TYPES.has(k)) throw new BadRequestException(`Invalid institution type "${k}" in weighting. Allowed: ${[...VALID_TYPES].join(', ')}.`);
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new BadRequestException(`Weighting for ${k} must be a number between 0 and 1.`);
    }
  }

  private parseAgentType(raw: string): AIAgentType {
    const v = (raw ?? '').trim().toUpperCase();
    const valid: AIAgentType[] = ['USER_GUIDANCE', 'COUNTRY_COMPARE', 'QUALIFICATION_SUPPORT', 'RECOMMENDATION_EXPLAIN', 'CASE_ASSISTANT', 'SOP_GENERATION', 'CV_GENERATION', 'AI_COMPANION', 'AUTOMATION_TRIGGER'];
    if (!valid.includes(v as AIAgentType)) throw new BadRequestException(`Unknown agentType "${raw}".`);
    return v as AIAgentType;
  }

  private async assertPromptExists(id: string | null | undefined) {
    if (id === null || id === undefined) return; // clearing the reference is allowed
    const found = await this.prisma.promptVersion.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new BadRequestException(`promptVersionId ${id} does not exist.`);
  }
}
