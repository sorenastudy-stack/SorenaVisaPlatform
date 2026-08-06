// PR-EXPLORE — pure ranking and shaping for the student Explore map.
//
// No Prisma here so the ordering rules — which decide what a student sees
// first — are testable without a database.

import type { StudentPricing } from '../providers/student-pricing.logic';

export type ExploreSort = 'featured' | 'lowestTuition' | 'highestScholarship' | 'lowestNetCost';

export interface ExploreRow {
  programmeId: string;
  programmeName: string;
  providerId: string;
  providerName: string;
  isFeatured: boolean;
  latitude: number | null;
  longitude: number | null;
  pricing: StudentPricing;
}

/**
 * Featured institutions surface first.
 *
 * This is a COMMERCIAL rule, not a quality signal: `isFeatured` marks the
 * institutions Sorena has a relationship with. It is applied as the primary
 * sort on every ordering rather than as a separate list, so a featured
 * institution still has to compete on the chosen measure among its peers —
 * "featured" moves you to the front of the queue, it does not reorder the
 * queue itself.
 *
 * Before this, `isFeatured` existed as a column and was read in
 * public.service.ts but no query ever ordered by it, so the flag had no effect
 * anywhere.
 */
export function compareForSort(sort: ExploreSort, a: ExploreRow, b: ExploreRow): number {
  if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;

  switch (sort) {
    case 'lowestTuition':
      return nullsLast(a.pricing.tuition.amountNZD, b.pricing.tuition.amountNZD, 'asc')
        || a.programmeName.localeCompare(b.programmeName);
    case 'highestScholarship':
      // A scholarship of 0 is a known answer, not missing data, so it sorts
      // normally at the bottom rather than being pushed past unknowns.
      return (b.pricing.scholarship.totalNZD - a.pricing.scholarship.totalNZD)
        || a.programmeName.localeCompare(b.programmeName);
    case 'lowestNetCost':
      return nullsLast(a.pricing.netCostNZD, b.pricing.netCostNZD, 'asc')
        || a.programmeName.localeCompare(b.programmeName);
    case 'featured':
    default:
      return a.providerName.localeCompare(b.providerName)
        || a.programmeName.localeCompare(b.programmeName);
  }
}

/**
 * Unknown values sort LAST, never first.
 *
 * A programme whose tuition could not be parsed must not top a "lowest tuition"
 * list — it would read as the cheapest option when the truth is that nobody
 * knows the price.
 */
function nullsLast(a: number | null, b: number | null, dir: 'asc' | 'desc'): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

export function sortExploreRows(rows: ExploreRow[], sort: ExploreSort): ExploreRow[] {
  return [...rows].sort((a, b) => compareForSort(sort, a, b));
}

/**
 * Map pins, one per institution rather than one per programme.
 *
 * 1,123 programmes across 91 institutions would put ~12 overlapping markers on
 * the same coordinate; the map shows institutions and the count of matching
 * programmes at each.
 */
export interface MapPin {
  providerId: string;
  providerName: string;
  isFeatured: boolean;
  latitude: number;
  longitude: number;
  programmeCount: number;
  /** Cheapest net cost among this institution's matching programmes, if known. */
  fromNetCostNZD: number | null;
}

export function buildMapPins(rows: ExploreRow[]): { pins: MapPin[]; unmapped: Array<{ providerId: string; providerName: string; programmeCount: number }> } {
  const byProvider = new Map<string, ExploreRow[]>();
  for (const r of rows) {
    const list = byProvider.get(r.providerId);
    if (list) list.push(r); else byProvider.set(r.providerId, [r]);
  }

  const pins: MapPin[] = [];
  const unmapped: Array<{ providerId: string; providerName: string; programmeCount: number }> = [];

  for (const [providerId, list] of byProvider) {
    const first = list[0];
    const nets = list.map((r) => r.pricing.netCostNZD).filter((n): n is number => n != null);
    if (first.latitude == null || first.longitude == null) {
      // Not silently dropped: the caller surfaces these so a student can still
      // see and open an institution that has no coordinate.
      unmapped.push({ providerId, providerName: first.providerName, programmeCount: list.length });
      continue;
    }
    pins.push({
      providerId,
      providerName: first.providerName,
      isFeatured: first.isFeatured,
      latitude: first.latitude,
      longitude: first.longitude,
      programmeCount: list.length,
      fromNetCostNZD: nets.length ? Math.min(...nets) : null,
    });
  }

  // Featured pins last in the array so they paint ON TOP of the others where
  // markers overlap.
  pins.sort((a, b) => Number(a.isFeatured) - Number(b.isFeatured));
  unmapped.sort((a, b) => a.providerName.localeCompare(b.providerName));
  return { pins, unmapped };
}
