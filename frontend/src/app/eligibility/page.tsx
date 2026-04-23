'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';

function ResultContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const score = searchParams.get('score') || 'MID';

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0a2342 0%,#0d4f6e 60%,#0a7a6e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '48px', width: '100%', maxWidth: 540, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0a2342', marginBottom: 8 }}>Assessment Complete</h1>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>Your eligibility score: <strong style={{ color: '#0d7a6e' }}>{score}</strong></p>
        <p style={{ color: '#374151', fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>
          Thank you for completing your assessment. A member of our team will review your profile and contact you within 24 hours with your personalised pathway recommendation.
        </p>
        <button onClick={() => router.push('/')} style={{ padding: '14px 32px', borderRadius: 8, background: '#0a2342', color: '#fff', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}>
          Back to Home
        </button>
      </div>
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ResultContent />
    </Suspense>
  );
}