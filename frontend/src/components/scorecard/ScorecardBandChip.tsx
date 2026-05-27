// PR-CRM-LEADS — Scorecard band chip.
//
// Used in /staff/leads and elsewhere where we need a colour-coded
// pill for the 6 scorecard bands. The colour scale increases from
// red (Band 1, weakest) → teal (Band 6, strongest) so a row of
// leads is scannable at a glance.

export type ScorecardBand =
  | 'BAND_1' | 'BAND_2' | 'BAND_3' | 'BAND_4' | 'BAND_5' | 'BAND_6';

const STYLES: Record<ScorecardBand, string> = {
  BAND_1: 'bg-red-100     text-red-800     border-red-200',
  BAND_2: 'bg-orange-100  text-orange-800  border-orange-200',
  BAND_3: 'bg-amber-100   text-amber-800   border-amber-200',
  BAND_4: 'bg-lime-100    text-lime-800    border-lime-200',
  BAND_5: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  BAND_6: 'bg-teal-100    text-teal-800    border-teal-200',
};

const LABELS: Record<ScorecardBand, string> = {
  BAND_1: 'Band 1',
  BAND_2: 'Band 2',
  BAND_3: 'Band 3',
  BAND_4: 'Band 4',
  BAND_5: 'Band 5',
  BAND_6: 'Band 6',
};

export function ScorecardBandChip({ band, compact = false }: {
  band: ScorecardBand;
  compact?: boolean;
}) {
  const style = STYLES[band] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span className={[
      'inline-flex items-center font-bold rounded-full border',
      compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs',
      style,
    ].join(' ')}>
      {LABELS[band] ?? band}
    </span>
  );
}

export const ALL_BANDS: ScorecardBand[] = [
  'BAND_1', 'BAND_2', 'BAND_3', 'BAND_4', 'BAND_5', 'BAND_6',
];
