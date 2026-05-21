'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  getSearchableCountries,
  getCountryName,
  countryCodeToFlagEmoji,
  type SearchableCountry,
} from '@/lib/country-codes';

// PR-CONSULT-4 — Country picker.
//
// Searchable dropdown over the ISO 3166-1 alpha-2 catalogue.
// Returns the alpha-2 code on selection. Each row is `<flag> <name>
// <code>` with the flag on the leading edge — RTL-aware via flexbox
// (no manual `direction:` overrides).
//
// The catalogue is computed once per locale + memoised; switching
// from en → fa rebuilds the list with localised names + re-sorts.

export function CountryPicker({
  value,
  onChange,
  placeholderKey = 'staff.users.form.countryPlaceholder',
  disabled = false,
}: {
  value:           string;
  onChange:        (code: string) => void;
  placeholderKey?: string;
  disabled?:       boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'fa';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const catalogue = useMemo(
    () => getSearchableCountries(locale),
    [locale],
  );

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return catalogue;
    const q = query.trim().toLowerCase();
    return catalogue.filter((c: SearchableCountry) => c.searchText.includes(q));
  }, [catalogue, query]);

  const selectedFlag = value ? countryCodeToFlagEmoji(value) : '';
  const selectedName = value ? getCountryName(value, locale) : '';

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {value ? (
          <>
            <span className="text-lg leading-none" aria-hidden>{selectedFlag}</span>
            <span className="flex-1 text-start truncate">{selectedName}</span>
            <span className="text-xs text-gray-400">{value}</span>
          </>
        ) : (
          <span className="flex-1 text-start text-gray-400">{t(placeholderKey)}</span>
        )}
        <ChevronDown size={16} className="text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          <div className="relative border-b border-gray-100 p-2">
            <Search size={14} className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              className="w-full ps-7 pe-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <ul className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-gray-400">—</li>
            ) : (
              filtered.map((c: SearchableCountry) => {
                const active = value === c.code;
                return (
                  <li key={c.code}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(c.code);
                        setOpen(false);
                        setQuery('');
                      }}
                      className={[
                        'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#faf8f3] transition-colors',
                        active ? 'bg-[#1e3a5f]/5' : '',
                      ].join(' ')}
                    >
                      <span className="text-lg leading-none" aria-hidden>{c.flag}</span>
                      <span className="flex-1 text-start truncate">{c.name}</span>
                      <span className="text-[10px] text-gray-400 font-mono">{c.code}</span>
                      {active && <Check size={14} className="text-[#1e3a5f]" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
