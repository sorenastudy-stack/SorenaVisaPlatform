'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { api } from '@/lib/api';

// PR-DASH-3 — Create / edit overlay.
//
// Inline modal (no shadcn Dialog primitive — same pattern PR-DASH-2
// uses). react-hook-form + zod for validation. Server enforces the
// same rules; this keeps a snappy UX.

const TYPES = ['CONSULTATION', 'FOLLOW_UP', 'DOCUMENT_REVIEW', 'ASSESSMENT'] as const;

const schema = z.object({
  studentId:       z.string().min(1, 'studentId is required'),
  scheduledAt:     z.string().min(1, 'scheduledAt is required'),
  durationMinutes: z.coerce.number().int().min(5).max(240),
  meetingType:     z.enum(TYPES),
  locationOrLink:  z.string().max(2000).optional().or(z.literal('')),
  agenda:          z.string().max(5000).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export interface MeetingFormInitial {
  id: string;
  studentId: string;
  scheduledAt: string;
  durationMinutes: number;
  meetingType: string;
  locationOrLink: string | null;
  agenda: string | null;
}

interface CreateProps {
  mode: 'create';
  onClose: () => void;
  onSaved: () => void;
}
interface EditProps {
  mode: 'edit';
  initial: MeetingFormInitial;
  onClose: () => void;
  onSaved: () => void;
}
type Props = CreateProps | EditProps;

// `datetime-local` input wants "YYYY-MM-DDThh:mm" — strip the
// timezone suffix from the server's ISO string.
function isoToLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

export function MeetingFormOverlay(props: Props) {
  const t = useTranslations();
  const isEdit = props.mode === 'edit';
  const initial = isEdit ? props.initial : null;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial
      ? {
          studentId:       initial.studentId,
          scheduledAt:     isoToLocalInput(initial.scheduledAt),
          durationMinutes: initial.durationMinutes,
          meetingType:     initial.meetingType as (typeof TYPES)[number],
          locationOrLink:  initial.locationOrLink ?? '',
          agenda:          initial.agenda ?? '',
        }
      : {
          studentId:       '',
          scheduledAt:     '',
          durationMinutes: 30,
          meetingType:     'CONSULTATION',
          locationOrLink:  '',
          agenda:          '',
        },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const onSubmit = async (values: FormValues) => {
    try {
      // Convert local datetime back to an ISO string the backend
      // accepts (treat the input as local time; the browser's Date
      // serializes it to the right ISO).
      const scheduledAt = new Date(values.scheduledAt).toISOString();
      const payload = {
        ...values,
        scheduledAt,
        locationOrLink: values.locationOrLink === '' ? undefined : values.locationOrLink,
        agenda:         values.agenda === '' ? undefined : values.agenda,
      };
      if (isEdit && initial) {
        // PATCH doesn't accept studentId — drop it.
        const { studentId, ...patchBody } = payload;
        void studentId;
        await api.patch(`/api/consultant/meetings/${initial.id}`, patchBody);
      } else {
        await api.post('/api/consultant/meetings', payload);
      }
      props.onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg);
    }
  };

  const labelKey = isEdit ? 'meetings.consultant.edit' : 'meetings.consultant.create';

  const input =
    'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-sorena-navy focus:border-sorena-navy focus:outline-none';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={props.onClose}
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1 text-slate-500 hover:bg-slate-100"
        >
          <X size={18} />
        </button>

        <h2 className="text-lg font-bold text-sorena-navy">
          {t(labelKey as Parameters<typeof t>[0])}
        </h2>

        <div className="mt-4 flex flex-col gap-3">
          {!isEdit && (
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                Student ID
              </label>
              <input {...register('studentId')} className={input} />
              {errors.studentId && (
                <p className="mt-1 text-xs text-rose-600">{errors.studentId.message}</p>
              )}
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
              Scheduled at
            </label>
            <input
              type="datetime-local"
              {...register('scheduledAt')}
              className={input}
            />
            {errors.scheduledAt && (
              <p className="mt-1 text-xs text-rose-600">{errors.scheduledAt.message}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                Duration (min)
              </label>
              <input
                type="number"
                min={5}
                max={240}
                {...register('durationMinutes', { valueAsNumber: true })}
                className={input}
              />
              {errors.durationMinutes && (
                <p className="mt-1 text-xs text-rose-600">{errors.durationMinutes.message}</p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
                Type
              </label>
              <select {...register('meetingType')} className={input}>
                <option value="CONSULTATION">{t('meetings.type.consultation')}</option>
                <option value="FOLLOW_UP">{t('meetings.type.followUp')}</option>
                <option value="DOCUMENT_REVIEW">{t('meetings.type.documentReview')}</option>
                <option value="ASSESSMENT">{t('meetings.type.assessment')}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
              Location / link
            </label>
            <input {...register('locationOrLink')} placeholder="https://..." className={input} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">
              Agenda
            </label>
            <textarea rows={4} {...register('agenda')} className={`${input} resize-y`} />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            disabled={isSubmitting}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-sorena-navy px-6 text-base font-semibold text-white hover:brightness-110 disabled:opacity-40"
          >
            {isSubmitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
