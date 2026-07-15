# PR-BOOKING-ELIGIBILITY — live, reconciled, enforced booking eligibility

Booking eligibility now has a single, LIVE source of truth. It fixes three bugs
from the scan: the "unlock after the LIA clears it" that never fired (stale
snapshot), grey-paint buttons that weren't real gates (unenforced), and the
scenario A-F logic trapped inside the report (inline). It also implements the
flag-3 decision: **LIA is a paid service, always bookable when a verified adviser
is available** — no longer gated on a hard stop.

## 1. What this PR does

- Adds `GET /booking/eligibility` returning per-type `{ eligible, reason }` for
  FREE_15 / GAP_CLOSING / LIA — the acting JWT client only, live.
- Reads `band` from the latest submission (snapshot is honest — nothing mutates
  band post-submit) and the hard-stop **live** from the **Case lead**
  (`Case.lead.hardStopFlag`) when an active Case exists, else the submission
  lead. `hardStopSource` reports which.
- Reconciles BOTH layers with a fixed precedence — **band → live-hard-stop →
  booking-flow gate → eligible** — and returns the BINDING reason.
- Enforces server-side: `assertEligible(userId, type)` runs inside
  `createFreeBooking` and `createHold` (service layer), so no write path can be
  bypassed by the UI. Ineligible → `ForbiddenException` (403), distinct from the
  409 slot-taken.
- Refactors `ScorecardResultClient` to consume the endpoint. Buttons carry a
  REAL `disabled`; reason copy is server-provided. The hard-stop **list** still
  renders from `data.hardStops` (historical display is correct).

**Unchanged on purpose:** `primaryType` preserves the report's headline CTA
(hard stop → LIA; else band 4-6 → FREE_15; band 3 → GAP; band 1-2 no hard stop →
nurture). Staff scorecard views still display the submission snapshot.

## 2. Files changed

**Backend**
- `src/booking/booking-eligibility.service.ts` — **new** `BookingEligibilityService`
  (`getEligibility`, `assertEligible`, per-type evaluators, reason copy).
- `src/booking/booking.controller.ts` — `GET /booking/eligibility` (`@Throttle`).
- `src/booking/booking.service.ts` — inject the service; `assertEligible` calls
  in `createFreeBooking` + `createHold`.
- `src/booking/booking.module.ts` — register + export the service.

**Frontend**
- `src/lib/booking/eligibility.ts` — **new** client type + `getBookingEligibility()`.
- `src/components/scorecard/ScorecardResultClient.tsx` — consume the endpoint;
  real `disabled` buttons; inline scenario A-F + `WHY_*` copy removed.

**Test (local-only, gitignored):** `backend/scripts/test-booking-eligibility.ts`.

No schema change. No migration.

## 3. Schema added

**None.** All reads over existing models: `ScorecardSubmission` (band, leadId),
`Case → lead.hardStopFlag`, `Lead.hardStopFlag`, `Consultation` (free-once),
`User + LiaProfile` (verified-LIA count).

## 4. Endpoint contract

`GET /api/booking/eligibility` — **LEAD/STUDENT only**, acting JWT user only
(never accepts a `userId`). `@Throttle({ ttl: 60000, limit: 30 })` on top of the
global baseline.

```jsonc
{
  "hasSubmission": true,
  "band": "BAND_4",
  "liveHardStop": false,
  "hardStopSource": "case",           // "case" | "submission" | null
  "types": [
    { "type": "FREE_15",     "eligible": true,  "reason": "…", "paid": false, "priceNzd": 0   },
    { "type": "GAP_CLOSING", "eligible": false, "reason": "…", "paid": true,  "priceNzd": 30  },
    { "type": "LIA",         "eligible": true,  "reason": "…", "paid": true,  "priceNzd": 150 }
  ],
  "primaryType": "FREE_15"            // headline CTA (or null → nurture / no submission)
}
```

### The reconciled matrix
| Type | Eligible when | Binding block reasons (precedence order) |
|---|---|---|
| FREE_15 | band 4-6 **and** no live hard stop **and** free unused | no submission → band<4 → live hard stop → free-once used |
| GAP_CLOSING | band == 3 **and** no live hard stop | no submission → wrong band → live hard stop |
| **LIA** | verified adviser available (**flag-3: no band/hard-stop gate**) | no submission → no verified adviser |

## 5. Configuration

None. No env vars. Prices/`requiresLia` come from the existing `session-config`;
reason copy is plain English constants in the service (no `t()` keys, Persian
frozen — copy is returned in the payload so both pages render identical text).

## 6. How to test (automated)

`backend/scripts/test-booking-eligibility.ts` (local, gitignored) — 14/14 checks,
run entirely inside a rolled-back transaction (services constructed on the tx
client), so global verified-LIA state is controlled and nothing persists:
```
cd backend && npx ts-node scripts/test-booking-eligibility.ts
```
Covers: Band-4 free eligible; live hard stop on the Case lead blocks FREE_15;
**clearHardStop → FREE_15 unlocks** (the bug); free-once precedence over band;
LIA eligible with no hard stop (flag-3); no verified adviser blocks LIA;
no-submission → all ineligible; and `assertEligible` rejecting at both
`createFreeBooking` and `createHold` with 403.

## 7. Known limitations

- **Lead-per-submission:** each submission spawns a new Lead. The live hard-stop
  reads the **Case lead** (where the LIA clears) and only falls back to the
  submission lead when no active Case exists — a post-Case resubmission's stray
  Lead is intentionally ignored (Case wins, per the agreed decision).
- **`band` is a snapshot** — honest, since nothing mutates band post-submit; only
  a resubmission changes it.
- **Multiple active Cases** (edge): the most-recent active Case's lead is used.
- The endpoint reports **verified-adviser existence**, not per-slot availability;
  an empty calendar is still handled by the slot layer.

## 8. How to extend

- New session type: add to `session-config`, add an evaluator + reason to
  `BookingEligibilityService`, and it appears in `types[]` automatically.
- The (next) standing booking page consumes the same `types[]` — both pages agree
  by construction.

## 9. Security layers applied

- **Acting-user only** — the endpoint reads `req.user.userId`; no `userId` param.
- **Role-gated** — class-level `@Roles('LEAD','STUDENT')` + `JwtAuthGuard`.
- **Server-side enforcement in the service layer** — `assertEligible` in
  `createFreeBooking`/`createHold`, so the write paths reject ineligible bookings
  (403) regardless of what the UI renders. Free-once is also still enforced in
  `createFreeBooking` as a backstop.
- **Rate-limited** — `@Throttle` on the endpoint.
- **Read-only endpoint** — no mutations.

## 10. Rollback procedure

- **Code:** revert the commit. The report falls back to… nothing else depends on
  the endpoint; reverting restores the inline scenario logic. No data touched.
- **Schema:** none added — nothing to roll back.
- **Order:** deploy backend before frontend (the report calls the new endpoint);
  on rollback, revert frontend first.
