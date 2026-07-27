# Phase 28 — Persian / RTL spine (client portal)

End-of-phase handover for the client-portal Persian/RTL **foundation** — the work the
Phase-25.5 scan deferred and originally labelled "Phase 1", renumbered to **Phase 28** to
match the real sequence.

**Date:** 2026-07-28
**Commit:** `6c3b308` — feat(i18n): Phase 28 Persian/RTL spine — server locale, chrome strings, dates, RTL

**Locked decisions carried in:** Gregorian calendar with Persian month names; Persian
digits in prose; Claude drafts + Owner reviews the copy; Phase-1 (spine) scope only.
**Reviewer adjustments applied:** engagement letter → «قرارداد همکاری»; `portal.nav.apply`
→ «درخواست تحصیل» (single phrase); INZ / PDF kept as Latin acronyms.

---

## 1. What this phase does

Turns the **half-wired** next-intl setup into a working, persistent, server-rendered
bilingual spine for the client portal:

- **Locale is now server-authoritative + persistent.** The globe toggle writes a
  `NEXT_LOCALE` cookie and `router.refresh()`es; the root layout reads that cookie on the
  server and stamps `<html lang dir>` on the **first paint** (no LTR→RTL flash); every one
  of the 19 server pages renders in the chosen language and the choice **survives reloads
  and navigation**. (`i18n/request.ts` already honoured the cookie — nothing wrote it.)
- **The ~26 most-seen chrome strings are Persian** — the sidebar nav, active-case cards,
  re-login prompt, contract-ready prompt, and assessment card.
- **Dates read correctly in Persian** — Gregorian calendar, Persian month names + digits.
- **The flagship RTL bugs are fixed** — the case timeline rail + its dot mirror to the
  right; back/forward arrows flip.

## 2. Files changed (8, all frontend)

- `app/layout.tsx` — server-reads `NEXT_LOCALE`, sets `<html lang dir>`, passes
  `initialLocale` to the provider.
- `components/LocaleProvider.tsx` — seeds the store from `initialLocale` once
  (SSR/hydration agree, no flash); keeps `document.dir/lang` synced.
- `lib/stores/localeStore.ts` — `setLocale`/`toggleLocale` write the `NEXT_LOCALE` cookie.
- `components/portal/ClientShell.tsx` — toggle calls `router.refresh()` so server
  components re-render in the new language.
- `i18n/messages/fa.json` — the ~26 Persian chrome strings; stale `_TODO` markers removed.
- `lib/date.ts` — locale param; Persian → `fa-IR-u-ca-gregory` (Gregorian + Persian
  months + Persian digits).
- `app/portal/case/page.tsx` — passes the server locale to `formatDate`; timeline rail
  logical (`border-s`/`ps-5`, side-aware dot); chevrons `rtl:rotate-180`.
- `components/student/StudentHeader.tsx` — back arrow `rtl:rotate-180`.

## 3. How the locale flow works (for the next developer)

1. Request arrives → `layout.tsx` (server) reads `NEXT_LOCALE` → sets `<html lang dir>`
   and passes `initialLocale` to `LocaleProvider`.
2. Server components resolve the same locale via `i18n/request.ts` (also reads the
   cookie) → `getTranslations()`/`getLocale()` return the right language.
3. `LocaleProvider` (client) seeds the Zustand store from `initialLocale` in a
   `useState` initializer → SSR and first client render agree (no hydration flash).
4. Toggle → store writes the cookie + flips `document.dir/lang`; `ClientShell` calls
   `router.refresh()` → server components re-render in the new language. Persisted.

## 4. Environment variables / DB

**None.** Frontend-only; no schema, no env.

## 5. How to test it works

Set a `NEXT_LOCALE=fa` cookie (or toggle the globe) and load the portal at 390px:
- `document.documentElement` is `dir="rtl" lang="fa"` **from the first paint** (no flash),
  and stays Persian across a hard reload (cookie).
- The **nav drawer** opens from the right with Persian items (خانه / پرونده من / مدارک /
  درخواست ویزا / درخواست تحصیل / پرداخت‌ها / پیام‌ها و پشتیبانی / کیف پول).
- `/portal/case` renders the Persian hero + the **timeline date «۲۷ ژوئیه ۲۰۲۶»**
  (Gregorian July, Persian month + digits — the old "Jul 2026 27" bug is gone), with the
  **rail + dot mirrored to the right** and the wallet arrow pointing left.

(Verification screenshots were captured this phase; the demo seed was removed afterwards.)

## 6. Known limitations / explicitly deferred to later phases

This is the **spine**, not full coverage. Still English in Persian mode (by scope):

- **Fully-hardcoded page bodies** — `/portal/booking`, `/portal/case/pay`, the `/student`
  dashboard, and the `/student/case/messages` folder (~290 strings from the scan). Their
  RTL BiDi artifacts (e.g. ".You have no upcoming sessions", literal `→` glyphs) persist
  until those strings are translated.
- **Two inline-label nav items — "My Assessment" and "Booking"** — set as literal strings
  in `clientShellData.ts` (no i18n key), so they bypass next-intl. Not in the approved 26;
  a 2-string follow-up (add `portal.nav.myAssessment` / `portal.nav.booking`).
- **Inline date/relative-time + currency** outside `lib/date.ts` — `timeAgo`, `formatWhen`,
  the 7 currency formatters, and the other inline `Intl.DateTimeFormat` sites still
  hardcode `en`. A shared `formatMoney` + `Intl.RelativeTimeFormat('fa')` come later.
- **Deep-form RTL cosmetics** — ~68 `ml-0.5` asterisks + `pl-6` bullet lists in the
  visa/admission steps (low visibility).

## 7. How a future developer would extend this

- **Translate a page body:** replace hardcoded JSX strings with `t('...')` keys (add to
  both `en.json` + `fa.json`), following the dashboard-card components as the model.
- **The 2 inline nav labels:** add `portal.nav.myAssessment`/`booking` keys and switch the
  `clientShellData.ts` entries from literal strings to those dotted keys.
- **Dates/money elsewhere:** route inline sites through `lib/date.ts` (pass the locale) and
  a new shared money helper.

## 8. Security layers applied

**No change.** Locale is a display cookie (`samesite=lax`, non-sensitive). No auth, PII, or
endpoint surface touched.

## 9. Rollback

Frontend-only — `git revert 6c3b308` restores the client-only locale (English SSR),
English chrome, `en-NZ` dates, and the LTR timeline rail. No DB/env to undo.
