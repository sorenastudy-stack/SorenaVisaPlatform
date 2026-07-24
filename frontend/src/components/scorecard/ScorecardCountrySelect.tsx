'use client';

import { useMemo } from 'react';
import { SearchableSelect, type SearchableOption } from '@/components/common/SearchableSelect';
import { getSearchableCountries } from '@/lib/country-codes';
import { useLocaleStore } from '@/lib/stores/localeStore';

// PR-COUNTRY-DROPDOWN — country-of-residence picker for the scorecard.
//
// Same searchable combobox as the language picker (shared SearchableSelect), over
// the full ISO 3166-1 catalogue with flags + localised names. Stores the alpha-2
// CODE (e.g. 'NZ') — the same format the staff country picker and the Client ID
// generator use — so there is no messy free text and no extra normalisation step.

export function ScorecardCountrySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Accepted for call-site compatibility; the combobox styles its own trigger. */
  className?: string;
}) {
  const locale = useLocaleStore((s) => s.locale) as 'en' | 'fa';
  const options: SearchableOption[] = useMemo(
    () =>
      getSearchableCountries(locale).map((c) => ({
        value: c.code,
        label: c.name,
        glyph: c.flag,
        searchExtra: c.code,
      })),
    [locale],
  );

  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder="— select your country —"
      searchPlaceholder="Search countries…"
    />
  );
}
