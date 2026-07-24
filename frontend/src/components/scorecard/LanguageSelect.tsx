'use client';

import { SearchableSelect, type SearchableOption } from '@/components/common/SearchableSelect';
import { ALL_LANGUAGE_OPTIONS } from '@/lib/languages';

// First-language picker for the scorecard.
//
// PR-COUNTRY-DROPDOWN — now a proper searchable combobox (search box at top,
// full display names) built on the shared SearchableSelect, so it looks + behaves
// identically to the country picker. Stored value is unchanged: a lowercase
// ISO 639-1 code, or '' when nothing is selected.

const LANGUAGE_OPTIONS: SearchableOption[] = ALL_LANGUAGE_OPTIONS.map((l) => ({
  value: l.code,
  label: l.label,
  searchExtra: l.code,
}));

export function LanguageSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Accepted for call-site compatibility; the combobox styles its own trigger. */
  className?: string;
}) {
  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={LANGUAGE_OPTIONS}
      placeholder="— select (optional) —"
      searchPlaceholder="Search languages…"
    />
  );
}
