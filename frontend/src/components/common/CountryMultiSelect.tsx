'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  getSearchableCountries,
  getCountryName,
  countryCodeToFlagEmoji,
  type SearchableCountry,
} from '@/lib/country-codes';

// PR-PROVIDER-PORTAL slice E (follow-up) — pick MANY countries.
//
// The catalogue is the shared one in `lib/country-codes` — the same list
// `CountryPicker` (staff) and `CountrySelect` (student forms) already use. Both
// of those are single-select by construction: `value: string`, and the dropdown
// closes on choose. Widening either into a multi-select would change a component
// used by five existing screens to serve one new one, so this is a third
// consumer of the same data rather than a fourth country list.
//
// It deliberately does NOT depend on next-intl, unlike `CountryPicker` — the
// provider portal renders outside that provider, and a `useTranslations()` call
// there throws at runtime rather than falling back.
//
// WHAT IT EMITS: alpha-2 codes, in the order chosen. Names are display only.
// Invalid codes are impossible by construction — every option comes from the
// catalogue — so the parent's dedupe/validation becomes a belt on top of braces
// rather than the only thing standing between a typo and the database.

export interface CountryMultiSelectProps {
  /** Selected alpha-2 codes. */
  value: string[];
  onChange: (codes: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Optional cap, matching whatever the server enforces. */
  max?: number;
  id?: string;
}

export function CountryMultiSelect({
  value,
  onChange,
  placeholder = 'Search and choose countries…',
  disabled = false,
  max,
  id,
}: CountryMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // English only: this component is used on the institution portal, which has no
  // locale switch. `getSearchableCountries` still takes the locale so a future
  // localised surface can pass 'fa' without touching this contract.
  const catalogue = useMemo(() => getSearchableCountries('en'), []);
  const selected = useMemo(() => new Set(value.map((c) => c.toUpperCase())), [value]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /**
   * Filter, then rank so the obvious answer is first.
   *
   * Plain alphabetical is wrong here: typing "India" puts "British Indian Ocean
   * Territory" above "India", so the first row — the one a fast user clicks — is
   * the wrong country. Caught by the test that picks the first result.
   *
   * Order: exact code, then exact name, then name-starts-with, then the rest,
   * alphabetical within each band.
   */
  const filtered = useMemo(() => {
    if (!query.trim()) return catalogue;
    const q = query.trim().toLowerCase();
    const rank = (c: SearchableCountry) => {
      const name = c.name.toLowerCase();
      if (c.code.toLowerCase() === q) return 0;
      if (name === q) return 1;
      if (name.startsWith(q)) return 2;
      return 3;
    };
    return catalogue
      .filter((c: SearchableCountry) => c.searchText.includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [catalogue, query]);

  const atMax = typeof max === 'number' && value.length >= max;

  /** Toggle, preserving the order countries were chosen in. */
  const toggle = (code: string) => {
    if (selected.has(code)) {
      onChange(value.filter((c) => c.toUpperCase() !== code));
      return;
    }
    if (atMax) return;
    onChange([...value, code]);
  };

  const remove = (code: string) => onChange(value.filter((c) => c.toUpperCase() !== code.toUpperCase()));

  const chips = value.length > 0 && (
    // ABOVE the control, not below it. The dropdown panel is absolutely
    // positioned directly under the button, so chips rendered underneath sit
    // behind it and cannot be clicked while the list is open — which is exactly
    // when someone notices they picked the wrong country. Caught in the browser,
    // not in jsdom: the panel has no size there, so nothing overlapped.
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {value.map((code) => {
        const upper = code.toUpperCase();
        return (
          <li key={upper}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white py-1 pe-1 ps-2.5 text-xs">
              <span aria-hidden>{countryCodeToFlagEmoji(upper)}</span>
              <span className="text-sorena-navy">{getCountryName(upper, 'en')}</span>
              <button
                type="button"
                onClick={() => remove(upper)}
                disabled={disabled}
                aria-label={`Remove ${getCountryName(upper, 'en')}`}
                className="rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
              >
                <X size={12} />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div ref={wrapperRef} className="relative">
      {chips}
      <button
        type="button"
        id={id}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-[48px] w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={`flex-1 text-start ${value.length ? 'text-sorena-navy' : 'text-gray-400'}`}>
          {value.length === 0
            ? placeholder
            : `${value.length} ${value.length === 1 ? 'country' : 'countries'} selected`}
        </span>
        <ChevronDown size={16} className="text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="relative border-b border-gray-100 p-2">
            <Search size={14} className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              aria-label="Search countries"
              placeholder="Search…"
              className="w-full rounded-lg border border-gray-200 py-1.5 pe-3 ps-7 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                <X size={14} />
              </button>
            )}
          </div>

          {atMax && (
            <p className="border-b border-gray-100 px-3 py-2 text-xs text-[#8a6d10]">
              That’s the maximum of {max}. Remove one to add another.
            </p>
          )}

          {/* The list stays OPEN on choose — the whole point is picking several. */}
          <ul className="max-h-72 overflow-y-auto" role="listbox" aria-multiselectable="true">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-gray-400">No country matches that.</li>
            ) : (
              filtered.map((c: SearchableCountry) => {
                const isOn = selected.has(c.code);
                return (
                  <li key={c.code}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isOn}
                      disabled={!isOn && atMax}
                      onClick={() => toggle(c.code)}
                      className={[
                        'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-[#faf8f3]',
                        isOn ? 'bg-[#1e3a5f]/5' : '',
                        !isOn && atMax ? 'cursor-not-allowed opacity-40' : '',
                      ].join(' ')}
                    >
                      <span className="text-lg leading-none" aria-hidden>{c.flag}</span>
                      <span className="flex-1 truncate text-start">{c.name}</span>
                      <span className="font-mono text-[10px] text-gray-400">{c.code}</span>
                      {isOn && <Check size={14} className="text-[#1e3a5f]" />}
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
