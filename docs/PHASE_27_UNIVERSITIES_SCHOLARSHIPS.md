# Phase 27 — Universities / Education Provider Management + Scholarships

End-of-phase handover for the OWNER/SUPER_ADMIN **"Universities"** section: manage the
institutions Sorena works with — their commission terms, bonuses, and per-country
scholarships. This is the source of truth for the commissions ledger (Phase 23) and the
future AI offer-generation / recommendation engine, so data accuracy is the priority.

**Date:** 2026-07-27
**Commit (this phase):**
- `feat(universities): Owner-managed institution catalog + per-country scholarships`

**Decisions locked before build (all recommended options):** controlled nationality list
(reuse `CountryPicker`); provider writes tightened to OWNER/SUPER_ADMIN; scholarships
scoped richer (nationality + optional programme/level); build Phases 1+2 together.

---

## 1. What this phase does

- **Surfaces the already-built (but headless) providers backend** in a real UI. The
  `providers` module (CRUD for providers/faculties/programmes) existed with no admin
  screen; there is now `/staff/universities` (OWNER/SUPER_ADMIN) to list / create / edit
  providers with their commission Y1/Y2 rates, volume bonus, agreement dates, and status.
- **Adds scholarships** — a genuinely new model: what Sorena can offer for a provider,
  scoped by **applicant nationality** (ISO code) and optionally to a **programme** and/or
  **qualification level**. Full CRUD from the provider edit screen.
- **Tightens the commercial write tier** — creating/editing a provider and its agreement
  moved from ADMIN → **OWNER/SUPER_ADMIN**. Reads (and programme/faculty curation) unchanged.

## 2. Files created or changed

*Backend*
- `prisma/schema.prisma` — new `ProviderScholarship` model + relations on `EducationProvider`
  and `EducationProgramme`.
- `prisma/migrations/20260727180000_pr_universities_scholarships/migration.sql` — additive:
  one table + 2 FKs + 2 indexes (authored via the fresh-ref-DB diff, hand-trimmed to just
  the new object — the DB↔migration drift noise was excluded).
- `src/providers/dto/create-scholarship.dto.ts`, `update-scholarship.dto.ts` — new.
- `src/providers/providers.service.ts` — `findScholarships` / `addScholarship` /
  `updateScholarship` / `deleteScholarship` + `assertProgrammeBelongsToProvider`; nationality
  & currency normalised; audit events emitted.
- `src/providers/providers.controller.ts` — scholarship routes; `PROVIDER_ADMIN` (OWNER/
  SUPER_ADMIN) applied to `create`/`update`/`agreement` + all scholarship writes.
- `src/providers/providers.scholarships.spec.ts` — 5 DB-backed tests.

*Frontend*
- `app/staff/universities/page.tsx` — OWNER/SUPER_ADMIN gate.
- `components/staff/universities/UniversitiesClient.tsx` — list + create/edit provider +
  scholarships subsection (add/edit/toggle-active/delete).
- `components/staff/shell/StaffSidebar.tsx` — "Universities" nav (OWNER/SUPER_ADMIN).

## 3. Database — what's added

- **`provider_scholarships`** — `{ providerId (FK→education_providers, cascade), nationality
  (ISO code), programmeId? (FK→education_programmes, set null), level? (QualificationLevel),
  name, amountType (CommissionType PERCENTAGE/FIXED, default FIXED), amountValue, currency
  (default NZD), eligibilityNotes?, isActive (default true), createdAt, updatedAt,
  updatedById? }`. Indexed on `providerId` and `nationality`.
- **No changes to `education_providers`** — it already had every commission/bonus/agreement
  field. Only a new back-relation.

## 4. Environment variables added

**None.**

## 5. Third-party services connected

**None.**

## 6. How to test it works

**Automated** — `providers.scholarships.spec.ts` (DB-backed, 5/5 green): create applies
defaults + normalises nationality/currency; a programme from another provider is rejected;
programme + level scoping sticks; list (active-first) + partial update + delete; and a
role-metadata assertion that provider create/update/agreement + all scholarship writes are
`['OWNER','SUPER_ADMIN']`. Backend `tsc`/`nest build` + frontend `tsc` clean.

**End-to-end HTTP smoke** (run this phase, then torn down): with a seeded OWNER + CONSULTANT
and minted sessions — CONSULTANT create provider → **403**; OWNER create → **201**; OWNER add
scholarship → **201** (nationality `ir`→`IR`); **`PATCH /providers/scholarships/:id` → 200**
(confirms route ordering — it is NOT swallowed by `PATCH /providers/:id`); CONSULTANT read
scholarships → **200**, CONSULTANT write → **403**; OWNER delete → **200**.

**Manual:** as OWNER open **Universities** → New university (name/type/country/commissions) →
Save → reopen to edit (agreement dates, status) → Scholarships → Add (nationality via the
country picker, optional programme/level, amount, conditions) → edit/activate/delete a row.

## 7. Known limitations / future work

- **No Country / agency-relationship model.** `EducationProvider.country` remains a plain
  string = the *provider's* location; the scholarship `nationality` is the *applicant*
  dimension. The project's "operating countries / active agency relationships" concept is
  **still unmodelled** — introduce a `Country`/`AgencyRelationship` table if that needs to
  gate which nationalities/providers are in scope. (Fork raised in the scan; deferred.)
- **Programme/faculty management has no UI** (the backend CRUD exists). Not part of this
  section; add a programmes tab on the provider edit screen when needed.
- **No AI consumer yet.** Nothing in the AI module reads institutional data today; this
  screen is the *future* source of truth for offer generation / the recommendation engine.
- **Commission linkage stays manual.** The Phase 23 ledger takes the commission rate from
  its own DTO, not auto-copied from the provider — so editing a provider's rate here does
  **not** retroactively change existing commission rows (by design; additive + decoupled).
- **Create form is intentionally minimal** — status defaults PENDING and agreement dates are
  set on the edit screen (matching the backend create DTO).

## 8. How a future developer would extend this

- **Operating-country scoping:** add a `Country`/`AgencyRelationship` model, link providers +
  scholarships, and filter the nationality picker to active relationships.
- **AI offer generation:** query `provider_scholarships` where `isActive` + matching
  nationality (and programme/level) — the data shape is built for exactly this.
- **Programmes UI:** the `/providers/:id/programmes` endpoints (+ approve/reject) are ready to
  surface as a tab.

## 9. Security layers applied

- **Commercial writes are OWNER/SUPER_ADMIN** — enforced at the controller (`@Roles`
  `PROVIDER_ADMIN`) *and* the frontend page gate. Reads stay on the existing catalog-read
  tier (admission-handling staff). Verified by the e2e 403s + the spec's metadata assertion.
- **Input validation** — DTOs (`class-validator`) bound lengths; nationality/currency are
  normalised (upper-cased/trimmed); a scholarship's programme reference is validated to
  belong to the same provider (no cross-provider linkage).
- **Auditability** — create/update/delete emit `SCHOLARSHIP_*` events with the actor.
- **Additive, non-PII** — institutional reference data only; no new secrets or personal data.

## 10. Rollback instructions

Additive — `git revert` the phase commit removes the UI, routes, scholarship service, and the
role tightening (reverting provider writes to ADMIN). The `provider_scholarships` table can
stay (additive, unused) or be dropped separately: `DROP TABLE "provider_scholarships";`.
