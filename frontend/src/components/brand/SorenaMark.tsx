// PR-SCORECARD-2 polish — inline SVG logomark (just the "S" + plane).
//
// Used wherever the wordmark would be too wide (avatars, favicons,
// compact headers). Transparent background; tints via the same
// `variant` prop as SorenaWordmark.

interface Props {
  variant: 'navy' | 'white';
  className?: string;
}

const FILL: Record<Props['variant'], string> = {
  navy:  '#1E3A5F',
  white: '#FFFFFF',
};

export function SorenaMark({ variant, className }: Props) {
  const fill = FILL[variant];
  return (
    <svg
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Sorena Visa"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Large heavy "S" centred in the square */}
      <text
        x="40"
        y="60"
        textAnchor="middle"
        fontFamily="Inter, 'Helvetica Neue', 'Segoe UI', Arial, system-ui, sans-serif"
        fontWeight="900"
        fontSize="74"
        letterSpacing="-3"
        fill={fill}
      >
        S
      </text>
      {/* Plane silhouette tucked into the lower belly of the S */}
      <g transform="translate(26, 44)" fill={fill}>
        <path d="M 0 7 L 18 7 L 22 1 L 28 7 L 22 13 L 18 7 Z" />
        <path d="M 6 4 L 14 4 L 11 7 L 14 10 L 6 10 Z" opacity="0.55" />
      </g>
    </svg>
  );
}
