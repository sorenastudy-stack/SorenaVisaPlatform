import {
  slotStateOf,
  computeSlotStatuses,
  canSubmitToChoice,
  type SlotInput,
} from './sequential.logic';

const at = (d: string) => new Date(`${d}T09:00:00Z`);
const NOW = at('2026-08-20');
const RECENT = '2026-08-18'; // < 21 working days before NOW → ACTIVE
const OLD = '2026-07-01'; // ≥ 21 working days before NOW → TIMED_OUT

const slot = (choiceId: string, priority: number, outcome?: string, submittedAt = RECENT): SlotInput =>
  ({ choiceId, priority, latest: outcome ? { submittedAt, outcome: outcome as any } : null });

const byId = (statuses: ReturnType<typeof computeSlotStatuses>, id: string) => statuses.find((s) => s.choiceId === id)!;

describe('slotStateOf', () => {
  it('maps outcomes to states; PENDING splits on the 21-working-day timeout', () => {
    expect(slotStateOf(null, NOW)).toBe('UNSTARTED');
    expect(slotStateOf({ submittedAt: RECENT, outcome: 'OFFER' as any }, NOW)).toBe('OFFERED');
    expect(slotStateOf({ submittedAt: RECENT, outcome: 'DECLINED' as any }, NOW)).toBe('DECLINED');
    expect(slotStateOf({ submittedAt: RECENT, outcome: 'WITHDRAWN' as any }, NOW)).toBe('WITHDRAWN');
    expect(slotStateOf({ submittedAt: RECENT, outcome: 'PENDING' as any }, NOW)).toBe('ACTIVE');
    expect(slotStateOf({ submittedAt: OLD, outcome: 'PENDING' as any }, NOW)).toBe('TIMED_OUT');
    expect(slotStateOf({ submittedAt: OLD, outcome: 'ACKNOWLEDGED' as any }, NOW)).toBe('TIMED_OUT');
  });
});

describe('computeSlotStatuses — sequential gate', () => {
  it('all unstarted → only Slot 1 is submittable; later slots blocked in order', () => {
    const s = computeSlotStatuses([slot('a', 1), slot('b', 2), slot('c', 3)], NOW);
    expect(byId(s, 'a').canSubmit).toBe(true);
    expect(byId(s, 'a').isActiveSlot).toBe(true);
    expect(byId(s, 'b').canSubmit).toBe(false);
    expect(byId(s, 'b').blockedReason).toMatch(/Submit to Slot 1 first/);
    expect(byId(s, 'c').canSubmit).toBe(false);
  });

  it('Slot 1 ACTIVE → only Slot 1 (resubmit) is allowed; Slot 2 blocked as parallel', () => {
    const s = computeSlotStatuses([slot('a', 1, 'PENDING', RECENT), slot('b', 2)], NOW);
    expect(byId(s, 'a').state).toBe('ACTIVE');
    expect(byId(s, 'a').canSubmit).toBe(true); // resubmit/chase the same slot
    expect(byId(s, 'a').isActiveSlot).toBe(true);
    expect(byId(s, 'b').canSubmit).toBe(false);
    expect(byId(s, 'b').blockedReason).toMatch(/Only one application may be in progress/);
  });

  it('Slot 1 TIMED_OUT → flagged, still blocks Slot 2 until withdrawn (strict, no auto-advance)', () => {
    const s = computeSlotStatuses([slot('a', 1, 'PENDING', OLD), slot('b', 2)], NOW);
    expect(byId(s, 'a').state).toBe('TIMED_OUT');
    expect(byId(s, 'a').timedOut).toBe(true);
    expect(byId(s, 'a').isActiveSlot).toBe(true);
    expect(byId(s, 'b').canSubmit).toBe(false); // must withdraw Slot 1 first
    expect(byId(s, 'b').blockedReason).toMatch(/resolve Slot 1/);
  });

  it('Slot 1 DECLINED → Slot 1 locked (resolved), Slot 2 opens and becomes active', () => {
    const s = computeSlotStatuses([slot('a', 1, 'DECLINED'), slot('b', 2), slot('c', 3)], NOW);
    expect(byId(s, 'a').canSubmit).toBe(false);
    expect(byId(s, 'a').blockedReason).toMatch(/already resolved \(declined\)/);
    expect(byId(s, 'b').canSubmit).toBe(true);
    expect(byId(s, 'b').isActiveSlot).toBe(true);
    expect(byId(s, 'c').canSubmit).toBe(false); // still gated behind Slot 2
  });

  it('Slot 1 WITHDRAWN → Slot 2 opens (withdraw-then-advance)', () => {
    const s = computeSlotStatuses([slot('a', 1, 'WITHDRAWN'), slot('b', 2)], NOW);
    expect(byId(s, 'b').canSubmit).toBe(true);
    expect(byId(s, 'b').isActiveSlot).toBe(true);
  });

  it('Slot 1 DECLINED + Slot 2 ACTIVE → Slot 2 resubmit ok, Slot 3 blocked as parallel', () => {
    const s = computeSlotStatuses([slot('a', 1, 'DECLINED'), slot('b', 2, 'PENDING', RECENT), slot('c', 3)], NOW);
    expect(byId(s, 'b').canSubmit).toBe(true);
    expect(byId(s, 'c').canSubmit).toBe(false);
    expect(byId(s, 'c').blockedReason).toMatch(/Only one application may be in progress/);
  });

  it('an OFFER halts the whole sequence — nothing further is submittable', () => {
    const s = computeSlotStatuses([slot('a', 1, 'OFFER'), slot('b', 2), slot('c', 3)], NOW);
    expect(s.every((x) => x.canSubmit === false)).toBe(true);
    expect(s.every((x) => x.isActiveSlot === false)).toBe(true); // halted → no active slot
    expect(byId(s, 'b').blockedReason).toMatch(/An offer has been received \(Slot 1\)/);
  });

  it('offer at a later slot still halts earlier unresolved slots', () => {
    const s = computeSlotStatuses([slot('a', 1, 'DECLINED'), slot('b', 2, 'OFFER'), slot('c', 3)], NOW);
    expect(byId(s, 'c').canSubmit).toBe(false);
    expect(byId(s, 'c').blockedReason).toMatch(/offer has been received \(Slot 2\)/);
  });

  it('all slots resolved (declined) → no active slot, nothing submittable', () => {
    const s = computeSlotStatuses([slot('a', 1, 'DECLINED'), slot('b', 2, 'DECLINED')], NOW);
    expect(s.every((x) => !x.isActiveSlot && !x.canSubmit)).toBe(true);
  });

  it('is order-independent (input not required pre-sorted)', () => {
    const s = computeSlotStatuses([slot('c', 3), slot('a', 1), slot('b', 2)], NOW);
    expect(byId(s, 'a').canSubmit).toBe(true);
    expect(byId(s, 'b').canSubmit).toBe(false);
  });
});

describe('canSubmitToChoice — the create gate', () => {
  const slots = [slot('a', 1), slot('b', 2)];
  it('allows the active slot, blocks a later one with a reason', () => {
    expect(canSubmitToChoice(slots, 'a', NOW)).toEqual({ allowed: true, reason: null });
    const b = canSubmitToChoice(slots, 'b', NOW);
    expect(b.allowed).toBe(false);
    expect(b.reason).toMatch(/Submit to Slot 1 first/);
  });
  it('rejects an unknown choice id', () => {
    expect(canSubmitToChoice(slots, 'nope', NOW).allowed).toBe(false);
  });
});
