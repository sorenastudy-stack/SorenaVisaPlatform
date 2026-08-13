# Client portal audit — 13 August 2026

**Scan only. No code changed; working tree clean.**

Every route under `/portal` and `/student`, exercised in a real browser as three real accounts.
Nothing below is inferred from phase docs.

## Status of these findings (updated 13 Aug 2026, end of session)

| # | Finding | Status |
|---|---|---|
| 1 | Consultations charged without GST + flat 10% card fee | **FIXED** — `0de6a8a` |
| 2 | Payments page can never show a paid invoice | **FIXED** — `b2ef3dc` |
| 3 | Payment gate fails closed under a shared rate limit | **FIXED** — 14 Aug 2026 |
| 4 | Raw database IDs on the dashboard | **FIXED** — this commit |
| 5-14 | Unambiguous set (raw i18n key, assistant markdown, 2 shell strings, false "being processed") | **FIXED** — 14 Aug 2026 |
| 5-14 | Ticket-count contradiction | **DOES NOT REPRODUCE** — see the two-ticket-models entry in `BACKLOG.md` |
| 5-14 | Four judgment calls (assessment dead-end, `DRAFT` leak, orphan route, empty wallet card) | open — awaiting an Owner decision |

### Finding #3 — FIXED, 14 Aug 2026

The shell defaulted `paymentUnlocked = false` on any error from `/portal/me/access`, so a
transient failure showed a paying client locks on features they own (0 locks -> 5 once the
shared rate limit tripped).

Failing closed read as caution but bought nothing: the flag is **presentation only** —
`EngagementPaidGuard` re-reads the engagement invoice from the database on every gated
request and 403s regardless. Verified before relying on it, rather than trusting the note.

An error now means **unknown, not unpaid**. The last definitive answer per user is kept as a
fallback (10-minute TTL, consulted only on failure so a client who has just paid still sees
the gate open on their very next render). With no answer at all, the shell declines to
assert a lock — claiming somebody has not paid is a statement about their money, and not
something to guess at when the network is unhappy. The page itself is still refused
server-side.

Verified by recreating the original condition, not a stand-in — 11/11:

```
baseline          paid 0 locks   unpaid 5 locks   access 200
throttle tripped after 58 calls -> access 429
WHILE THROTTLED   paid 0 locks (was 5)            unpaid 5 locks (last known answer)
                  unpaid still 403 on the gated endpoint
after recovery    paid 0 locks   unpaid 5 locks
```

**Still open — the deeper cause.** Server-rendered calls reach the backend from the frontend
service's own IP (`apiServer` forwards no client IP), so every client shares one rate-limit
bucket and the shell spends ~4 requests per page render. The fix above stops the *symptom*
being wrong; it does not stop the bucket being shared. Tracked in `BACKLOG.md`.

## Method

- Production build of the frontend + backend against the development database, driven by a real
  browser with real session cookies — **not** `next dev` (the `'use client'` export bug found
  earlier today does not reproduce in dev).
- Three accounts: **STUDENT with a paid invoice** (gate open), **STUDENT unpaid** (gate closed),
  **LEAD**. 20 routes each, plus a separate Persian pass.
- Captured per page: final URL after redirects, console errors, failed backend calls, full rendered
  text, screenshot. Endpoint payloads were then compared against what the page displayed.
- Production touched **read-only**, for catalogue data quality only.
- ⚠ **Caveat worth keeping:** the harness initially tripped the API rate limit, which made every
  later page render a *false* locked gate. Requests were spaced afterwards. That accident is
  finding #3.

Counts: **1 money bug · 3 high · 6 medium · 4 low · 7 verified solid.**

---

## 1. CRITICAL (money) — consultations are charged without GST, and with a different card-fee model

`backend/src/booking/session-pricing.ts` · `/portal/booking`

The same class of bug fixed this morning for the account-opening fee, still live on all three
consultation types — and this is the **charged** amount, not a label. The wallet debit and the card
charge both derive from the base price with no GST. The card fee is a flat **10%**, while
`fee-config` uses Stripe's 2.9% + $0.30.

```
type          charged(wallet)  charged(card)  |  fee-config bank   fee-config card
GAP_CLOSING          20.00          22.00     |        23.00            23.97   short 3.00 / 1.97
LIA                  58.00          63.80     |        66.70            68.93   short 8.70 / 5.13
```

Three client-facing surfaces disagree about one service: the booking page says **USD 58.00**,
`fee-config` says **USD 66.70**, and the chatbot — corrected this morning — tells clients
*"USD 66.70 including GST"*.

## 2. HIGH — the Payments page can never show an invoice a client has paid

`/portal/payments` · `/student/payments` · `model Payment`

> **Correction (added after the follow-up scan).** Two claims here were wrong. There *is* a
> working soft link — `Payment.metadata.invoiceId`, stamped by the pay-link path and already
> resolved by `getMyPayments` — so the card path worked end to end. And bank transfers were
> not universally Payment-less: the staff *manual* endpoint writes a proper row. The real
> defect was narrower: the **receipt-confirmation path wrote no Payment at all**. Fixed in
> `b2ef3dc`.

`Payment` has **no `invoiceId` column**; it stores Stripe webhook events only. A paid invoice is
filtered out of "Outstanding" and has nothing to appear as in history, so the page shows
*"No payments yet — your payments and receipts will appear here once you've made one."* to somebody
who has paid. **Bank transfer — the recommended method — creates no Payment row at all.**

```
dev database: 109 PAID invoices, 0 Payment rows
```

The schema comment acknowledges it: the AR domain is to be redesigned "when the student invoice
receipts page ships out of Coming soon".

**Consequence for today's work:** the new Tax invoice download never appears on the Payments page
for a paid invoice — it is reachable only from `/portal/case/pay`.

## 3. HIGH — the payment gate fails closed and shows paid clients locks on what they own

`frontend/src/lib/clientShellData.ts`

The shell calls `/portal/me/access` on every render and defaults to `paymentUnlocked = false` on
*any* error — throttle, timeout, backend blip. The global limit is 60 req/60s. These are
server-rendered calls and `apiServer` forwards no client IP, so every client's page render reaches
the backend from the frontend service's own address and they share one bucket.

```
baseline                        access=200   0 locked nav items
after 59 calls                  throttle trips
while throttled                 5 LOCKED nav items for a client who HAS paid
a different client, same moment also 429
```

**Honest bound:** 31 sequential page loads by one client did *not* trip it. This is a fragility
under aggregate load rather than a guaranteed daily failure — but it fails silently and in the
wrong direction.

## 4. HIGH — raw database IDs and class names shown to the client

`/student/dashboard` — "Recent activity", both locales:

```
You saved AdmissionApplication
You recorded cms9kh223001tudhw96f998fu
You recorded cms9kgy5k001pudhw9udjof9i
```

## 5–10. MEDIUM

- **The dashboard states two untrue things.** *"Your assessment is being processed"* for a client
  with no assessment (`/scorecard/me/latest` 404s — which is why "My Assessment" redirects away);
  and *"No open tickets"* while `/student/tickets` lists an Open one.
- **A raw translation key renders as UI**: `tickets.department.null` as a badge on the ticket row,
  beside an empty *"Reply:"* label.
- **"My Assessment" silently dead-ends** — `/portal/report` → `/portal/case` with no explanation and
  no invitation to take one. `/student/case` → `/portal/case` likewise.
- **The assistant renders raw markdown** (`**DRAFT**`) and tells the client their case is in
  *DRAFT* — an internal enum, not the language the rest of the portal uses.
- **The assistant page invites typing with nothing to type into** — no composer until
  "New conversation" is clicked. Works end to end once started.
- **Two shell strings untranslated on every page**: "CLIENT PORTAL" and "Recommendations". The
  latter is hardcoded (`{ labelKey: 'Recommendations' }`, a literal not a key) to keep Persian
  frozen; that freeze has outlived its reason.

## 11–14. LOW / UX

- `/student/meetings` is an **orphan** — not in the sidebar, bare "No meetings yet", no next action,
  not even a link to Booking.
- `/portal/case` "MY WALLET" card shows a heading and a chevron and **nothing else**.
- `/student/explore` map notice lists every affected institution inline in one run-on sentence
  (80 in dev; production is 4 of 96, so mild there — the pattern doesn't degrade well).
- Persian dashboard renders `2026-07-31` in Latin digits where the rest of the portal localises.

---

## Page by page

| Route | Purpose | State | What's wrong |
|---|---|---|---|
| `/portal` → `/portal/case` | Case overview, next steps, timeline | Works | Empty "My wallet" card; "What to do next" untranslated |
| `/portal/case/documents` | Document list + upload | Renders | Upload not exercised |
| `/portal/payments` | Outstanding + history | **Broken** | Cannot show a paid invoice; no tax-invoice button here |
| `/portal/case/pay` | Choose payment method | Works | Verified earlier today; USD 230.00 consistent |
| `/portal/report` | Readiness report | **Unverified** | No submitted assessment exists in this DB |
| `/portal/wallet` | Credit balance + activity | Works | Clean, fully translated — prior "English-only" flag is **stale** |
| `/portal/booking` | Book a consultation | **Prices wrong** | Pre-GST prices shown *and charged* |
| `/student` | Student home | Works | — |
| `/student/dashboard` | At-a-glance | **Wrong data** | Raw DB IDs; false assessment status; ticket count contradicts tickets page |
| `/student/case` | Case detail | Redirects | Silently lands on `/portal/case` |
| `/student/case/messages` | Message thread | Renders | Empty here; sending not exercised |
| `/student/chat` | AI assistant | Works, rough | No composer until "New conversation"; raw markdown; leaks "DRAFT"; not in nav |
| `/student/admission` | 14-step application | Renders | Largely English in Persian; steps beyond first not exercised |
| `/student/documents` | Visa checklist | Works | Richest page in the portal; minor English strings |
| `/student/explore` | Browse programmes | Works | Essentially untranslated; map notice verbose; demo records are dev-only |
| `/student/meetings` | Meetings | Orphan | Not in nav, no next action |
| `/student/payments` | Same as `/portal/payments` | **Broken** | Same defect |
| `/student/recommendations` | Matched programmes | Works | Largely untranslated |
| `/student/tickets` | Support tickets | Placeholder leak | `tickets.department.null`; empty "Reply:" |
| `/student/tickets/new` | Open a ticket | Renders | Submission not exercised |

## Persian & RTL

RTL mirroring works correctly on every page checked — sidebar, alignment, icon direction all flip.
Coverage measured as Latin words beyond the 8-word baseline (brand, account email, and the two
untranslated shell strings).

| Route | English words beyond baseline | Verdict |
|---|---|---|
| `/portal/payments`, `/portal/wallet`, `/portal/booking` | 0 | Complete |
| `/student/chat`, `/student/meetings`, `/student/case/messages`, `/student/tickets/new` | 0 | Complete |
| `/student/payments` | 3 | Near complete |
| `/student/tickets` | 7 | Key leak |
| `/student/documents` | 11 | Partial |
| `/portal/case` (and `/portal`, `/portal/report`, `/student/case`) | 13 | "What to do next" English |
| `/student` | 23 | Partial |
| `/student/admission` | 52 | Mostly English |
| `/student/recommendations` | 61 | Mostly English |
| `/student/explore` | 242 | Untranslated |

Prior flags: **wallet** and the **payment-gate panel** are now fully translated — those notes are
**stale**. The **14-step forms** flag is **confirmed still true**. The **assessment/report view**
could not be checked for lack of data.

### Persian/RTL backlog

Carried forward as one queue rather than fixed piecemeal:

1. **`/student/explore`** — 242 English words; effectively untranslated.
2. **`/student/recommendations`** — 61 English words.
3. **`/student/admission`** — the 14-step forms, 52 English words.
4. **Shell strings on every page** — "CLIENT PORTAL", and "Recommendations", which is a
   hardcoded literal (`{ labelKey: 'Recommendations' }`) rather than a key.
5. **Dates and relative times are not localised.** `formatRelativeTime` renders "57m ago" in
   English on the Persian dashboard, and absolute dates render as ISO `2026-07-31` in *both*
   languages where the rest of the portal localises them. Noticed while fixing the activity
   feed (`bd836af`) and deliberately not folded in — same card, different mechanism.
6. **`/portal/case`** — the "What to do next" block, 13 English words.

⚠ All Persian copy added this session is **unverified by a native speaker**, consistent with
the flag raised in `PHASE_GST_PRICING_CORRECTION.md`. Treat as pending translation review.

## What is solid

- **Access control holds.** A LEAD is redirected to `/unauthorized` on all 20 `/student` routes. The
  unpaid gate blocks Explore, Recommendations, Documents, Visa and Apply server-side (403) and the
  UI explains it well — "Programmes unlock after payment" with a direct *Go to payments* button.
- **Core pages are coherent and well built** — case overview, wallet, documents checklist, gate
  panels. The assistant gives accurate, case-aware answers. The tax invoice shipped today downloads
  correctly from the pay screen.
- **Production catalogue data is clean**: 96 providers (0 generated names, 4 missing a map pin),
  1129 programmes (0 generated names). The machine-named institutions on Explore are a dev seed
  artefact and do not exist in production.

## Not verified — and why

- **`/portal/report` with real data** — zero submitted assessments exist in this database; only the
  no-assessment path was observed.
- **Write actions** — document upload, ticket creation, message sending, admission steps beyond the
  first render. Read-only sweep by design.
- **Booking checkout** — deliberately not completed; it creates a real hold and a charge. The prices
  above come from the pricing payload the page itself uses.
- **Dynamic routes** — `/student/explore/[programmeId]`, `/student/tickets/[id]`.
- **Production portal pages with a client session** — the sweep ran against a local production build
  on the dev database.

## Suggested order

1. **Consultation GST + card fee.** Money, live, and it contradicts a price the chatbot was
   corrected to state this morning. Same fix shape as the account-opening fee.
2. **Payments page can't show a paid invoice.** Affects every client who pays by the recommended
   method, and currently caps the reach of the tax invoice.
3. **Raw IDs on the dashboard** and the `tickets.department.null` badge — small, visible, and they
   read as unfinished software to a paying client.
4. **Fail-closed payment gate.** Cheap mitigation: treat an errored access check as *unknown* rather
   than *unpaid*, or cache the last known-good answer per session.
5. **Persian on Explore, Recommendations and the 14-step forms**, plus the two shell strings.
6. **The dashboard's false statements** and the silent "My Assessment" redirect.
