import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sorena Visa | Education & Migration New Zealand',
  description:
    'Expert education and migration services for New Zealand. Student visas, skilled migrant visas, work visas and family sponsorship.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
