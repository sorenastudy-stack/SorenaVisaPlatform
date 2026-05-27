import Image from 'next/image';

// PR-SCORECARD-2 polish — branded logomark for the public scorecard
// surface. Two artwork variants, both genuinely transparent (real
// alpha channel — verified against navy + white composites):
//
//   variant='white-bg'  → /brand/SorenaMark_Circle_Transparent.png
//                          (navy circle enclosing the white S+plane —
//                           suits LIGHT backgrounds such as the form +
//                           result page headers)
//
//   variant='navy-bg'   → /brand/SorenaMark_White_Transparent.png
//                          (white S+plane only, no enclosing circle —
//                           suits DARK backgrounds such as the
//                           landing-page hero gradient + footer band)
//
//   variant='auto'      → alias for 'white-bg' (default for backwards
//                          compatibility with any caller that doesn't
//                          pass a variant)
//
// These two PNGs are the canonical scorecard logomarks going forward.
// Reference them via this component — never the file paths directly —
// so the next artwork swap is a single-file change here.
//
// The earlier full-brand PNG (SorenaVisa_FullBrand_Navy.png) and the
// inline-SVG components (SorenaWordmark, SorenaMark) are kept on disk
// for future use but no longer referenced by any scorecard page.

const SRC_BY_VARIANT = {
  'white-bg': '/brand/SorenaMark_Circle_Transparent.png',
  'navy-bg':  '/brand/SorenaMark_White_Transparent.png',
} as const;

type Variant = 'auto' | 'white-bg' | 'navy-bg';

type Props = {
  variant?: Variant;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
};

export function SorenaLogo({
  variant = 'auto',
  className = '',
  width = 256,
  height = 256,
  priority = false,
}: Props) {
  const resolved: Exclude<Variant, 'auto'> = variant === 'auto' ? 'white-bg' : variant;
  return (
    <Image
      src={SRC_BY_VARIANT[resolved]}
      alt="Sorena Visa — Education & Immigration · New Zealand"
      width={width}
      height={height}
      priority={priority}
      className={className}
    />
  );
}
