'use client';

import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';

// PR-CONSULT-2 — Generic "Coming soon" placeholder.
//
// Used by every staff section that hasn't been built yet (Overview,
// Meetings, Tickets, Users, Approvals) and by the Documents /
// Meetings / Tickets tabs on the case detail. The optional `section`
// prop displays a contextual label so the user knows which section
// they're looking at — falls back to the generic body text.

export function PlaceholderPanel({ section }: { section?: string }) {
  const t = useTranslations();
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
      <div className="text-center max-w-sm">
        <div className="mx-auto mb-5 w-14 h-14 rounded-full bg-[#1e3a5f]/10 flex items-center justify-center">
          <Clock size={28} className="text-[#1e3a5f]" />
        </div>
        <h2 className="text-lg font-bold text-[#1e3a5f] mb-2">
          {t('staff.comingSoon.title')}
          {section ? ` — ${section}` : ''}
        </h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          {t('staff.comingSoon.body')}
        </p>
      </div>
    </div>
  );
}
