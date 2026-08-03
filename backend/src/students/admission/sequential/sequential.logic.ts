// PR-ADMISSION-OFFER (step 6) — pure sequential-submission logic (PRD_10: Slot 1 → Slot 2 after 21
// working days, no parallel submission). NO I/O. The gate is derived entirely from the ordered
// programme choices + each choice's latest submission outcome + a 21-working-day timeout (via the
// canonical addWorkingDays). Golden-frozen before wiring.
//
// STRICT single-active (Owner decision 2026-08-03): at most one application is ever live. A choice
// only "clears" the way for the next when it is DECLINED or WITHDRAWN; a slot that has been PENDING
// ≥21 working days is TIMED_OUT — still live (blocking) — a PROMPT to withdraw and advance, not an
// auto-clear. An OFFER anywhere HALTS the sequence (declining a received offer reopens it).

import { addWorkingDays } from '../../../common/working-days/nz-working-days';
import type { SubmissionOutcome } from '../submission/submission.logic';

export const SEQUENTIAL_ADVANCE_WORKING_DAYS = 21;

export type SlotState = 'UNSTARTED' | 'ACTIVE' | 'TIMED_OUT' | 'OFFERED' | 'DECLINED' | 'WITHDRAWN';

// "Cleared" = resolved in a way that lets the NEXT slot proceed. Timeout/offer deliberately excluded.
const CLEARED: ReadonlySet<SlotState> = new Set<SlotState>(['DECLINED', 'WITHDRAWN']);
const LIVE: ReadonlySet<SlotState> = new Set<SlotState>(['ACTIVE', 'TIMED_OUT']);

export interface SlotInput {
  choiceId: string;
  priority: number;
  // The choice's latest submission attempt (from summariseChoiceSubmissions), or null if unstarted.
  latest: { submittedAt: string; outcome: SubmissionOutcome } | null;
}

export interface SlotStatus {
  choiceId: string;
  priority: number;
  state: SlotState;
  timedOut: boolean; // pending ≥21 working days — prompt to withdraw + advance
  isActiveSlot: boolean; // the slot staff should act on now
  canSubmit: boolean; // may log a (re)submission to this slot right now
  blockedReason: string | null;
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const asDate = (s: string): Date => new Date(`${s}T00:00:00Z`);
const reachedWorkingDays = (submittedAt: string, now: Date, n: number): boolean =>
  ymd(now) >= ymd(addWorkingDays(asDate(submittedAt), n));

export function slotStateOf(latest: SlotInput['latest'], now: Date): SlotState {
  if (!latest) return 'UNSTARTED';
  switch (latest.outcome) {
    case 'OFFER': return 'OFFERED';
    case 'DECLINED': return 'DECLINED';
    case 'WITHDRAWN': return 'WITHDRAWN';
    default: // PENDING | ACKNOWLEDGED — still awaiting a decision
      return reachedWorkingDays(latest.submittedAt, now, SEQUENTIAL_ADVANCE_WORKING_DAYS) ? 'TIMED_OUT' : 'ACTIVE';
  }
}

// Compute the full per-choice sequential status. Deterministic + non-mutating; the golden battery
// pins every branch. `now` is injected so it stays pure.
export function computeSlotStatuses(slots: SlotInput[], now: Date): SlotStatus[] {
  const ordered = [...slots].sort((a, b) => a.priority - b.priority);
  const stated = ordered.map((s) => ({ ...s, state: slotStateOf(s.latest, now) }));

  const offered = stated.find((s) => s.state === 'OFFERED') ?? null;
  const live = stated.filter((s) => LIVE.has(s.state));

  // The active slot: none if halted by an offer; else the (single) live slot; else the next
  // unstarted slot whose predecessors are all cleared; else none (sequence exhausted).
  let activeId: string | null = null;
  if (!offered) {
    if (live.length) {
      activeId = live[0].choiceId;
    } else {
      const next = stated.find((s) => s.state === 'UNSTARTED' && stated.filter((p) => p.priority < s.priority).every((p) => CLEARED.has(p.state)));
      activeId = next?.choiceId ?? null;
    }
  }

  return stated.map((s) => {
    let canSubmit = false;
    let blockedReason: string | null = null;

    if (offered) {
      blockedReason = `An offer has been received (Slot ${offered.priority}) — the sequence is complete. Decline that offer to reopen it.`;
    } else if (s.state === 'DECLINED' || s.state === 'WITHDRAWN' || s.state === 'OFFERED') {
      blockedReason = `This slot is already resolved (${s.state.toLowerCase()}).`;
    } else {
      const otherLive = live.find((l) => l.choiceId !== s.choiceId);
      if (otherLive) {
        blockedReason = `Only one application may be in progress at a time — resolve Slot ${otherLive.priority} first (decline or withdraw it).`;
      } else {
        const uncleared = stated.filter((p) => p.priority < s.priority && !CLEARED.has(p.state));
        if (uncleared.length) {
          blockedReason = `Submit to Slot ${uncleared[0].priority} first — submissions are sequential.`;
        } else {
          canSubmit = true;
        }
      }
    }

    return {
      choiceId: s.choiceId,
      priority: s.priority,
      state: s.state,
      timedOut: s.state === 'TIMED_OUT',
      isActiveSlot: s.choiceId === activeId,
      canSubmit,
      blockedReason,
    };
  });
}

// Gate for a single choice — used by SubmissionService.create.
export function canSubmitToChoice(slots: SlotInput[], choiceId: string, now: Date): { allowed: boolean; reason: string | null } {
  const status = computeSlotStatuses(slots, now).find((s) => s.choiceId === choiceId);
  if (!status) return { allowed: false, reason: 'Programme choice not found.' };
  return { allowed: status.canSubmit, reason: status.blockedReason };
}
