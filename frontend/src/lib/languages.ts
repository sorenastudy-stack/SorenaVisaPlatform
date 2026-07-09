// Phase 2b — client-facing first-language options for the scorecard intake.
//
// Values are lowercase ISO 639-1 codes, matching the backend
// (common/language-codes.ts) and staff User.languages format so consultant
// language-matching (Phase 2a) compares like-for-like.
//
// COMMON_LANGUAGES is the short dropdown shown by default. OTHER_LANGUAGES is a
// fuller, searchable list revealed only when the user picks "Other…". Labels
// are the language's own English name (endonym-in-English) — kept simple; the
// scorecard UI is English-only.

export interface LanguageOption {
  code: string;  // lowercase ISO 639-1
  label: string;
}

// Short list (the default dropdown). Ordered by how often Sorena sees them.
export const COMMON_LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'fa', label: 'Farsi (Persian)' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ur', label: 'Urdu' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
];

// Fuller list for the "Other…" searchable picker. Excludes the common codes
// (they're already in the short list). Broad but practical coverage.
export const OTHER_LANGUAGES: LanguageOption[] = [
  { code: 'af', label: 'Afrikaans' },
  { code: 'sq', label: 'Albanian' },
  { code: 'am', label: 'Amharic' },
  { code: 'hy', label: 'Armenian' },
  { code: 'az', label: 'Azerbaijani' },
  { code: 'bn', label: 'Bengali' },
  { code: 'bs', label: 'Bosnian' },
  { code: 'bg', label: 'Bulgarian' },
  { code: 'my', label: 'Burmese' },
  { code: 'ca', label: 'Catalan' },
  { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'nl', label: 'Dutch' },
  { code: 'et', label: 'Estonian' },
  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },
  { code: 'ka', label: 'Georgian' },
  { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'ha', label: 'Hausa' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'is', label: 'Icelandic' },
  { code: 'ig', label: 'Igbo' },
  { code: 'id', label: 'Indonesian' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'jv', label: 'Javanese' },
  { code: 'kn', label: 'Kannada' },
  { code: 'kk', label: 'Kazakh' },
  { code: 'km', label: 'Khmer' },
  { code: 'rw', label: 'Kinyarwanda' },
  { code: 'ko', label: 'Korean' },
  { code: 'ku', label: 'Kurdish' },
  { code: 'ky', label: 'Kyrgyz' },
  { code: 'lo', label: 'Lao' },
  { code: 'lv', label: 'Latvian' },
  { code: 'lt', label: 'Lithuanian' },
  { code: 'mk', label: 'Macedonian' },
  { code: 'ms', label: 'Malay' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'mr', label: 'Marathi' },
  { code: 'mn', label: 'Mongolian' },
  { code: 'ne', label: 'Nepali' },
  { code: 'no', label: 'Norwegian' },
  { code: 'ps', label: 'Pashto' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ro', label: 'Romanian' },
  { code: 'ru', label: 'Russian' },
  { code: 'sr', label: 'Serbian' },
  { code: 'si', label: 'Sinhala' },
  { code: 'sk', label: 'Slovak' },
  { code: 'sl', label: 'Slovenian' },
  { code: 'so', label: 'Somali' },
  { code: 'es', label: 'Spanish' },
  { code: 'sw', label: 'Swahili' },
  { code: 'sv', label: 'Swedish' },
  { code: 'tl', label: 'Tagalog (Filipino)' },
  { code: 'tg', label: 'Tajik' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'tr', label: 'Turkish' },
  { code: 'tk', label: 'Turkmen' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'uz', label: 'Uzbek' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'zu', label: 'Zulu' },
];

// Every option, for reverse lookups (code → label), incl. the common list.
export const ALL_LANGUAGE_OPTIONS: LanguageOption[] = [
  ...COMMON_LANGUAGES,
  ...OTHER_LANGUAGES,
];

export function languageLabel(code: string): string {
  return ALL_LANGUAGE_OPTIONS.find((l) => l.code === code)?.label ?? code;
}

// Map the site locale ('en' | 'fa') to the pre-selected first-language code.
export function localeToLanguageCode(locale: string): string {
  return COMMON_LANGUAGES.some((l) => l.code === locale) ? locale : 'en';
}
