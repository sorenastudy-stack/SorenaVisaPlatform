// PR-EXPLORE — turning an institution's stored location into a map coordinate.
//
// Pure: builds query strings and judges results. The HTTP call lives in the
// script so this stays testable without a network.

export interface GeocodeCandidate {
  lat: number;
  lon: number;
  displayName: string;
  /** Nominatim's own confidence, 0..1. */
  importance?: number;
  /** e.g. "university", "college", "school", "house", "city" */
  type?: string;
  class?: string;
  boundingbox?: string[];
}

/**
 * New Zealand's bounding box, used to reject a confident-looking match on the
 * other side of the world.
 *
 * "Lincoln University" exists in Nebraska, "Wellington" in Somerset, and
 * "Canterbury" in Kent — a bare name search happily returns those. Everything
 * imported is a New Zealand institution, so anything outside this box is wrong
 * no matter how confident the geocoder is. Includes the Chathams (to -176 lon)
 * and Stewart Island.
 */
export const NZ_BOUNDS = { minLat: -47.5, maxLat: -34.0, minLon: 166.0, maxLon: 179.5 };

export function isInNewZealand(lat: number, lon: number): boolean {
  return lat >= NZ_BOUNDS.minLat && lat <= NZ_BOUNDS.maxLat
    && lon >= NZ_BOUNDS.minLon && lon <= NZ_BOUNDS.maxLon;
}

/** An institution name the geocoder has a chance of knowing. */
export function cleanInstitutionName(name: string): string {
  return name
    // Trailing legal-entity noise hurts the match: the geocoder knows
    // "Ara Institute of Canterbury", not "… (ICL Education Limited)".
    .replace(/\s*\((?:trading name of|t\/a)[^)]*\)/gi, '')
    .replace(/\s+(Limited|Ltd|Limited Partnership|Incorporated|Inc)\.?$/i, '')
    .trim();
}

/**
 * The location strings worth trying, pulled out of a messy stored `city`.
 *
 * The imported city field is free text and only sometimes a city. Of 92
 * institutions, 51 carry parentheses, semicolons or notes:
 *
 *   "Auckland (99 Khyber Pass Road, Grafton, Auckland 1023)"  ← a full address
 *   "Auckland (City) and Christchurch"                        ← two campuses
 *   "Invercargill (HyFlex option available)"                  ← a note
 *   "Dunedin; Auckland"                                       ← a list
 *   "Madras Street Campus"                                    ← not a city at all
 *
 * A street address inside the brackets is the BEST input available — better
 * than the city — so it is returned first when one is present. Otherwise the
 * leading segment before any bracket/semicolon is the usable city.
 */
export function locationCandidates(city: string | null): { address: string | null; city: string | null } {
  if (!city) return { address: null, city: null };

  const bracketed = city.match(/\(([^)]+)\)/)?.[1]?.trim() ?? null;
  // Treat the bracketed text as an address only if it looks like one: a street
  // number, or a road-type word. "(City)" and "(HyFlex option available)" must
  // not be sent to the geocoder as addresses.
  const looksLikeAddress = !!bracketed && (
    /\d+\s+\w/.test(bracketed) || /\b(road|rd|street|st|avenue|ave|drive|dr|highway|hwy|terrace|quay|parade)\b/i.test(bracketed)
  );

  // Multi-campus institutions list every campus, in whatever separator the
  // source felt like. Take the FIRST — one pin on the main campus beats no pin,
  // and the card still names every campus in its text.
  const primary = city
    .split(/[;(\/]/)[0]               // "Auckland (City) and Christchurch" / "A / B / C" → first
    .split(/\b(?:and|or)\b/i)[0]      // "Auckland, Wellington, or Christchurch" → first clause
    .split(',')[0]                    // "Huntly, New Zealand" → "Huntly"
    .replace(/\s*[-–]\s*.*$/, '')     // "Auckland - unconfirmed this session" → "Auckland"
    // "Hamilton City Campus" is not a place Nominatim knows; "Hamilton" is.
    .replace(/\b(?:city\s+)?campus\b/i, '')
    .trim();

  return {
    address: looksLikeAddress ? bracketed : null,
    city: primary.length > 1 ? primary : null,
  };
}

/**
 * The queries to try for one institution, most specific first.
 *
 * Ordered deliberately: a street address pins the actual campus, then the
 * institution with its city, then the bare institution name, and the city alone
 * is the last resort — accurate to the town, not the building. The caller
 * records which rung matched so a city-level fallback is never mistaken for a
 * campus pin.
 */
export function geocodeQueries(institutionName: string, city: string | null): string[] {
  const clean = cleanInstitutionName(institutionName);
  const loc = locationCandidates(city);
  const acronym = clean.match(/\(([A-Z]{2,8})\)/)?.[1] ?? null;

  const queries = [
    loc.address ? `${loc.address}, New Zealand` : null,
    loc.city ? `${clean}, ${loc.city}, New Zealand` : null,
    `${clean}, New Zealand`,
    acronym ? `${acronym}, New Zealand` : null,
    // ALWAYS last when present — judgeCandidate treats the final query as the
    // city-level fallback, so this ordering is load-bearing, not cosmetic.
    loc.city ? `${loc.city}, New Zealand` : null,
  ].filter((q): q is string => !!q);

  return [...new Set(queries)];
}

export type MatchQuality = 'campus' | 'institution' | 'city' | 'rejected';

export interface GeocodeDecision {
  accepted: boolean;
  lat: number | null;
  lon: number | null;
  quality: MatchQuality;
  reason: string;
}

/**
 * Accept or reject a geocoder result.
 *
 * Rejects rather than guesses. A result outside New Zealand is refused outright
 * — better an institution with no pin, listed normally in the results, than a
 * pin in the wrong hemisphere that a student would read as fact.
 */
export function judgeCandidate(
  candidate: GeocodeCandidate | null,
  queryIndex: number,
  totalQueries: number,
): GeocodeDecision {
  if (!candidate) {
    return { accepted: false, lat: null, lon: null, quality: 'rejected', reason: 'no result' };
  }
  const { lat, lon } = candidate;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { accepted: false, lat: null, lon: null, quality: 'rejected', reason: 'non-numeric coordinates' };
  }
  if (!isInNewZealand(lat, lon)) {
    return {
      accepted: false, lat: null, lon: null, quality: 'rejected',
      reason: `outside New Zealand (${lat.toFixed(3)}, ${lon.toFixed(3)}) — "${candidate.displayName}"`,
    };
  }
  // The LAST query is always the city fallback when a city is known; anything
  // matching only at that rung is town-accurate, not campus-accurate.
  const isCityFallback = queryIndex === totalQueries - 1 && totalQueries > 1;
  const quality: MatchQuality = isCityFallback ? 'city' : queryIndex === 0 ? 'campus' : 'institution';
  return { accepted: true, lat, lon, quality, reason: candidate.displayName };
}
