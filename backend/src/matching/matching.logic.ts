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
  | 'CERTIFICATE' | 'DIPLOMA' | 'GRADUATE_CERTIFICATE' | 'GRADUATE_DIPLOMA' | 'BACHELOR'
  | 'POSTGRADUATE_CERTIFICATE' | 'POSTGRADUATE_DIPLOMA' | 'MASTER' | 'PHD';

// Progression ladder (low → high) for "meets the minimum level" checks.
// PR-PHASE34 — CERTIFICATE is the lowest rung (NZ Certificates, NZQF 3–5).
const LEVEL_ORDER: QualLevel[] = [
  'CERTIFICATE', 'DIPLOMA', 'GRADUATE_CERTIFICATE', 'GRADUATE_DIPLOMA', 'BACHELOR',
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

// PR-OWNER-1 (slice b) — NZ regulatory institution type (Phase 34). Drives the
// optional 6th soft-score component; null/absent → neutral (never a hard filter).
export type InstitutionType = 'UNIVERSITY' | 'ITP' | 'PTE';
// A per-country institution-type weighting from CountryExecutionConfig, e.g.
// { PTE: 0.4, ITP: 0.35, UNIVERSITY: 0.25 }. Higher = ranked earlier.
export type InstitutionWeighting = Record<string, number>;

export interface ProgrammeForMatch {
  id: string;
  approved: boolean;         // programme.reviewStatus === 'APPROVED' && isActive
  providerApproved: boolean; // provider.status === 'APPROVED'
  studyFieldIds: string[];
  level: QualLevel;
  institutionType?: InstitutionType | null; // provider.institutionType (Phase 34)
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
// Legacy 5-factor weights (sum to 1.00). Used verbatim when NO per-country
// institution weighting is supplied → byte-identical to pre-slice-(b) behavior
// (frozen in matching.golden.spec.ts).
const WEIGHTS = { field: 0.35, location: 0.15, scholarship: 0.15, ranking: 0.20, budget: 0.15 };

// PR-OWNER-1 (slice b) — when a CountryExecutionConfig weighting IS supplied, the
// engine adds institution type as a 6th INDEPENDENT component. The prior five are
// scaled by (1 - W_INST) so all six still sum to 1.00 (relative importance of the
// five is preserved); institution contributes W_INST. This is an additive
// component, NOT a multiplier — a low-weighted institution type nudges rank but
// can never suppress an otherwise-strong match on the other five factors.
const W_INST = 0.15;
const WEIGHTS6 = {
  field: WEIGHTS.field * (1 - W_INST),
  location: WEIGHTS.location * (1 - W_INST),
  scholarship: WEIGHTS.scholarship * (1 - W_INST),
  ranking: WEIGHTS.ranking * (1 - W_INST),
  budget: WEIGHTS.budget * (1 - W_INST),
  institution: W_INST,
};
// Programmes with no institution type score NEUTRAL — never penalised to zero.
const NEUTRAL_INSTITUTION_FACTOR = 0.5;

// Institution factor ∈ [0,1]: the type's configured weight normalised so the
// TOP-weighted type maps to 1.0. Un-typed / unknown-in-map → neutral.
export function institutionFactor(type: InstitutionType | null | undefined, weighting: InstitutionWeighting): number {
  if (!type) return NEUTRAL_INSTITUTION_FACTOR;
  const v = weighting[type];
  if (v == null) return NEUTRAL_INSTITUTION_FACTOR;
  const values = Object.values(weighting).filter((x) => typeof x === 'number');
  const max = values.length ? Math.max(...values) : 0;
  return max > 0 ? Math.max(0, Math.min(1, v / max)) : NEUTRAL_INSTITUTION_FACTOR;
}

export function softScore(p: ProgrammeForMatch, c: MatchCriteria, weighting?: InstitutionWeighting | null): number {
  const useInst = weighting != null && Object.keys(weighting).length > 0;
  const W = useInst ? WEIGHTS6 : WEIGHTS;
  let s = 0;
  // Field: exact match to a stated preference scores full; otherwise (allowed but
  // not explicitly preferred) scores partial.
  const preferredHit = c.preferredFieldIds.length > 0 && p.studyFieldIds.some((f) => c.preferredFieldIds.includes(f));
  s += W.field * (preferredHit ? 1 : 0.5);
  // Location
  const locAny = !c.locationPref || c.locationPref.length === 0 || c.locationPref.includes('flexible');
  s += W.location * (locAny ? 0.6 : c.locationPref!.includes(p.city ?? '') ? 1 : 0);
  // Scholarship available for nationality
  s += W.scholarship * ((p.scholarshipsForNationality?.length ?? 0) > 0 ? 1 : 0);
  // Ranking (staff-entered, 0..100)
  s += W.ranking * (p.rankingScore != null ? Math.max(0, Math.min(1, p.rankingScore / 100)) : 0.4);
  // Budget headroom (further under budget = better; unknown = neutral)
  if (c.tuitionBudgetNZD != null && p.tuitionFeeNZD != null && c.tuitionBudgetNZD > 0) {
    s += W.budget * Math.max(0, Math.min(1, 1 - p.tuitionFeeNZD / c.tuitionBudgetNZD));
  } else {
    s += W.budget * 0.5;
  }
  // 6th component — institution-type weighting (only when a country config supplied).
  if (useInst) {
    s += WEIGHTS6.institution * institutionFactor(p.institutionType, weighting!);
  }
  return Math.round(s * 1000) / 1000;
}

// ── whyThisFits — deterministic per-dimension breakdown for the agent ────────
export type WhyVerdict = 'match' | 'meets' | 'within' | 'aligns' | 'partial';
export interface WhyDimension { dim: string; verdict: WhyVerdict; detail: string }

export function whyThisFits(p: ProgrammeForMatch, c: MatchCriteria, allowed: Set<string>, weighting?: InstitutionWeighting | null): WhyDimension[] {
  const w: WhyDimension[] = [];
  const preferredHit = c.preferredFieldIds.length > 0 && p.studyFieldIds.some((f) => c.preferredFieldIds.includes(f));
  w.push(preferredHit
    ? { dim: 'field', verdict: 'match', detail: 'Matches your preferred field of study.' }
    : { dim: 'field', verdict: 'aligns', detail: 'A field open to your background (related to your prior study, or Business & Management).' });
  // PR-OWNER-1 (slice b) — surface the institution-type dimension only when a
  // per-country weighting is active and the programme has a known type.
  if (weighting != null && Object.keys(weighting).length > 0 && p.institutionType) {
    w.push({ dim: 'institution', verdict: 'aligns', detail: `Institution type (${p.institutionType}) matches the preferred mix for this country.` });
  }
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
  weighting?: InstitutionWeighting | null, // PR-OWNER-1: per-country institution weighting (optional)
): Recommendation[] {
  const allowed = allowedFieldIds(c.qualificationFieldId, fields, relations);
  return programmes
    .filter((p) => passesHardFilter(p, c, allowed))
    .map((p) => ({ programmeId: p.id, fitScore: softScore(p, c, weighting), why: whyThisFits(p, c, allowed, weighting) }))
    .sort((a, b) => b.fitScore - a.fitScore);
}
