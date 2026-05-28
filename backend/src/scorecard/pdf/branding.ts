// PR-SCORECARD-3 — Shared brand constants for both PDF renderers.
//
// All values come from the Sorena Visa brand book; the spec for this
// PR pins them so they don't drift between the internal and client
// reports. Colours are the same palette the rest of the platform
// uses (#1E3A5F navy, #E8B923 gold, #FAF8F3 cream, #4A4A4A body).
//
// The Python reference (Sorena_Scoring_Reference/score_pdf.py +
// client_report.py) uses a slightly fuller palette including
// NAVY_DEEP / WARMGRAY / GRAYLIGHT / EMERALD. We mirror those here
// under BRAND.COLORS.PALETTE so the renderers can reach for them
// without redefining locally; the headline colours stay in their
// top-level home.

export const BRAND = {
  COLORS: {
    NAVY:      '#1E3A5F',
    GOLD:      '#E8B923',
    OFF_WHITE: '#FAF8F3',
    BODY:      '#4A4A4A',
    MUTED:     '#8B8B8B',
    SUCCESS:   '#10B981',   // emerald
    WARNING:   '#F59E0B',   // amber
    DANGER:    '#EF4444',   // red
    // Brand-book extras used by the renderers for depth.
    PALETTE: {
      NAVY_DEEP:  '#0F1F36',
      WARMGRAY:   '#5C5550',
      GRAYLIGHT:  '#E8E4DC',
      SOFTBG:     '#F4F0E6',
      EMERALD:    '#2D6A4F',
      AMBER:      '#D97706',
      RED:        '#C0392B',
      WHITE:      '#FFFFFF',
    },
    // Spec-pinned band colour scale (red → teal). Note this differs
    // from the Python reference (which uses NAVY for Band 4 and
    // EMERALD for Bands 5 and 6). The spec values are authoritative.
    BAND_COLORS: {
      BAND_1: '#EF4444',
      BAND_2: '#F97316',
      BAND_3: '#F59E0B',
      BAND_4: '#84CC16',
      BAND_5: '#10B981',
      BAND_6: '#0D9488',
    },
  },
  FONTS: {
    BODY:   'Helvetica',          // pdfkit built-in
    BOLD:   'Helvetica-Bold',
    ITALIC: 'Helvetica-Oblique',
  },
  PAGE: {
    SIZE:   'A4' as const,
    MARGIN: 50,
  },
  SLOGAN:  'From assessment to arrival.',
  COMPANY: 'Sorena Visa',
  TAGLINE: 'Education & Immigration · New Zealand',
} as const;

// Convenient typed band lookup. Band number ("1".."6") → colour hex.
export function bandColor(band: string): string {
  const key = band.startsWith('BAND_') ? band : `BAND_${band}`;
  return (BRAND.COLORS.BAND_COLORS as Record<string, string>)[key] ?? BRAND.COLORS.NAVY;
}
