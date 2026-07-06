# Unifying the client experience — one navigation shell for `/portal/*` + `/student/*`

**Goal:** a client should never jump between two different-looking layouts. One shell
(same sidebar always visible, consistent header/back) across the whole client journey,
Stage 1 (`/portal/*`, LEAD+STUDENT) through Stage 2 (`/student/*`, STUDENT-only).

**Status:** analysis only — no code changed. This documents what exists and the safest
incremental path.

---

## 1. The two current shells — very different

### `/portal/layout.tsx` → `ClientPortalHeader` (top header)
File: `frontend/src/app/portal/layout.tsx` → `frontend/src/components/portal/ClientPortalHeader.tsx`

- **Top horizontal nav.** Navy `#1e3a5f` header bar. Top row: brand ("Sorena" + portal
  title) left, "Sign out" right. Below it, a row of underline-style tabs.
- Body: `max-w-5xl` centered, cream `#faf8f3` background.
- No locale toggle, no avatar, no mobile drawer (the nav simply wraps on small screens).
- Nav items: **My Case** (`/portal/case`, exact) · **Documents** (`/portal/case/documents`) ·
  **Wallet** (`/portal/wallet`). Booking is intentionally omitted.
- **Role gate: LEAD + STUDENT, in the layout only** (`CLIENT_ROLES` set; redirects to
  `/login` if no session, `/unauthorized` if role not allowed).

### `/student/layout.tsx` → `PortalLayout` (left sidebar)
File: `frontend/src/app/student/layout.tsx` → `frontend/src/components/portal/PortalLayout.tsx`

- **Left sidebar** (`w-64`, navy `bg-sorena-navy`): logo mark, portal title ("My Portal"),
  icon+label nav items, "Sign out" pinned to the bottom.
- **White top header** (`h-14`): mobile hamburger, locale toggle (فا/EN via `localeStore`),
  user avatar + name. Body background gray-50. Includes `BackToTop` + `Toaster`.
- **Mobile:** the sidebar collapses into an overlay drawer (backdrop + close button).
- **Shared component:** `PortalLayout` is the same shell used by `admin` / `ops` / `sales` /
  `lia` (a `Portal` union type + `NAV_CONFIG` map). `student` is one entry among them.
- The **layout fetches student-only data** to drive the nav:
  - `GET /students/me/admission/application` → `hasCase` (gates the "Apply" item)
  - `GET /students/me/case-messages/unread-count` → red dot on "Messages"
- Nav items: **Dashboard** (`/student`) · **My Case** (`/student/case`) · **Visa Section**
  (`/student/documents`) · **Messages** (`/student/case/messages`) · **Payments**
  (`/student/payments`) · **Apply** (`/student/admission`, `requiresCase`).
- **Role gate: STUDENT only, enforced TWICE** — `middleware.ts` **and** the layout.

### How different
Essentially opposite layouts: **top-nav vs left-sidebar**, different backgrounds
(cream vs gray-50), different headers (portal has no locale toggle / no avatar), different
mobile patterns (wrap vs drawer), different sign-out code paths, different active-state
logic. Crossing `/portal → /student` today makes the whole chrome visibly "jump" — the exact
problem to fix.

---

## 2. Route inventory + which shell each uses

### `/portal/*` — all under the `ClientPortalHeader` shell (LEAD + STUDENT)
| Route | File | In nav? |
|---|---|---|
| `/portal` → redirects to `/portal/case` | `app/portal/page.tsx` | — |
| `/portal/case` | `app/portal/case/page.tsx` | ✅ My Case |
| `/portal/case/documents` | `app/portal/case/documents/page.tsx` | ✅ Documents |
| `/portal/wallet` | `app/portal/wallet/page.tsx` | ✅ Wallet |
| `/portal/booking` | `app/portal/booking/page.tsx` | ❌ contextual (`?type=free15\|gap\|lia`) |

### `/student/*` — all under the `PortalLayout` shell (STUDENT only)
| Route | File | In nav? |
|---|---|---|
| `/student` (renders the dashboard) | `app/student/page.tsx` | ✅ Dashboard |
| `/student/dashboard` (separate page) | `app/student/dashboard/page.tsx` | ❌ orphan |
| `/student/case` | `app/student/case/page.tsx` | ✅ My Case |
| `/student/case/messages` | `app/student/case/messages/page.tsx` | ✅ Messages |
| `/student/documents` (Visa Section) | `app/student/documents/page.tsx` | ✅ Visa Section |
| `/student/admission` | `app/student/admission/page.tsx` | ✅ Apply (requiresCase) |
| `/student/payments` | `app/student/payments/page.tsx` | ✅ Payments |
| `/student/tickets`, `/tickets/new`, `/tickets/[id]` | `app/student/tickets/**` | ❌ (reached from the Stage-2 cards on `/portal/case`) |
| `/student/meetings` | `app/student/meetings/page.tsx` | ❌ orphan |
| `/student/chat` | `app/student/chat/page.tsx` | ❌ orphan |

### Incidental findings (out of scope but relevant to a nav merge)
- The student dashboard (`app/student/page.tsx`) links to **`/student/messages`** (twice),
  which has **no page** — the real route is `/student/case/messages`. Likely a dead link.
- **Two dashboards** exist: `/student` (renders dashboard content) and a separate
  `/student/dashboard`.
- Several real pages are in **neither** nav: `tickets`, `meetings`, `chat`. A unified nav is
  a chance to reconcile these.

---

## 3. Overlapping vs unique nav items → the unified set

| Concept | Portal nav | Student nav |
|---|---|---|
| Case | My Case → `/portal/case` | My Case → `/student/case` |
| Documents | Documents → `/portal/case/documents` (initial docs) | Visa Section → `/student/documents` |
| Money | Wallet → `/portal/wallet` (store credit) | Payments → `/student/payments` (invoices) |
| Home | — | Dashboard → `/student` |
| Messages | — | Messages → `/student/case/messages` |
| Apply | — | Apply → `/student/admission` (requiresCase) |
| Booking | (contextual, not in nav) | — |

**Overlap is conceptual, not literal.** "My Case" and "Documents" point at *different routes*
on each side — that's the core of the confusion. **Unique to portal:** Wallet, Booking.
**Unique to student:** Dashboard, Messages, Apply, Payments, Visa Section.

**Proposed single unified client nav (role + stage aware):**
- **Always visible:** Home / My Case · Documents · Wallet · Messages / Support
- **Stage-2 (STUDENT) adds:** Apply / Admission · Visa Section · Payments
- Booking stays contextual (not a top-level item).
- Nav-item **targets follow role/stage**: a LEAD's "My Case" → `/portal/case`; a STUDENT's
  fuller items → the corresponding `/student/*` route.

---

## 4. Role gating — the hard constraint

- **`/portal/*`** is gated in the **layout only** (LEAD + STUDENT). `middleware.ts` does **not**
  match `/portal` — its `config.matcher` covers `/admin`, `/ops`, `/sales`, `/lia`, `/staff`,
  `/student` only.
- **`/student/*`** is gated in **middleware** (`ROLE_ROUTES['/student'] = ['STUDENT']`) **and**
  again in the layout (`STUDENT_ROLES`).

**The trap when "unifying":** if we unify by physically **moving student pages under
`/portal/*`**, those pages **lose the middleware STUDENT-only gate** (middleware doesn't cover
`/portal`). A LEAD could then reach them unless every page re-gates itself.

**Rule to keep the boundary safe:** **keep the route groups where they are.** `/portal/*`
stays LEAD+STUDENT; `/student/*` stays STUDENT-only with its middleware gate. **Unify only the
presentation (the shell) — never the URL boundaries.** The gates stay exactly where they are;
only the chrome around the pages changes.

---

## 5. Safest approach — one shared shell *component*, two unchanged route groups

**Do NOT merge routes, and do NOT bend the shared staff `PortalLayout`.**

1. Extract a new **`ClientShell`** presentational component (sidebar + header + mobile drawer +
   locale toggle), driven by props: `session`, `portalStage` (`STAGE_1 | STAGE_2`), and a nav
   config filtered by role + stage. Model its structure on `PortalLayout` so the two groups
   look identical — but keep it **client-specific** (do not touch the staff shell).
2. Both `/portal/layout.tsx` and `/student/layout.tsx` render `<ClientShell>`, each keeping its
   **own server-side role gate** and its **own data fetches** (student keeps `hasCase` +
   unread-count; portal adds `portalStage`, already used on the case page).
3. Nav items show/hide by role + stage; item hrefs resolve to `/portal/*` for a LEAD and the
   right `/student/*` route for a STUDENT.

This gives one consistent shell while the URL boundaries — and therefore the gates — are
untouched.

### Biggest risks
- **Staff-shell coupling (highest).** `PortalLayout` is shared by admin/ops/sales/lia. Reusing
  it directly for the client (e.g. adding a `'client'` portal type) risks regressing staff.
  Prefer a **separate `ClientShell`**.
- **Role-gating regression.** Any refactor that routes student pages through a LEAD-reachable
  path breaks the STUDENT-only boundary. Keep middleware + per-group layout gates intact; add a
  check that a LEAD hitting `/student/*` still 302s to `/unauthorized`.
- **Student-only fetches 403 for LEAD.** `hasCase` / unread-count endpoints must **not** be
  called in the portal branch — keep those fetches in the student layout only, or the portal
  shell will spam 403s.
- **RTL / Persian.** Only the student header has the locale toggle today; the portal shell has
  none. A unified shell must render correctly in RTL — sidebar flips side, drawer direction
  reverses, and the underline/active border styles (`-mb-px`, `border-b`) need RTL-safe
  equivalents. Test `fa` explicitly.
- **Mobile.** Two different mobile patterns today (wrap vs drawer). The unified drawer must be
  verified on small screens for both groups.
- **Active-state logic.** Portal uses `startsWith` + an `exact` flag; the sidebar uses strict
  `pathname === href`. Nested routes (e.g. `/portal/case/documents` under "My Case") need the
  exact/startsWith rules ported, or links mis-highlight.
- **Narrow-shell pages.** Booking + placeholder pages assume the centered narrow shell; verify
  they still look right inside a sidebar layout.

---

## 6. Smallest first incremental step

**Apply a new `ClientShell` to `/portal/*` ONLY** (replace `ClientPortalHeader` with the
sidebar shell), leaving `/student/*` on its existing `PortalLayout` completely untouched.

Why this slice first:
- `/portal` is the **smaller surface** (4 pages), has the **simpler data model**, and **zero
  staff coupling** — lowest blast radius.
- It's the **LEAD entry point**, so the visual "jump" is reduced for the earliest-stage users
  first.
- It proves the shell (RTL, mobile drawer, nav-by-stage, active states) in isolation before
  `/student` is switched.
- **Rollback is trivial:** revert one layout file back to `ClientPortalHeader`.

Then, as a **separate later step**, point `/student/layout.tsx` at the same `ClientShell` — at
which point both groups share one look and the staff `PortalLayout` is retired from the client
path. Each slice is independently shippable and revertible.

---

## 7. Migration

**None.** Frontend structure only — new/edited layout + shell components and nav config. No DB,
no Prisma, no backend, no schema change.

---

# Slice 1 spec — `ClientShell` on `/portal/*` only

**Scope of this slice:** introduce a client-specific sidebar shell and use it in
**`/portal/layout.tsx` only**. `/student/*` is **not touched** in this slice. No security gate
changes. No backend, no routes, no migration. (Design/spec only — no component code here.)

## 1. `ClientShell` component API

A new client-only presentational shell: `frontend/src/components/portal/ClientShell.tsx`
(`'use client'`). It renders the chrome; the page content is passed as `children`.

```
interface ClientNavItem {
  labelKey: string;          // i18n key, e.g. 'portal.nav.myCase'
  href: string;              // e.g. '/portal/case'
  icon: React.ReactNode;     // lucide icon, matching PortalLayout sizing (size={18})
  exact?: boolean;           // active-match rule (see §4 of the merge analysis)
  stage2Only?: boolean;      // render only when portalStage === 'STAGE_2'
}

interface ClientShellProps {
  children: React.ReactNode;
  session: Session;                        // from '@/lib/auth' (name/email/role)
  portalStage: 'STAGE_1' | 'STAGE_2';      // drives stage-gated nav items
  navItems: ClientNavItem[];               // the /portal nav config (see §2)
  backHref?: string;                        // optional "back" target for the header
  backLabelKey?: string;                    // i18n key for the back label
}
```

**What it renders** (structure mirrors `PortalLayout` so the look is identical):
- **Left sidebar** (`w-64`, `bg-sorena-navy`, `hidden lg:flex`): logo mark
  (`/brand/logo-mark-white.jpg`), brand + a client portal title (gold), the filtered nav
  items (icon + label, active highlight), and "Sign out" pinned to the bottom.
- **Top header** (`h-14`, white, `border-b`): on the left, a mobile hamburger (`lg:hidden`) +
  an **optional back button** (chevron + `t(backLabelKey)`, only when `backHref` is provided);
  on the right, the **existing locale toggle** and the **avatar + name** (see §3).
- **Mobile drawer**: the sidebar as an overlay (backdrop + close button), toggled by the
  hamburger — same pattern as `PortalLayout` (see §5).
- **Main**: `<main className="flex-1 overflow-y-auto p-6">{children}</main>`, plus the existing
  `BackToTop` and a `Toaster`.

**Sign out**: reuse the existing pattern (`POST /api/auth/logout` → `router.push('/login')`) —
identical to both current shells. No new auth code.

**Active state**: `exact ? pathname === href : pathname.startsWith(href)` — ports the
portal rule so `/portal/case/documents` doesn't light up "My Case" (which is `exact`).

**Note:** `ClientShell` is a **new, separate** component — it does **not** modify or extend the
shared staff `PortalLayout` (`admin/ops/sales/lia/student`), so staff shells cannot regress.

## 2. Client nav config for `/portal` (Slice 1)

Defined next to the shell (or in the portal layout) and passed in as `navItems`. Stage signal
is the **existing** `GET /portal/me/stage` → `{ portalStage }` (already built; the `/portal/case`
page uses it). In this slice the **portal layout** fetches it once and passes it to the shell.

| Item | href | Always vs Stage-2 |
|---|---|---|
| My Case | `/portal/case` (`exact`) | **Always** |
| Documents | `/portal/case/documents` | **Always** |
| Wallet | `/portal/wallet` | **Always** |
| Messages / Support | `/student/tickets` | **STAGE_2 only** (`stage2Only`) |

Rationale:
- The three always-on items are exactly today's `ClientPortalHeader` items → **no behavior
  change for a Stage-1 client**. Slice 1 is visually the sidebar, functionally the same nav.
- "Messages / Support" is shown **only at STAGE_2** because it targets `/student/tickets`
  (STUDENT-only). A LEAD (Stage-1) never sees it, so the shell never offers a link a LEAD
  can't use. This reuses the same `portalStage` gate the `/portal/case` page already trusts.
- Booking stays **contextual** (entered from the case page with `?type=`), not a nav item —
  unchanged from today.
- Filtering rule in the shell: drop any item where `stage2Only && portalStage !== 'STAGE_2'`.

> Deliberately NOT added in Slice 1: Apply / Visa Section / Payments. Those are `/student/*`
> pages and belong to the later slice that unifies the student side. Keeping them out now means
> Slice 1 introduces **zero** new cross-boundary links for a LEAD.

## 3. Reuse of existing styling + widgets (don't rebuild)

- **Colors**: reuse the existing tokens already used by `PortalLayout` — `bg-sorena-navy`,
  `text-sorena-gold`, `#1e3a5f` / `#F3CE49` / `#b8941f`. No new palette.
- **Locale toggle**: reuse `useLocaleStore()` (`locale`, `toggleLocale`) exactly as
  `PortalLayout` does (the فا/EN button with the `Globe` icon). Do **not** build a new toggle.
- **Avatar + name**: reuse the same header snippet — initial-in-a-circle + truncated
  `session.name || session.email`.
- **BackToTop**: reuse `@/components/common/BackToTop` (already imported by `PortalLayout`).
- **Toaster**: reuse `sonner`'s `Toaster` (same props: `richColors`, `position="top-right"`).
- **Icons**: reuse `lucide-react` at the same sizes (`18` in the sidebar, `14–16` in the header).
- **i18n**: nav labels use the existing `portal.nav.*` keys already in `en.json` / `fa.json`
  (`myCase`, `documents`, `wallet`); a new **Messages/Support** label + any **back** label are
  added as `portal.nav.*` keys — English filled, `fa.json` placeholder + `_TODO` marker (no
  invented Persian), per the project convention.

Net new UI to actually build: only the **sidebar container + the optional back button**. The
toggle, avatar, drawer mechanics, BackToTop, and Toaster are all lifted from the existing shell.

## 4. RTL / Persian behavior

- In `fa` (RTL) the **sidebar flips to the right**; main content sits to its left. Use
  logical/`rtl:`-aware placement rather than hard-coded left (the drawer must open from the
  correct side too).
- The **back-button chevron direction** must flip (points right in RTL).
- Any underline/active-border treatment carried over from the top-nav (`-mb-px`, `border-b`)
  must use RTL-safe equivalents; the sidebar's active style is a background fill (already
  direction-agnostic), which is safer to keep.
- The locale toggle already lives in the header — switching to فا must re-render the shell in
  RTL without a full reload (it's a client store).
- Verify text truncation (`max-w-[140px] truncate` on the name) behaves in RTL.

## 5. Mobile behavior

- **`< lg`**: sidebar hidden; a hamburger in the header opens it as an **overlay drawer**
  (backdrop click or a close button dismisses it) — the exact `PortalLayout` pattern.
- Tapping any nav item **closes the drawer** (`onClick` closes `sidebarOpen`).
- Header stays sticky at the top; main scrolls independently (`overflow-y-auto`).
- Touch targets ≥ 40–44px (matches existing nav/button sizing).
- The back button (if present) is reachable in the mobile header next to the hamburger.

## 6. Test checklist — applying `ClientShell` to `/portal/*` only

**Rendering / navigation**
- [ ] `/portal` still redirects to `/portal/case`.
- [ ] Each page loads inside the new sidebar shell: `/portal/case`, `/portal/case/documents`,
      `/portal/wallet`, `/portal/booking` (incl. `?type=free15|gap|lia`).
- [ ] Sidebar nav: My Case / Documents / Wallet navigate correctly; active highlight is right
      on each (My Case does **not** stay active on `/portal/case/documents`).
- [ ] Back button (where wired) returns to the expected page.
- [ ] Booking + placeholder pages still look right inside the sidebar (they assumed a narrow
      centered shell before).

**Stage gate (nav visibility only)**
- [ ] Stage-1 client: sees only My Case / Documents / Wallet — **no** Messages/Support item.
- [ ] Stage-2 client: additionally sees Messages/Support → `/student/tickets`, and it works.

**Role gating (must be unchanged)**
- [ ] LEAD can reach all `/portal/*` pages (layout gate still LEAD+STUDENT).
- [ ] Staff role / no session hitting `/portal/*` still bounces (`/unauthorized` / `/login`).
- [ ] A LEAD is never shown a `/student/*` link (Messages/Support is STAGE_2-gated); and if a
      LEAD manually hits `/student/*`, **middleware still 302s to `/unauthorized`** (untouched).

**RTL + mobile**
- [ ] Toggle to فا: sidebar flips to the right, drawer opens from the right, chevrons flip,
      no layout breakage; toggle back to EN restores LTR.
- [ ] `< lg`: hamburger opens the drawer, item tap closes it, backdrop closes it.
- [ ] Locale toggle, avatar, BackToTop, and toasts all work in the new shell.

**Regression guard**
- [ ] `/student/*` is visually and functionally **unchanged** (still on `PortalLayout`).
- [ ] Staff shells (`admin/ops/sales/lia`) unchanged (we did not touch `PortalLayout`).
- [ ] `tsc` clean for the touched files.

## 7. Rollback

Slice 1 is **one component swap in `/portal/layout.tsx`** (render `<ClientShell>` instead of
`<ClientPortalHeader>`), plus the new `ClientShell.tsx` and a nav-config constant. To revert:
restore `/portal/layout.tsx` to render `ClientPortalHeader` again (and optionally delete
`ClientShell.tsx`). No data, no routes, no gates, no other files involved — a clean one-file
revert.

## Confirmation

- **Touches ONLY `/portal`**: the new `ClientShell` component + `/portal/layout.tsx` (and new
  i18n keys). `/student/*`, the staff `PortalLayout`, and `middleware.ts` are **not** modified.
- **No security gate altered**: the `/portal` layout keeps its LEAD+STUDENT gate; the
  `/student` middleware + layout STUDENT-only gates are untouched; the only Stage-2 link
  (`/student/tickets`) remains protected by the existing middleware regardless of nav
  visibility. Nav filtering is a UX affordance, not a security control.
