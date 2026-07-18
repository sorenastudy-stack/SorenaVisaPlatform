# PHASE-J — Payment-checkout ownership + RolesGuard fail-closed

Two fixes in one pass: (1) the two `/payments/*/checkout` endpoints no longer let
any authenticated user mint a checkout against an arbitrary lead; (2) the
root-cause `RolesGuard` now **fails closed** — a route behind it with no `@Roles`
is denied by default instead of allowing everyone.

## 1. What this PR does

- **Payment checkout ownership** — `POST /payments/subscription/checkout` and
  `/consultation/checkout` now call `PaymentsService.assertLeadCheckoutAllowed`
  before creating anything: **staff** may check out for any client's lead; a
  **client** (LEAD/STUDENT) may only check out against a lead linked to their own
  user account (`Lead.contact.userId === JWT user id`). Denials are **audit-logged**.
  Both routes rate-limited.
- **RolesGuard fail-closed** — no `@Roles` (and no `@StaffRoles`) ⇒ `403`. The old
  `return true` fail-open is what left seven controllers open. A new ungated route
  now fails visibly instead of leaking silently.

## 2. Before/after scan

### Payments (before)
Both checkout routes were `@UseGuards(JwtAuthGuard)` only, taking a body `leadId`
with no ownership check — any authenticated user (incl. a self-registered client)
could create a Stripe session against **anyone's** lead.
- **Callers today:** NONE. No frontend call-site; no backend call-site (verified
  by grep). The proven **LIA/GAP paid-booking flow uses `POST /booking/checkout`**
  (a different endpoint), so this change does not touch it.
- **Lead→User link:** `Lead.contactId → Contact.userId` (nullable, `@unique`,
  relation "StudentContact").

### RolesGuard flip (before → after)
- `RolesGuard` (`roles.guard.ts`) returned `true` when `@Roles` metadata was
  absent (fail-open). It is **not** a global guard — only routes with an explicit
  `@UseGuards(..., RolesGuard, ...)` are affected.
- **Blast radius of the flip (full sweep of all 71 controllers):** **ZERO routes.**
  Every route currently behind `RolesGuard` already carries `@Roles` at the method
  or class level. So the flip is a **no-op for live traffic** — it only changes
  what happens to a *future* ungated route (now denied).
- `@StaffRoles` is a **separate** system (`STAFF_ROLES_KEY` + `StaffRolesGuard`,
  also fail-open) — and **no controller combines `RolesGuard` with `@StaffRoles`**
  (verified), so flipping `RolesGuard` cannot lock out any staff route. As a
  safety net the flipped guard still **defers to `@StaffRoles`** if the two are
  ever combined.
- **Public routes** (login, register, Google OAuth, magic-link, password
  reset/forgot/change, scorecard public submit, short-link redirect, signed-file
  download, Stripe/DocuSign/Wix/WhatsApp webhooks, acquisition ingest, public
  health/intake) — **none use `RolesGuard`** (they use no guard, `JwtAuthGuard`
  only, `ApiKeyGuard`, or signature/verify guards). The flip cannot break them.

## 3. Files changed

- `auth/guards/roles.guard.ts` — fail-closed + `@StaffRoles` deferral.
- `payments/payments.service.ts` — `assertLeadCheckoutAllowed(leadId, actor)`
  (staff-or-owner, fail-closed, audited).
- `payments/payments.controller.ts` — both checkout routes call the check with
  the JWT actor; `@Throttle(15/min)` added.
- **Test (local-only, gitignored):** `backend/scripts/test-fail-closed-auth.ts`.

## 4. The ownership rule (payments)

```
staff role (OWNER/SUPER_ADMIN/ADMIN/SALES/OPERATIONS/CONSULTANT/
            CLIENT_CONSULTANT/FINANCE/SUPPORT/LIA)        → allowed for any lead
client (LEAD/STUDENT) AND Lead.contact.userId === JWT id  → allowed (own lead)
otherwise                                                 → 403 + audit row
lead not found                                            → 404
```

`actor.id`/`actor.role` come from the JWT (`req.user`); the client-sent body
carries only `leadId` (which is validated against ownership), never an identity.

## 5. Configuration

None. No env, no schema change, no migration. Denials reuse the existing
`AuditLog` table (`PAYMENT_CHECKOUT_OWNERSHIP_DENIED`).

## 6. How to test

`scripts/test-fail-closed-auth.ts` — **18/18, runtime**:
- **Guard:** no @Roles + no @StaffRoles → **denied**; no @Roles + @StaffRoles →
  allowed (defers); @Roles + matching user → allowed; @Roles + wrong user →
  denied; empty @Roles → denied.
- **Checkout:** client vs another user's lead → **403** + audit row; client vs own
  lead → allowed; staff vs any lead → allowed; no-linked-user lead → client
  denied; unknown lead → 404; only denials are audited (successes/404 write none).
- **Regression:** the seven previously-exposed controllers still carry `@Roles`
  (so fail-closed doesn't deny them); public controllers (Auth login, ShortLink)
  and the checkout routes carry **no** `RolesGuard`.
- PHASE-I `test-endpoint-scoping.ts` still 24/24. `nest build` clean.
- The 6 failing auth/payments specs are a **pre-existing** DB-fixture flake —
  verified identical on baseline with my `src` changes stashed.

**LIA/GAP booking:** unchanged code path (`/booking/checkout` + the Stripe
webhook's `booking`/`ACCOUNT_OPENING` branches were not touched); the proven
end-to-end flow is unaffected.

## 7. Known limitations / follow-ups

- **`amountNZD` on `/subscription/checkout` is client-supplied** and passed
  straight to Stripe — a client checking out their *own* lead could still tamper
  the price. Ownership is fixed here; the price should be derived server-side from
  the plan (BASIC/PRO/PREMIUM) in a follow-up. Low immediate risk (no callers).
- **`StaffRolesGuard` is the same fail-open pattern** (`staff-roles.guard.ts`:
  `if (!required) return true`). All 13 staff controllers currently carry
  `@StaffRoles`/`@OwnerOnly`/`@AdminTier`, so it appears fully covered — but it
  deserves its own blast-radius sweep before flipping. Flagged, not flipped here
  (the user asked specifically about `RolesGuard`, and flipping the sibling
  without a dedicated per-route scan would risk staff routes).
- **Defense-in-depth idea** (from the sweep): a unit test asserting every
  `RolesGuard` route has `@Roles` metadata, so a future ungated route is caught at
  CI even though it would now fail closed at runtime.

## 8. How to extend

- Adjust who can checkout for others: edit `CHECKOUT_STAFF_ROLES` in
  `payments.service.ts`.
- Flip `StaffRolesGuard` fail-closed: mirror the `roles.guard.ts` change
  (deny when no `@StaffRoles`) after scanning its routes.

## 9. Security applied

- **Service-layer enforcement** — checkout ownership is decided inside
  `PaymentsService`, not the controller; the controller cannot mint a session for
  a lead the caller neither owns nor is staff for.
- **No client-sent identity trusted** — `actor` is built from `req.user` (JWT);
  the body's `leadId` is validated against ownership, never used as an identity.
- **Audit** — every ownership denial writes an `AuditLog` row
  (`PAYMENT_CHECKOUT_OWNERSHIP_DENIED`) with the attacker's user id + role snapshot
  and the target lead — exactly what a security review wants to see.
- **Fail-closed default** — the guard now denies unconfigured routes; the safe
  direction (visible 403, not silent leak).
- **Rate-limited** — both checkout routes 15/min/IP.

## 10. Rollback procedure

- **Code:** revert the commit. `roles.guard.ts` returns to fail-open; the checkout
  routes drop the ownership check. No schema/data to unwind.
- **Guard-only concern:** if the flip ever denies a legitimate route (a straggler
  the sweep missed), the fix-forward is to add the correct `@Roles` to that route —
  **not** to revert the guard (reverting re-opens the fail-open hole). The sweep
  found zero such routes.
- **Order:** backend-only; no frontend change. Deploy/rollback independently.
