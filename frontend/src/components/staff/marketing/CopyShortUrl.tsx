'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// PR-SCORECARD-2 — Inline "copy short URL" button.

export function CopyShortUrl({ shortUrl, shortCode }: { shortUrl: string; shortCode: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — fall through silently
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={shortUrl}
      className="inline-flex items-center gap-1.5 hover:text-[#E8B923]"
    >
      <span>{shortCode}</span>
      {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
    </button>
  );
}
