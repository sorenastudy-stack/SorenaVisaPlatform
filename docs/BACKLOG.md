# Standing backlog

Open items carried between sessions. Not a roadmap — just the things that were
deliberately deferred, with enough context to pick each one up cold.

Last updated: 14 August 2026.

---

## Small / quick

### Audit untracked `scripts/` files for stale references
**DONE — 14 Aug 2026.** Full sweep of all 54 files in `backend/scripts/`.

Five were rotted, all the same root cause: **service-constructor arity drift** (services
gained dependencies, the scripts still built them with the old argument count), so none had
run since those services changed. Four were fixed by supplying the missing arguments;
`e2e-onboarding-smoke.ts` was deleted with the Owner's per-file confirmation — broken *and*
asserting `liaPrice === 150`, a price disproved the day before.

`test-slot-engine.ts` (tracked) also seeded a literal `amountNZD: 150` — the pre-Phase-E NZD
price. Now derived from `getSessionConfig('LIA').price`, so it cannot drift again. Note for
whoever touches it: that column holds the **pre-GST base**, so a GST-inclusive figure would
be taxed twice (58.00 -> 66.70 correct; 66.70 -> 76.71 wrong).

The remaining 49 were checked beyond typecheck — DocuSign is still live (24 src files), the
`SALES` role is still a valid enum kept for legacy rows, and every HTTP path referenced still
exists — and found healthy. **The whole backend now typechecks clean including `scripts/`,
which it did not before.**

⚠ **Caveat for the next sweep:** 26 of these scripts use `as any`, often casting entire
services. A clean typecheck does **not** prove a script is healthy — `test-slot-engine.ts`
compiled perfectly while seeding a price that no longer existed. None were executed: several
are unsafe to run blind (`send-real-onboarding.ts` fires a real email,
`catalogue-import-prod.ts` runs against production, `purge-test-fixtures-local.ts` deletes
rows).

### Stale `.gitignore` line
**DONE — 14 Aug 2026.** Removed alongside the sweep, as its own note suggested.

### Delete `SESSION_CARD_FEE_PERCENT` from Railway
**Done / not needed** — it was never set in any service or environment. Kept here only so
nobody re-checks.

---

## Money & billing

### Group 2/3 fee-string cleanup — derive ALL fee copy from `fee-config`
The structural cure for the bug class that appeared **four times in one day** (account
opening, chatbot CTA, hard-stop resolutions, consultation pricing). Every remaining
hand-written price should come from `feeLabel()` / `calculateFeeBreakdown`.

Known instances:
- `bands.ts` revenue labels — `'NZD 30 + NZD 50'` (should be USD 20 + USD 50) and three
  `'USD 200'` missing GST. Internal/planning labels; no client render found.
- `ConsultationLinkGenerator.tsx` — four hand-computed totals, correct today, will rot.
- `en.json` — `"Admission Consultation ($50)"`.
- **Booking cards say "USD 66.70" where the chatbot says "USD 66.70 including GST".**
  The numbers agree, so no client is misled; fold the wording into the same pass.

Context: `PHASE_GST_PRICING_CORRECTION.md` §7.

### AR redesign — link `Payment` to `Invoice` properly
`Payment` has no `invoiceId` column; the link is a soft `metadata.invoiceId`. All three
payment paths now write a Payment row (`b2ef3dc` closed the last one), so this is no
longer urgent — but the residual gap stands: **an invoice marked PAID by any other or
future route still shows nothing on the client's Payments page**, because history is
built from payments rather than merged with paid invoices. The schema comment anticipates
this redesign.

---

## Client portal

See `AUDIT_CLIENT_PORTAL_2026-08-13.md` for the full inventory and status table.

- **Known issue #3 — payment gate fails closed.** Accepted for later. Reproduction and
  the cheap mitigation (treat an errored access check as *unknown*, not *unpaid*) are in
  the audit doc.
- **Findings 5–14 open and unprioritised** — dashboard states two untrue things, a raw
  `tickets.department.null` badge, "My Assessment" dead-ends silently, the assistant
  renders raw markdown and leaks the internal `DRAFT` stage name, `/student/meetings` is
  an orphan route, and more.

### Persian / RTL
Six-item queue in the audit doc: Explore (242 English words), Recommendations (61), the
14-step admission forms (52), two shell strings on every page, un-localised relative times
and ISO dates, and the "What to do next" block.

⚠ **All Persian copy added on 13 Aug 2026 is unverified by a native speaker.**

---

## Engineering health

### Backend test suite is flaky in parallel
5–8 integration suites fail on shared-database contention; the failing set varies run to
run; each passes in isolation. **Green at 103/103 with `--runInBand`.** Pre-existing, not
caused by any recent change. Means "the suite is green" is currently only true serially.
Real fix is test isolation (per-worker database).

### Values shared across the server/client boundary
`PAYABLE_STATUSES` was defined in a `'use client'` module and imported by Server
Components; in a production build it arrived as a client *reference*, `.includes()` threw,
a silent catch swallowed it, and the "Outstanding" section never rendered. Fixed in
`c933160`. **Other values may cross the same boundary the same way** — worth a sweep for
server components importing non-type, non-component exports from `'use client'` files.

---

## Blocked / awaiting someone else

- **Agent Portal Phase 3** — DocuSeal contract signing for agents. Plan approved; held for
  the real template (id, party names verbatim, prefill field names including the rate
  label). Six decisions recorded.
- **DocuSeal engagement-letter wording** — the Owner was checking whether the template
  states a fee; it lives in DocuSeal's editor, outside the repo, so the GST correction did
  not cover it.
