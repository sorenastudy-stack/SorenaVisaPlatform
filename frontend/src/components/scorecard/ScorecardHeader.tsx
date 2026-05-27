import Link from 'next/link';

// PR-SCORECARD-2 — Sorena Visa branded header for the public
// scorecard surface (Fix 8).
//
// Used at the top of /scorecard/landing, /scorecard (form), and
// /scorecard/result. Logo links back to /scorecard/landing.
//
// `variant`:
//   - 'light' (default) — dark logotype on cream/white background
//                         (used on form + result pages)
//   - 'dark'            — white logotype on navy background (used on
//                         the landing hero which has its own dark
//                         gradient; the header sits transparently
//                         over the gradient)

interface Props {
  variant?: 'light' | 'dark';
  className?: string;
}

export function ScorecardHeader({ variant = 'light', className = '' }: Props) {
  const isDark = variant === 'dark';
  const logoSrc = isDark
    ? '/brand/SorenaVisaLogoTypeWhite.jpg'
    : '/brand/SorenaVisaLogoTypePNG.png';
  return (
    <header
      className={[
        'w-full',
        isDark
          ? 'border-b border-white/10'
          : 'bg-white border-b border-[#1E3A5F]/10',
        className,
      ].join(' ')}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-center sm:justify-start">
        <Link
          href="/scorecard/landing"
          aria-label="Sorena Visa — Home"
          className="inline-flex items-center"
        >
          <img
            src={logoSrc}
            alt="Sorena Visa"
            className="h-9 sm:h-11 w-auto"
            style={{ maxWidth: 220 }}
          />
        </Link>
      </div>
    </header>
  );
}
