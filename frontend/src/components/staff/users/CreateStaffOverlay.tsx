'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { useRoleLabel } from '@/lib/role-label';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ASSIGNABLE_ROLES, isExecutedWithPassword, isPendingApproval, type ActionResult } from './types';
import { TempPasswordModal } from './TempPasswordModal';
import { notifySentForApproval } from './notify';
import { CountryPicker } from '@/components/common/CountryPicker';

// PR-CONSULT-3 — Create staff overlay.
// PR-CONSULT-4 — extended with mobileNumber + countryOfResidence
// (both required) + address + emergencyContact (both optional).
//
// react-hook-form + zod. First-name + last-name are kept as two
// inputs (the onboarding spec specifically wants both visible);
// they're concatenated into the `fullName` field the backend DTO
// accepts. The role dropdown excludes OWNER and STUDENT — see
// `ASSIGNABLE_ROLES`. PR-CONSULT-4 also excludes the deprecated
// SALES role (already absent from ASSIGNABLE_ROLES).
//
// Response handling is two-path:
//   - OWNER inline → response carries tempPassword → open the
//     TempPasswordModal, refresh on close.
//   - SUPER_ADMIN  → response has PENDING_OWNER_APPROVAL → close
//     this overlay, fire the "Sent for owner approval" toast.

const PHONE_REGEX = /^[+0-9 ()\-]{5,32}$/;

const schema = z.object({
  firstName:          z.string().trim().min(1).max(80),
  lastName:           z.string().trim().min(1).max(80),
  email:              z.string().trim().email().min(5).max(255),
  role:               z.enum(ASSIGNABLE_ROLES as unknown as [string, ...string[]]),
  mobileNumber:       z.string().trim().min(5).max(32).regex(PHONE_REGEX, 'Use digits, spaces, +, -, parens (5-32 chars)'),
  countryOfResidence: z.string().regex(/^[A-Z]{2}$/, 'Pick a country'),
  address:            z.string().max(500).optional().or(z.literal('')),
  emergencyContact:   z.string().max(200).optional().or(z.literal('')),
  locale:             z.enum(['en', 'fa']).optional(),
});

type FormValues = z.infer<typeof schema>;

export function CreateStaffOverlay({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone:  () => void;
}) {
  const t = useTranslations();
  const roleLabel = useRoleLabel();
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { locale: 'en', countryOfResidence: '' },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      const fullName = `${values.firstName} ${values.lastName}`.trim();
      const result = await api.post<ActionResult>('/api/staff/users', {
        email:              values.email.toLowerCase().trim(),
        fullName,
        role:               values.role,
        mobileNumber:       values.mobileNumber.trim(),
        countryOfResidence: values.countryOfResidence,
        address:            values.address?.trim() || undefined,
        emergencyContact:   values.emergencyContact?.trim() || undefined,
      });
      if (isPendingApproval(result)) {
        notifySentForApproval(t('staff.users.sentForApproval'), t('staff.users.sentForApprovalLink'));
        onDone();
        onClose();
        return;
      }
      if (isExecutedWithPassword(result)) {
        setTempPassword(result.tempPassword);
        return;
      }
      toast.success('Staff user created');
      onDone();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create staff';
      if (/email/i.test(msg)) {
        setError('email', { message: msg });
      } else {
        toast.error(msg);
      }
    }
  };

  if (tempPassword) {
    return (
      <TempPasswordModal
        password={tempPassword}
        onDone={() => {
          setTempPassword(null);
          onDone();
          onClose();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => (isSubmitting ? null : onClose())}
      />
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-bold text-[#1e3a5f]">{t('staff.users.create')}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
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
              {t('staff.users.form.role')}
            </label>
            <select
              {...register('role')}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
              defaultValue=""
            >
              <option value="" disabled>—</option>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
            {errors.role && <p className="mt-1 text-xs text-rose-600">{errors.role.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              {t('staff.users.form.locale')}
            </label>
            <select
              {...register('locale')}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 min-h-[48px]"
            >
              <option value="en">English</option>
              <option value="fa">فارسی</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              {t('staff.users.form.mobile')}
            </label>
            <input
              type="tel"
              autoComplete="off"
              placeholder="+64 21 …"
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
          {errors.address && <p className="mt-1 text-xs text-rose-600">{errors.address.message}</p>}
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
          {errors.emergencyContact && <p className="mt-1 text-xs text-rose-600">{errors.emergencyContact.message}</p>}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-[#1e3a5f] text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#162d4a] transition-colors min-h-[48px]"
        >
          {isSubmitting ? '…' : t('staff.users.form.submit')}
        </button>
      </form>
    </div>
  );
}
