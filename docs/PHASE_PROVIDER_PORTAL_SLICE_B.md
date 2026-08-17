# Provider Portal — Slice B: Login & Ownership Boundary

**Status:** DONE — 17 August 2026
**Depends on:** Slice A (`docs/PHASE_PROVIDER_PORTAL_SLICE_A.md`) — the `PROVIDER` role and
`EducationProvider.userId`, both added there and unread until now.
**Followed by:** Slice C — importer wrapper and provider UI.

---

## 1. What this phase does

An institution can now log in and see its own record, and cannot see anyone else's.

Slice A added the field an institution's identity hangs off. This slice makes it mean something:
the Owner provisions a login, the institution signs in by magic link, and a guard turns that
session into exactly one `providerId` — read from the JWT, never from the request.

Three decisions carry the whole boundary:

1. **A separate controller.** `ProvidersController` has no ownership check on `:id` anywhere;
   `req.user` appears in it seventeen times and every one is attribution, not authorisation.
   Adding `PROVIDER` to its role lists would let any institution read any other's commission
   terms. The new `/provider` controller is a different surface, not a widened one.
2. **No route accepts an id.** Not in the path, not in a query, not in a body. There is no
   `:id`, no `@Param`, no `@Query`. Every handler reads `req.providerAccess.providerId`.
3. **A narrow DTO that is not `UpdateProviderDto`.** Six descriptive fields. The commercial
   terms are not omitted from a larger object — they were never in this object.

An institution with no login provisioned has no way in at all, and clearing `userId` revokes
access on the next request.

## 2. Files created or changed

**Created**
| File | Purpose |
|---|---|
| `backend/src/provider-portal/provider-access.helper.ts` | `resolveProviderAccess()` — the single definition of "who is calling". Looks up by `userId` only. |
| `backend/src/provider-portal/provider-access.guard.ts` | Attaches `req.providerAccess`; 403 with a reason otherwise. |
| `backend/src/provider-portal/provider-portal.controller.ts` | `GET /provider/me`, `PATCH /provider/me`. No path parameters. |
| `backend/src/provider-portal/provider-portal.service.ts` | `getOwn()` / `updateOwn()`, both taking an already-resolved id. |
| `backend/src/provider-portal/dto/update-own-provider.dto.ts` | The six-field allow-list, with the exclusions documented in place. |
| `backend/src/provider-portal/provider-portal.module.ts` | Wiring. |
| `backend/src/provider-portal/provider-boundary.spec.ts` | 28 source-property tests, including the absence tests. |
| `backend/src/providers/dto/provision-provider-login.dto.ts` | `{ email }`. |

**Changed**
| File | Change |
|---|---|
| `backend/src/providers/providers.service.ts` | `provisionLogin()` — Owner-only, one transaction, audited. |
| `backend/src/providers/providers.controller.ts` | `POST /providers/:id/provision-login`, `@Roles('OWNER')`. |
| `backend/src/app.module.ts` | Registers `ProviderPortalModule`. |

## 3. Database changes

**None.** Slice A's `EducationProvider.userId` is the only column this needs, and it already
exists. No migration in this slice.

Rows written at runtime: a `User` per provisioned institution (`role: PROVIDER`, unusable
password), plus `AuditLog` rows.

## 4. Environment variables

None added. Uses the existing `JWT_SECRET` and the magic-link mail configuration.

## 5. Third-party services

None added. Login e-mail goes out through the existing Resend integration, the same path clients
already use.

## 6. How to test it works

Provision from the Owner's provider screen, or:

```bash
curl -X POST http://localhost:3001/providers/<id>/provision-login \
  -H 'Authorization: Bearer <owner jwt>' -H 'Content-Type: application/json' \
  -d '{"email":"admissions@example.ac.nz"}'
```

The institution then signs in at `/client/login` with that address — the magic link arrives by
e-mail and issues a `PROVIDER` session. `GET /provider/me` returns their own record.

**What was actually run, 17 Aug 2026** — two real institutions, provisioned over HTTP, logged in
through the app's own `/auth/magic-link/verify` + `/confirm` endpoints (the JWT is issued by the
application, not signed by the harness), then attacked:

```
29/29 checks passed
  the Owner can provision a login                                    HTTP 201
    the login has role PROVIDER / an UNUSABLE password               64 chars of random
    userId set, provisioning audited
  provisioning twice fails cleanly, it does not overwrite            HTTP 400
  an ADMIN cannot provision a login                                  HTTP 403
  a provisioned institution can log in for real (magic link → JWT)   role=PROVIDER
  provider A can read its OWN profile                                HTTP 200
    the payload carries NO commercial terms
  provider B reading /provider/me gets B, never A
  a body naming another institution is REJECTED (400)                A untouched
  a query string naming another institution changes nothing          got own
  provider A can update its own descriptive fields                   HTTP 200, commission untouched
    the provider-initiated change is audited as PROVIDER
  a PROVIDER token is refused on /providers, /review-queue, /providers/:id   HTTP 403 ×3
  a PROVIDER login with no institution behind it is refused          HTTP 403
  clearing userId revokes access immediately                         HTTP 403
  a non-ACTIVE institution loses portal access                       HTTP 403
  test institutions and logins removed                               0 left
```

The 400 above is meaningful precisely because the same request without the foreign id returns
200 — a legitimate write was proven in the same run.

Rate limit, measured rather than assumed: 26 consecutive `PATCH /provider/me` calls → **20
accepted, first 429 at request 21**.

Suite: **109 suites / 1322 tests, all passing** (`npx jest --runInBand`).

**The boundary tests were proven able to fail.** Each guard was temporarily broken and the suite
re-run:

| Reintroduced mistake | Suite |
|---|---|
| `PROVIDER` added to a staff `@Roles` list | RED |
| a commission field added to the provider DTO | RED |
| the controller reading an id from the query string | RED |
| (restored) | GREEN |

## 7. Known limitations

- **No provider UI.** Provisioning is an API call; the Owner-side button and the institution's
  own screen are Slice C.
- **No pricing upload for institutions.** `/provider/me` is read plus six editable fields. The
  importer wrapper is Slice C.
- **Name changes stay with staff.** `name` is the string students match on and the key the
  importer joins providers by, so an institution cannot rename itself.
- **One login per institution.** `userId` is a single unique field. A second contact at the same
  institution needs a schema change (a join table), not a code change.
- **Re-provisioning is deliberately manual.** If an institution loses its inbox, staff clear
  `userId` and provision again; there is no self-service recovery.

## 8. How a future developer would extend this

Add routes to `ProviderPortalController` and read `req.providerAccess.providerId`. That is the
whole contract. **Do not add a `providerId` parameter to any service method here** — the moment a
caller can name a target, "their own data" stops meaning anything, and the boundary tests will
fail if you try.

New editable fields go in `UpdateOwnProviderDto` and in `updateOwn()`'s field loop. Anything
touching money, `status`, `isFeatured`, ranking or the agreement does not belong in either.

For multiple contacts per institution, replace `EducationProvider.userId` with a join table and
change `resolveProviderAccess()` — every other file reads the resolved id and needs no edit.

## 9. Security layers applied

| Layer | Where |
|---|---|
| Authentication | `JwtAuthGuard` on every route |
| Role | `RolesGuard` + `@Roles('PROVIDER')`; provisioning is `@Roles('OWNER')` and the service **re-checks** rather than trusting the decorator |
| Tenancy | `ProviderAccessGuard` resolves the institution from the JWT alone; no route accepts an id |
| Unknown fields | Global `ValidationPipe` (`forbidNonWhitelisted`) rejects a body carrying `id`, `providerId` or a commission field with 400 |
| Field allow-list | `UpdateOwnProviderDto` — six fields |
| Read allow-list | Explicit `select` in `getOwn()`; commission, agreement, ranking and staff `notes` are never fetched, so they cannot leak |
| Status | A non-ACTIVE institution is refused |
| Revocation | Access resolves per request, so clearing `userId` takes effect immediately |
| Credentials | Magic-link only; the created `User` has 48 random bytes as its password hash — no password can match it |
| Rate limit | 20 writes/minute per identity on `PATCH /provider/me`, on top of the global limit |
| Audit | `EDUCATION_PROVIDER_LOGIN_PROVISIONED` and `EDUCATION_PROVIDER_SELF_UPDATED`, the latter with `actorRoleSnapshot: 'PROVIDER'` so "the institution changed this" stays distinguishable from "staff changed this" |

## 10. Rollback instructions

No migration, so rollback is code-only:

1. Revert the commit.
2. Optionally revoke provisioned logins — `UPDATE education_providers SET "userId" = NULL;` and
   deactivate the `PROVIDER` users. Not required: with the module gone, those accounts have
   nothing to reach.

Slice A's `reviewStatus` gate is unaffected either way.
