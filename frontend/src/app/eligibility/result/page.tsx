'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';

type ScoreType = 'high' | 'medium' | 'low';

const getResultConfig = (score: string | null): { type: ScoreType; title: string; message: string; color: string; bgColor: string; iconColor: string } => {
  const normalized = (score || 'medium').toLowerCase();
  
  if (normalized === 'high' || normalized === '3') {
    return {
      type: 'high',
      title: 'Strong Eligibility',
      message: 'Your profile shows strong potential for NZ study. Our team will contact you within 24 hours.',
      color: '#065f46',
      bgColor: '#ecfdf5',
      iconColor: '#10b981',
    };
  } else if (normalized === 'low' || normalized === '1') {
    return {
      type: 'low',
      title: 'Pathway Needs Work',
      message: 'We can still help. Book a free consultation to explore your options.',
      color: '#7c2d12',
      bgColor: '#fffbeb',
      iconColor: '#f59e0b',
    };
  } else {
    return {
      type: 'medium',
      title: 'Good Potential',
      message: 'Your profile shows good potential. A consultation will help clarify your pathway.',
      color: '#92400e',
      bgColor: '#fffbeb',
      iconColor: '#f59e0b',
    };
  }
};

function EligibilityResultContent() {
  const searchParams = useSearchParams();
  const score = searchParams.get('score');
  const id = searchParams.get('id');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const config = getResultConfig(score);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Success Icon */}
        <div style={{ ...styles.iconContainer, background: config.bgColor }}>
          <div style={{ ...styles.icon, color: config.iconColor }}>
            {config.type === 'high' ? '✓' : '→'}
          </div>
        </div>

        {/* Result Title */}
        <h1 style={{ ...styles.title, color: config.color }}>
          {config.title}
        </h1>

        {/* Result Message */}
        <p style={styles.message}>
          {config.message}
        </p>

        {/* Score Badge */}
        {id && (
          <div style={styles.badgeContainer}>
            <span style={styles.badgeLabel}>Your Assessment ID:</span>
            <span style={styles.badgeValue}>{id}</span>
          </div>
        )}

        {/* CTA Button */}
        <a
          href="https://www.sorenavisa.com"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.ctaButton}
        >
          Book Free Consultation
        </a>

        {/* Secondary Info */}
        <div style={styles.infoBox}>
          <h3 style={styles.infoTitle}>What Happens Next?</h3>
          <ul style={styles.infoList}>
            <li style={styles.infoItem}>Our team reviews your submission</li>
            <li style={styles.infoItem}>We'll send a detailed assessment to your email</li>
            <li style={styles.infoItem}>Book a free 30-minute consultation</li>
            <li style={styles.infoItem}>Discuss your personalized study pathway</li>
          </ul>
        </div>

        {/* Footer Link */}
        <div style={styles.footer}>
          <a href="/" style={styles.backLink}>
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}

const styles: any = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0a2342 0%, #0d4f6e 60%, #0a7a6e 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 24px',
  },
  container: {
    background: '#fff',
    borderRadius: 20,
    padding: '60px 48px',
    width: '100%',
    maxWidth: 540,
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    textAlign: 'center',
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 32px',
  },
  icon: {
    fontSize: '50px',
    fontWeight: 700,
  },
  title: {
    fontSize: '2rem',
    fontWeight: 800,
    marginBottom: 16,
  },
  message: {
    fontSize: '1.05rem',
    color: '#5a6a7a',
    lineHeight: 1.6,
    marginBottom: 32,
  },
  badgeContainer: {
    background: '#f4f7f6',
    padding: '16px 20px',
    borderRadius: 12,
    marginBottom: 32,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  badgeLabel: {
    fontSize: '0.85rem',
    color: '#5a6a7a',
    fontWeight: 600,
  },
  badgeValue: {
    fontSize: '1.1rem',
    color: '#0a2342',
    fontWeight: 700,
    fontFamily: 'monospace',
  },
  ctaButton: {
    display: 'inline-block',
    background: '#0d7a6e',
    color: '#fff',
    padding: '16px 48px',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: '1rem',
    textDecoration: 'none',
    marginBottom: 40,
    transition: 'all 0.3s ease',
    cursor: 'pointer',
    border: 'none',
  },
  infoBox: {
    background: '#f4f7f6',
    padding: '24px',
    borderRadius: 12,
    marginBottom: 32,
    textAlign: 'left',
  },
  infoTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#0a2342',
    marginBottom: 16,
  },
  infoList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  infoItem: {
    fontSize: '0.95rem',
    color: '#5a6a7a',
    padding: '8px 0',
    paddingLeft: 24,
    position: 'relative',
  },
  footer: {
    marginTop: 24,
  },
  backLink: {
    color: '#0d7a6e',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '0.95rem',
  },
};

function LoadingFallback() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a2342 0%, #0d4f6e 60%, #0a7a6e 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
    }}>
      <div style={{
        color: '#fff',
        fontSize: '1.2rem',
      }}>Loading...</div>
    </div>
  );
}

export default function EligibilityResultPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <EligibilityResultContent />
    </Suspense>
  );
}
