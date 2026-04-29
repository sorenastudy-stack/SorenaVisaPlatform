import type { Metadata } from 'next';
import './globals.css';
import { LocaleProvider } from '@/components/LocaleProvider';

export const metadata: Metadata = {
  title: 'Sorena Visa | Education & Migration New Zealand',
  description:
    'Expert education and migration services for New Zealand. Student visas, skilled migrant visas, work visas and family sponsorship.',
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
