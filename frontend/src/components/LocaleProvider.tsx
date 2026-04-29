'use client';

import { useEffect } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { useLocaleStore } from '@/lib/stores/localeStore';
import enMessages from '@/i18n/messages/en.json';
import faMessages from '@/i18n/messages/fa.json';

const messages = {
  en: enMessages,
  fa: faMessages,
} as const;

export function LocaleProvider({ children }: { children: React.ReactNode }) {
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
