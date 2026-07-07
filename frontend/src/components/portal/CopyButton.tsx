'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// Small copy-to-clipboard control for a single value (e.g. a bank-detail
// row on the pay screen). The pay page is a server component, so this
// interactive bit lives in its own 'use client' child. Icon swaps to a
// check for ~1.5s on success; silently no-ops if the clipboard API is
// unavailable (older/insecure contexts) — the value is also select-all.
export function CopyButton({ value, label = 'value' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the value stays selectable for manual copy */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      title={copied ? 'Copied' : 'Copy'}
      className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-[#1e3a5f]/55 hover:text-[#1e3a5f] hover:bg-[#1e3a5f]/5 transition-colors"
    >
      {copied ? <Check size={16} className="text-[#b8941f]" /> : <Copy size={16} />}
    </button>
  );
}
