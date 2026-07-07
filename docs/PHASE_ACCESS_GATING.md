# Phase: Client Portal Access Gating + Unified Shell (Piece #4 + nav unification)

## 1. What it does

Two related client-portal changes, shipped together.

**A. Payment access gate (Piece #4).** A client is locked out of their working surfaces — **Documents**, **Visa application**, and **Apply / Study** — until their engagement invoice is **PAID**. "Paid" is the same end-state for all three payment methods (Stripe card auto-reconcile, or an accountant confirming a bank-transfer / partner-exchange receipt). While locked, the client sees a calm gate — **"Your full access opens once we confirm your payment"** — or, once they've uploaded a receipt, the reassuring **"Payment received — we're confirming it"** processing state. The moment the engagement invoice flips to PAID, all three surfaces unlock. Case status and the pay/upload screen stay reachable the whole time.

**B. Unified client shell + "CLIENT PORTAL" label.** The client portal previously rendered two different sidebars — a short one on `/portal/*` and a fuller one on `/student/*` — so a client bounced between inconsistent navigation as they clicked around. It now renders **one consistent sidebar on every client page**, driven by a single shared resolver, with a gold **"CLIENT PORTAL"** sub-label under "Sorena Visa" (styled exactly like the Finance Portal's "FINANCE PORTAL"). A follow-up consistency fix makes **Apply/Study and Visa application show the SAME calm gate** as Documents when locked, instead of a red "Could not start your application" error toast.

## 2. Files changed

**Backend**
- `backend/src/common/engagement-payment.helper.ts` *(new)* — `isEngagementPaid` / `getEngagementGateState` / `resolveOwnCaseId`; the single "is the ENG invoice PAID?" source of truth, fail-safe to LOCKED.
- `backend/src/common/guards/engagement-paid.guard.ts` *(new)* — `EngagementPaidGuard`: resolves the caller's own case from the JWT and 403s until the ENG invoice is PAID.
- `backend/src/documents/documents-access.helper.ts` — the client branch of `checkCaseDocumentsAccess` now requires ENG PAID (staff/admin/slot-holders return `allow` earlier, untouched).
- `backend/src/students/visa/visa.controller.ts` — added `EngagementPaidGuard` to `students/me/visa/*`.
- `backend/src/students/admission/admission.controller.ts` — added `EngagementPaidGuard` to `students/me/admission/*`.
- `backend/src/portal/portal.controller.ts` — new `GET /portal/me/access` route (always allowed).
- `backend/src/portal/portal.service.ts` — `getAccessState()` backing that route.

**Frontend**
- `frontend/src/components/portal/PaymentGatePanel.tsx` *(new)* — the calm gate component (locked + "we're confirming it" processing variants).
- `frontend/src/lib/clientShellData.ts` *(new)* — shared server resolver: builds the one unified sidebar (fuller for STUDENT, reachable subset for LEAD) + stage + payment-gate signals.
- `frontend/src/app/portal/layout.tsx` — renders the unified sidebar via the shared resolver.
- `frontend/src/app/student/layout.tsx` — renders the **same** unified sidebar via the shared resolver.
- `frontend/src/components/portal/ClientShell.tsx` — sub-label is now **"CLIENT PORTAL"**; lock icon on gated nav items (Documents / Visa / Apply).
- `frontend/src/app/portal/case/documents/page.tsx` — renders `PaymentGatePanel` when unpaid (original Piece #4 gate).
- `frontend/src/app/student/admission/page.tsx` — access check → `PaymentGatePanel` before the gated fetch (gate-consistency fix).
- `frontend/src/app/student/documents/page.tsx` — access check → `PaymentGatePanel` before the gated fetch (gate-consistency fix).

## 3. Database changes

**NONE.** The gate derives entirely from existing state: the case's engagement invoice (`invoiceNumber = 'ENG-<caseId>'`) reaching `status = 'PAID'`. No new columns, tables, enum values, or migrations.

## 4. Environment variables

**None new.** Uses only existing config (JWT secret for the signed session/token; existing `apiServer` base URL).

## 5. Third-party services

**None new.** The gate only READS existing invoice state (which is set by the already-built Stripe reconciliation webhook or the accountant-confirm flow). No new external calls.

## 6. How to test

**State matrix** (as a client, e.g. `lead2@booking.test`, on their case's ENG invoice):

| ENG invoice state | `GET /portal/me/access` | Documents / Visa / Apply pages | Gated endpoints (direct API) |
|---|---|---|---|
| **SENT (unpaid)** | `{paid:false, processing:false}` | calm gate: "Your full access opens once we confirm your payment" | **403** |
| **SENT + receiptUploadedAt (processing)** | `{paid:false, processing:true}` | "Payment received — we're confirming it" | **403** |
| **PAID** | `{paid:true}` | pages load normally (unlocked) | **200** |

Gated endpoints to hit directly (proves server-side enforcement, not just hidden UI):
`GET /cases/:caseId/documents`, `GET /students/me/visa/application`, `GET /students/me/admission/documents` → **403 while unpaid, 200 when paid**.

**Unified shell / label:**
- Navigate Home → My Case → Documents → Visa application → Apply/Study → Payments → Messages & support → Wallet: the **same fuller sidebar** shows on every page (no short/long swap, no bounce).
- The gold **"CLIENT PORTAL"** sub-label appears under "Sorena Visa" on every client page.
- Staff and the Finance Portal are unaffected (they keep "Staff Portal" / "Finance Portal"; no "Client Portal" leak).

**Fail-safe:** a case with no ENG invoice → `access.paid:false` and the gated endpoints 403 (locked, never silently unlocked).

## 7. Known limitations

- **LEAD (pre-promotion) clients** see the reduced `/portal` nav subset (My Case, Documents, Wallet) rather than the full sidebar, because the fuller items link into STUDENT-only `/student/*` routes that middleware would bounce a LEAD from. This is intentional — it avoids dead-end links.
- **Legacy clients without an ENG invoice are LOCKED** out of Documents/Visa/Apply by design (fail-safe: "no engagement invoice → locked"). In production every engaged client has an ENG invoice; a legacy/edge case lacking one must have one raised and paid to unlock.
- The calm gate page is server-rendered per surface; the lock **icon** in the nav is a UX hint — the real boundary is the server-side 403 (see §9).

## 8. How to extend

The gated-route set is defined in two places, both additive:
- **Documents** — the client branch of `checkCaseDocumentsAccess` in `backend/src/documents/documents-access.helper.ts` (gates the whole `/cases/:caseId/documents/*` client flow).
- **Other client surfaces** — apply `EngagementPaidGuard` (`backend/src/common/guards/engagement-paid.guard.ts`) to the controller's `@UseGuards(...)` (as done on `students/me/visa` and `students/me/admission`). To gate a new client surface: add the guard to its controller and add an access check + `PaymentGatePanel` render to the page (mirroring `student/admission/page.tsx`), and mark the nav item `lockedUntilPaid` in `clientShellData.ts`.

The gate rule itself lives in `getEngagementGateState()` — change the definition of "paid" (or the ENG-invoice lookup) in one place.

## 9. Security layers

- **#2 Access control (server-side, primary boundary):** `EngagementPaidGuard` (visa + admission controllers) and the `checkCaseDocumentsAccess` client-branch check both resolve the caller's OWN case from the JWT (`lead.contact.userId → case`) — never a client-supplied id — and require ENG PAID. A locked client calling any gated endpoint directly with a valid token gets **403** (verified in testing for `/cases/:id/documents`, `/students/me/visa/*`, `/students/me/admission/*`). Staff (admin tier + case slot-holders) return `allow` before the client branch, so the gate never touches staff.
- **#1 Authentication:** all gated routes sit behind `JwtAuthGuard` (+ `RolesGuard`); the actor id comes from the verified JWT.
- **Fail-safe to LOCKED:** every unresolved path in `getEngagementGateState` / the guard (no case, no ENG invoice, DB error) resolves to LOCKED. The system never silently unlocks.
- The frontend gate (nav lock + `PaymentGatePanel`) is the calm UX layer only — it is NOT the security boundary and is fail-safe to locked as well.

## 10. Rollback

No migration to undo (no schema change). To revert behaviour:
1. Remove `EngagementPaidGuard` from the `@UseGuards(...)` on `students/me/visa` and `students/me/admission` controllers.
2. Revert the client-branch change in `documents-access.helper.ts` (drop the `isEngagementPaid` check so the owning client is allowed as before).
3. Remove the access check + `PaymentGatePanel` render from `portal/case/documents/page.tsx`, `student/admission/page.tsx`, `student/documents/page.tsx`.
4. (Optional) Revert `clientShellData.ts` + the two layouts + the ClientShell label to restore the prior per-route sidebars — independent of the gate; can be kept even if the gate is rolled back.

The new files (`engagement-payment.helper.ts`, `engagement-paid.guard.ts`, `PaymentGatePanel.tsx`, `clientShellData.ts`, `GET /portal/me/access`) are additive and harmless if left unreferenced.
