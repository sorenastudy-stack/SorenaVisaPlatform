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

function resolveLocale(): SupportedLocale {
  const cookieValue = cookies().get('NEXT_LOCALE')?.value;
  if (cookieValue === 'en' || cookieValue === 'fa') return cookieValue;
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = resolveLocale();
  return {
    locale,
    messages: MESSAGES[locale],
  };
});
