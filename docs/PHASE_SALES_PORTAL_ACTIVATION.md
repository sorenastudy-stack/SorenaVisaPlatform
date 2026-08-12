# Phase: Sales Portal Activation (SALES role) + Pre-Migration Backup Verification
**Date:** 2026-08-11
**Session type:** Standard feature work, following the 2026-08-10 outage/security session.

## 1. What this phase does

Activates the previously-dormant `SALES` role end-to-end: a salesperson can now log in, see only the leads they own, work assigned leads, view consultations tied to their leads, and (once commission data exists) see only their own commissions. Also closes several pre-existing access-control gaps discovered along the way, adds a self-generating Roles & Access reference page for Owner/Super Admin, and verifies the pre-migration backup pipeline (built in the prior outage-recovery session) on a real production deploy.

## 2. Background — why this was needed

`SALES` existed in the `UserRole` enum and had a full frontend portal (~1,500 lines) at `/sales`, but was deliberately excluded from the backend (`FUNNEL_ROLES`, `ASSIGNEE_ROLES`, Commissions access) during an earlier cleanup, because at the time the only user was a single Owner running everything through `/staff/leads`. The `/sales` portal returned 403 for any SALES user. Zero SALES users existed in production going into this session.

Decision made with the user: rather than waiting for an actual sales hire, activate SALES now so it's ready the moment someone is hired, and rewire the portal to work correctly rather than deleting it.

## 3. Files created or changed

**Backend (NestJS):**
- `backend/src/leads/leads.service.ts` — added `SALES` to `FUNNEL_ROLES`; added mandatory per-user filtering (`ownerId === req.user.userId`) for working roles (`SALES`, `CONSULTANT`) in `findAll`; closed a by-id access hole (`GET /leads/:id`, history, status change, undo had no ownership check — fixed to return `NOT FOUND` rather than `FORBIDDEN` for non-owned records, to avoid confirming existence); added `SELF_OWNING_ROLES` (`SALES`, `CONSULTANT`) — lead creation now forces `ownerId` to the creator's own ID for these roles, ignoring any client-supplied value.
- `backend/src/leads/leads.controller.ts` — removed a duplicate, stale `FUNNEL_ROLES` definition that had its own copy out of sync with the service (SALES was added to the service's list but the controller had its own separate array still excluding it).
- Commissions controller/service — added the same per-user filter via the `Commission → Application → Case → Lead → ownerId` chain for `SALES`, read-only (no edit/approve access).
- `staff/leads` (assignment endpoint) — `PATCH /staff/leads/:id/assign` — added `SALES` to `ASSIGNEE_ROLES`; fixed a bug comparing `assignee.role` directly instead of using the `hasRole()` helper (a user with SALES as a secondary role couldn't be assigned a lead).
- New endpoint for Sales-facing consultations, modeled on `staff/bookings`' `list()` — filters `where.lead = { ownerId: actor.id }` for working roles, full visibility for oversight roles (`FUNNEL_OVERSIGHT_ROLES` = OWNER, SUPER_ADMIN, ADMIN, FINANCE).
- New Roles & Access endpoint/page backing data — generated from the actual `@Roles` decorators and route guards at request time (not hand-maintained), so it cannot silently go stale.
- `prisma/schema.prisma` — removed `@default(SALES)` from `User.role` (was an unsafe default now that SALES has real access); role is now a required explicit field enforced at the TypeScript layer.
- `frontend/src/components/portal/PortalLayout.tsx` — the staff-photo fetch call is now skipped entirely for roles outside `STAFF_PORTAL_ROLES` (was causing a silent 403 + console error for SALES on every portal page load).

**Frontend (Next.js):**
- `/sales/consultations` — new page, consultations for leads the rep owns, grouped into Needs Scheduling / Upcoming / Past.
- `/staff/roles` — new page (OWNER/SUPER_ADMIN only), lists all roles with plain-English responsibility text (hand-written, explicitly labeled as descriptive, not authoritative) alongside the live, code-generated list of routes each role can actually reach.
- Fixed a CSS bug on the new roles page: group headings used `text-transform: uppercase` on route group names like `CaseConversationNotes`, producing an unreadable wall of capital letters — changed to break on camelCase before uppercasing.
- `/sales/leads`, `/sales/layout.tsx` — unchanged (already scoped to SALES), now functional end-to-end since backend access exists.

## 4. Database changes

One migration: `20260811144508_role_requires_explicit_assignment`
```sql
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
```
Non-destructive, instant, rewrites no rows. Verified before writing: no code path (app, scripts, seeds, tests) relied on the default — all explicitly pass `role`. Applied to production via the standard pre-migration-backup pipeline (see below).

No other schema changes. `Lead.ownerId` already existed from prior work.

## 5. Environment variables added

None.

## 6. Third-party services involved

- **Railway** — production and demo deploys, both from `main`. No separate demo branch/remote exists; `railway up` was used to test the Docker build changes (from the prior outage session) against `demo` in isolation before any of this session's work was pushed.
- **Cloudflare R2** — pre-migration backup destination (`db-backups/production/...`), confirmed working on every deploy in this session, including one with zero pending migrations (script runs cleanly regardless).

## 7. How to test it works

1. Log in as a user with the `SALES` role (or add `SALES` as a secondary role to a test account via `secondaryRoles`).
2. Visit `/sales/leads` — should show only leads where `ownerId` is that user, not the full pipeline.
3. Visit `/sales/consultations` — should show only consultations tied to leads that user owns, grouped into Needs Scheduling / Upcoming / Past.
4. Create a lead as that SALES user — confirm it's owned by them regardless of any `ownerId` sent in the request.
5. Attempt `GET /leads/:id` for a lead owned by someone else — should return `404 NOT FOUND`, not `403`.
6. Log in as OWNER/SUPER_ADMIN/ADMIN/FINANCE — confirm full, unrestricted visibility on Leads, Consultations, and Commissions is unchanged.
7. Visit `/staff/roles` as OWNER — confirm the page renders all 13 roles with their live route lists (no console errors).
8. Check browser console on any `/sales/*` page as a SALES user — should be clean, no failed `/api/staff/me` calls.

## 8. Known limitations

- **Sales-facing Commissions page not built.** Backend access and per-user filtering exist and are tested; there is no dedicated UI page yet (Commissions is otherwise accessible via the existing Owner/Finance-facing view, but not surfaced in `/sales`).
- **CONSULTANT still has unrestricted visibility on `/staff/leads`** — this page was deliberately left as an org-wide oversight view at the user's request, but `CONSULTANT` is a working role, not an oversight role, so this is an intentional inconsistency the user chose to accept for now, not an oversight.
- **Two parallel "oversight roles" definitions still exist**: `ADMIN_TIER` (OWNER/SUPER_ADMIN/ADMIN) used by `bookings`/`diary`, vs. `FUNNEL_OVERSIGHT_ROLES` (adds FINANCE) used by the new Leads/Commissions/Consultations work. Not a security issue, but should be unified eventually so there's one definition, not two.
- **26 other services** were identified as having the same "role-gated but no per-user filter" shape as the original Leads/Commissions bug. Most are believed to be legitimately org-wide (settings, providers), but this was not audited — do not assume they're safe without checking.
- **Currency inconsistency on Consultations**: `Consultation.currency` still defaults to `NZD` and the field is named `amountNZD`, left over from before this year's USD migration (Phase 40 fee/GST work). The new Sales Consultations page displays whatever is in the database, which is currently NZD-labeled. Deliberately not touched this session — tracked as a separate finance-domain task alongside the exchange-rate backlog item.
- **Sales-facing Commissions**: zero commissions exist in production (zero Applications exist yet), so the per-user filter logic for Commissions has only been proven against fixture/test data, not real production data.

## 9. How a future developer would extend this

- To add a new working role that should see only its own leads/consultations/commissions: add it to `SELF_OWNING_ROLES` (lead creation ownership) and to the per-user filter conditions in `leads.service.ts` / the consultations endpoint / commissions filter. All three currently hard-code the same two roles (`SALES`, `CONSULTANT`) — consider extracting a shared constant if a third working role is added.
- To add a new oversight role: add it to `FUNNEL_OVERSIGHT_ROLES`, not `ADMIN_TIER` (the newer, more inclusive definition) — but see the known limitation above about unifying these first.
- The Roles & Access page at `/staff/roles` reads its route list live from the same guard metadata the API enforces, so it never needs manual updates when routes change. Only the plain-English responsibility text is hand-maintained; update it in the same file if a role's real-world duties change.
- Sales-facing Commissions page: backend is ready (`GET /commissions` filtered for SALES); only a frontend page needs to be added, following the same pattern as `/sales/consultations`.

## 10. Security layers applied

1. **Access control on every endpoint, server-side** — all new/modified endpoints enforce role + per-user ownership filtering server-side (`@Roles` decorators + service-layer `ownerId` checks), not just hidden in the UI.
2. **Audit log** — lead assignment (`PATCH /staff/leads/:id/assign`) already logs to the audit table; unchanged by this work.
3. **Fail-closed defaults** — the by-id access hole fix returns `404` rather than leaking existence via `403`; the `role` column now has no default, forcing explicit assignment rather than silently falling back to a role that now has real access.
4. Database backup before every production migration (layer built in the prior session, verified working again here, including on a no-op migration run).

Layers not directly touched by this phase (Google OAuth, HTTPS, rate limiting, secrets management, auto-logout, file upload rules, `npm audit`) were not modified and are assumed unchanged from prior phases.

## 11. Rollback instructions

All work landed as 6 commits on `main`, deployed incrementally with health checks after each:
```
b9ac9d8  feat(sales): activate the SALES role, and scope the funnel to the person working it
becd8b8  feat(staff): a Roles & Access reference the code generates, not a document
ed18286  fix(leads): close the by-id hole that list scoping left open, and de-flake a spec
debae8a  fix(access): require an explicit role, and scope /staff/leads to its working roles
3ca92f6  fix(leads): a salesperson owns the leads they create
8b91006  fix(leads): a consultant owns the leads they create, like a salesperson
766e5d8  feat(sales): consultations for the leads a rep owns
039adcd  fix(portal): only ask for the staff photo when the caller is staff
```
To roll back the whole phase: revert commits in reverse order back through `b9ac9d8`. The one migration (`role DROP DEFAULT`) can be reversed with `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'SALES'` if truly necessary, but there is no reason to — dropping a default is always safe to leave in place even if the surrounding feature is reverted. A pre-migration backup exists in R2 at `db-backups/production/2026-08-10T22-41-28-193Z-pre-migrate.dump` (taken just before this phase's migration applied) if a full restore is ever needed.

## 12. Related, deferred work (not part of this phase)

- Manual exchange-rate entry UI + pre-migration backup pipeline Dockerfile work — from the 2026-08-10 session, already committed and deployed to production as part of that session's closure.
- Currency/NZD-vs-USD cleanup on Consultations — flagged above, needs its own session.
- Audit of the remaining 26 role-gated-without-per-user-filter services.
- Unify `ADMIN_TIER` and `FUNNEL_OVERSIGHT_ROLES` into one oversight definition.
- Two leftover R2 token cleanup items from the 2026-08-10 outage session (deleting old tokens in Cloudflare) — still open, not addressed this session.
