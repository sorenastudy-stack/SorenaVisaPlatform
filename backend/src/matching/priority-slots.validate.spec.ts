// PR-RECS-2 (slice 2) — GOLDEN two-directional freeze for validateSlotSelection,
// the safety gate. A wrongly-ALLOWED selection silently removes a client's
// mandatory Polytechnic/College safety net; a wrongly-BLOCKED selection frustrates
// a valid client and erodes trust. BOTH are real harms — neither is a "safe
// default" — so each direction gets equal, explicit coverage with exact
// {position, code} assertions. Frozen BEFORE any endpoint wiring.
import {
  validateSlotSelection, type SlotRule, type SlotSelectionEntry, type InstitutionType,
} from './matching.logic';

// Canonical NZ slotRules (matches the seeded CountryExecutionConfig).
const RULES: SlotRule[] = [
  { position: 1, allowedTypes: ['UNIVERSITY'], mandatory: false },
  { position: 2, allowedTypes: ['UNIVERSITY'], mandatory: false },
  { position: 3, allowedTypes: ['UNIVERSITY', 'ITP', 'PTE'], mandatory: false, preferred: 'PTE' },
  { position: 4, allowedTypes: ['ITP'], mandatory: true },
  { position: 5, allowedTypes: ['PTE'], mandatory: true },
];
const N = 5;

const sel = (rows: Array<[number, string | null, InstitutionType | null]>): SlotSelectionEntry[] =>
  rows.map(([position, programmeId, institutionType]) => ({ position, programmeId, institutionType }));
const errPairs = (r: { errors: { position: number | null; code: string }[] }) =>
  r.errors.map((e) => ({ position: e.position, code: e.code }));

// A valid canonical slate reused as the base for permutation cases.
const VALID = sel([
  [1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', 'ITP'], [5, 'p5', 'PTE'],
]);

describe('GOLDEN — validateSlotSelection: wrongly-ALLOWED must be REJECTED', () => {
  it('Slot 4 (mandatory ITP) holding a University → MANDATORY_WRONG_TYPE', () => {
    const r = validateSlotSelection(
      sel([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'bad', 'UNIVERSITY'], [5, 'p5', 'PTE']]),
      RULES, N,
    );
    expect(r.valid).toBe(false);
    expect(errPairs(r)).toEqual([{ position: 4, code: 'MANDATORY_WRONG_TYPE' }]);
  });

  it('Slot 5 (mandatory PTE) left empty → MANDATORY_EMPTY', () => {
    const r = validateSlotSelection(
      sel([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', 'ITP'], [5, null, null]]),
      RULES, N,
    );
    expect(r.valid).toBe(false);
    expect(errPairs(r)).toEqual([{ position: 5, code: 'MANDATORY_EMPTY' }]);
  });

  it('Slot 1 (allows only UNIVERSITY) holding a College → DISALLOWED_TYPE', () => {
    const r = validateSlotSelection(
      sel([[1, 'bad', 'PTE'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', 'ITP'], [5, 'p5', 'PTE']]),
      RULES, N,
    );
    expect(errPairs(r)).toEqual([{ position: 1, code: 'DISALLOWED_TYPE' }]);
  });

  it('THE REORDER HOLE — swap slot 3↔4 of a valid set lands PTE in mandatory-ITP → MANDATORY_WRONG_TYPE', () => {
    // Same programme SET as VALID, positions 3 and 4 swapped. Set-preserving, still invalid.
    const r = validateSlotSelection(
      sel([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'i4', 'ITP'], [4, 'p3', 'PTE'], [5, 'p5', 'PTE']]),
      RULES, N,
    );
    expect(r.valid).toBe(false);
    expect(errPairs(r)).toEqual([{ position: 4, code: 'MANDATORY_WRONG_TYPE' }]);
  });

  it('same programme in two slots → DUPLICATE_PROGRAMME on both', () => {
    const r = validateSlotSelection(
      sel([[1, 'dup', 'UNIVERSITY'], [2, 'dup', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', 'ITP'], [5, 'p5', 'PTE']]),
      RULES, N,
    );
    expect(errPairs(r)).toEqual([
      { position: 1, code: 'DUPLICATE_PROGRAMME' },
      { position: 2, code: 'DUPLICATE_PROGRAMME' },
    ]);
  });

  it('only 4 slots submitted → BAD_COUNT + MISSING_POSITION(5)', () => {
    const r = validateSlotSelection(
      sel([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', 'ITP']]),
      RULES, N,
    );
    expect(r.valid).toBe(false);
    expect(errPairs(r)).toEqual([
      { position: null, code: 'BAD_COUNT' },
      { position: 5, code: 'MISSING_POSITION' },
    ]);
  });

  it('unknown/unresolved type in a mandatory slot fails closed → MANDATORY_WRONG_TYPE', () => {
    const r = validateSlotSelection(
      sel([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', null], [5, 'p5', 'PTE']]),
      RULES, N,
    );
    expect(errPairs(r)).toEqual([{ position: 4, code: 'MANDATORY_WRONG_TYPE' }]);
  });
});

describe('GOLDEN — validateSlotSelection: wrongly-BLOCKED must be ACCEPTED', () => {
  it('the canonical valid NZ slate → valid, no errors', () => {
    const r = validateSlotSelection(VALID, RULES, N);
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it('Slot 3 filled with UNIVERSITY (allowed, not the PREFERRED PTE) → valid', () => {
    const r = validateSlotSelection(
      sel([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'u3', 'UNIVERSITY'], [4, 'i4', 'ITP'], [5, 'p5', 'PTE']]),
      RULES, N,
    );
    expect(r.valid).toBe(true); // preferred is a hint, never a hard requirement
  });

  it('a non-mandatory slot (1) left empty → valid', () => {
    const r = validateSlotSelection(
      sel([[1, null, null], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', 'ITP'], [5, 'p5', 'PTE']]),
      RULES, N,
    );
    expect(r.valid).toBe(true);
  });

  it('a VALID reorder — swap slots 1↔2 (both Universities) → valid', () => {
    const r = validateSlotSelection(
      sel([[1, 'u2', 'UNIVERSITY'], [2, 'u1', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'i4', 'ITP'], [5, 'p5', 'PTE']]),
      RULES, N,
    );
    expect(r.valid).toBe(true);
  });

  it('a VALID reorder — swap the two PTE programmes between slots 3 and 5 → valid', () => {
    // slot 3 allows PTE, slot 5 mandates PTE; both hold PTE, so the swap stays legal.
    const r = validateSlotSelection(
      sel([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p5', 'PTE'], [4, 'i4', 'ITP'], [5, 'p3', 'PTE']]),
      RULES, N,
    );
    expect(r.valid).toBe(true);
  });

  it('respects LIVE rules — under a relaxed config (slot 4 allows ITP or PTE), a PTE there is valid', () => {
    const relaxed = RULES.map((r) => (r.position === 4 ? { ...r, allowedTypes: ['ITP', 'PTE'] as InstitutionType[] } : r));
    const r = validateSlotSelection(
      sel([[1, 'u1', 'UNIVERSITY'], [2, 'u2', 'UNIVERSITY'], [3, 'p3', 'PTE'], [4, 'x4', 'PTE'], [5, 'p5', 'PTE']]),
      relaxed, N,
    );
    expect(r.valid).toBe(true);
  });
});
