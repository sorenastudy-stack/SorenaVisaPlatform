import Image from 'next/image';

// PR-SCORECARD-2 polish — branded logo using the supplied PNG.
//
// The PNG at /brand/SorenaVisa_FullBrand_Navy.png has a baked-in
// navy (#1D395E) background. This is the user's chosen artwork
// (Option C from the design conversation). It looks correct against
// the navy gradient landing-page hero; on the white form/result
// header it presents as a small navy rectangle — accepted tradeoff
// per the brief.
//
// Future swap path: drop a properly-transparent PNG at the same
// public/brand/SorenaVisa_FullBrand_Navy.png filename and no code
// changes are needed — every consumer reads from that single path.
//
// We use next/image (not a raw <img>) so the framework picks up
// width/height for layout-shift prevention and applies its own
// optimisation pipeline.

type Props = {
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
};

export function SorenaLogo({
  className = '',
  width = 320,
  height = 128,
  priority = false,
}: Props) {
  return (
    <Image
      src="/brand/SorenaVisa_FullBrand_Navy.png"
      alt="Sorena Visa — Education & Immigration · New Zealand"
      width={width}
      height={height}
      priority={priority}
      className={className}
    />
  );
}
