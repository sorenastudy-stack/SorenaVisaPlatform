# Standing backlog

Open items carried between sessions. Not a roadmap — just the things that were
deliberately deferred, with enough context to pick each one up cold.

Last updated: 13 August 2026.

---

## Small / quick

### Audit untracked `scripts/` files for stale references
Same failure mode as `SESSION_CARD_FEE_PERCENT`, found while cleaning that up.
`backend/scripts/` holds local harnesses that are gitignored, ship nowhere, and have
rotted against the code they test — they import deleted exports and assert figures that
are no longer correct. A "verification suite" asserting the old numbers is worse than no
suite: someone runs it, sees red, and "fixes" the code backwards.

Known rotted (as of 13 Aug 2026):
- `e2e-onboarding-smoke.ts` — references `priceNZD`, renamed in Phase E
- `test-client-contract-onramp.ts` — calls with wrong arities
- `test-contract-capture.ts` — same

`test-session-pricing-usd.ts` was the fourth and was deleted (it asserted the pre-GST
prices). The fix is the same shape each time: check whether the script is still
referenced, then delete or update. Quick when picked up.

⚠ These are **untracked** — deleting one is irreversible, so confirm with the Owner
before removing rather than assuming.

### Stale `.gitignore` line
`backend/.gitignore:15` still ignores `scripts/test-session-pricing-usd.ts`, deleted
13 Aug 2026. Harmless. Sweep it opportunistically next time that area is touched — not
worth a solo commit.

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
