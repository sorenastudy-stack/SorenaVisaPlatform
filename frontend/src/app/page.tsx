'use client';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg,#0a2342 0%,#0d4f6e 60%,#0a7a6e 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px'
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        padding: '48px',
        width: '100%',
        maxWidth: 620,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        textAlign: 'center'
      }}>
        <h1 style={{
          fontSize: '2.5rem',
          fontWeight: 800,
          color: '#0a2342',
          marginBottom: 16
        }}>
          Sorena Visa Platform
        </h1>
        <p style={{
          fontSize: '1.1rem',
          color: '#5a6a7a',
          marginBottom: 32
        }}>
          Global education and migration support
        </p>
        <button
          onClick={() => router.push('/eligibility')}
          style={{
            padding: '14px 40px',
            background: '#0d7a6e',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '1rem',
            cursor: 'pointer'
          }}
        >
          Check Your Eligibility
        </button>
      </div>
    </div>
  );
}
