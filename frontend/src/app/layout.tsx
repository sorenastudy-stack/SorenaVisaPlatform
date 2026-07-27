import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { LocaleProvider } from '@/components/LocaleProvider';

export const metadata: Metadata = {
  title: 'Sorena Visa',
  description: 'Sorena Visa staff and student portal',
  icons: { icon: '/favicon.png' },
};

// PR-I18N-1 — resolve the locale on the SERVER from the NEXT_LOCALE cookie so the
// very first HTML already carries the right lang/dir (no LTR→RTL flash) and server
// components render in the chosen language. Mirrors i18n/request.ts.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieLocale = cookies().get('NEXT_LOCALE')?.value;
  const locale = cookieLocale === 'fa' ? 'fa' : 'en';
  const dir = locale === 'fa' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
