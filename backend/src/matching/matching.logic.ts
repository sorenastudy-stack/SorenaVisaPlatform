// PR-PHASE32 — Matching Engine core (pure, DB-agnostic).
//
// Turns a Step-1 MatchCriteria (derived from the redesigned ~31-question
// assessment) into a RANKED list of programme recommendations, each with a
// deterministic `whyThisFits` breakdown that the Recommendation Explanation
// Agent later renders as prose.
//
// Two enforcement stages, per the approved design:
//   1. allowedFieldIds() — the Q30 academic-progression rule: an applicant may
//      only be matched to fields RELATED to their prior-qualification field
//      (Q13), plus any field in an always-selectable category (Management &
//      Business). Recomputed here server-side so a tampered/stale input can
//      never surface a disallowed programme (belt-and-suspenders with the UI).
//   2. passesHardFilter() — must-pass gates (field, level, GPA, English, budget,
//      and APPROVED-only). Only survivors are soft-scored + ranked.
//
// Kept as pure functions with local types (mirroring the Prisma models) so the
// whole engine is unit-testable without a database.

export type QualLevel =
  | 'DIPLOMA' | 'GRADUATE_CERTIFICATE' | 'GRADUATE_DIPLOMA' | 'BACHELOR'
  | 'POSTGRADUATE_CERTIFICATE' | 'POSTGRADUATE_DIPLOMA' | 'MASTER' | 'PHD';

// Progression ladder (low → high) for "meets the minimum level" checks.
const LEVEL_ORDER: QualLevel[] = [
  'DIPLOMA', 'GRADUATE_CERTIFICATE', 'GRADUATE_DIPLOMA', 'BACHELOR',
  'POSTGRADUATE_CERTIFICATE', 'POSTGRADUATE_DIPLOMA', 'MASTER', 'PHD',
];

export interface FieldNode {
  id: string;
  categoryAlwaysSelectable: boolean; // true for "Management & Business" fields
}

export interface RelationEdge {
  sourceFieldId: string;
  targetFieldId: string;
  approved: boolean; // reviewStatus === 'APPROVED'
}

export interface MatchCriteria {
  qualificationFieldId: string | null; // Q13 → StudyField id (null = Other/unmapped)
  preferredFieldIds: string[];          // Q32 (already ⊆ allowed at input; re-checked here)
  desiredLevels: QualLevel[];           // Q33
  currentHighestLevel: QualLevel | null; // Q12
  gpaBand?: number;                     // normalised applicant GPA (same scale as minGpa)
  ieltsEquivalent?: number;             // Q16 → IELTS-equivalent overall
  tuitionBudgetNZD?: number;            // Q34 (or derived from Q20 funds)
  nationality?: string;                 // Q5 → scholarship scoping (ISO)
  locationPref?: string[];              // Q35 preferred city/cities ([] or ['flexible'] = any)
  workWhileStudying?: boolean;          // Q36
}

export interface ProgrammeForMatch {
  id: string;
  approved: boolean;         // programme.reviewStatus === 'APPROVED' && isActive
  providerApproved: boolean; // provider.status === 'APPROVED'
  studyFieldIds: string[];
  level: QualLevel;
  tuitionFeeNZD?: number | null;
  intakeMonths: number[];
  city?: string | null;
  req?: {
    minQualificationLevel?: QualLevel | null;
    minGpa?: number | null;
    englishOverallMin?: number | null;
  } | null;
  scholarshipsForNationality?: Array<{ name: string; nationality: string }>;
  rankingScore?: number | null; // 0..100, staff-entered
}

// ── Q30 — allowed target fields given the prior-qualification field ───────────
export function allowedFieldIds(
  qualificationFieldId: string | null,
  fields: FieldNode[],
  relations: RelationEdge[],
): Set<string> {
  const allowed = new Set<string>();
  // (b) any field in an always-selectable category (Management & Business).
  for (const f of fields) if (f.categoryAlwaysSelectable) allowed.add(f.id);
  // (a) related to the prior field — including continuing in the same field.
  if (qualificationFieldId) {
    allowed.add(qualificationFieldId);
    for (const r of relations) {
      if (r.approved && r.sourceFieldId === qualificationFieldId) allowed.add(r.targetFieldId);
    }
  }
  // qualificationFieldId null/unmapped ("Other") → Management & Business only
  // (plus a "request another field → staff" path handled at the input layer).
  return allowed;
}

export function levelMeets(applicant: QualLevel | null, min: QualLevel | null | undefined): boolean {
  if (!min) return true;         // no minimum → always ok
  if (!applicant) return false;  // minimum exists but applicant level unknown → fail closed
  return LEVEL_ORDER.indexOf(applicant) >= LEVEL_ORDER.indexOf(min);
}

// ── Hard filter — a programme may be recommended iff EVERY check passes ───────
export function passesHardFilter(
  p: ProgrammeForMatch,
  c: MatchCriteria,
  allowed: Set<string>,
): boolean {
  // Never surface unapproved programme/provider/enrichment to applicants.
  if (!p.approved || !p.providerApproved) return false;

  // Field: must be in an ALLOWED field (Q30) AND, when the applicant expressed
  // preferences, one of them. Allowed is re-derived server-side, so a programme
  // in a disallowed field is rejected even if it slipped into preferredFieldIds.
  const fieldOk = p.studyFieldIds.some(
    (fid) => allowed.has(fid) && (c.preferredFieldIds.length === 0 || c.preferredFieldIds.includes(fid)),
  );
  if (!fieldOk) return false;

  if (c.desiredLevels.length > 0 && !c.desiredLevels.includes(p.level)) return false;
  if (!levelMeets(c.currentHighestLevel, p.req?.minQualificationLevel)) return false;
  if (c.gpaBand != null && p.req?.minGpa != null && c.gpaBand < p.req.minGpa) return false;
  if (c.ieltsEquivalent != null && p.req?.englishOverallMin != null && c.ieltsEquivalent < p.req.englishOverallMin) return false;
  if (c.tuitionBudgetNZD != null && p.tuitionFeeNZD != null && p.tuitionFeeNZD > c.tuitionBudgetNZD) return false;
  return true;
}

// ── Soft score — weighted preference alignment, 0..1 ─────────────────────────
const WEIGHTS = { field: 0.35, location: 0.15, scholarship: 0.15, ranking: 0.20, budget: 0.15 };

export function softScore(p: ProgrammeForMatch, c: MatchCriteria): number {
  let s = 0;
  // Field: exact match to a stated preference scores full; otherwise (allowed but
  // not explicitly preferred) scores partial.
  const preferredHit = c.preferredFieldIds.length > 0 && p.studyFieldIds.some((f) => c.preferredFieldIds.includes(f));
  s += WEIGHTS.field * (preferredHit ? 1 : 0.5);
  // Location
  const locAny = !c.locationPref || c.locationPref.length === 0 || c.locationPref.includes('flexible');
  s += WEIGHTS.location * (locAny ? 0.6 : c.locationPref!.includes(p.city ?? '') ? 1 : 0);
  // Scholarship available for nationality
  s += WEIGHTS.scholarship * ((p.scholarshipsForNationality?.length ?? 0) > 0 ? 1 : 0);
  // Ranking (staff-entered, 0..100)
  s += WEIGHTS.ranking * (p.rankingScore != null ? Math.max(0, Math.min(1, p.rankingScore / 100)) : 0.4);
  // Budget headroom (further under budget = better; unknown = neutral)
  if (c.tuitionBudgetNZD != null && p.tuitionFeeNZD != null && c.tuitionBudgetNZD > 0) {
    s += WEIGHTS.budget * Math.max(0, Math.min(1, 1 - p.tuitionFeeNZD / c.tuitionBudgetNZD));
  } else {
    s += WEIGHTS.budget * 0.5;
  }
  return Math.round(s * 1000) / 1000;
}

// ── whyThisFits — deterministic per-dimension breakdown for the agent ────────
export type WhyVerdict = 'match' | 'meets' | 'within' | 'aligns' | 'partial';
export interface WhyDimension { dim: string; verdict: WhyVerdict; detail: string }

export function whyThisFits(p: ProgrammeForMatch, c: MatchCriteria, allowed: Set<string>): WhyDimension[] {
  const w: WhyDimension[] = [];
  const preferredHit = c.preferredFieldIds.length > 0 && p.studyFieldIds.some((f) => c.preferredFieldIds.includes(f));
  w.push(preferredHit
    ? { dim: 'field', verdict: 'match', detail: 'Matches your preferred field of study.' }
    : { dim: 'field', verdict: 'aligns', detail: 'A field open to your background (related to your prior study, or Business & Management).' });
  if (p.req?.minQualificationLevel) {
    w.push({ dim: 'level', verdict: 'meets', detail: `Your qualification meets the entry level (${p.req.minQualificationLevel}).` });
  }
  if (c.ieltsEquivalent != null && p.req?.englishOverallMin != null) {
    w.push({ dim: 'english', verdict: 'meets', detail: `Your English (~IELTS ${c.ieltsEquivalent}) meets the required ${p.req.englishOverallMin}.` });
  }
  if (c.tuitionBudgetNZD != null && p.tuitionFeeNZD != null) {
    w.push({ dim: 'budget', verdict: 'within', detail: `Tuition NZD ${p.tuitionFeeNZD} is within your budget of NZD ${c.tuitionBudgetNZD}.` });
  }
  if ((p.scholarshipsForNationality?.length ?? 0) > 0) {
    w.push({ dim: 'scholarship', verdict: 'match', detail: `A scholarship is available for your nationality (${p.scholarshipsForNationality![0].name}).` });
  }
  return w;
}

export interface Recommendation {
  programmeId: string;
  fitScore: number;
  why: WhyDimension[];
}

// ── Top-level: filter → score → rank ─────────────────────────────────────────
export function rankRecommendations(
  programmes: ProgrammeForMatch[],
  c: MatchCriteria,
  fields: FieldNode[],
  relations: RelationEdge[],
): Recommendation[] {
  const allowed = allowedFieldIds(c.qualificationFieldId, fields, relations);
  return programmes
    .filter((p) => passesHardFilter(p, c, allowed))
    .map((p) => ({ programmeId: p.id, fitScore: softScore(p, c), why: whyThisFits(p, c, allowed) }))
    .sort((a, b) => b.fitScore - a.fitScore);
}
