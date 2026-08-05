// PR-CURATION — pure decision logic for the programme curation screen.
//
// Kept free of Prisma so the rules that decide what a student can see, and what
// the Owner is warned about, are testable without a database.

export type ReviewStatusValue = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ActivationTarget {
  reviewStatus: ReviewStatusValue;
  isActive: boolean;
}

/**
 * What "Active" and "Inactive" mean in the database.
 *
 * The Recommendation Engine gates on `reviewStatus === 'APPROVED' && isActive
 * && provider.status === 'ACTIVE'` (matching.service.ts). The screen presents a
 * single Active/Inactive switch, so the toggle must move BOTH programme-level
 * fields together — setting only one would leave a programme that looks active
 * to the Owner but is invisible to matching, which is the confusing half-state
 * this mapping exists to prevent.
 *
 * Inactive returns to PENDING rather than REJECTED. REJECTED means "reviewed
 * and refused"; a programme switched off is simply not live yet, and the Owner
 * must be able to switch it back on without it reading as a rejection.
 */
export function activationTarget(active: boolean): ActivationTarget {
  return active
    ? { reviewStatus: 'APPROVED', isActive: true }
    : { reviewStatus: 'PENDING', isActive: false };
}

export interface StudentHold {
  admissionApplicationId: string;
  studentName: string | null;
  caseReference: string | null;
}

export interface DeactivationDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  affected: StudentHold[];
  message: string | null;
}

/**
 * Deactivating a programme a student has already chosen.
 *
 * Neither silently allowed nor silently blocked: the Owner is shown who is
 * affected and must confirm. Blocking outright would be wrong — an institution
 * really can withdraw a programme mid-cycle, and the platform has to be able to
 * represent that. Allowing it silently would be worse: a student's chosen
 * programme would vanish from matching with nobody told.
 *
 * Activation is never gated — switching a programme ON cannot invalidate an
 * existing choice.
 */
export function decideDeactivation(
  active: boolean,
  holds: StudentHold[],
  confirmed: boolean,
): DeactivationDecision {
  if (active || holds.length === 0) {
    return { allowed: true, requiresConfirmation: false, affected: [], message: null };
  }
  if (confirmed) {
    return { allowed: true, requiresConfirmation: false, affected: holds, message: null };
  }
  const who = holds.length === 1 ? '1 student has' : `${holds.length} students have`;
  return {
    allowed: false,
    requiresConfirmation: true,
    affected: holds,
    message: `${who} already chosen this programme. Switching it to Inactive removes it from matching for new recommendations. Existing choices are not deleted.`,
  };
}

/**
 * The columns a human may edit on the curation screen.
 *
 * Duplicated deliberately from UpdateProgrammeDto. The DTO is stripped by
 * ValidationPipe at the HTTP boundary; this list is enforced in the service, so
 * the invariant "an edit cannot change visibility or provenance" holds even if
 * the pipe's whitelist option is ever turned off, and for any non-HTTP caller.
 *
 * Absent on purpose: reviewStatus, isActive (owned by the activation endpoint
 * and its student-hold guard), sourceRef, source (provenance — the idempotent
 * re-import keys on sourceRef), coverImageUrl (upload endpoint only),
 * providerId (moving a programme would silently reassign its applications).
 */
export const EDITABLE_PROGRAMME_FIELDS = [
  'name', 'level', 'nzqfLevel', 'qualificationType', 'majorStrand', 'subjectAreaRaw',
  'durationMonths', 'durationText',
  'tuitionFeeNZD', 'tuitionFeeRaw', 'tuitionParseNote', 'feeBasis', 'feeYear', 'fee2027Status',
  'campusCity', 'deliveryMode', 'studentVisaSuitable',
  'intakeMonths', 'remaining2026Intakes', 'published2027Intakes', 'projected2027Intakes',
  'intakeBasis2027', 'intakes2027Planning',
  'academicPrerequisites', 'englishRequirementRaw', 'otherRequirements', 'scholarshipNote',
  'descriptionEn', 'descriptionFa', 'programmeUrl', 'verificationSourceUrl', 'notes',
] as const;

const EDITABLE = new Set<string>(EDITABLE_PROGRAMME_FIELDS as readonly string[]);

/**
 * The fields a save actually changed, for the audit entry.
 *
 * Returns only real changes: the edit form posts every field, so without this
 * an untouched save would record a diff of the whole programme and make the
 * audit trail useless for answering "what did someone actually change".
 *
 * Arrays compare by value (intakeMonths). `undefined` in the patch means "not
 * submitted" and is skipped; `null` means "cleared" and IS a change.
 */
export function changedFields<T extends Record<string, any>>(
  before: T,
  patch: Partial<T>,
): Record<string, { from: any; to: any }> {
  const out: Record<string, { from: any; to: any }> = {};
  for (const [key, next] of Object.entries(patch)) {
    if (next === undefined) continue;
    if (!EDITABLE.has(key)) continue; // visibility/provenance are not editable here
    const prev = before[key];
    const same = Array.isArray(prev) && Array.isArray(next)
      ? prev.length === next.length && prev.every((v, i) => v === next[i])
      : normalise(prev) === normalise(next);
    if (!same) out[key] = { from: prev ?? null, to: next };
  }
  return out;
}

// An empty string from a cleared text input and a null in the database mean the
// same thing to a reader; treating them as different would log phantom edits.
const normalise = (v: any) => (v === '' || v === undefined ? null : v);

/**
 * Why an Active programme still is not reaching students.
 *
 * The provider-level gate is invisible on this screen — the Owner switches a
 * programme Active and nothing happens, because the institution itself is still
 * PENDING (no signed agreement). Surfacing the reason prevents that dead end.
 */
export function matchingBlockedReason(
  programme: { reviewStatus: string; isActive: boolean },
  providerStatus: string,
): string | null {
  if (!programme.isActive || programme.reviewStatus !== 'APPROVED') return null;
  if (providerStatus !== 'ACTIVE') {
    return 'This programme is Active, but the institution is not marked as under contract yet, so it is still excluded from recommendations.';
  }
  return null;
}
