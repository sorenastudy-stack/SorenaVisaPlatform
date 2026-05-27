import Link from 'next/link';
import { SorenaWordmark } from '@/components/brand/SorenaWordmark';

// PR-SCORECARD-2 polish — Sorena Visa branded header for /scorecard
// (form) and /scorecard/result.
//
// The /scorecard/landing page renders its own hero, so this header
// is light-variant only. It now uses the inline SVG wordmark
// (transparent background, crisp at every size) instead of the
// JPG/PNG file that baked in a white box.

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
          <SorenaWordmark variant="navy" className="w-40 sm:w-52" />
          <div className="text-[#1E3A5F] italic text-sm tracking-wide mt-1">
            From assessment to arrival.
          </div>
        </Link>
      </div>
    </header>
  );
}
