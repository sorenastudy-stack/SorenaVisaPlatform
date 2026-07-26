# Phase 26 — Client Portal Polish (gold, accents, one primary action, no ID leak)

End-of-phase handover for the client-portal visual polish identified by the Phase-25.5
portal scan. Scoped **strictly to the client app** (`/portal` + `/student`). **Persian /
RTL was deliberately NOT touched — it is the explicitly deferred next phase (see §7).**

**Date:** 2026-07-27
**Commit (this phase):**
- `e388462` — fix(portal): Phase 26 client polish — unify gold, on-brand accents, one Pay-now, no ID leak

---

## 1. What this phase does

Four fixes, in the priority order requested:

1. **Demo seed data deleted.** The two screenshot demo users (`ava.student@demo.local`,
   `reza.lead@demo.local`) and their whole graph (contacts, leads, cases, invoices,
   payment, wallet + ledger) were removed from the local dev DB. *(DB-only cleanup — no
   code artifact; the seed/delete scripts live in the session scratchpad, not the repo.)*
2. **Dual-gold unified to the spec gold `#c9a961`** across the client app.
3. **`/student` dashboard rainbow accents** (orange/blue) replaced with the navy/gold
   palette; genuine success states moved to the approved jade token.
4. **Lead "My Case"**: collapsed two competing "Pay now" buttons to **one** primary
   action, and replaced the raw **`INV-LEAD-SVC`** invoice-ID leak with human copy.

## 2. Files created or changed

Pulled from `git show --stat e388462` — **23 files, all client-facing + one backend
service. Zero staff files.**

*Backend*
- `backend/src/portal/portal.service.ts` — `buildNextSteps`: added `description` to the
  invoices `select`; the non-engagement invoice label is now `Pay ${description}` instead
  of `Pay invoice ${invoiceNumber}`.

*Frontend — gold sweep (raw literals + client `sorena-gold` class → `#c9a961`)*
- `app/portal/{booking,case/page,case/pay}` , `app/student/page`,
  `app/student/case/messages/{page,ReplyComposer,FulfilRequestButton}`,
  `components/portal/{ClientShell,ClientPortalHeader,PaymentGatePanel,ReloginBanner,UpcomingBookings,CopyButton}`,
  `components/dashboard/ProgressCard`, `components/student/StudentHeader`,
  `components/student/admission/{ReadOnlyView,StageProgressBar,StepFooter,StepNav}`,
  `components/student/chat/ChatMessageBubble`,
  `components/student/visa/{DocumentMetadataPicker,OtherEvidenceCard}`.

*Frontend — semantic edits*
- `app/student/page.tsx` — dashboard stat-card accents (§4).
- `app/portal/case/page.tsx` — one-primary-Pay-now logic (§5).

## 3. The dual-gold decision (important)

The design spec says gold = **`#c9a961`** (muted antique), but the app had drifted to a
brighter **`#F3CE49`** (plus a darker `#b8941f`/`#d4a51e` companion). Three delivery
methods existed: raw `#F3CE49` literals, raw `#c9a961` literals, and the `sorena-gold`
Tailwind **token** (which was `#F3CE49`).

**The `sorena-gold` token is shared with the staff app** (staff dashboards use both the
token *and* raw `#F3CE49`). Flipping the token to `#c9a961` would have silently repainted
the entire **staff** dashboard — out of scope for this phase. So the unification was done
**client-only**:

- Raw `#F3CE49` → `#c9a961`; darker `#b8941f` / `#d4a51e` → **`#b28f4e`** (a darker
  companion of the spec gold, for hover/border depth).
- Client `sorena-gold` **class** usages → arbitrary `[#c9a961]` (e.g. `text-sorena-gold`
  → `text-[#c9a961]`), so they no longer depend on the shared token.
- **The shared `sorena-gold` token is left as `#F3CE49`** — staff is untouched.
- One dark-gold **text** color, `#8a6d10` (used for legibility on cream in "Check your
  email" / "In review" labels), was intentionally kept — `#c9a961` on cream is too low
  contrast for small text.

**Net:** within the client app there is now a single gold (`#c9a961`). The one remaining
"two golds in the codebase" fact is the **staff** app still on `#F3CE49` — see §7.

## 4. Dashboard accents (`/student`)

The stat-card icon tiles were a grab-bag (blue / orange / green). Remapped to the palette:

| Tile | Before | After |
|---|---|---|
| Visa section | gold | gold `#c9a961` (unchanged intent) |
| Messages | `blue-50` / `blue-600` | navy `#1E3A5F` tint + navy icon |
| Payments (outstanding) | `orange-50` / `orange-600` | gold `#c9a961` tint + gold icon |
| Payments (all paid up) | `green-50` / `green-600` | **jade `#15a86b`** (approved success token) |
| "Case active" check | `green-400` | jade `#15a86b` |

Genuine *success* states use **jade** (`sorena-jade`, already in the approved palette);
neutral/action tiles use navy/gold. Nothing off-palette remains.

## 5. Lead "My Case" — one primary action + no ID leak

- **One Pay-now.** `buildNextSteps` can emit several INVOICE steps (engagement fee +
  service fees). The page now computes `firstInvoiceIdx` and renders the **primary navy
  "Pay now" button only for the first** payable invoice; any further invoice renders a
  low-emphasis underlined **"Pay"** link. One clear primary action per screen.
- **No raw invoice IDs.** The client previously saw `Pay invoice INV-LEAD-SVC`. The label
  now uses the invoice's human `description` → **"Pay visa application service fee"**.
  Engagement invoices still read "Pay engagement fee". The raw `ENG-`/`INV-` number is
  never surfaced.

## 6. How to test it works

**Visual (the method used to verify this phase):** the client portal needs an
authenticated session. Seed a paid STUDENT + a pre-payment LEAD, mint a `sorena_session`
JWT (HS256, `JWT_SECRET`) — the SSR layer forwards it to the backend as a Bearer token —
run backend + `next dev`, and screenshot at 390 px with a headless Chromium. Confirm:
1. `/student` — the "View My Case" CTA and all accents are the muted `#c9a961`; the
   Messages tile is navy, the Payments tile gold; no bright gold, no orange/blue.
2. Lead `/portal/case` — exactly **one** navy "Pay now" button; the second invoice is a
   subtle "Pay" link; the step reads "Pay visa application service fee" (no `INV-…`).

*(This phase's verification screenshots were captured and reviewed; the seeded demo data
was deleted again afterwards — the local dev DB is clean.)*

**Static:** `grep -rniE "#F3CE49|#b8941f|#d4a51e" app/portal app/student components/{portal,dashboard,student}`
returns **0**. Frontend `tsc --noEmit` is clean on the two semantically-edited pages.

## 7. Known limitations / DEFERRED — Persian / RTL is the next phase

**Persian / RTL was intentionally not touched in this pass.** Everything the portal scan
surfaced about it carries over to its own dedicated phase:

- **Untranslated strings** — `portal.nav.*` and most page/component bodies are English
  placeholders (or blank) in `fa.json`; `/student/*` pages use no `t()` at all.
- **Locale doesn't persist** — the Zustand store defaults to `en` with no cookie/
  localStorage, and the server always renders `lang="en"` / LTR (client-only `dir` flip).
- **RTL layout artifacts** — date reads "Jul 2026 27", a period jumps to the front of
  ".You have no upcoming sessions", and the "My Case" timeline **rail sits on the wrong
  (left) side** under `dir="rtl"` (≈93 physical `ml-/mr-/pl-/pr-/left-/right-` classes
  across ~40 client files with no `rtl:`/logical variants).

These are **out of scope for Phase 26** and unblocked for the Persian/RTL phase.

Other non-blocking follow-ups:
- **Staff app still on `#F3CE49`.** To make gold consistent app-wide, a later staff-polish
  pass can flip the shared `sorena-gold` token to `#c9a961` and sweep staff raw literals.
- **Touch targets** — a few client header controls are `min-h-[40px]` (below the 48 px
  bar); not addressed this phase.

## 8. Security layers applied

**None changed.** Colour/label/rendering only. The invoice-label change *reduces* data
exposure (no internal reference codes reach the client). No new endpoints, secrets, or
PII surfaces.

## 9. Rollback

Additive/cosmetic — a straight `git revert e388462` restores the prior gold, accents,
dual Pay-now buttons, and the `Pay invoice <number>` label. No DB or env changes to undo.
