'use client';

import { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAdmission } from '../AdmissionFormContext';

const ACCOMMODATION_OPTIONS = [
  { value: 'HOMESTAY',       key: 'admissionStep6AccommodationOptionHomestay'      },
  { value: 'RESIDENTIAL',    key: 'admissionStep6AccommodationOptionResidential'   },
  { value: 'PRIVATE_RENTAL', key: 'admissionStep6AccommodationOptionPrivateRental' },
  { value: 'WITH_FAMILY',    key: 'admissionStep6AccommodationOptionWithFamily'    },
  { value: 'OTHER',          key: 'admissionStep6AccommodationOptionOther'         },
] as const;

export function Step6Accommodation() {
  const t = useTranslations();
  const { step6Fields, setStep6Fields, patchApplication, registerStepHandler } = useAdmission();
  const { accommodationType } = step6Fields;

  const handler = useCallback(async (): Promise<boolean> => {
    if (!accommodationType?.trim()) {
      toast.error(t('admissionStep6ValidationAccommodation'));
      return false;
    }
    try {
      await patchApplication({ accommodationType });
      return true;
    } catch {
      return false;
    }
  }, [accommodationType, patchApplication, t]);

  useEffect(() => {
    registerStepHandler(handler);
    return () => registerStepHandler(null);
  }, [handler, registerStepHandler]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-sorena-navy">{t('admissionStep6Title')}</h2>
        <p className="mt-1 text-sm text-sorena-navy/60">{t('admissionStep6Helper')}</p>
      </div>

      {/* accommodationType */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep6AccommodationLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <select
          value={accommodationType ?? ''}
          onChange={(e) => setStep6Fields({ accommodationType: e.target.value || null })}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy/60 focus:outline-none"
        >
          <option value="" disabled>{t('admissionStep6AccommodationPlaceholder')}</option>
          {ACCOMMODATION_OPTIONS.map(({ value, key }) => (
            <option key={value} value={value}>{t(key)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
