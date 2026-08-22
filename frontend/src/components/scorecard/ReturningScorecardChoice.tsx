import Link from 'next/link';
import { ArrowRight, FileText, RotateCcw } from 'lucide-react';

export function ReturningScorecardChoice({
  latestCompletedAt,
}: {
  latestCompletedAt: string | null;
}) {
  const formattedDate = latestCompletedAt
    ? new Intl.DateTimeFormat('en-NZ', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Pacific/Auckland',
      }).format(new Date(latestCompletedAt))
    : null;

  return (
    <section className="mx-auto max-w-3xl rounded-2xl border border-sorena-navy/10 bg-white p-6 shadow-sm md:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sorena-gold">
        Welcome back
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-sorena-navy">
        You already have a completed assessment
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-sorena-text/70">
        {formattedDate
          ? `Your latest result is from ${formattedDate}. You can review it or start a new assessment to record your updated circumstances.`
          : 'You can review your latest result or start a new assessment to record your updated circumstances.'}
      </p>

      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <Link
          href="/scorecard/result"
          className="group rounded-xl bg-sorena-navy p-5 text-white transition hover:bg-sorena-navy/90"
        >
          <span className="flex items-center justify-between gap-3">
            <FileText size={20} aria-hidden="true" />
            <ArrowRight size={18} className="transition group-hover:translate-x-1" aria-hidden="true" />
          </span>
          <span className="mt-5 block text-base font-semibold">View latest result</span>
          <span className="mt-1 block text-xs leading-5 text-white/70">
            Open your most recent completed Scorecard.
          </span>
        </Link>

        <Link
          href="/scorecard?retake=1"
          className="group rounded-xl border border-sorena-navy/15 bg-sorena-cream p-5 text-sorena-navy transition hover:border-sorena-gold"
        >
          <span className="flex items-center justify-between gap-3">
            <RotateCcw size={20} aria-hidden="true" />
            <ArrowRight size={18} className="transition group-hover:translate-x-1" aria-hidden="true" />
          </span>
          <span className="mt-5 block text-base font-semibold">Start a new assessment</span>
          <span className="mt-1 block text-xs leading-5 text-sorena-text/60">
            Begin with a blank form; your earlier result stays in history.
          </span>
        </Link>
      </div>
    </section>
  );
}
