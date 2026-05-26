# PR-LIA-10 — Immigration Officer module

The previous LIA PRs accumulated case-level state — risk overrides, INZ submissions, visa outcomes, expiry reminders — all anchored to a single Case. PR-LIA-10 introduces the first **case-spanning** entity in the LIA portal: the INZ officer who reviewed the application. Officer profiles are collaborative (any LIA can edit shared facts) but observations are attributed and append-only (only the author can delete their own). Case ↔ officer linkages are 1:1 per case, with the visa outcome snapshotted at link time.

Aggregates are computed at read time — no maintained counters. The `(officerId, linkedAt)` index keeps that cheap.

---

## 1. Scope

In:

* Three new Prisma models:
  * `ImmigrationOfficer` (collaborative profile)
  * `ImmigrationOfficerObservation` (attributed, append-only)
  * `CaseOfficerLinkage` (1:1 per case, snapshotted outcome)
* Backend service + 2 controllers (officer-side + case-side)
* 7 new audit event types
* Frontend "Officers" sidebar nav entry
* Officers index page with search + filter chips + sort selector
* Officer detail page with profile / stats / observations / linked-cases sections
* 6 new client components (Add/Edit/Delete officer, Add/Delete observation, Link/Unlink case)
* Case-detail "Reviewing Officer" panel (CTA when unlinked, full record when linked)

Out (deferred to PR-LIA-11):

* Officer metrics dashboard with charts
* Officer comparison view (side-by-side)
* Trend analysis over time (decisions per quarter, response-time trends)
* Officer alert/flag system ("officer X declined 80% of cases from country Y")
* Bulk CSV import of officer profiles
* Officer photo uploads (privacy-flagged — defer indefinitely)
* Multi-officer linkage per case (current model is 1:1)
* Sharing / export of officer notes
* Officer-specific notification preferences

---

## 2. Three non-negotiable design decisions

| Code | Decision | What it means |
|---|---|---|
| **1A** | Encrypt everything narrative | `profileDescriptionEncrypted` on `ImmigrationOfficer`, `bodyEncrypted` on `ImmigrationOfficerObservation`, `noteEncrypted` on `CaseOfficerLinkage` — all AES-256-GCM via `CryptoService`. Identity fields (`fullName`, `branch`, `countryOfPosting`, `officerCode`) stay plaintext because they drive search + `ILIKE`. |
| **2C** | Profile = collaborative · Observations = attributed and append-only | Profile fields editable by any LIA per Decision 2C — they're shared factual data. Observations have an `authorId`; only the author can delete their own row; nobody can edit (delete + repost). The schema has no `updatedAt` on observations to enforce this. |
| **3A** | Aggregates are read-time, never maintained | No `totalCases` / `approvedCases` / `declinedCases` columns on `ImmigrationOfficer`. Every read aggregates from `CaseOfficerLinkage` via `groupBy(linkedOutcome)`. The `(officerId, linkedAt)` index keeps the path indexed. |

---

## 3. Data model

```
                  ┌─────── User ───────┐
                  │ (any portal viewer) │
                  └──┬──────┬───────┬───┘
                     │      │       │
       createdBy ────┘  authorId    linkedById
                            │       │
                            ▼       │
┌────── ImmigrationOfficer ──────┐  │
│ fullName (plain, indexed)      │  │
│ branch, countryOfPosting       │  │
│ officerCode                    │  │
│ profileDescriptionEncrypted    │  │
│ createdById                    │  │
└──┬─────────────────────────────┘  │
   │ 1:N                            │
   ▼                                │
┌── ImmigrationOfficerObservation ──┐
│ authorId          ← immutable     │
│ bodyEncrypted                     │
│ tags[]            (plaintext      │
│                    categorical)   │
│ createdAt only — no updatedAt     │
└───────────────────────────────────┘
                                  │
   │ 1:N                          │
   ▼                              │
┌── CaseOfficerLinkage ───────────┐│
│ caseId (UNIQUE — 1:1 per case)  ◄┘
│ officerId                       │
│ linkedOutcome (snapshot of      │
│   case.visa.outcome at link)    │
│ noteEncrypted                   │
│ linkedById                      │
│ FK officerId  ON DELETE RESTRICT│
│   ← can't delete officers with  │
│     linked cases                │
└─────────────────────────────────┘
```

### Why `CaseOfficerLinkage.caseId` is UNIQUE

The spec says "one case ↔ one officer (a case can only be reviewed by one officer)". The `caseId` column itself is `@unique`; the composite `@@unique([caseId, officerId])` is kept too, both as documentation and as a defensive guard. Re-linking the same officer is an upsert (note + linkedAt refresh); re-linking a different officer 409s — LIA must unlink first.

### Why `linkedOutcome` is a snapshot

Decision 3A makes the linkage row the source of truth at the moment of linking. The visa state can change later (revert, re-issue) — the linkage still records what the LIA saw when they decided to credit this officer. If the LIA wants the linkage's snapshot to reflect the current visa state, they re-link (an upsert that refreshes `linkedOutcome` from current `case.visa.outcome`).

### Why we don't soft-delete observations

A deleted observation leaves an audit row (`OFFICER_OBSERVATION_DELETED`) but no DB trail. We chose this over soft-delete because:

* Observations are short and easy to retract; the author owns them.
* The audit log is the durable trail of what was said + when.
* Soft-deleting would clutter the timeline with "[deleted]" rows.

---

## 4. Backend — files added / modified

### New (5)

* [backend/src/immigration-officers/immigration-officers.service.ts](../backend/src/immigration-officers/immigration-officers.service.ts) — 9 methods (list, get, create, update, delete, addObservation, deleteOwnObservation, link, unlink) + getLinkageForCase + hydrator + helpers
* [backend/src/immigration-officers/immigration-officers.controller.ts](../backend/src/immigration-officers/immigration-officers.controller.ts) — 7 routes under `/officers`
* [backend/src/immigration-officers/case-officer-linkage.controller.ts](../backend/src/immigration-officers/case-officer-linkage.controller.ts) — 3 routes under `/cases/:caseId/officer-linkage`
* [backend/src/immigration-officers/dto/immigration-officers.dto.ts](../backend/src/immigration-officers/dto/immigration-officers.dto.ts) — 5 DTOs
* [backend/src/immigration-officers/immigration-officers.module.ts](../backend/src/immigration-officers/immigration-officers.module.ts)
* [backend/prisma/migrations/20260527060000_pr_lia_10_immigration_officers/migration.sql](../backend/prisma/migrations/20260527060000_pr_lia_10_immigration_officers/migration.sql)

### Modified (3)

* [backend/prisma/schema.prisma](../backend/prisma/schema.prisma) — 3 new models + inverse relations on User (`createdOfficers`, `officerObservations`, `caseOfficerLinkages`) and Case (`officerLinkage`)
* [backend/src/app.module.ts](../backend/src/app.module.ts) — register `ImmigrationOfficersModule`
* [backend/src/common/audit/audit.helper.ts](../backend/src/common/audit/audit.helper.ts) — 7 new event-type cases in `summarizeAuditEntry`

---

## 5. Frontend — files added / modified

### New (8)

* [frontend/src/app/lia/officers/page.tsx](../frontend/src/app/lia/officers/page.tsx) — server-rendered index with search, filter chips, sort selector, pagination, card grid
* [frontend/src/app/lia/officers/AddOfficerButton.tsx](../frontend/src/app/lia/officers/AddOfficerButton.tsx) — creation overlay with duplicate-hint surfacing
* [frontend/src/app/lia/officers/[id]/page.tsx](../frontend/src/app/lia/officers/[id]/page.tsx) — detail with profile / stats / observations timeline / linked-cases table
* [frontend/src/app/lia/officers/[id]/EditOfficerButton.tsx](../frontend/src/app/lia/officers/[id]/EditOfficerButton.tsx)
* [frontend/src/app/lia/officers/[id]/DeleteOfficerButton.tsx](../frontend/src/app/lia/officers/[id]/DeleteOfficerButton.tsx) — OWNER+ gated, two-step confirmation
* [frontend/src/app/lia/officers/[id]/AddObservationButton.tsx](../frontend/src/app/lia/officers/[id]/AddObservationButton.tsx)
* [frontend/src/app/lia/officers/[id]/DeleteObservationButton.tsx](../frontend/src/app/lia/officers/[id]/DeleteObservationButton.tsx) — only renders when viewer = author
* [frontend/src/app/lia/cases/[id]/LinkOfficerButton.tsx](../frontend/src/app/lia/cases/[id]/LinkOfficerButton.tsx) — debounced 300ms typeahead, "create new" bounce-out, optional note
* [frontend/src/app/lia/cases/[id]/UnlinkOfficerButton.tsx](../frontend/src/app/lia/cases/[id]/UnlinkOfficerButton.tsx)

### Modified (2)

* [frontend/src/components/portal/PortalLayout.tsx](../frontend/src/components/portal/PortalLayout.tsx) — "Officers" nav entry (UserSquare2 icon) between Document Review and Decisions
* [frontend/src/app/lia/cases/[id]/page.tsx](../frontend/src/app/lia/cases/[id]/page.tsx) — fetches `officerLinkage`, renders `<ReviewingOfficerPanel>` between the assignment row and the applications list

---

## 6. Routes (new)

### Officer side — `/officers`

| Verb | Path | Auth | Notes |
|---|---|---|---|
| GET | `/officers` | LIA / ADMIN / SUPER_ADMIN / OWNER | `?search=`, `?branch=`, `?countryOfPosting=`, `?sort=mostRecent|mostActive|name`, `?page=`, `?pageSize=` (default 25, max 100) |
| GET | `/officers/:id` | LIA+ | profile + observations (decrypted) + linkages + stats |
| POST | `/officers` | LIA+ | returns `{ officer, duplicateHint }` — loose duplicate check warns, doesn't block |
| PATCH | `/officers/:id` | LIA+ | profile-field edit |
| DELETE | `/officers/:id` | **OWNER / SUPER_ADMIN** | 409 if linkages exist |
| POST | `/officers/:id/observations` | LIA+ | body 10–5000 chars, optional tags[] (max 20) |
| DELETE | `/officers/:officerId/observations/:observationId` | LIA+ | service enforces `authorId === actor.id` (403 otherwise) |

### Case side — `/cases/:caseId/officer-linkage`

| Verb | Path | Auth | Notes |
|---|---|---|---|
| GET | `/cases/:caseId/officer-linkage` | LIA+ | returns linkage or null |
| POST | `/cases/:caseId/officer-linkage` | LIA+ | upsert by caseId; 409 if different officer already linked |
| DELETE | `/cases/:caseId/officer-linkage` | LIA+ | removes linkage; officer + observations stay intact |

All routes use `req.user?.userId ?? req.user?.id` per d95640d.

---

## 7. Audit events (new)

* `OFFICER_PROFILE_CREATED` — `newValue: { officerId, fullName, branch, duplicateHintId }`
* `OFFICER_PROFILE_UPDATED` — `newValue: { officerId, changedFields }`
* `OFFICER_DELETED` — `newValue: { officerId, fullName }`
* `OFFICER_OBSERVATION_ADDED` — `newValue: { officerId, observationId, tagsCount, bodyLength }`
* `OFFICER_OBSERVATION_DELETED` — `newValue: { officerId, observationId }`
* `CASE_OFFICER_LINKED` — `newValue: { caseId, officerId, officerName, linkedOutcome, hasNote, reLink }`
* `CASE_OFFICER_UNLINKED` — `newValue: { caseId, officerId, officerName }`

Plus a companion `VisaCaseFileNote` (SYSTEM_EVENT) is written on `CASE_OFFICER_LINKED` and `CASE_OFFICER_UNLINKED` via the standard visa-case resolve chain (Case → AdmissionApplication → VisaApplication → VisaCase) — same pattern PR-LIA-7/8 used.

All 7 events are surfaced through `summarizeAuditEntry` in [audit.helper.ts](../backend/src/common/audit/audit.helper.ts).

---

## 8. UX notes

* **Officer creation duplicate hint.** The backend doesn't block creation if `(fullName, branch)` already exists — it returns the existing row as `duplicateHint`. The `AddOfficerButton` surfaces it inline ("An officer named X at branch Y already exists — open their profile instead?") with a deep link. Friction-light by design.
* **Officer search filter chips.** The index page builds branch / country chips from the current page's results. That's approximate (only shows values that are on the current page), but works well for small rosters. A dedicated "distinct values" endpoint is an easy follow-up if rosters grow.
* **Officer detail "You" badge.** When viewing your own observation, a gold "You" badge marks attribution. The Delete button only renders for the author's own observations — both client-side (UX) and server-side (the service throws 403 if the JWT doesn't match the row's authorId).
* **Case-side linkage CTA when unlinked.** Renders a dashed-border tile with the link button so empty state isn't invisible. Once linked, the panel grows into a full record with outcome snapshot + linker metadata + optional note + the Link/Unlink action row.
* **Re-linking is an upsert.** Linking the same officer twice updates the note + linkedAt + linkedOutcome snapshot. The audit row's `reLink: true` field distinguishes a fresh link from a re-link.

---

## 9. Constraints honoured

* No new npm dependencies
* No new env vars
* Encryption everywhere narrative: profileDescription, observation body, linkage note (Decision 1A)
* Observations are attributed and append-only — only the author can delete (Decision 2C); the model has no `updatedAt` to enforce this at schema level
* No maintained-counter columns on ImmigrationOfficer — read-time aggregates only (Decision 3A)
* `req.user?.userId ?? req.user?.id` everywhere — d95640d preserved
* Every mutation writes an AuditLog row
* `CaseOfficerLinkage.caseId` UNIQUE enforces 1:1 at the schema level
* Re-linking the same officer is an upsert; re-linking a different officer 409s

---

## 10. Backlog

* **PR-LIA-11 — Officer metrics dashboard.** Charts for decisions over time (per quarter, per country, per case stage). Likely shares the productivity-report pattern from PR-LIA-3. Top candidates: stacked bar of approvals/declines per officer per quarter; heatmap of officer × country.
* **PR-LIA-11.1 — Officer comparison view.** Pick two officers, render their stats side by side. Useful for the OWNER comparing similar caseload officers.
* **PR-LIA-11.2 — Trend analysis.** Decision rate change over time, response-time trends if we ever capture INZ-side timestamps.
* **PR-LIA-11.3 — Alert/flag system.** "Officer X declined 80% of cases from country Y in the last quarter" — surface for OWNER review. Threshold-based, alert-on-change.
* **Bulk CSV import.** OWNER-only admin tool to seed officer profiles from a spreadsheet.
* **Distinct values endpoint for filter chips.** Currently the index page derives branch/country chip values from the current page's data, which is approximate. A `GET /officers/distinct-values` endpoint would let the filter chips show the full set without pagination.
* **Multi-officer linkage per case.** If INZ assigns multiple officers in sequence (e.g. an initial reviewer + an escalation), the current 1:1 model can't capture that. Extending to a `CaseOfficerLinkage` table without the `caseId UNIQUE` constraint + a `linkageRole` column (PRIMARY | REVIEWER | ESCALATION) would work; defer until OPS reports it as a real need.
* **Officer-attached document evidence.** A future PR could let LIAs attach screenshots / scans to an observation (think "INZ letter showing officer X's signature"). File-storage pattern already exists in PR-LIA-5 / PR-LIA-8.
* **Per-LIA notification on officer activity.** "When an observation is added to an officer I've linked a case to, email me." Useful but not on the critical path.
* **Officer activity feed on the dashboard.** A small card on `/lia` showing the 5 most recent observations / linkages across the platform. Surfaces institutional knowledge as it accrues.
* **Audit-log surface in the officer profile.** The audit-log helper already humanises all 7 events; rendering them in a "History" tab on the officer page would close the loop without new event types.
