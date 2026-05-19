'use client';

import { useState } from 'react';

// Shared searchable-select. Same look, same behaviour as the inlined copies
// in the admission form (Step2AdditionalInfo / Step5GuardianInfo /
// EducationHistoryEditor). Extracted so the Visa Section can reuse it
// without duplicating the widget; admission's inlined copies are left
// as-is and can be migrated in a follow-up cleanup.
//
// Behaviour notes (parity with admission):
// - Opens on focus, closes on blur (150ms delay so a click on a list item
//   registers before the input loses focus).
// - Typing into the input populates a local `query` string and CLEARS the
//   parent `value` — the user must pick from the dropdown to set a value.
//   This is intentional: free-text "Iran" alongside the list option "Iran"
//   would otherwise drift apart silently.
// - Case-insensitive substring filter.
// - `hasError` is an optional enhancement on top of admission's shape; pass
//   it to flip the border red. Admission's call sites never pass it.
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  hasError = false,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hasError?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const inputValue = open ? query : value;
  const filtered = query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className="relative">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => { setQuery(e.target.value); onChange(''); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className={[
          'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:outline-none',
          hasError
            ? 'border-red-400 focus:border-red-500'
            : 'border-sorena-navy/20 focus:border-sorena-navy/60',
        ].join(' ')}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-sorena-navy/20 bg-white shadow-lg">
          {filtered.map((opt) => (
            <li
              key={opt}
              onMouseDown={() => { onChange(opt); setQuery(''); setOpen(false); }}
              className={[
                'cursor-pointer px-3 py-2 text-sm text-sorena-navy hover:bg-sorena-navy/5',
                opt === value ? 'bg-sorena-navy/5 font-medium' : '',
              ].join(' ')}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && query && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2 text-sm text-sorena-navy/50 shadow-lg">
          No results
        </div>
      )}
    </div>
  );
}
