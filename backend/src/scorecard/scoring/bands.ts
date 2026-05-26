// PR-SCORECARD-1 — verbatim port of BANDS table + band_for().
//
// Source: Sorena_Scoring_Reference/sorena_scoring.py lines 474-498.
//
// `number` in the Python is a string ("1".."6") to match how the
// rest of the engine compares. We keep that exact string so port
// behaviour stays identical, and expose `enumValue` for callers that
// want the Prisma enum form. Both representations stay in sync.

export type BandNumber = '1' | '2' | '3' | '4' | '5' | '6';
export type BandEnum = 'BAND_1' | 'BAND_2' | 'BAND_3' | 'BAND_4' | 'BAND_5' | 'BAND_6';

export interface BandInfo {
  number: BandNumber;
  enumValue: BandEnum;
  name: string;
  range: string;
  route: string;
  service: string;
  revenue: string;
}

interface BandRow {
  lo: number;
  hi: number;
  number: BandNumber;
  name: string;
  route: string;
  service: string;
  revenue: string;
}

export const BANDS: BandRow[] = [
  {
    lo: 0, hi: 24, number: '1',
    name: 'Cold / Unready',
    route: 'Content Nurture',
    service: 'Free content & webinars',
    revenue: 'No immediate revenue',
  },
  {
    lo: 25, hi: 39, number: '2',
    name: 'Early Stage / Fragile',
    route: 'Webinar First',
    service: 'Webinar + readiness content',
    revenue: 'No immediate revenue',
  },
  {
    lo: 40, hi: 54, number: '3',
    name: 'Developing / Consultable',
    route: 'Gap-Closing Session + Admission Consultation',
    service: 'Gap-Closing Session + Admission Consultation',
    revenue: 'NZD 30 + NZD 50',
  },
  {
    lo: 55, hi: 69, number: '4',
    name: 'Viable / Structured Opportunity',
    route: 'Free 15-Min Session + Account Opening',
    service: 'Free 15-min then Account Opening',
    revenue: 'USD 200',
  },
  {
    lo: 70, hi: 84, number: '5',
    name: 'Strong / Near Execution Ready',
    route: 'Free 15-Min Session + Fast-Track Account Opening',
    service: 'Free 15-min (mandatory) then fast-track',
    revenue: 'USD 200 + priority',
  },
  {
    lo: 85, hi: 100, number: '6',
    name: 'Premium / Execution Ready',
    route: 'Free 15-Min Session + Immediate Activation',
    service: 'Free 15-min (mandatory) then immediate activation',
    revenue: 'USD 200 + priority',
  },
];

export function bandFor(total: number): BandInfo {
  for (const b of BANDS) {
    if (total >= b.lo && total <= b.hi) {
      return {
        number: b.number,
        enumValue: `BAND_${b.number}` as BandEnum,
        name: b.name,
        range: `${b.lo}-${b.hi}`,
        route: b.route,
        service: b.service,
        revenue: b.revenue,
      };
    }
  }
  // Python falls back to BANDS[0]; mirror that.
  const b = BANDS[0];
  return {
    number: b.number,
    enumValue: `BAND_${b.number}` as BandEnum,
    name: b.name,
    range: `${b.lo}-${b.hi}`,
    route: b.route,
    service: b.service,
    revenue: b.revenue,
  };
}
