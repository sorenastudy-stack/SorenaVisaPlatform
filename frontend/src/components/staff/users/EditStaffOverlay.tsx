'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { CountryPicker } from '@/components/common/CountryPicker';
import type { StaffUserDetail } from './types';

// PR-CONSULT-4 — Edit staff profile overlay.
//
// Both OWNER and SUPER_ADMIN execute inline — backend treats edits
// as non-destructive. Role rotation still goes via the existing
// Change-role overlay (separate endpoint, separate approval flow).
//
// Pre-populates from the detail snapshot. First/last name are
// split client-side on the first whitespace so the form stays
// consistent with Create; on submit they're joined back into a
// single `name`.

const PHONE_REGEX = /^[+0-9 ()\-]{5,32}$/;

const schema = z.object({
  firstName:          z.string().trim().min(1).max(80),
  lastName:           z.string().trim().max(80),
  email:              z.string().trim().email().min(5).max(255),
  mobileNumber:       z.string().trim().min(5).max(32).regex(PHONE_REGEX, 'Use digits, spaces, +, -, parens (5-32 chars)').optional().or(z.literal('')),
  countryOfResidence: z.string().regex(/^[A-Z]{2}$/).optional().or(z.literal('')),
  address:            z.string().max(500).optional().or(z.literal('')),
  emergencyContact:   z.string().max(200).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function EditStaffOverlay({
  detail,
  open,
  onClose,
  onDone,
}: {
  detail:  StaffUserDetail;
  open:    boolean;
  onClose: () => void;
  onDone:  () => void;
}) {
  const t = useTranslations();
  const [submitting, setSubmitting] = useState(false);

  const initial = splitName(detail.name);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName:          initial.firstName,
      lastName:           initial.lastName,
      email:              detail.email,
      mobileNumber:       detail.mobileNumber ?? '',
      countryOfResidence: detail.countryOfResidence ?? '',
      address:            detail.address ?? '',
      emergencyContact:   detail.emergencyContact ?? '',
    },
  });

  if (!open) return null;

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const name = `${values.firstName.trim()} ${values.lastName.trim()}`.trim();
      const patch: Record<string, string | undefined> = {};
      if (name !== detail.name) patch.name = name;
      if (values.email.toLowerCase().trim() !== detail.email) {
        patch.email = values.email.toLowerCase().trim();
      }
      if ((values.mobileNumber || '').trim() !== (detail.mobileNumber ?? '')) {
        patch.mobileNumber = values.mobileNumber?.trim() || '';
      }
      if ((values.countryOfResidence || '') !== (detail.countryOfResidence ?? '')) {
        patch.countryOfResidence = values.countryOfResidence || '';
      }
      if ((values.address || '') !== (detail.address ?? '')) {
        patch.address = values.address || '';
      }
      if ((values.emergencyContact || '') !== (detail.emergencyContact ?? '')) {
        patch.emergencyContact = values.emergencyContact || '';
      }

      await api.patch(`/api/staff/users/${detail.id}`, patch);
      toast.success(t('staff.users.editProfile.saved'));
      onDone();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update';
      if (/email/i.test(msg)) {
        setError('email', { message: msg });
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => (submitting ? null : onClose())}
      />
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-bold text-[#1e3a5f]">{t('staff.users.editProfile.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              {t('staff.users.form.firstName')}
            </label>
            <input
              type="text"
              {...register('firstName')}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
            />
            {errors.firstName && <p className="mt-1 text-xs text-rose-600">{errors.firstName.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              {t('staff.users.form.lastName')}
            </label>
            <input
              type="text"
              {...register('lastName')}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
            />
            {errors.lastName && <p className="mt-1 text-xs text-rose-600">{errors.lastName.message}</p>}
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            {t('staff.users.form.email')}
          </label>
          <input
            type="email"
            autoComplete="off"
            {...register('email')}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
          />
          {errors.email && <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              {t('staff.users.form.mobile')}
            </label>
            <input
              type="tel"
              {...register('mobileNumber')}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
            />
            {errors.mobileNumber && <p className="mt-1 text-xs text-rose-600">{errors.mobileNumber.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              {t('staff.users.form.country')}
            </label>
            <Controller
              control={control}
              name="countryOfResidence"
              render={({ field }) => (
                <CountryPicker value={field.value ?? ''} onChange={field.onChange} />
              )}
            />
            {errors.countryOfResidence && <p className="mt-1 text-xs text-rose-600">{errors.countryOfResidence.message}</p>}
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            {t('staff.users.form.address')}
          </label>
          <textarea
            rows={2}
            maxLength={500}
            {...register('address')}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
          />
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            {t('staff.users.form.emergencyContact')}
          </label>
          <input
            type="text"
            maxLength={200}
            {...register('emergencyContact')}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-[#1e3a5f] text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#162d4a] transition-colors min-h-[48px]"
        >
          {submitting ? '…' : t('staff.users.editProfile.submit')}
        </button>
      </form>
    </div>
  );
}
