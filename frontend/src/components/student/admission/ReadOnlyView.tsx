'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle, X } from 'lucide-react';

export function ReadOnlyView({ applicationId }: { applicationId: string }) {
  const t = useTranslations();
  const storageKey = `admission_submitted_card_dismissed_${applicationId}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!localStorage.getItem(storageKey));
  }, [storageKey]);

  const dismiss = () => {
    localStorage.setItem(storageKey, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-sorena-gold/40 bg-sorena-gold/10 p-4">
      <CheckCircle className="mt-0.5 shrink-0 text-sorena-gold" size={20} />
      <div className="flex-1">
        <p className="text-sm font-semibold text-sorena-navy">
          {t('admissionSubmittedTitle')}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-sorena-navy/70">
          {t('admissionSubmittedBody')}
        </p>
        <p className="mt-3 text-sm font-medium text-sorena-navy/70">
          {t('admissionSubmittedSignoff')}
        </p>
      </div>
      <button onClick={dismiss} className="text-sorena-navy/40 hover:text-sorena-navy">
        <X size={16} />
      </button>
    </div>
  );
}
