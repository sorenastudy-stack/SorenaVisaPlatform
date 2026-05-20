'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// PR-DASH-2 — Create-ticket form.
//
// react-hook-form + zod (project standard — same setup as the login
// page). Field constraints mirror the server DTO: subject 5-200,
// initialMessage 10-5000. Submitting POSTs to /students/me/tickets;
// on success we router.push() to the new ticket's detail page.
// 429 from the backend → toast with the rate-limit copy and a
// disabled submit until the user dismisses.

const DEPARTMENTS = [
  'ADMISSIONS',
  'VISA_APPLICATION',
  'DOCUMENTS',
  'PAYMENTS_FINANCE',
  'TECHNICAL_SUPPORT',
  'GENERAL_INQUIRY',
] as const;

const SUBJECT_MIN = 5;
const SUBJECT_MAX = 200;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 5000;

const buildSchema = (t: ReturnType<typeof useTranslations>) =>
  z.object({
    department: z.enum(DEPARTMENTS, {
      errorMap: () => ({ message: t('tickets.validation.departmentRequired') }),
    }),
    subject: z
      .string()
      .trim()
      .min(SUBJECT_MIN, { message: t('tickets.validation.subjectMin') })
      .max(SUBJECT_MAX, { message: t('tickets.validation.subjectMax') }),
    initialMessage: z
      .string()
      .trim()
      .min(MESSAGE_MIN, { message: t('tickets.validation.messageMin') })
      .max(MESSAGE_MAX, { message: t('tickets.validation.messageMax') }),
  });

type FormValues = {
  department: (typeof DEPARTMENTS)[number] | '';
  subject: string;
  initialMessage: string;
};

export function NewTicketForm() {
  const t = useTranslations();
  const router = useRouter();
  const schema = buildSchema(t);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema as never),
    defaultValues: { department: '', subject: '', initialMessage: '' },
  });

  const [rateLimited, setRateLimited] = useState(false);

  const watchedDepartment = watch('department');
  const watchedSubject = watch('subject') ?? '';
  const watchedMessage = watch('initialMessage') ?? '';

  const onSubmit = async (values: FormValues) => {
    setRateLimited(false);
    try {
      const res = await api.post<{ id: string }>('/students/me/tickets', values);
      router.push(`/student/tickets/${res.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('rateLimit')) {
        setRateLimited(true);
        toast.error(t('tickets.errors.rateLimitExceeded'));
      } else {
        toast.error(msg || t('tickets.errors.notFound'));
      }
    }
  };

  const inputClass = (hasError: boolean) =>
    [
      'w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-slate-400 focus:outline-none',
      hasError ? 'border-rose-400 focus:border-rose-500' : 'border-gray-200 focus:border-sorena-navy',
    ].join(' ');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-sorena-navy md:text-3xl">
        {t('tickets.new.title')}
      </h1>

      {/* Department */}
      <div>
        <label className="mb-1.5 block text-sm font-bold text-sorena-navy">
          {t('tickets.new.department.label')}
        </label>
        <select
          {...register('department')}
          className={inputClass(!!errors.department)}
        >
          <option value="">{t('tickets.new.department.placeholder')}</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {t(`tickets.department.${d}` as Parameters<typeof t>[0])}
            </option>
          ))}
        </select>
        {watchedDepartment && (
          <p className="mt-1.5 text-xs text-slate-500">
            {t(`tickets.department.description.${watchedDepartment}` as Parameters<typeof t>[0])}
          </p>
        )}
        {errors.department && (
          <p className="mt-1 text-xs text-rose-600">{errors.department.message}</p>
        )}
      </div>

      {/* Subject */}
      <div>
        <label className="mb-1.5 block text-sm font-bold text-sorena-navy">
          {t('tickets.new.subject.label')}
        </label>
        <input
          type="text"
          {...register('subject')}
          placeholder={t('tickets.new.subject.placeholder')}
          maxLength={SUBJECT_MAX + 50}
          className={inputClass(!!errors.subject)}
        />
        <div className="mt-1 flex items-center justify-between">
          <p className="text-xs text-rose-600">{errors.subject?.message ?? ' '}</p>
          <p className={`text-xs ${watchedSubject.length > SUBJECT_MAX ? 'text-rose-600' : 'text-slate-500'}`}>
            {watchedSubject.length} / {SUBJECT_MAX}
          </p>
        </div>
      </div>

      {/* Message */}
      <div>
        <label className="mb-1.5 block text-sm font-bold text-sorena-navy">
          {t('tickets.new.message.label')}
        </label>
        <textarea
          rows={8}
          {...register('initialMessage')}
          placeholder={t('tickets.new.message.placeholder')}
          className={`${inputClass(!!errors.initialMessage)} resize-y`}
        />
        <div className="mt-1 flex items-center justify-between">
          <p className="text-xs text-rose-600">{errors.initialMessage?.message ?? ' '}</p>
          <p className={`text-xs ${watchedMessage.length > MESSAGE_MAX ? 'text-rose-600' : 'text-slate-500'}`}>
            {watchedMessage.length} / {MESSAGE_MAX}
          </p>
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting || rateLimited}
        className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-sorena-gold px-6 text-base font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-gold focus-visible:ring-offset-2 md:w-auto"
      >
        {isSubmitting ? t('tickets.new.submitting') : t('tickets.new.submit')}
      </button>
    </form>
  );
}
