import type { Metadata } from 'next';
import './globals.css';
import { LocaleProvider } from '@/components/LocaleProvider';

export const metadata: Metadata = {
  title: 'Sorena Visa',
  description: 'Sorena Visa staff and student portal',
  icons: { icon: '/favicon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
