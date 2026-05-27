// PR-SCORECARD-2 polish — inline SVG wordmark.
//
// Why inline SVG (not the JPG/PNG files in /public/brand/):
//   The supplied bitmap "transparent" logos were RGB images with a
//   solid white/navy background baked in, so on a dark gradient they
//   rendered as ugly coloured boxes. This component is genuinely
//   transparent (no background) and scales crisply at any size.
//
// Composition:
//   * SORENA wordmark in a heavy weight (Inter Black or system Black
//     fallback)
//   * A small horizontal-arrow plane silhouette positioned inside the
//     lower belly of the first "S"
//   * "Visa" sub-wordmark in regular weight, right-aligned under the
//     "A" tail
//
// Pixel-perfect match to the original brand asset isn't the goal —
// what matters is brand recognisability (heavy "SORENA Visa" + plane
// motif) and a guaranteed transparent background.

interface Props {
  variant: 'navy' | 'white';
  className?: string;
}

const FILL: Record<Props['variant'], string> = {
  navy:  '#1E3A5F',
  white: '#FFFFFF',
};

export function SorenaWordmark({ variant, className }: Props) {
  const fill = FILL[variant];
  return (
    <svg
      viewBox="0 0 320 80"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Sorena Visa"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* SORENA — heavy wordmark */}
      <text
        x="0"
        y="56"
        fontFamily="Inter, 'Helvetica Neue', 'Segoe UI', Arial, system-ui, sans-serif"
        fontWeight="900"
        fontSize="60"
        letterSpacing="-2.5"
        fill={fill}
      >
        SORENA
      </text>
      {/* Plane silhouette tucked into the lower belly of the "S".
          A simple right-pointing arrow with a triangular tail — reads
          as a plane at small sizes. Offset so it sits inside the S
          glyph's lower curve. */}
      <g transform="translate(10, 38)" fill={fill}>
        <path d="M 0 7 L 18 7 L 22 1 L 28 7 L 22 13 L 18 7 Z" />
        <path d="M 6 4 L 14 4 L 11 7 L 14 10 L 6 10 Z" opacity="0.55" />
      </g>
      {/* Visa sub-wordmark — right-aligned under the A */}
      <text
        x="318"
        y="78"
        textAnchor="end"
        fontFamily="Inter, 'Helvetica Neue', 'Segoe UI', Arial, system-ui, sans-serif"
        fontWeight="500"
        fontSize="18"
        letterSpacing="3"
        fill={fill}
      >
        Visa
      </text>
    </svg>
  );
}
