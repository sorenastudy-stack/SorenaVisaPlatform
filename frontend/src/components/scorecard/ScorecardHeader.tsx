import Link from 'next/link';

// PR-SCORECARD-2 — Sorena Visa branded header for the public
// scorecard surface.
//
// Used at the top of /scorecard (form) and /scorecard/result.
// (The /scorecard/landing page renders its own hero with a much
// larger white logotype — it does NOT use this header.)
//
// Fix 2 (refinement batch following 7a458fe): bigger logotype +
// "From assessment to arrival." slogan underneath. Generous vertical
// padding so the brand mark has presence on every scorecard surface.

interface Props {
  className?: string;
}

export function ScorecardHeader({ className = '' }: Props) {
  return (
    <header
      className={[
        'w-full bg-white',
        // Very faint gold underline for warmth.
        'border-b',
        className,
      ].join(' ')}
      style={{ borderBottomColor: '#E8B92322' }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col items-center sm:items-start">
        <Link
          href="/scorecard/landing"
          aria-label="Sorena Visa — Home"
          className="inline-flex flex-col items-center sm:items-start"
        >
          <img
            src="/brand/SorenaVisaLogoTypePNG.png"
            alt="Sorena Visa"
            className="w-full h-auto max-w-[160px] sm:max-w-[240px]"
          />
          <div className="text-[#1E3A5F] italic text-sm tracking-wide mt-1">
            From assessment to arrival.
          </div>
        </Link>
      </div>
    </header>
  );
}
