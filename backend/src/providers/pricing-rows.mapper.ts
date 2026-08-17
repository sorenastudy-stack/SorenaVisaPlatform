import type { TuitionRow } from './student-pricing.logic';
import type { ScholarshipRow } from './scholarship-total.logic';

// PR-PROVIDER-PORTAL slice E — the one place a database pricing row becomes a
// pure-logic pricing row.
//
// This exists because of how the group nearly went missing. The three call sites
// that resolve student pricing all passed Prisma rows straight in with `as any`,
// which compiled happily and would have compiled just as happily after
// `groupNationalities` became a required field — every group-scoped rate would
// have silently matched nobody, and a student would have been quoted the flat fee
// instead. `as any` on a money path is a hole with a lid on it.
//
// So: one include fragment, one mapper, no casts. Adding a field to the logic
// row now breaks the build in exactly one file.

/** Pass to `include` on any providerTuition/providerScholarship query feeding the resolver. */
export const PRICING_GROUP_INCLUDE = {
  nationalityGroup: { select: { id: true, name: true, nationalities: true } },
} as const;

type WithGroup = {
  nationalityGroup?: { nationalities: string[] } | null;
};

export function toTuitionRow(r: WithGroup & Record<string, any>): TuitionRow {
  return {
    id: r.id,
    nationality: r.nationality ?? null,
    groupNationalities: r.nationalityGroup?.nationalities ?? null,
    programmeId: r.programmeId ?? null,
    level: r.level ?? null,
    amountValue: r.amountValue,
    currency: r.currency,
    feeYear: r.feeYear ?? null,
    isActive: r.isActive,
  };
}

export function toScholarshipRow(r: WithGroup & Record<string, any>): ScholarshipRow {
  return {
    id: r.id,
    name: r.name,
    nationality: r.nationality ?? null,
    groupNationalities: r.nationalityGroup?.nationalities ?? null,
    programmeId: r.programmeId ?? null,
    level: r.level ?? null,
    amountType: r.amountType,
    amountValue: r.amountValue,
    currency: r.currency,
    isActive: r.isActive,
  };
}
