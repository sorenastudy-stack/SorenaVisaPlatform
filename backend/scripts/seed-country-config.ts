/**
 * PR-OWNER-1 (slice a) — seed default per-country config for Domain 16.
 *
 * Idempotent: upserts by the unique countryCode / (countryAIConfig, agentType)
 * keys, so re-running never duplicates and never clobbers an Owner's later edits
 * beyond re-asserting the seed defaults for a country that has no row yet. Safe to
 * run in every environment.
 *
 *   npx ts-node scripts/seed-country-config.ts            # seeds NZ
 *   npx ts-node scripts/seed-country-config.ts NZ AU IR   # seeds several
 *
 * The NZ execution defaults encode PRD_4 §8 in the InstitutionType vocabulary
 * (College = PTE, Polytechnic = ITP, University = UNIVERSITY). These are just DATA
 * — the Owner edits them via /staff/settings/country-config with no code deploy —
 * so the College=PTE / Polytechnic=ITP mapping assumption is fully reversible.
 */
import { PrismaClient, AIAgentType, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// PR-SLOTRULES — PRD_4 §8 default: within a 5-slot list, position 4 must be a
// Polytechnic (ITP) and position 5 a College (PTE). Every other position is
// unconstrained. All three types are equal, symmetric config entries.
const NZ_SLOT_RULES: Prisma.InputJsonValue = {
  enabled: true,
  mandatorySlots: [
    { position: 4, institutionType: 'ITP' }, // mandatory Polytechnic
    { position: 5, institutionType: 'PTE' }, // mandatory College
  ],
};

// Default recommendation sort weighting — higher = ranked earlier. Encodes the
// PRD's "College > Polytechnic > University" default.
const NZ_WEIGHTING: Prisma.InputJsonValue = { PTE: 0.4, ITP: 0.35, UNIVERSITY: 0.25 };

// The 9 agents (PRD_13). Only the recommendation-surfacing agent gets a default
// maxOptionsShown; the rest are null (n/a for how-many-options-to-a-student).
const ALL_AGENTS: AIAgentType[] = [
  'USER_GUIDANCE', 'COUNTRY_COMPARE', 'QUALIFICATION_SUPPORT', 'RECOMMENDATION_EXPLAIN',
  'CASE_ASSISTANT', 'SOP_GENERATION', 'CV_GENERATION', 'AI_COMPANION', 'AUTOMATION_TRIGGER',
];
const DEFAULT_MAX_OPTIONS: Partial<Record<AIAgentType, number>> = {
  RECOMMENDATION_EXPLAIN: 5,
};

async function seedCountry(code: string) {
  // Execution config — create if absent; never overwrite an existing (possibly
  // Owner-edited) row.
  const exec = await prisma.countryExecutionConfig.findUnique({ where: { countryCode: code } });
  if (!exec) {
    await prisma.countryExecutionConfig.create({
      data: { countryCode: code, slotCount: 5, slotRules: NZ_SLOT_RULES, institutionTypeWeighting: NZ_WEIGHTING, intakeMinLeadMonths: 5, intakeMaxWindowMonths: 12, liaLeadMonths: 4 },
    });
  }

  // AI config — create parent if absent.
  const ai = await prisma.countryAIConfig.upsert({
    where: { countryCode: code },
    update: {},
    create: { countryCode: code, guidanceLevel: 'STRICT', sopGateEnforcement: true },
  });

  // Agent rows — one per agent, upserted by (config, agentType). Only fills gaps;
  // existing rows keep their Owner-set values.
  for (const agentType of ALL_AGENTS) {
    await prisma.aIAgentConfig.upsert({
      where: { countryAIConfigId_agentType: { countryAIConfigId: ai.id, agentType } },
      update: {},
      create: {
        countryAIConfigId: ai.id,
        agentType,
        enabled: true,
        maxOptionsShown: DEFAULT_MAX_OPTIONS[agentType] ?? null,
      },
    });
  }

  const agentCount = await prisma.aIAgentConfig.count({ where: { countryAIConfigId: ai.id } });
  console.log(`  ${code}: execution ${exec ? '(kept)' : '(created)'} · AI config + ${agentCount} agents ready`);
}

async function main() {
  const codes = process.argv.slice(2).map((c) => c.toUpperCase());
  const targets = codes.length ? codes : ['NZ'];
  console.log(`Seeding country config for: ${targets.join(', ')}`);
  for (const code of targets) await seedCountry(code);
  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
