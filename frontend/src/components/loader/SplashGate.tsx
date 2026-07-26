'use client';

import { useEffect, useState } from 'react';
import { SorenaGlobeLoader } from './SorenaGlobeLoader';

// PR-GLOBE-LOADER — first-paint splash for the landing page. Overlays the globe
// loader on first mount, then fades out once the page is "ready" (window load OR a
// short min-display, whichever is later — capped so a slow device is never blocked).
// Self-contained: it renders nothing after it's dismissed, and it's a no-op for
// users who've already seen it this session (so client-side nav doesn't re-splash).
//
// Lightweight by design: no dependencies, GPU-only fade, and it respects
// prefers-reduced-motion (instant dismiss, no animation).

const SESSION_KEY = 'sorena_splash_seen';
const MIN_DISPLAY_MS = 700;   // don't flash for <0.7s
const MAX_DISPLAY_MS = 3500;  // hard cap — never block the app
const FADE_MS = 450;

export function SplashGate() {
  // Start shown only if we haven't splashed yet this session (avoids re-splash on
  // client-side navigation back to the landing page). SSR renders it; the effect
  // dismisses immediately if already seen.
  const [phase, setPhase] = useState<'shown' | 'fading' | 'done'>('shown');

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const alreadySeen = sessionStorage.getItem(SESSION_KEY) === '1';
    if (alreadySeen || reduce) {
      setPhase('done');
      return;
    }
    sessionStorage.setItem(SESSION_KEY, '1');

    const start = performance.now();
    let fadeTimer: number;
    let doneTimer: number;

    const dismiss = () => {
      const elapsed = performance.now() - start;
      const wait = Math.max(0, MIN_DISPLAY_MS - elapsed);
      fadeTimer = window.setTimeout(() => {
        setPhase('fading');
        doneTimer = window.setTimeout(() => setPhase('done'), FADE_MS);
      }, wait);
    };

    // Ready = window load (fonts/hero images in) OR the hard cap, whichever first.
    const capTimer = window.setTimeout(dismiss, MAX_DISPLAY_MS);
    if (document.readyState === 'complete') {
      dismiss();
    } else {
      window.addEventListener('load', dismiss, { once: true });
    }

    return () => {
      window.clearTimeout(capTimer);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
      window.removeEventListener('load', dismiss);
    };
  }, []);

  if (phase === 'done') return null;

  return (
    <div
      aria-hidden={phase === 'fading'}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        opacity: phase === 'fading' ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: phase === 'fading' ? 'none' : 'auto',
      }}
    >
      <SorenaGlobeLoader />
    </div>
  );
}

export default SplashGate;
