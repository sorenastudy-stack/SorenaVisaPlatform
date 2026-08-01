// PR-SLOTRULES (freeze) — the mandatory institution-type rule for a student's
// Apply/Study programme-choice list, re-homed from the deleted PR-RECS-2 PrioritySlot
// system into the ONE real admission pathway. Pure + deterministic: NO DB, NO I/O — the
// caller server-resolves each choice's institution type (from programme → provider) and
// loads the live rule config; this file just decides valid/invalid. Golden-frozen before
// any wiring.
//
// Design (per Owner decision 2026-08-01):
//   • Fully config-driven — which positions are mandatory and what type each requires come
//     from CountryExecutionConfig, not hardcoded. `enabled:false` or an empty mandatory list
//     disables the rule cleanly.
//   • All three institution types are EQUAL, symmetric config entries. A mandatory
//     UNIVERSITY position is enforced exactly like a mandatory ITP or PTE — nothing is a
//     hardcoded default or fallback.
//   • The rule constrains ONLY the configured mandatory positions. Every other position is
//     unconstrained (any type, or absent). The "full safety-net slate" is realised as: the
//     list must reach each mandatory position and hold the required type there — so for the
//     NZ default (pos 4 = ITP, pos 5 = PTE) a student needs ≥5 ranked choices with a
//     Polytechnic 4th and a College 5th, exactly the PRD_4 §8 intent.
//   • FAIL CLOSED — a null/unresolved institution type never satisfies a mandatory position.

export type InstitutionType = 'UNIVERSITY' | 'ITP' | 'PTE';

// One Owner-configured mandatory position. `position` is a 1-based priority; the choice at
// that priority must be exactly `institutionType`.
export interface MandatorySlot {
  position: number;
  institutionType: InstitutionType;
}

// The live rule config (assembled by the caller from CountryExecutionConfig — `slotCount`
// stays UI/metadata there and is NOT needed here; the rule is entirely mandatory-driven).
export interface SlotRuleConfig {
  enabled: boolean;
  mandatorySlots: MandatorySlot[];
}

// A student's ordered programme choice, with the institution type SERVER-RESOLVED from the
// programme's provider — never a client claim. `null` = unresolved (fails closed).
export interface ChoiceForRule {
  priority: number;
  programmeId: string;
  institutionType: InstitutionType | null;
}

export type ChoiceRuleErrorCode = 'MANDATORY_EMPTY' | 'MANDATORY_WRONG_TYPE';

export interface ChoiceRuleError {
  position: number;
  code: ChoiceRuleErrorCode;
  requiredType: InstitutionType;
  actualType: InstitutionType | null; // null = no choice at that position, or unresolved type
  message: string;
}

export interface ChoiceRuleResult {
  valid: boolean;
  errors: ChoiceRuleError[];
}

export const INSTITUTION_TYPE_LABEL: Record<InstitutionType, string> = {
  UNIVERSITY: 'University',
  ITP: 'Polytechnic',
  PTE: 'College',
};

// The rule only bites when it's enabled AND at least one mandatory position is configured.
export function isRuleActive(config: SlotRuleConfig): boolean {
  return config.enabled && config.mandatorySlots.length > 0;
}

// Validate an ordered choice list against the configured mandatory positions. Returns a
// deterministic errors array (sorted by position) so callers and the golden battery see a
// stable result. An inactive rule always passes.
export function validateChoiceTypeRules(
  choices: ChoiceForRule[],
  config: SlotRuleConfig,
): ChoiceRuleResult {
  if (!isRuleActive(config)) return { valid: true, errors: [] };

  const byPosition = new Map<number, ChoiceForRule>();
  for (const c of choices) byPosition.set(c.priority, c);

  const errors: ChoiceRuleError[] = [];
  for (const slot of [...config.mandatorySlots].sort((a, b) => a.position - b.position)) {
    const choice = byPosition.get(slot.position);
    const req = INSTITUTION_TYPE_LABEL[slot.institutionType];

    if (!choice) {
      // Mandatory position not reached by the list (list too short / gap).
      errors.push({
        position: slot.position,
        code: 'MANDATORY_EMPTY',
        requiredType: slot.institutionType,
        actualType: null,
        message: `Priority ${slot.position} must be a ${req} programme — add one at that position.`,
      });
      continue;
    }
    // Fail closed: a null/unresolved type is treated as NOT matching.
    if (choice.institutionType !== slot.institutionType) {
      const actual = choice.institutionType ? INSTITUTION_TYPE_LABEL[choice.institutionType] : 'an unknown type';
      errors.push({
        position: slot.position,
        code: 'MANDATORY_WRONG_TYPE',
        requiredType: slot.institutionType,
        actualType: choice.institutionType,
        message: `Priority ${slot.position} must be a ${req} programme; this one is ${actual}.`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
