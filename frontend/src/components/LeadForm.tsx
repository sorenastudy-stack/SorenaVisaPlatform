'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useEffect } from 'react';
import { leadSchema, LeadFormValues } from '@/lib/schemas/lead.schema';
import { api, ApiError } from '@/lib/api';
import { LeadResponse } from '@/types/acquisition';

type FormStatus = 'idle' | 'submitting' | 'success-email' | 'success' | 'error';

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '8px',
  padding: '14px 18px',
  color: '#fff',
  fontSize: '0.95rem',
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'border-color 0.2s',
};

const inputErrorStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: '#f87171',
};

export default function LeadForm() {
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [visitorId, setVisitorId] = useState<string>('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: { destination: 'NZ', privacyConsent: false, marketingConsent: false },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    api
      .post<{ id: string }>('/acquisition/visitors', {
        country: 'NZ',
        referrer: document.referrer || undefined,
        utmSource: params.get('utm_source') || undefined,
        utmMedium: params.get('utm_medium') || undefined,
        utmCampaign: params.get('utm_campaign') || undefined,
      })
      .then((v) => setVisitorId(v.id))
      .catch(() => {});
  }, []);

  const onSubmit = async (values: LeadFormValues) => {
    setStatus('submitting');
    setErrorMessage('');

    try {
      const res = await api.post<LeadResponse>('/acquisition/leads', {
        ...values,
        email: values.email || undefined,
        phone: values.phone || undefined,
        whatsapp: values.whatsapp || undefined,
        visitorId: visitorId || undefined,
        landingPage: window.location.pathname,
        referrer: document.referrer || undefined,
      });

      setStatus(res.emailVerificationRequired ? 'success-email' : 'success');
    } catch (err) {
      setErrorMessage(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
      );
      setStatus('error');
    }
  };

  if (status === 'success-email') {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0' }}>
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✉️</div>
        <h3 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 800, margin: '0 0 12px' }}>
          Check Your Email
        </h3>
        <p style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1.7, maxWidth: '400px', margin: '0 auto 12px' }}>
          We sent a verification link to your email address. Please click it to confirm your enquiry.
        </p>
        <p style={{ color: '#12a693', fontSize: '0.85rem' }}>The link expires in 24 hours.</p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0' }}>
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🎉</div>
        <h3 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 800, margin: '0 0 12px' }}>
          Thank You!
        </h3>
        <p style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1.7, maxWidth: '400px', margin: '0 auto' }}>
          Your enquiry has been received. Our team will be in touch with you shortly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Honeypot — hidden from real users, filled by bots */}
      <div style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }} aria-hidden="true">
        <input {...register('website')} type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {/* Full Name */}
      <div>
        <input
          {...register('fullName')}
          type="text"
          placeholder="Full Name *"
          autoComplete="name"
          style={errors.fullName ? inputErrorStyle : inputStyle}
        />
        {errors.fullName && <p style={{ color: '#f87171', fontSize: '0.78rem', marginTop: '4px' }}>{errors.fullName.message}</p>}
      </div>

      {/* Email */}
      <div>
        <input
          {...register('email')}
          type="email"
          placeholder="Email Address"
          autoComplete="email"
          style={errors.email ? inputErrorStyle : inputStyle}
        />
        {errors.email && <p style={{ color: '#f87171', fontSize: '0.78rem', marginTop: '4px' }}>{errors.email.message}</p>}
      </div>

      {/* Phone + WhatsApp */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div>
          <input
            {...register('phone')}
            type="tel"
            placeholder="Phone"
            autoComplete="tel"
            style={inputStyle}
          />
        </div>
        <div>
          <input
            {...register('whatsapp')}
            type="tel"
            placeholder="WhatsApp"
            style={inputStyle}
          />
        </div>
      </div>

      {/* Hidden destination */}
      <input {...register('destination')} type="hidden" value="NZ" />

      {/* Study Level */}
      <select {...register('studyLevel')} style={inputStyle}>
        <option value="">Study Level (optional)</option>
        <option value="secondary">Secondary / High School</option>
        <option value="undergraduate">Undergraduate Degree</option>
        <option value="postgraduate">Postgraduate / Masters</option>
        <option value="phd">PhD / Doctorate</option>
        <option value="vocational">Vocational / Trade</option>
        <option value="other">Other</option>
      </select>

      {/* Preferred Language */}
      <select {...register('preferredLanguage')} style={inputStyle}>
        <option value="">Preferred Language (optional)</option>
        <option value="English">English</option>
        <option value="Persian">Persian / Farsi</option>
        <option value="Mandarin">Mandarin</option>
        <option value="Arabic">Arabic</option>
        <option value="Hindi">Hindi</option>
        <option value="Other">Other</option>
      </select>

      {/* Privacy Consent */}
      <div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
          <input
            {...register('privacyConsent')}
            type="checkbox"
            style={{ marginTop: '3px', accentColor: '#0d7a6e', flexShrink: 0 }}
          />
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', lineHeight: 1.6 }}>
            I agree to the{' '}
            <a href="/privacy" target="_blank" style={{ color: '#12a693' }}>Privacy Policy</a>
            {' '}and consent to Sorena Visa collecting my personal information. *
          </span>
        </label>
        {errors.privacyConsent && (
          <p style={{ color: '#f87171', fontSize: '0.78rem', marginTop: '4px' }}>{errors.privacyConsent.message}</p>
        )}
      </div>

      {/* Marketing Consent */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
        <input
          {...register('marketingConsent')}
          type="checkbox"
          style={{ marginTop: '3px', accentColor: '#0d7a6e', flexShrink: 0 }}
        />
        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.82rem', lineHeight: 1.6 }}>
          I&apos;d like to receive updates and news from Sorena Visa (optional).
        </span>
      </label>

      {/* Error */}
      {status === 'error' && (
        <div style={{ background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: '8px', padding: '12px 16px' }}>
          <p style={{ color: '#fca5a5', fontSize: '0.88rem', margin: 0 }}>{errorMessage}</p>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={status === 'submitting'}
        style={{
          background: status === 'submitting' ? '#0d7a6e99' : '#0d7a6e',
          color: '#fff',
          border: 'none',
          padding: '16px',
          borderRadius: '8px',
          fontFamily: 'inherit',
          fontSize: '1rem',
          fontWeight: 700,
          cursor: status === 'submitting' ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s',
          marginTop: '4px',
        }}
      >
        {status === 'submitting' ? 'Sending...' : 'Send Enquiry →'}
      </button>
    </form>
  );
}
