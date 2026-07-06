# /portal/case Stage-1/Stage-2 branching — deep review

**Scope:** the uncommitted client-portal branching work. **Status:** review only —
no code changed by this review; nothing committed.

**Files under review (all uncommitted):**
- `frontend/src/app/portal/case/page.tsx` (modified)
- `frontend/src/components/portal/AssessmentPdfButton.tsx` (new)
- `frontend/src/i18n/messages/en.json` (modified)
- `frontend/src/i18n/messages/fa.json` (modified)

**Verification method:** read the actual source end-to-end; cross-checked routes,
the scorecard endpoint payload, i18n keys in both locales, role guards, and ran
`npx tsc --noEmit` filtered for the touched files (clean).

---

## Summary

| # | Check | Verdict |
|---|-------|---------|
| 1 | Stage-2 renders only when `portalStage==='STAGE_2'` | ✅ Correct |
| 2 | Contract prompt fires for DRAFT too | ⚠️ Needs decision |
| 3 | Four Stage-2 links real + STUDENT-reachable | ✅ Valid; 1 judgment call |
| 4 | Assessment card hides when no submission | ✅ Correct |
| 5 | New strings i18n'd, fa placeholders + TODO, no hardcoded English | ✅ Correct |
| 6 | No sensitive data; `portalStage` server-derived; no weakened guards | ✅ Correct |
| 7 | Navy/gold calm styling, mobile-ok | ✅ Correct |
| 8 | tsc / import errors | ✅ Clean |

**Auto-fixed this pass:** none — every clearly-safe category came back clean.
**Awaiting your decision:** 3 judgment calls (items 2, 3, and one extra observation).

---

## Findings

### 1. Stage-2 gating — ✅ CORRECT
`page.tsx:216` renders the section under `{portalStage === 'STAGE_2' && (…)}`.
`portalStage` defaults to `'STAGE_1'` (`page.tsx:129`) and is only overwritten from
the server via `GET /portal/me/stage` inside a `try` that swallows any error back to
`STAGE_1` (`page.tsx:130-135`). A STAGE_1 client — or any error/timeout — can **never**
see the Stage-2 section.

### 2. Contract-ready prompt fires for DRAFT — ⚠️ NEEDS-YOUR-DECISION
The prompt keys off `caseData.nextSteps.some(s => s.kind === 'CONTRACT')`
(`page.tsx:151`). The backend emits that step for `['DRAFT','SENT','VIEWED']`
(`backend/src/portal/portal.service.ts:97`). So a `DRAFT` contract (created but not
yet emailed) shows "check your email to sign" prematurely.

**There is no frontend-only fix.** The `CONTRACT` next-step carries only
`{ kind, label }` — **not** the status (`portal.service.ts:98`) — so the page cannot
distinguish DRAFT from SENT/VIEWED. The exact one-line fix is in the **backend**:

```ts
// backend/src/portal/portal.service.ts:97
if (contract && ['SENT', 'VIEWED'].includes(contract.status)) {   // drop 'DRAFT'
```

**Coupling to weigh:** the same step also feeds the "What to do next" list, so this
change also removes "Sign your engagement letter" from that list while DRAFT. That is
arguably *more* correct (a client can't sign an un-sent contract), but it is a
behavior change to the list as well as the prompt — hence your call.
**Not applied.**

### 3. Stage-2 card links — ✅ ALL VALID; two-to-admission is intentional (1 judgment call)
All three target routes exist and are STUDENT-gated (`'/student': ['STUDENT']` in
`frontend/src/middleware.ts:14`). Mapping verified against the real pages:

| Card | Route | Reality | Verdict |
|------|-------|---------|---------|
| Choose your field of study | `/student/admission` | AdmissionFormShell → `programmeChoices` | ✅ |
| Visa application questions | `/student/documents` | **Visa** section (legacy folder name; VisaFormShell → INZ details) | ✅ correct despite name |
| Educational documents | `/student/admission` | AdmissionFormShell **also** holds `educationEntries` + `documents` | ✅ correct, not a copy-paste bug |
| Messages & support | `/student/tickets` | tickets page | ✅ |

No dead links. Open item: **two cards ("Choose your field of study" +
"Educational documents") both deep-link to `/student/admission`** because that single
form covers both. It works but a client may find two cards → one page redundant.
**NEEDS-YOUR-DECISION:** keep both / merge into one / anchor "Educational documents"
to a documents section (e.g. `/student/admission#documents`). **Not changed.**

### 4. Assessment card hides when no submission — ✅ CORRECT
`getMyLatestResult` throws `NotFoundException` when there is no submission
(`backend/src/scorecard/scorecard.service.ts:333`). The page catches it to `null`
(`page.tsx:141-145`) and gates render on `{assessment && …}` (`page.tsx:244`). It
hides cleanly and never throws or blocks the page. The `AssessmentResult` interface
(`submissionId/bandName/bandRange/submittedAt`) matches the real payload
(`scorecard.service.ts:72-100`). Endpoint is `@Roles('LEAD','STUDENT',…)` — reachable
by both client roles.

### 5. i18n — ✅ CORRECT
New visible strings all use `portal.*` keys, present in **both** locales:
`portal.contractReady`, `portal.assessment`, `portal.stage2` (`en.json:1722`,
`fa.json:1724`). fa carries English placeholder values **plus** a `_TODO` marker on
each block — no invented Persian. No hardcoded English literals in the **new** JSX.
(Pre-existing surrounding literals — "What to do next", "Your case timeline", "Open"
at `page.tsx:189/312/206` — are **not** part of this work and are out of scope.)

### 6. Security — ✅ CORRECT
- No sensitive data on `/portal/case`: Stage-2 cards are pure `<Link>`s
  (`Stage2Card`, `page.tsx:352`); the assessment card shows only the client's **own**
  band summary; the PDF is fetched per-request with auth.
- `portalStage` is **server-derived** from `GET /portal/me/stage` — no client-supplied
  value.
- No role guard touched or weakened. Target pages remain independently STUDENT-gated
  by middleware; a promoted-but-stale (still-LEAD-cookie) client is bounced there and
  steered by the ReloginBanner.

### 7. Design — ✅ CORRECT
Navy `#1e3a5f` / gold `#F3CE49`/`#b8941f` throughout; reuses existing card idioms;
`Stage2Card` grid is `grid-cols-1 sm:grid-cols-2` (mobile-friendly); 44px touch
target on the PDF button; calm and uncluttered; consistent with the rest of the page.

### 8. tsc / imports — ✅ CLEAN
`npx tsc --noEmit` filtered for the touched files → **no errors**. All added icons
(`Award, Mail, GraduationCap, ClipboardList, FolderOpen`) and `AssessmentPdfButton`
are imported and used; no unused imports; the `Stage2Card` helper is defined.

### 9. Extra observation — ⚠️ NEEDS-YOUR-DECISION (pre-existing, not a bug introduced here)
For a client with a `SENT` contract, the contract surfaces **twice**: the new
"Your contract is ready — check email" card (correct, no link) **and** the
pre-existing "What to do next" row "Sign your engagement letter" whose **"Open"** link
goes to `/portal/case/documents` (`page.tsx:204-208`) — a page with no sign action.
That "Open" behavior predates this work. Optional reconcile: suppress the "Open" link
for `CONTRACT`-kind steps so the new card is the single source of guidance.
**Not changed.**

---

## What was fixed this pass

Nothing. All clearly-safe categories (broken links, hardcoded strings, tsc/import
errors) came back clean, so there was nothing safe to change.

## What needs your decision

1. **DRAFT contract timing** — apply the backend one-liner
   `['DRAFT','SENT','VIEWED']` → `['SENT','VIEWED']` at `portal.service.ts:97`?
   (Also drops DRAFT from the "What to do next" list — see the coupling note.)
2. **Two Stage-2 cards → same `/student/admission`** — keep both, merge to one, or
   anchor "Educational documents" to a documents section?
3. **Duplicate contract surfacing** — suppress the "Open" link on the `CONTRACT`
   next-step row so it doesn't dead-end at documents while the new card is the real
   guidance? (pre-existing; optional)

---

## How to test every branch (reversible)

Base login: `lead2@booking.test` / `SorenaClient2026!` (LEAD, STAGE_1).

- **A — STAGE_1 baseline:** log in as lead2 → `/portal/case`. Expect hero, "What to do
  next", bookings, wallet, docs card. **No "Your active case" section.** Assessment
  card + contract prompt appear only if that client already has a scorecard submission
  / a DRAFT–VIEWED contract.
- **B — Assessment card:** as any client with a `scorecard_submission`: band name +
  range + "Completed <date>" + a working "Download your assessment (PDF)" button.
- **C — Contract prompt:** give the client's case a contract in `SENT`/`VIEWED`: the
  gold "Your contract is ready — check your email" card appears above "What to do next".
- **D — STAGE_2:** needs contract CLIENT+LIA signers both `signedAt` set
  (→ `portalStage='STAGE_2'`) and the user promoted to `STUDENT`. Log in **as that
  STUDENT** → `/portal/case` shows the four cards; click each into `/student/admission`,
  `/student/documents`, `/student/tickets`. (A scripted, self-reverting setup can mint
  the signers + set `signedAt` + promote + add a scorecard submission + a SENT contract,
  then tear it all down.)
- **E — Negative:** a plain STAGE_1 client never sees the Stage-2 section; a
  promoted-but-stale (still-LEAD-cookie) client sees the ReloginBanner + the cards, and
  clicking a card bounces to login until they re-auth.
