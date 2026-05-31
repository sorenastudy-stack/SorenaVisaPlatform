'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  getSearchableCountries,
  getCountryName,
  countryCodeToFlagEmoji,
  type SearchableCountry,
} from '@/lib/country-codes';

// PR-COUNTRY-CONSOLIDATE — Shared country dropdown for student forms.
//
// Storage format: ISO 3166-1 alpha-2 code (e.g. "IR") OR the literal
// "OVERSEAS" (admission schoolCountry only) OR null. Never emits full
// English names — that is the whole point of this PR.
//
// Visually matches the visa-form input look (rounded-lg, sorena-navy
// borders) rather than the staff `CountryPicker` (rounded-xl, gray)
// so it drops into existing visa/admission step layouts cleanly.

const DEFAULT_PRIORITY_CODES = ['IR', 'NZ', 'AU', 'GB', 'US'] as const;
const OVERSEAS_VALUE = 'OVERSEAS';

interface CountrySelectProps {
  value:          string | null;
  onChange:       (code: string | null) => void;
  priorityCodes?: string[];
  allowOverseas?: boolean;
  disabled?:     boolean;
  ariaInvalid?:  boolean;
  placeholder?:  string;
  id?:           string;
}

export function CountrySelect({
  value,
  onChange,
  priorityCodes = [...DEFAULT_PRIORITY_CODES],
  allowOverseas = false,
  disabled      = false,
  ariaInvalid   = false,
  placeholder   = 'Select a country',
  id,
}: CountrySelectProps) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // English-only for this PR. Persian locale support stays available
  // through getCountryName(code, 'fa') for any future LIA-side reader.
  const catalogue = useMemo(() => getSearchableCountries('en'), []);

  const priorityItems = useMemo(() => {
    const set = new Set(priorityCodes);
    const byCode = new Map(catalogue.map((c) => [c.code, c] as const));
    return priorityCodes
      .map((code) => byCode.get(code))
      .filter((c): c is SearchableCountry => Boolean(c))
      .map((c) => ({ ...c, _priority: true as const }));
  }, [priorityCodes, catalogue]);

  const alphaItems = useMemo(() => {
    const prioritySet = new Set(priorityCodes);
    return catalogue.filter((c) => !prioritySet.has(c.code));
  }, [catalogue, priorityCodes]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const q = query.trim().toLowerCase();

  // When the user is typing, collapse all groups into a single
  // alphabetical match list. OVERSEAS is matchable by "overseas" /
  // "other" so the typed-search UX stays consistent.
  const filtered = useMemo(() => {
    if (!q) return null; // null sentinel → render grouped view
    const matches = catalogue.filter((c) => c.searchText.includes(q));
    const list: Array<SearchableCountry | { code: string; name: string; flag: ''; searchText: string; _overseas: true }> = [...matches];
    if (allowOverseas && ('overseas'.includes(q) || 'other'.includes(q))) {
      list.unshift({
        code:       OVERSEAS_VALUE,
        name:       'Other / overseas country',
        flag:       '',
        searchText: 'overseas other',
        _overseas:  true,
      });
    }
    return list;
  }, [q, catalogue, allowOverseas]);

  const selectedDisplay = (() => {
    if (!value) return null;
    if (value === OVERSEAS_VALUE) return { flag: '', name: 'Other / overseas country', code: '' };
    return { flag: countryCodeToFlagEmoji(value), name: getCountryName(value, 'en'), code: value };
  })();

  const buttonClass = [
    'w-full flex items-center gap-2 rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy min-h-[48px] focus:outline-none',
    ariaInvalid
      ? 'border-red-400 focus:border-red-500'
      : 'border-sorena-navy/20 focus:border-sorena-navy/60',
    disabled ? 'opacity-50 cursor-not-allowed' : '',
  ].join(' ');

  const handlePick = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-invalid={ariaInvalid || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={buttonClass}
      >
        {selectedDisplay ? (
          <>
            {selectedDisplay.flag && (
              <span className="text-lg leading-none" aria-hidden>{selectedDisplay.flag}</span>
            )}
            <span className="flex-1 text-start truncate">{selectedDisplay.name}</span>
            {selectedDisplay.code && (
              <span className="text-[10px] font-mono text-sorena-navy/40">{selectedDisplay.code}</span>
            )}
          </>
        ) : (
          <span className="flex-1 text-start text-sorena-navy/40">{placeholder}</span>
        )}
        <ChevronDown size={16} className="text-sorena-navy/40" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-sorena-navy/20 bg-white shadow-lg">
          <div className="relative border-b border-sorena-navy/10 p-2">
            <Search size={14} className="absolute start-4 top-1/2 -translate-y-1/2 text-sorena-navy/40" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="Search country or code"
              className="w-full rounded-md border border-sorena-navy/15 py-1.5 pe-3 ps-7 text-sm focus:border-sorena-navy/60 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-sorena-navy/40 hover:text-sorena-navy"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <ul role="listbox" className="max-h-72 overflow-y-auto">
            {filtered !== null ? (
              filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-sorena-navy/40">No results</li>
              ) : (
                filtered.map((c) => (
                  <CountryRow
                    key={'_overseas' in c ? OVERSEAS_VALUE : c.code}
                    item={c}
                    selectedValue={value}
                    onPick={handlePick}
                  />
                ))
              )
            ) : (
              <>
                {allowOverseas && (
                  <>
                    <CountryRow
                      item={{
                        code:       OVERSEAS_VALUE,
                        name:       'Other / overseas country',
                        flag:       '',
                        searchText: 'overseas other',
                        _overseas:  true,
                      }}
                      selectedValue={value}
                      onPick={handlePick}
                    />
                    <li className="border-t border-sorena-navy/10" aria-hidden />
                  </>
                )}
                {priorityItems.length > 0 && (
                  <>
                    {priorityItems.map((c) => (
                      <CountryRow
                        key={`prio-${c.code}`}
                        item={c}
                        selectedValue={value}
                        onPick={handlePick}
                      />
                    ))}
                    <li className="border-t border-sorena-navy/10" aria-hidden />
                  </>
                )}
                {alphaItems.map((c) => (
                  <CountryRow
                    key={c.code}
                    item={c}
                    selectedValue={value}
                    onPick={handlePick}
                  />
                ))}
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function CountryRow({
  item,
  selectedValue,
  onPick,
}: {
  item:          SearchableCountry | { code: string; name: string; flag: string; searchText: string; _overseas?: true } | (SearchableCountry & { _priority?: true });
  selectedValue: string | null;
  onPick:        (code: string) => void;
}) {
  const isOverseas = '_overseas' in item && item._overseas === true;
  const code  = isOverseas ? OVERSEAS_VALUE : item.code;
  const active = selectedValue === code;
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(code)}
        className={[
          'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-sorena-navy/5',
          active ? 'bg-sorena-navy/5 font-medium' : '',
        ].join(' ')}
      >
        {item.flag && <span className="text-lg leading-none" aria-hidden>{item.flag}</span>}
        <span className="flex-1 text-start truncate">{item.name}</span>
        {!isOverseas && (
          <span className="font-mono text-[10px] text-sorena-navy/40">{item.code}</span>
        )}
        {active && <Check size={14} className="text-sorena-navy" />}
      </button>
    </li>
  );
}
