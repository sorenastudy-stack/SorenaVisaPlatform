import { z } from 'zod';

export const leadSchema = z
  .object({
    fullName: z
      .string()
      .min(2, 'Full name must be at least 2 characters.')
      .max(100, 'Full name is too long.'),
    email: z.string().email('Please enter a valid email address.').max(254).or(z.literal('')).optional(),
    phone: z.string().max(30).optional(),
    whatsapp: z.string().max(30).optional(),
    destination: z.literal('NZ').default('NZ'),
    studyLevel: z
      .enum(['secondary', 'undergraduate', 'postgraduate', 'vocational', 'phd', 'other'])
      .optional(),
    preferredLanguage: z
      .enum(['English', 'Persian', 'Mandarin', 'Arabic', 'Hindi', 'Other'])
      .optional(),
    privacyConsent: z.boolean().refine((v) => v === true, {
      message: 'You must accept the privacy policy to continue.',
    }),
    marketingConsent: z.boolean().optional(),
    website: z.string().max(0).optional(),
  })
  .refine(
    (data) =>
      (data.email && data.email.length > 0) ||
      (data.phone && data.phone.length > 0) ||
      (data.whatsapp && data.whatsapp.length > 0),
    {
      message: 'Please provide at least one contact method (email, phone, or WhatsApp).',
      path: ['email'],
    },
  );

export type LeadFormValues = z.infer<typeof leadSchema>;
