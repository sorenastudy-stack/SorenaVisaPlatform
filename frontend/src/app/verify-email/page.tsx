'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { VerifyEmailResponse } from '@/types/acquisition';
import { Suspense } from 'react';

type VerifyStatus = 'verifying' | 'success' | 'already-verified' | 'error';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<VerifyStatus>('verifying');
  const [name, setName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setErrorMessage('No verification token provided.');
      setStatus('error');
      return;
    }

    api
      .get<VerifyEmailResponse>(`/acquisition/verify-email?token=${encodeURIComponent(token)}`)
      .then((res) => {
        setName(res.name || '');
        setStatus(res.alreadyVerified ? 'already-verified' : 'success');
      })
      .catch((err) => {
        setErrorMessage(
          err instanceof ApiError ? err.message : 'Verification failed. Please try again.',
        );
        setStatus('error');
      });
  }, [token]);

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0a2342 0%, #0d4f6e 60%, #0a7a6e 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    padding: '24px',
  };

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: '16px',
    padding: '56px 48px',
    maxWidth: '480px',
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
  };

  if (status === 'verifying') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>⏳</div>
          <h2 style={{ color: '#0a2342', fontWeight: 800, fontSize: '1.5rem', margin: '0 0 12px' }}>
            Verifying your email...
          </h2>
          <p style={{ color: '#5a6a7a', lineHeight: 1.6 }}>Please wait a moment.</p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>✅</div>
          <h2 style={{ color: '#0a2342', fontWeight: 800, fontSize: '1.5rem', margin: '0 0 12px' }}>
            Email Verified!
          </h2>
          <p style={{ color: '#5a6a7a', lineHeight: 1.6, marginBottom: '28px' }}>
            {name ? `Thank you, ${name}! ` : ''}Your email has been verified successfully. Our team will be in touch with you shortly.
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              background: '#0d7a6e',
              color: '#fff',
              padding: '14px 32px',
              borderRadius: '8px',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Back to Home
          </a>
        </div>
      </div>
    );
  }

  if (status === 'already-verified') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>ℹ️</div>
          <h2 style={{ color: '#0a2342', fontWeight: 800, fontSize: '1.5rem', margin: '0 0 12px' }}>
            Already Verified
          </h2>
          <p style={{ color: '#5a6a7a', lineHeight: 1.6, marginBottom: '28px' }}>
            Your email has already been verified. No further action is needed.
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              background: '#0d7a6e',
              color: '#fff',
              padding: '14px 32px',
              borderRadius: '8px',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Back to Home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>❌</div>
        <h2 style={{ color: '#0a2342', fontWeight: 800, fontSize: '1.5rem', margin: '0 0 12px' }}>
          Verification Failed
        </h2>
        <p style={{ color: '#5a6a7a', lineHeight: 1.6, marginBottom: '28px' }}>{errorMessage}</p>
        <a
          href="/#contact"
          style={{
            display: 'inline-block',
            background: '#0d7a6e',
            color: '#fff',
            padding: '14px 32px',
            borderRadius: '8px',
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Submit New Enquiry
        </a>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#0a2342', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#fff' }}>Loading...</p>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
