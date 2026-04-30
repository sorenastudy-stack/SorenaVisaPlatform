'use client';

import { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';
import { useLocaleStore } from '@/lib/stores/localeStore';
import type { GlossaryEntry } from '@/lib/glossary';

interface InfoTipProps {
  entry: GlossaryEntry;
  iconSize?: number;
}

export function InfoTip({ entry, iconSize = 14 }: InfoTipProps) {
  const { locale } = useLocaleStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const text = locale === 'fa' ? entry.fa : entry.en;
  const isRtl = locale === 'fa';

  return (
    <span ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        aria-label={`More info about ${entry.term}`}
        className="inline-flex items-center justify-center text-[#1E3A5F]/40 hover:text-[#E8B923] transition-colors focus:outline-none focus:text-[#E8B923]"
      >
        <Info size={iconSize} />
      </button>

      {open && (
        <span
          role="tooltip"
          dir={isRtl ? 'rtl' : 'ltr'}
          className={`absolute z-50 bottom-full mb-2 ${
            isRtl ? 'right-0' : 'left-0'
          } w-64 px-3 py-2 rounded-lg bg-[#1E3A5F] text-white text-xs leading-relaxed shadow-lg pointer-events-none`}
        >
          <span className="block font-semibold mb-1 text-[#E8B923]">
            {entry.term}
          </span>
          {text}
        </span>
      )}
    </span>
  );
}
