import styles from './SorenaGlobeLoader.module.css';

// PR-GLOBE-LOADER — the "Global Operations · Live" globe loading screen, distilled
// from the original D3 world-map HUD into a lightweight pure-CSS/SVG component
// (no D3 / TopoJSON / CDN fetch / web fonts). Presentational and hook-free, so it
// renders as a server component — the portal's loading.tsx Suspense fallback ships
// zero client JS for it. The landing page overlays it via <SplashGate/>.

// A handful of faint "network lights" scattered on the sphere (static positions,
// blinking) — evokes the source's every-country network without any geometry.
const NET_LIGHTS: Array<[number, number, number]> = [
  // [cx, cy, animation-delay-seconds] within the 200×200 viewBox sphere (r≈86)
  [58, 66, 0], [140, 58, 0.6], [150, 104, 1.2], [72, 120, 0.4],
  [118, 138, 1.6], [96, 52, 0.9], [132, 92, 0.2], [64, 96, 1.4],
];

// The New Zealand hub, lower-left of the sphere (matches the source's NZ focus).
const HUB_X = 74;
const HUB_Y = 132;

export function SorenaGlobeLoader() {
  return (
    <div className={styles.root} role="status" aria-label="Loading Sorena Visa">
      {/* Top HUD */}
      <div className={`${styles.hud} ${styles.top}`}>
        <span className={styles.dot} aria-hidden />
        <span className={styles.accent}>LIVE</span>
        <span>Sorena Visa · Global Migration Network</span>
        <span className={styles.spacer} />
        <span className={`${styles.pill} ${styles.mono} ${styles.hideSm}`}>CLIENTS · 2,400+</span>
        <span className={`${styles.pill} ${styles.mono} ${styles.accent} ${styles.hideSm}`}>HQ · AUCKLAND</span>
      </div>

      {/* Centre: globe + wordmark */}
      <div className={styles.center}>
        <div className={styles.globeWrap}>
          <svg className={styles.globe} viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden>
            <defs>
              <radialGradient id="sgl-ocean" cx="42%" cy="38%" r="75%">
                <stop offset="0%" stopColor="#1d3a5c" />
                <stop offset="60%" stopColor="#16263f" />
                <stop offset="100%" stopColor="#0e1b2e" />
              </radialGradient>
              <filter id="sgl-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="1.4" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <clipPath id="sgl-sphere"><circle cx="100" cy="100" r="86" /></clipPath>
            </defs>

            {/* Outer gold ring + faint halo */}
            <circle cx="100" cy="100" r="94" fill="none" stroke="rgba(255,227,154,0.30)" strokeWidth="0.8" />
            <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,194,92,0.14)" strokeWidth="3" />

            {/* Sphere */}
            <circle cx="100" cy="100" r="86" fill="url(#sgl-ocean)" />

            {/* Wireframe graticule (static) — parallels + meridians, clipped to sphere */}
            <g clipPath="url(#sgl-sphere)" fill="none" stroke="rgba(160,210,245,0.20)" strokeWidth="0.5">
              {/* parallels */}
              <ellipse cx="100" cy="100" rx="86" ry="26" />
              <ellipse cx="100" cy="100" rx="86" ry="52" />
              <ellipse cx="100" cy="100" rx="86" ry="74" />
              {/* meridians */}
              <ellipse cx="100" cy="100" rx="26" ry="86" />
              <ellipse cx="100" cy="100" rx="52" ry="86" />
              <ellipse cx="100" cy="100" rx="74" ry="86" />
              {/* equator + prime meridian (stronger) */}
              <line x1="14" y1="100" x2="186" y2="100" stroke="rgba(160,210,245,0.34)" strokeWidth="0.6" />
              <line x1="100" y1="14" x2="100" y2="186" stroke="rgba(160,210,245,0.34)" strokeWidth="0.6" />
            </g>

            {/* Precessing orbit ring (tilted ellipse) with two traveller dots */}
            <g className={styles.orbit}>
              <g transform="rotate(-18 100 100)">
                <ellipse cx="100" cy="100" rx="96" ry="34" fill="none" stroke="rgba(143,240,255,0.32)" strokeWidth="0.7" />
                <circle cx="196" cy="100" r="2" fill="#8ff0ff" filter="url(#sgl-glow)" />
                <circle cx="4" cy="100" r="1.6" fill="#ffe39a" filter="url(#sgl-glow)" />
              </g>
            </g>

            {/* Network lights on the sphere */}
            <g clipPath="url(#sgl-sphere)">
              {NET_LIGHTS.map(([cx, cy, d], i) => (
                <circle
                  key={i}
                  className={styles.netLight}
                  cx={cx}
                  cy={cy}
                  r="1.1"
                  fill="#8ff0ff"
                  style={{ animationDelay: `${d}s` }}
                />
              ))}
            </g>

            {/* Hub: pings + marker (New Zealand) */}
            <g>
              {[0, 0.8, 1.6].map((d, i) => (
                <circle
                  key={i}
                  className={styles.ping}
                  cx={HUB_X}
                  cy={HUB_Y}
                  r="2"
                  fill="none"
                  stroke="#ffe39a"
                  strokeWidth="0.7"
                  style={{ animationDelay: `${d}s` }}
                />
              ))}
              <circle cx={HUB_X} cy={HUB_Y} r="2.4" fill="#ffc25c" stroke="#fff" strokeWidth="0.5" filter="url(#sgl-glow)" />
            </g>

            {/* Corner ticks */}
            <g stroke="rgba(180,210,230,0.45)" strokeWidth="0.7" fill="none">
              <path d="M 10 20 L 10 10 L 20 10" />
              <path d="M 190 20 L 190 10 L 180 10" />
              <path d="M 10 180 L 10 190 L 20 190" />
              <path d="M 190 180 L 190 190 L 180 190" />
            </g>
          </svg>

          {/* Rotating radar sweep on top of the globe */}
          <div className={styles.sweep} aria-hidden />
        </div>

        {/* Wordmark */}
        <div>
          <div className={styles.wordmark}>SORENA</div>
          <div className={styles.tagline}>
            <span>Global Operations</span>
            <span aria-hidden>·</span>
            <span className={styles.live}>Live</span>
          </div>
        </div>
      </div>

      {/* Bottom HUD */}
      <div className={`${styles.hud} ${styles.bottom}`}>
        <span className={styles.accent}>DESTINATION · NEW ZEALAND</span>
        <span className={`${styles.pill} ${styles.mono} ${styles.hideSm}`}>WORK · STUDY · RESIDENCE</span>
        <span className={styles.spacer} />
        <span className={`${styles.pill} ${styles.mono} ${styles.accent}`}>SORENAVISA.COM</span>
      </div>
    </div>
  );
}

export default SorenaGlobeLoader;
