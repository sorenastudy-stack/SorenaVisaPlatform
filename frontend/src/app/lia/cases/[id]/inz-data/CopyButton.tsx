'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// PR-LIA-6 — Reusable clipboard button.
//
// Three variants:
//   * 'field'   — small icon-only button next to a value
//   * 'entry'   — small "Copy entry" button on each array-item card
//   * 'section' — full "Copy section" pill on a section header
//
// Uses navigator.clipboard.writeText. No third-party dep. Brief
// "Copied" confirmation auto-dismisses after 2 seconds.

type Variant = 'field' | 'entry' | 'section';

export function CopyButton({
  text,
  variant = 'field',
  label,
  ariaLabel,
}: {
  text: string;
  variant?: Variant;
  label?: string;
  ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-secure contexts. Fall back to a
      // textarea trick.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        /* give up silently */
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  if (variant === 'field') {
    return (
      <button
        type="button"
        onClick={handle}
        aria-label={ariaLabel ?? 'Copy value'}
        className="inline-flex items-center justify-center w-6 h-6 rounded text-[#1E3A5F]/60 hover:text-[#E8B923] hover:bg-[#FAF8F3] transition-colors"
        title={copied ? 'Copied' : 'Copy'}
      >
        {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
      </button>
    );
  }

  if (variant === 'entry') {
    return (
      <button
        type="button"
        onClick={handle}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-[#1E3A5F] bg-white border border-gray-200 hover:border-[#E8B923] hover:text-[#E8B923] transition-colors"
      >
        {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
        {copied ? 'Copied' : label ?? 'Copy entry'}
      </button>
    );
  }

  // section
  return (
    <button
      type="button"
      onClick={handle}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#1E3A5F] bg-white border border-gray-200 hover:border-[#E8B923] hover:text-[#E8B923] transition-colors"
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
      {copied ? 'Copied' : label ?? 'Copy section'}
    </button>
  );
}
