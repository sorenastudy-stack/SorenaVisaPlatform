'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { getSearchableDialCodes, type SearchableDialCode } from '@/lib/country-codes';
import { composeE164, parseE164 } from '@/lib/phone';

// PR-COUNTRY-PHONE — the one phone field for the whole platform.
//
// Platform rule: anywhere a user enters a phone country code it must be a
// SEARCHABLE dropdown, never free text and never a plain <select>. This is the
// component that implements it.
//
// Contract: `value` is a single E.164 string ("+64215551234") and `onChange`
// emits the same — identical to what these fields stored as free text before,
// so nothing downstream changes. The (country, digits) split exists only
// inside this component.
//
// The country dropdown is a compact prefix button rather than the full-width
// `CountryPicker`, which renders "<flag> <name> <code>" and would swallow the
// number field. It is the same search behaviour over the same catalogue.

const DEFAULT_COUNTRY = 'NZ';

export interface PhoneInputProps {
  value:        string;
  onChange:     (e164: string) => void;
  /** Country pre-selected when `value` is empty. */
  defaultCountry?: string;
  placeholder?: string;
  disabled?:    boolean;
  ariaInvalid?: boolean;
  id?:          string;
  name?:        string;
  autoComplete?: string;
  /** 'dark' matches the marketing LeadForm's translucent-on-navy styling. */
  theme?:       'light' | 'dark';
}

export function PhoneInput({
  value,
  onChange,
  defaultCountry = DEFAULT_COUNTRY,
  placeholder = 'Phone number',
  disabled = false,
  ariaInvalid = false,
  id,
  name,
  autoComplete = 'tel',
  theme = 'light',
}: PhoneInputProps) {
  const parsedFromValue = useMemo(() => parseE164(value), [value]);

  const [iso2, setIso2] = useState(() => parsedFromValue?.iso2 ?? defaultCountry);
  const [national, setNational] = useState(() => parsedFromValue?.national ?? '');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Re-hydrate when the form loads a value from the server AFTER first render
  // (edit overlays fetch, then populate). Guarded on the value actually
  // differing from what this component last emitted, so typing is never
  // clobbered by the round-trip through the parent's state.
  const lastEmitted = useRef<string>(value);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const p = parseE164(value);
    if (p) {
      setIso2(p.iso2);
      setNational(p.national);
    } else if (!value) {
      setNational('');
    }
  }, [value]);

  const emit = (nextIso2: string, nextNational: string) => {
    const e164 = composeE164(nextIso2, nextNational);
    lastEmitted.current = e164;
    onChange(e164);
  };

  const catalogue = useMemo(() => getSearchableDialCodes('en'), []);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalogue;
    return catalogue.filter((c) => c.searchText.includes(q));
  }, [catalogue, query]);

  const selected = catalogue.find((c) => c.code === iso2) ?? null;

  const handleNationalChange = (raw: string) => {
    // A pasted full international number ("+98 912 …") should move the country
    // dropdown rather than be treated as national digits — otherwise the code
    // is silently duplicated into +64+98…
    if (raw.trim().startsWith('+') || raw.trim().startsWith('00')) {
      const p = parseE164(raw);
      if (p) {
        setIso2(p.iso2);
        setNational(p.national);
        emit(p.iso2, p.national);
        return;
      }
    }
    setNational(raw);
    emit(iso2, raw);
  };

  const handlePickCountry = (code: string) => {
    setIso2(code);
    setOpen(false);
    setQuery('');
    emit(code, national);
  };

  const dark = theme === 'dark';
  const shellClass = [
    'flex items-stretch overflow-hidden rounded-lg border',
    dark ? 'border-white/15 bg-white/[0.08]' : 'bg-white',
    dark ? '' : ariaInvalid ? 'border-red-400' : 'border-gray-300',
    disabled ? 'opacity-50' : '',
  ].join(' ');

  return (
    // `min-w-0` matters: as a grid/flex child this would otherwise be sized by
    // its min-content (prefix button + input) and overflow a narrow column —
    // which is exactly what the LeadForm's two-up phone/WhatsApp row does.
    <div ref={wrapperRef} className="relative w-full min-w-0">
      <div className={shellClass}>
        <button
          type="button"
          onClick={() => !disabled && setOpen((o) => !o)}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Country calling code"
          className={[
            'flex shrink-0 items-center gap-1.5 px-3 text-sm focus:outline-none',
            dark ? 'text-white hover:bg-white/10' : 'text-[#1e3a5f] hover:bg-gray-50',
            disabled ? 'cursor-not-allowed' : '',
          ].join(' ')}
        >
          <span className="text-base leading-none" aria-hidden>{selected?.flag ?? ''}</span>
          <span className="font-mono text-xs">+{selected?.dial ?? ''}</span>
          <ChevronDown size={13} className={dark ? 'text-white/50' : 'text-gray-400'} />
        </button>

        <span className={dark ? 'w-px bg-white/15' : 'w-px bg-gray-200'} aria-hidden />

        <input
          id={id}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          value={national}
          disabled={disabled}
          aria-invalid={ariaInvalid || undefined}
          placeholder={placeholder}
          onChange={(e) => handleNationalChange(e.target.value)}
          className={[
            'min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm focus:outline-none',
            dark ? 'text-white placeholder:text-white/40' : 'text-[#1e3a5f]',
          ].join(' ')}
        />
      </div>

      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-[16rem] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="relative border-b border-gray-100 p-2">
            <Search size={14} className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="Search country or code"
              aria-label="Search country calling code"
              className="w-full rounded-md border border-gray-200 py-1.5 pe-3 ps-7 text-sm text-[#1e3a5f] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <ul role="listbox" className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-gray-400">No results</li>
            ) : (
              filtered.map((c: SearchableDialCode) => {
                const active = c.code === iso2;
                return (
                  <li key={c.code}>
                    <button
                      type="button"
                      onClick={() => handlePickCountry(c.code)}
                      className={[
                        'flex w-full items-center gap-2 px-3 py-2 text-sm text-[#1e3a5f] transition-colors hover:bg-[#faf8f3]',
                        active ? 'bg-[#1e3a5f]/5 font-medium' : '',
                      ].join(' ')}
                    >
                      <span className="text-base leading-none" aria-hidden>{c.flag}</span>
                      <span className="flex-1 text-start truncate">{c.name}</span>
                      <span className="font-mono text-[11px] text-gray-400">+{c.dial}</span>
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

export default PhoneInput;
