import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import enMessages from './messages/en.json';
import faMessages from './messages/fa.json';

// Server-side i18n config for next-intl v4.
//
// Required by `getTranslations()` and any other `next-intl/server` API.
// The plugin in next.config.js (`createNextIntlPlugin()`) points Next.js
// here at build time. Without this file, server components calling
// getTranslations() throw at request time — which is exactly the bug
// the LEAD sign-in surfaced from /portal/case/page.tsx.
//
// Locale resolution mirrors the client-side LocaleProvider:
//   • The active locale on the client lives in a Zustand store
//     (frontend/src/lib/stores/localeStore.ts) that defaults to 'en'
//     and isn't persisted to a cookie today.
//   • To stay aligned with the client's first render (and avoid React
//     hydration mismatches), we default to 'en' here too.
//   • We DO honour a `NEXT_LOCALE` cookie if present — that's the
//     conventional next-intl key. The client doesn't write it yet, so
//     this is forward-compatible: a future LocaleProvider update that
//     persists the user's choice to that cookie will automatically
//     make server-rendered pages render in their language too.

const MESSAGES = {
  en: enMessages,
  fa: faMessages,
} as const;

type SupportedLocale = keyof typeof MESSAGES;

const DEFAULT_LOCALE: SupportedLocale = 'en';

function isSupported(value: unknown): value is SupportedLocale {
  return value === 'en' || value === 'fa';
}

function resolveLocale(): SupportedLocale {
  const cookieValue = cookies().get('NEXT_LOCALE')?.value;
  return isSupported(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}

export default getRequestConfig(async ({ requestLocale }) => {
  // Robustness contract: this MUST always return a supported `locale`
  // whose `messages` object is defined. If next-intl ever hands us a
  // missing/unknown locale (no i18n routing today, so requestLocale is
  // normally undefined) and we returned `messages: undefined`,
  // getTranslations() faults at request time — which, with no /portal
  // error boundary, previously surfaced as a silent hang on the Google
  // sign-in redirect. So we resolve defensively and fall back to
  // English for both the locale AND the messages.
  let locale: SupportedLocale = DEFAULT_LOCALE;
  try {
    const fromRequest = await requestLocale; // next-intl v4 (Promise)
    locale = isSupported(fromRequest) ? fromRequest : resolveLocale();
  } catch {
    locale = DEFAULT_LOCALE;
  }

  return {
    locale,
    messages: MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE],
    // A global default timeZone keeps server- and client-rendered dates
    // identical (no hydration markup mismatch) and silences next-intl's
    // ENVIRONMENT_FALLBACK warning. UTC is the safe, deterministic
    // default until per-user time zones are introduced.
    timeZone: 'UTC',
  };
});
