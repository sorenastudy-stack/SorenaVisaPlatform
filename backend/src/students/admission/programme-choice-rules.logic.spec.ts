// PR-SLOTRULES (freeze) — GOLDEN two-directional battery for the re-homed mandatory
// institution-type rule. Adapted from the deleted PR-RECS-2 validateSlotSelection battery:
// the model is now simpler (one required type per configured mandatory position, all other
// positions unconstrained, fully config-driven), so the count/position-integrity and
// non-mandatory DISALLOWED cases retire — but the core two-directional discipline stays.
//
// A wrongly-ALLOWED list silently removes a client's mandatory Polytechnic/College safety
// net; a wrongly-BLOCKED list frustrates a valid client. BOTH are real harms — neither is a
// "safe default" — so each direction gets equal, explicit coverage with exact {position,
// code} assertions. Frozen BEFORE any enforcement wiring.
import {
  validateChoiceTypeRules,
  isRuleActive,
  type SlotRuleConfig,
  type ChoiceForRule,
  type InstitutionType,
} from './programme-choice-rules.logic';

// Canonical NZ config: priority 4 = ITP mandatory, priority 5 = PTE mandatory.
const NZ: SlotRuleConfig = {
  enabled: true,
  mandatorySlots: [
    { position: 4, institutionType: 'ITP' },
    { position: 5, institutionType: 'PTE' },
  ],
};

// A config with a mandatory UNIVERSITY position — proves University is enforced exactly
// like ITP/PTE (co-equal, no special-casing).
const UNI_MANDATORY: SlotRuleConfig = {
  enabled: true,
  mandatorySlots: [{ position: 1, institutionType: 'UNIVERSITY' }],
};

const ch = (rows: Array<[number, string, InstitutionType | null]>): ChoiceForRule[] =>
  rows.map(([priority, programmeId, institutionType]) => ({ priority, programmeId, institutionType }));
const errPairs = (r: { errors: { position: number; code: string }[] }) =>
  r.errors.map((e) => ({ position: e.position, code: e.code }));

// A valid canonical slate, reused as the base for permutation cases.
const VALID = ch([
  [1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', 'ITP'], [5, 'p5', 'PTE'],
]);

describe('isRuleActive', () => {
  it('is off when disabled', () => expect(isRuleActive({ enabled: false, mandatorySlots: [{ position: 4, institutionType: 'ITP' }] })).toBe(false));
  it('is off when no mandatory slots', () => expect(isRuleActive({ enabled: true, mandatorySlots: [] })).toBe(false));
  it('is on when enabled with mandatory slots', () => expect(isRuleActive(NZ)).toBe(true));
});

describe('GOLDEN — wrongly-ALLOWED must be REJECTED', () => {
  it('mandatory ITP position (4) holding a University → MANDATORY_WRONG_TYPE', () => {
    const r = validateChoiceTypeRules(
      ch([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'bad', 'UNIVERSITY'], [5, 'p5', 'PTE']]),
      NZ,
    );
    expect(r.valid).toBe(false);
    expect(errPairs(r)).toEqual([{ position: 4, code: 'MANDATORY_WRONG_TYPE' }]);
  });

  it('mandatory PTE position (5) not reached (list too short) → MANDATORY_EMPTY', () => {
    const r = validateChoiceTypeRules(
      ch([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', 'ITP']]),
      NZ,
    );
    expect(r.valid).toBe(false);
    expect(errPairs(r)).toEqual([{ position: 5, code: 'MANDATORY_EMPTY' }]);
  });

  it('THE REORDER HOLE — swapping 3↔4 of a valid slate lands PTE in mandatory-ITP → MANDATORY_WRONG_TYPE', () => {
    // Same programme SET as VALID, priorities 3 and 4 swapped (set-preserving, still invalid).
    const r = validateChoiceTypeRules(
      ch([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'i4', 'ITP'], [4, 'p3', 'PTE'], [5, 'p5', 'PTE']]),
      NZ,
    );
    expect(r.valid).toBe(false);
    expect(errPairs(r)).toEqual([{ position: 4, code: 'MANDATORY_WRONG_TYPE' }]);
  });

  it('FAIL CLOSED — unresolved (null) type in a mandatory position → MANDATORY_WRONG_TYPE', () => {
    const r = validateChoiceTypeRules(
      ch([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', null], [5, 'p5', 'PTE']]),
      NZ,
    );
    expect(r.valid).toBe(false);
    expect(errPairs(r)).toEqual([{ position: 4, code: 'MANDATORY_WRONG_TYPE' }]);
    expect(r.errors[0].actualType).toBeNull();
  });

  it('reports multiple mandatory failures, sorted by position', () => {
    // pos4 wrong type AND pos5 empty.
    const r = validateChoiceTypeRules(
      ch([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'bad', 'UNIVERSITY']]),
      NZ,
    );
    expect(errPairs(r)).toEqual([
      { position: 4, code: 'MANDATORY_WRONG_TYPE' },
      { position: 5, code: 'MANDATORY_EMPTY' },
    ]);
  });

  it('SYMMETRY — a mandatory UNIVERSITY position holding an ITP is rejected exactly like the others', () => {
    const r = validateChoiceTypeRules(ch([[1, 'bad', 'ITP'], [2, 'u2', 'UNIVERSITY']]), UNI_MANDATORY);
    expect(r.valid).toBe(false);
    expect(errPairs(r)).toEqual([{ position: 1, code: 'MANDATORY_WRONG_TYPE' }]);
  });
});

describe('GOLDEN — wrongly-BLOCKED must be ACCEPTED', () => {
  it('the canonical valid NZ slate → valid, no errors', () => {
    expect(validateChoiceTypeRules(VALID, NZ)).toEqual({ valid: true, errors: [] });
  });

  it('a NON-mandatory position may hold ANY type — University in slot 3 → valid', () => {
    const r = validateChoiceTypeRules(
      ch([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'u3', 'UNIVERSITY'], [4, 'i4', 'ITP'], [5, 'p5', 'PTE']]),
      NZ,
    );
    expect(r.valid).toBe(true);
  });

  it('extra choices beyond the mandatory positions are unconstrained → valid', () => {
    const r = validateChoiceTypeRules(
      [...VALID, { priority: 6, programmeId: 'u6', institutionType: 'UNIVERSITY' }, { priority: 7, programmeId: 'i7', institutionType: 'ITP' }],
      NZ,
    );
    expect(r.valid).toBe(true);
  });

  it('a VALID reorder that keeps types in place — swap the two Universities (1↔2) → valid', () => {
    const r = validateChoiceTypeRules(
      ch([[1, 'u2', 'UNIVERSITY'], [2, 'u1', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', 'ITP'], [5, 'p5', 'PTE']]),
      NZ,
    );
    expect(r.valid).toBe(true);
  });

  it('a mandatory UNIVERSITY position satisfied by a University → valid (symmetry, positive)', () => {
    expect(validateChoiceTypeRules(ch([[1, 'u1', 'UNIVERSITY'], [2, 'i2', 'ITP']]), UNI_MANDATORY).valid).toBe(true);
  });
});

describe('GOLDEN — an inactive rule never blocks', () => {
  it('enabled:false accepts even a slate that would otherwise fail', () => {
    const wrong = ch([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'bad', 'UNIVERSITY'], [5, 'p5', 'PTE']]);
    expect(validateChoiceTypeRules(wrong, { enabled: false, mandatorySlots: NZ.mandatorySlots })).toEqual({ valid: true, errors: [] });
  });

  it('empty mandatorySlots accepts any list', () => {
    expect(validateChoiceTypeRules(ch([[1, 'x', null]]), { enabled: true, mandatorySlots: [] })).toEqual({ valid: true, errors: [] });
  });
});
