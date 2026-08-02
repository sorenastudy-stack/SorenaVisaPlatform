import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  validateChoiceTypeRules,
  isRuleActive,
  type SlotRuleConfig,
  type ChoiceForRule,
  type InstitutionType,
} from './programme-choice-rules.logic';

// PR-SLOTRULES (enforcement edge) — loads the live per-country rule config, SERVER-resolves
// each choice's institution type from its programme's provider (never a client claim; null =
// unresolved → fails closed in the pure rule), and enforces. Pure decision logic lives in
// programme-choice-rules.logic (golden-frozen); this is only the I/O + throw layer.
@Injectable()
export class ProgrammeChoiceRulesService {
  // Single-destination platform — same hardcoded 'NZ' the matcher uses. When the platform
  // goes multi-destination this reads the student's destination country instead.
  private readonly DESTINATION = 'NZ';

  constructor(private readonly prisma: PrismaService) {}

  async loadConfig(): Promise<SlotRuleConfig> {
    const row = await this.prisma.countryExecutionConfig.findUnique({
      where: { countryCode: this.DESTINATION },
      select: { slotRules: true },
    });
    const sr = row?.slotRules as unknown;
    if (!sr || typeof sr !== 'object' || Array.isArray(sr)) return { enabled: false, mandatorySlots: [] };
    const o = sr as Record<string, unknown>;
    return {
      enabled: o.enabled === true,
      mandatorySlots: Array.isArray(o.mandatorySlots)
        ? (o.mandatorySlots as SlotRuleConfig['mandatorySlots'])
        : [],
    };
  }

  private async resolve(
    choices: Array<{ programmeId: string; priority: number }>,
  ): Promise<ChoiceForRule[]> {
    const ids = [...new Set(choices.map((c) => c.programmeId))];
    const progs = ids.length
      ? await this.prisma.educationProgramme.findMany({
          where: { id: { in: ids } },
          select: { id: true, provider: { select: { institutionType: true } } },
        })
      : [];
    const typeById = new Map<string, InstitutionType | null>(
      progs.map((p) => [p.id, (p.provider?.institutionType ?? null) as InstitutionType | null]),
    );
    return choices.map((c) => ({
      priority: c.priority,
      programmeId: c.programmeId,
      institutionType: typeById.get(c.programmeId) ?? null,
    }));
  }

  // SUBMIT gate — the full rule: every configured mandatory position must be filled with the
  // right type. Throws (blocking submit) with per-position messages when not.
  async assertValidForSubmit(
    choices: Array<{ programmeId: string; priority: number }>,
  ): Promise<void> {
    const config = await this.loadConfig();
    if (!isRuleActive(config)) return;
    const res = validateChoiceTypeRules(await this.resolve(choices), config);
    if (!res.valid) {
      throw new BadRequestException({
        message: 'Your programme list doesn’t yet meet the required institution-type positions.',
        errors: res.errors.map((e) => e.message),
      });
    }
  }

  // WRITE guard (reorder) — block ONLY the reorder-hole: a mandatory position left holding the
  // WRONG type. Incompleteness (a mandatory position not yet reached) is allowed while
  // building; the submit gate catches that.
  async assertNoWrongTypeInMandatory(
    choices: Array<{ programmeId: string; priority: number }>,
  ): Promise<void> {
    const config = await this.loadConfig();
    if (!isRuleActive(config)) return;
    const res = validateChoiceTypeRules(await this.resolve(choices), config);
    const wrong = res.errors.filter((e) => e.code === 'MANDATORY_WRONG_TYPE');
    if (wrong.length) {
      throw new BadRequestException({
        message: 'That order puts the wrong institution type in a reserved position.',
        errors: wrong.map((e) => e.message),
      });
    }
  }
}
