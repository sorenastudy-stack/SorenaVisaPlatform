'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import {
  COMMON_LANGUAGES, OTHER_LANGUAGES, languageLabel,
} from '@/lib/languages';

// Phase 2b — first-language picker for the scorecard.
//
// Default view is a short dropdown of the common languages plus an "Other…"
// entry. Choosing "Other…" reveals a searchable list of the fuller language
// set. The stored value (via onChange) is always a lowercase ISO 639-1 code,
// or '' when nothing is selected. Fully optional — '' is a valid state.

const OTHER = '__other__';

function isCommon(code: string): boolean {
  return COMMON_LANGUAGES.some((l) => l.code === code);
}

export function LanguageSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  // "Other" mode is active when the user picked Other, or when the current
  // value is a real code that isn't in the short list (e.g. resumed draft).
  const [otherMode, setOtherMode] = useState<boolean>(!!value && !isCommon(value));
  const [search, setSearch] = useState('');

  const selectValue = otherMode ? OTHER : (isCommon(value) ? value : '');

  function handleSelect(v: string) {
    if (v === OTHER) {
      setOtherMode(true);
      onChange(''); // clear until they pick a specific language from the list
    } else {
      setOtherMode(false);
      setSearch('');
      onChange(v); // '' (— select —) or a common ISO code
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? OTHER_LANGUAGES.filter((l) => l.label.toLowerCase().includes(q) || l.code === q)
    : OTHER_LANGUAGES;

  return (
    <div>
      <select
        value={selectValue}
        onChange={(e) => handleSelect(e.target.value)}
        className={className}
      >
        <option value="">— select (optional) —</option>
        {COMMON_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>

      {otherMode && (
        <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3">
          {value && !isCommon(value) && (
            <div className="mb-2 text-xs font-semibold text-[#1E3A5F]">
              Selected: {languageLabel(value)}
            </div>
          )}
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search languages…"
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-sm text-[#1E3A5F] focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40"
            />
          </div>
          <div className="mt-2 max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-xs text-gray-400">No languages match “{search}”.</p>
            ) : (
              filtered.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => onChange(l.code)}
                  className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                    value === l.code
                      ? 'bg-[#1E3A5F] text-white'
                      : 'text-[#1E3A5F] hover:bg-[#faf8f3]'
                  }`}
                >
                  {l.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
