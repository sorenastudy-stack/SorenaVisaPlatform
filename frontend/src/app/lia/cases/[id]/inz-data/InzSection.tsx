'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { CopyButton } from './CopyButton';

// PR-LIA-6 — Collapsible section card. Header carries the title,
// a count/completeness badge, the section-level Copy button, and
// the expand/collapse toggle. Body renders children only when open.
//
// Default-open is decided per-section by the page (sections with
// data open; empty sections collapsed, per Option C in the spec).

type BadgeTone = 'gray' | 'blue' | 'emerald';

export function InzSection({
  title,
  badge,
  badgeTone = 'gray',
  copyText,
  copyLabel,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge: string;
  badgeTone?: BadgeTone;
  copyText: string;
  copyLabel?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const toneClasses: Record<BadgeTone, string> = {
    gray: 'bg-gray-100 text-gray-700 border border-gray-200',
    blue: 'bg-blue-100 text-blue-800 border border-blue-200',
    emerald: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white mb-4 overflow-hidden">
      <header className="flex items-center gap-3 flex-wrap p-4 border-b border-gray-100">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-[#1E3A5F] hover:bg-[#FAF8F3] transition-colors"
          title={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <h2 className="text-base font-bold text-[#1E3A5F] mr-auto">{title}</h2>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${toneClasses[badgeTone]}`}>
          {badge}
        </span>
        <CopyButton text={copyText} variant="section" label={copyLabel} />
      </header>
      {open && (
        <div className="p-4 transition-[max-height,opacity] duration-150">
          {children}
        </div>
      )}
    </section>
  );
}
