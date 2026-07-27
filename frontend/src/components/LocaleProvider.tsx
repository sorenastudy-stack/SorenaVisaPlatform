'use client';

import { useEffect, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { useLocaleStore } from '@/lib/stores/localeStore';
import enMessages from '@/i18n/messages/en.json';
import faMessages from '@/i18n/messages/fa.json';

const messages = {
  en: enMessages,
  fa: faMessages,
} as const;

type Locale = keyof typeof messages;

// PR-I18N-1 — locale is server-authoritative. The root layout reads the
// NEXT_LOCALE cookie and passes it here as `initialLocale`; we seed the shared
// store from it exactly once (synchronously, via the useState initializer) so the
// server render and the first client render agree — no LTR→RTL hydration flash.
// After that the store drives everything; the toggle writes the cookie + router
// .refresh()es so server components re-render in the new language too.
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale?: Locale;
  children: React.ReactNode;
}) {
  // Seed once. Guards against clobbering a user toggle on later re-renders.
  useState(() => {
    if (initialLocale) useLocaleStore.setState({ locale: initialLocale });
  });

  const locale = useLocaleStore((s) => s.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
  }, [locale]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {children}
    </NextIntlClientProvider>
  );
}
