import Link from 'next/link';
import { SorenaLogo } from '@/components/brand/SorenaLogo';

// PR-SCORECARD-2 polish — Sorena Visa branded header for /scorecard
// (form) and /scorecard/result.
//
// The /scorecard/landing page renders its own hero with a much larger
// version of the same logo. This header is the compact "every other
// scorecard page" treatment.
//
// Note: the supplied PNG has a baked-in navy background. On the white
// header bg it shows as a small navy rectangle. Accepted tradeoff —
// see SorenaLogo.tsx for the swap path when a transparent PNG is
// available.

interface Props {
  className?: string;
}

export function ScorecardHeader({ className = '' }: Props) {
  return (
    <header
      className={['w-full bg-white border-b', className].join(' ')}
      style={{ borderBottomColor: '#E8B92322' }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col items-center sm:items-start">
        <Link
          href="/scorecard/landing"
          aria-label="Sorena Visa — Home"
          className="inline-flex flex-col items-center sm:items-start"
        >
          <SorenaLogo className="w-40 sm:w-52 h-auto" />
          <div className="text-[#1E3A5F] italic text-sm tracking-wide mt-1">
            From assessment to arrival.
          </div>
        </Link>
      </div>
    </header>
  );
}
