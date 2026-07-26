# Phase 19 — "Global Operations · Live" Globe Loading Screen

End-of-phase handover for the animated globe **loading screen** shown when a user
first opens the platform — on the **landing page** (a first-mount splash that fades
out) and the **client portal** (the route-level loading fallback). Delivered from a
standalone HTML source, distilled into a lightweight theme-native React component.

**Date:** 2026-07-26
**Commit (this phase):**
- `50316e2` — feat(loader): "Global Operations · Live" globe loading screen (landing splash + portal fallback)

---

## 1. What this phase does

Shows the Sorena "Global Operations · Live" globe as the initial loading screen at
two entry points:

- **Client portal (`/portal/*`)** — `portal/loading.tsx` renders the globe as Next's
  route-level Suspense fallback, so a slow server render reads as the branded loader
  instead of a frozen previous page. **Zero client JS** on this path (the loader is a
  hook-free server component).
- **Landing page (`/`)** — a first-mount `<SplashGate>` overlays the globe and fades
  it out once the page is ready (`window.load`) or after a short min-display,
  whichever is later, hard-capped so it can never block the app.

**The key decision (a future dev must understand this):** the source file
(`docs/design/SorenaGlobeLoader.source.html`) is **not a lightweight loader** — it is
a full **D3 + TopoJSON world-map HUD** that, at runtime, loads two JS libraries and
`fetch()`es ~100 KB of country geometry from `unpkg.com`, then renders hundreds of
SVG country paths, arcs, and travelers, plus web fonts and a base64 logo (~350 KB
total). Shipping that as the *first-paint* loader would directly defeat its purpose
(and pull a third-party CDN dependency before the app shows). So it was **distilled**
into a pure-CSS/SVG component that preserves the visual identity — dark-navy radial
background, gold outer ring + cyan graticule globe, rotating radar sweep, a glowing
**New Zealand hub with expanding pings**, precessing orbit travelers, blinking
network lights, the top/bottom HUD framing, corner ticks, and the **SORENA**
wordmark — with **no D3, no TopoJSON, no CDN fetch, and no web fonts.** If the literal
rotating world map is ever wanted, vendor D3 + a *local* geojson behind a lazy import
and use it only for the landing splash — never the portal fallback. (Product decision
on record: ship the distilled version as-is.)

## 2. Files created or changed

Pulled from `git show --stat 50316e2`.

*Created*
- `frontend/src/components/loader/SorenaGlobeLoader.tsx` — the loader. Hook-free /
  server-renderable, pure presentational.
- `frontend/src/components/loader/SorenaGlobeLoader.module.css` — its scoped styles
  (CSS Module) — background, HUD, globe, sweep, keyframes, responsive + reduced-motion.
- `frontend/src/components/loader/SplashGate.tsx` — `'use client'` first-mount splash
  for the landing page (overlay + fade-out + session/reduced-motion handling).
- `docs/design/SorenaGlobeLoader.source.html` — the original standalone HTML, kept as
  design provenance. **Never imported → never bundled.**

*Changed*
- `frontend/src/app/portal/loading.tsx` — renders `<SorenaGlobeLoader/>` (was a plain
  "Loading…" text).
- `frontend/src/app/page.tsx` — renders `<SplashGate/>` above the landing content.

## 3. Database tables / columns added

**None.** Pure frontend.

## 4. Environment variables added (names only)

**None.**

## 5. Third-party services connected

**None — and deliberately so.** The whole point of the distillation was to remove the
source's runtime dependency on the `unpkg.com` world-atlas CDN and the D3/TopoJSON
libraries. The shipped loader makes no network requests and loads no external fonts.

## 6. How to test it works

**Automated/build:** `next build` compiles cleanly (`/` and `/portal/*` and
`/unsubscribe` all build; the loader adds no measurable weight). Frontend `tsc`
exit 0.

**Visual (done this phase):** rendered the exact component CSS/markup in Chromium at
**1280×800 (desktop)** and **390×844 (mobile)** — the globe scales via `vmin`, stays
centred, the HUD pills hide on small screens so nothing clips, and the SORENA
wordmark + "Global Operations · Live" tagline sit below.

**Manual:**
1. **Portal:** open `/portal/case` (or any `/portal/*`) with a throttled network — the
   globe shows while the server component streams, then the page replaces it.
2. **Landing:** hard-open `/` in a fresh tab — the globe splash shows, then fades into
   the landing page. Reload within the same session (client nav) → no re-splash.
3. **Reduced motion:** enable "reduce motion" in the OS → the globe renders static (no
   sweep/spin/pings) and the splash dismisses instantly.

## 7. Known limitations

- **The loader is not the literal D3 world map.** It's a faithful *distillation* of the
  identity, chosen for weight. The real map is available in
  `docs/design/SorenaGlobeLoader.source.html` if the design is ever revisited (see §1
  for how to reintroduce it safely).
- **The New Zealand hub + network lights are decorative, static positions** — not a
  real projection of NZ or of client countries. They evoke the source's "every country
  → NZ" network without any geometry.
- **`SplashGate` gates on `window.load`, not real app-data readiness.** For the landing
  page (a static marketing page) that's the right signal; it is not wired to any
  data-fetch completion, and the 3.5 s hard cap guarantees it never blocks.
- **Splash is once-per-session** (`sessionStorage`). A user who closes and reopens the
  tab sees it again; within a session, client-side navigation back to `/` does not
  re-trigger it. This is intentional (avoids a splash on every internal nav).
- **HUD copy is baked in** ("Sorena Visa · Global Migration Network", "HQ · AUCKLAND",
  "SORENAVISA.COM", "CLIENTS · 2,400+"). If any of these need to be dynamic or
  localised, they'd need to become props / i18n keys.

## 8. How a future developer would extend this

- **Reuse the loader anywhere:** `import { SorenaGlobeLoader } from
  '@/components/loader/SorenaGlobeLoader'`. It fills its positioned parent
  (`position:absolute; inset:0`), so drop it in any `loading.tsx` or a full-screen
  overlay.
- **Add it to another entry point:** for a route with a server fetch, add a
  `loading.tsx` that returns `<SorenaGlobeLoader/>`. For a client-only "first open"
  surface, reuse `<SplashGate/>` (or copy its ready/fade logic).
- **Tune the splash timing:** `MIN_DISPLAY_MS` / `MAX_DISPLAY_MS` / `FADE_MS` constants
  at the top of `SplashGate.tsx`.
- **Restyle:** all colours + motion live in `SorenaGlobeLoader.module.css` (`--accent`,
  `--accent-bright`, `--cyan`, `--ok` custom properties + the `@keyframes`). The globe
  geometry is inline SVG in the component (graticule ellipses, hub position `HUB_X/Y`,
  `NET_LIGHTS` array).
- **Make HUD copy dynamic:** lift the baked strings in `SorenaGlobeLoader.tsx` to props.

## 9. Security layers applied

- **No new surface.** Pure presentational frontend — no endpoints, no data, no auth
  interaction, no user input.
- **No third-party network calls** (the removed CDN dependency was the main risk in the
  source). The loader is fully self-contained, so it can't leak a referrer or be a
  supply-chain vector.
- **No secrets, no PII** rendered — the HUD copy is static marketing text.

## 10. Rollback instructions

Pure frontend, no migration — a straight git revert.

1. **Full revert:** `git revert 50316e2`. This restores the portal's plain "Loading…"
   fallback and removes the landing splash + the loader component + the reference HTML.
   Nothing else imports these files, so the revert is self-contained.
2. **Partial (keep portal, drop landing splash):** remove the `<SplashGate/>` line +
   import from `frontend/src/app/page.tsx`. The portal keeps the globe fallback.
3. **Partial (keep landing, revert portal):** restore the previous `portal/loading.tsx`
   body (a centred "Loading…" paragraph on `#faf8f3`).
4. **No data / no env / no service cleanup** — there is none.
