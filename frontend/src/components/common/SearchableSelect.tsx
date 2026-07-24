'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

// PR-COUNTRY-DROPDOWN — a generic searchable single-select combobox.
//
// Search box pinned at the top of the popover, full display names in a
// scrollable list, and the underlying CODE stored via onChange. No next-intl
// dependency, so it drops into the public scorecard AND staff surfaces
// identically. Used for both the language and country pickers so the two look
// and behave the same.
//
// - `value`   : the stored code ('' when nothing selected)
// - `onChange`: receives the selected option's `value` (a code), or '' on clear
// - `options` : { value, label, hint? } — `hint` renders as a muted leading
//               glyph (a flag emoji for countries) or trailing code chip.

export interface SearchableOption {
  value: string;
  label: string;
  /** Optional leading glyph (e.g. a flag emoji). */
  glyph?: string;
  /** Extra text folded into the search match (e.g. the raw code). */
  searchExtra?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  allowClear = true,
  disabled = false,
  buttonClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.searchExtra ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  // Close + reset the query on click-outside.
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

  // Focus the search box when the popover opens.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setQuery('');
  }

  const baseBtn =
    buttonClassName ??
    'w-full flex items-center justify-between gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-left text-[#1E3A5F] focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40 disabled:opacity-50';

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={baseBtn}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`flex min-w-0 items-center gap-2 ${selected ? '' : 'text-gray-400'}`}>
          {selected?.glyph && <span className="shrink-0">{selected.glyph}</span>}
          <span className="truncate">{selected ? selected.label : placeholder}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {allowClear && selected && !disabled && (
            <X
              size={15}
              className="text-gray-400 hover:text-[#1E3A5F]"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
            />
          )}
          <ChevronDown size={16} className="text-gray-400" />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="relative border-b border-gray-100 p-2">
            <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-sm text-[#1E3A5F] focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-xs text-gray-400">No matches for “{query}”.</li>
            ) : (
              filtered.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => choose(o.value)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      o.value === value ? 'bg-[#1E3A5F] text-white' : 'text-[#1E3A5F] hover:bg-[#faf8f3]'
                    }`}
                    role="option"
                    aria-selected={o.value === value}
                  >
                    {o.glyph && <span className="shrink-0">{o.glyph}</span>}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.value === value && <Check size={15} className="shrink-0" />}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
