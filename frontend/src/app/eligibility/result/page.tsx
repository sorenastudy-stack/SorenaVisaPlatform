'use client';
import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

const ROUTE_LABELS: Record<string, string> = {
  ADMISSION_CONSULTATION: 'Admission Consultation',
  CONTENT_NURTURE: 'Free Resources & Guidance',
  WEBINAR: 'Attend Our Webinar',
  ROADMAP: 'Personalised Roadmap',
  SPECIALIST_CONSULTATION: 'Specialist Consultation',
  LIA_CONSULTATION: 'Licensed Immigration Adviser Consultation',
  EXECUTION_QUEUE: 'You Are Ready to Apply',
};

function ResultContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const score = (searchParams.get('score') || '').toUpperCase();
  const readiness = searchParams.get('readiness');
  const route = (searchParams.get('route') || '').toUpperCase();
  const risk = (searchParams.get('risk') || '').toUpperCase();

  const getContent = () => {
    if (score === 'HIGH') return {
      emoji: '🎉',
      headline: 'You Have Strong Eligibility',
      message: 'Your profile shows excellent potential. Our team will personally review your assessment and contact you within 24 hours with a tailored recommendation.',
      color: '#065f46',
      bg: '#ecfdf5',
      badge: { text: 'Strong Profile', bg: '#d1fae5', color: '#065f46' },
    };
    if (score === 'LOW') return {
      emoji: '📋',
      headline: 'Your Pathway Needs Some Preparation',
      message: 'There are some areas we can help you strengthen. Our specialist will contact you within 24 hours to discuss a preparation plan.',
      color: '#92400e',
      bg: '#fffbeb',
      badge: { text: 'Preparation Needed', bg: '#fef3c7', color: '#92400e' },
    };
    return {
      emoji: '✅',
      headline: 'You Have Good Potential',
      message: 'Your profile shows real promise. Our specialist will contact you within 24 hours to walk you through your personalised pathway.',
      color: '#1e3a5f',
      bg: '#eff6ff',
      badge: { text: 'Good Potential', bg: '#dbeafe', color: '#1e3a5f' },
    };
  };

  const c = getContent();
  const readinessNum = readiness !== null && readiness !== '' ? Number(readiness) : null;
  const routeLabel = ROUTE_LABELS[route] || route;

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0a2342 0%,#0d4f6e 60%,#0a7a6e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '48px', width: '100%', maxWidth: 600, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>{c.emoji}</div>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: c.color, marginBottom: 16 }}>{c.headline}</h1>
        <p style={{ color: '#374151', fontSize: 15, lineHeight: 1.7, marginBottom: 28 }}>{c.message}</p>

        {/* Score summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: readinessNum !== null ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 28 }}>
          {readinessNum !== null && (
            <div style={{ background: c.bg, borderRadius: 10, padding: '16px 20px', textAlign: 'left' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Readiness Score</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 32, fontWeight: 800, color: c.color }}>{readinessNum}</span>
                <span style={{ fontSize: 16, color: '#9ca3af' }}>/100</span>
              </div>
              <div style={{ marginTop: 8, background: '#e5e7eb', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{ width: `${readinessNum}%`, background: c.color, height: '100%', borderRadius: 4, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          )}
          {routeLabel && (
            <div style={{ background: c.bg, borderRadius: 10, padding: '16px 20px', textAlign: 'left' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Recommended Next Step</p>
              <p style={{ fontSize: 15, fontWeight: 700, color: c.color, lineHeight: 1.4 }}>{routeLabel}</p>
            </div>
          )}
        </div>

        {/* What happens next */}
        <div style={{ background: c.bg, borderRadius: 10, padding: '20px 24px', marginBottom: 32, textAlign: 'left' }}>
          <p style={{ fontWeight: 700, color: '#0a2342', marginBottom: 8, fontSize: 14 }}>What happens next:</p>
          <ul style={{ margin: 0, padding: '0 0 0 18px', color: '#374151', fontSize: 14, lineHeight: 2 }}>
            <li>Our team reviews your full assessment</li>
            <li>You receive a personalised pathway email</li>
            <li>A specialist contacts you within 24 hours</li>
            <li>We discuss your study and visa options</li>
          </ul>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => router.push('/eligibility')} style={{ padding: '14px 32px', borderRadius: 8, background: '#0d7a6e', color: '#fff', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}>Start New Assessment</button>
          <button onClick={() => router.push('/')} style={{ padding: '14px 32px', borderRadius: 8, background: '#0a2342', color: '#fff', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}>Back to Home</button>
        </div>
      </div>
    </div>
  );
}

export default function ResultPage() {
  return <Suspense fallback={<div>Loading...</div>}><ResultContent /></Suspense>;
}
