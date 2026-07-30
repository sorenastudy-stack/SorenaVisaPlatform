import type { MatchCriteria } from '../matching.logic';
import type { RecommendationCriteriaSource } from '@prisma/client';

// PR-RECS-1 (slice 1) — the resolveMatchCriteria SEAM.
//
// `MatchCriteria` is the abstraction boundary: the matcher + the recommendation-
// list service know only MatchCriteria, never where it came from. This lets slice
// 1 ship on the live /scorecard data today (Impl A) and swap in the full-fidelity
// v2 /assessment later (Impl B) WITHOUT touching the list code.

export interface ResolvedCriteria {
  criteria: MatchCriteria;
  source: RecommendationCriteriaSource; // SCORECARD (Impl A) | ASSESSMENT (Impl B)
}

export interface MatchCriteriaResolver {
  // Resolve a student's MatchCriteria, or null if they have no usable submission.
  resolve(studentUserId: string): Promise<ResolvedCriteria | null>;
}

// Nest DI token — the RecommendationModule binds this to the active impl.
export const MATCH_CRITERIA_RESOLVER = Symbol('MATCH_CRITERIA_RESOLVER');
