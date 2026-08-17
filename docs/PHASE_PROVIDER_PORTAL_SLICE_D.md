# Provider Portal — Slice D: Programme CRUD

**Status:** DONE — 17 August 2026
**Depends on:** Slices A–C.
**Followed by:** Slice E — country-grouped tuition and scholarships.

---

## 1. What this phase does

An institution can now add a programme, correct one, and stop offering one —
without a spreadsheet and without emailing us.

The slice opens with a fix, because the feature could not be built honestly on
top of the bug. **Approving a programme used to set `isActive: true` as well**,
which made approval a publish button. An institution that switched a programme
off would have it switched back on by the next approval, silently. Approval now
sets the review status and nothing else, which is the rule slice A already
applied to pricing and stated in those words: *"Coupling them would silently
republish a retired price on approval."*

Everything else follows from three rules:

- **A new programme lands PENDING and inactive**, exactly as an imported row does.
- **A content edit costs the approval**; an edit that changes nothing does not.
- **Activation is not content**, so it never triggers re-review in either
  direction.

## 2. Files created or changed

**Created**
| File | Purpose |
|---|---|
| `backend/src/provider-portal/provider-programme.controller.ts` | `GET`/`POST`/`PATCH` under `/provider/programmes`. No delete. |
| `backend/src/provider-portal/provider-programme.service.ts` | `scoped()` — the id-plus-owner rule — and the four operations. |
| `backend/src/provider-portal/dto/provider-programme.dto.ts` | 21 editable fields across three classes. |
| `backend/src/provider-portal/provider-programme-boundary.spec.ts` | 28 source-property tests. |
| `frontend/src/app/provider/programmes/page.tsx` | The route. |
| `frontend/src/components/provider/ProviderProgrammes.tsx` | List, add/edit form, offer toggle. |

**Changed**
| File | Change |
|---|---|
| `backend/src/providers/providers.service.ts` | `approveProgramme` no longer activates. |
| `backend/src/provider-portal/provider-portal.module.ts` | Registers the programme controller. |
| `frontend/src/components/provider/ProviderShell.tsx` | Nav — the second destination has arrived. |
| `frontend/src/components/staff/programme-approvals/ProgrammeApprovalsClient.tsx` | Copy: approving is no longer publishing. |

## 3. Database changes

**None.** No migration. The change is behavioural: `isActive` and `reviewStatus`
are now written independently on this path.

## 4. Environment variables

None added.

## 5. Third-party services

None added.

## 6. How to test it works

Sign in as a provisioned institution and open **Programmes**. Add one; it appears
as *With us for review*. Approve it staff-side, switch it on, then press **Stop
offering** — it becomes *Not being offered* and keeps its approval.

**What was actually run, 17 Aug 2026** — two real institutions, over HTTP:

```
33/33 checks passed
  an institution can add a programme                        HTTP 201
    it lands PENDING and not offered / belongs to the CALLER / source MANUAL_ENTRY
  a programme with no level or intake is refused            400
  a body claiming a providerId or reviewStatus is rejected  400
  staff can approve the programme                           HTTP 200
    approving sets the review status and NOT the switch     APPROVED / isActive=false
  the institution can stop offering an approved programme
    the approval SURVIVES deactivation                      APPROVED / isActive=false
  RE-APPROVING DOES NOT REPUBLISH what was switched off     APPROVED / isActive=false
  switching it back on does not send it for re-review       APPROVED / isActive=true
  an edit that changes nothing keeps the approval           APPROVED
  a CHANGED detail returns it to review                     PENDING, Wellington/35000
  re-sending the same intake months is still a no-op        APPROVED
  A cannot read / edit / deactivate B's programme           404 ×3, B untouched
  the list contains only the caller's own programmes
  DELETE is not a route (collection or item)                404 ×2
  a PROVIDER token refused on curation, activation, approve 403 ×3
  create, edit, activate, deactivate all audited            4 event types
  test institutions, logins and programmes removed          0 left
```

**In a real browser**, signing in through the magic-link page and using the form:
**13/13** — the nav appears, the empty state explains itself, a programme created
through the form lands PENDING with the intake months actually chosen (`[2,7]`),
the status chip reads *With us for review*, **Stop offering** works and the
approval survives it in the database, no schema words reach the screen, no delete
button exists, no console errors.

Suites: backend **111 / 1382**, frontend **5 / 53**.

**The guards were proven able to fail** — each mistake reintroduced, suite
re-run, then restored:

| Reintroduced mistake | Suite |
|---|---|
| a read scoped by id alone instead of id + owner | RED |
| an edit no longer costing the approval | RED |
| the activation toggle re-coupled to review status | RED |
| a delete route added | RED |
| approval re-coupled to activation (the original bug) | RED |
| `Create` inheriting the optional versions of its required fields | RED |
| (restored) | GREEN |

## 7. Known limitations

- **`REJECTED` programmes cannot be resubmitted.** An edit moves APPROVED →
  PENDING but leaves REJECTED alone, deliberately: otherwise an institution
  could loop a refused programme back into the queue indefinitely. A rejection
  is a conversation, and there is no way to have it in the portal yet.
- **No delete, ever.** `RecommendationItem` and `AdmissionProgrammeChoice` hold
  required FKs with no cascade, so the database refuses — correctly, since a
  student's recorded choice must not vanish because a catalogue was tidied.
- **The staff activation toggle still couples both fields.** `activationTarget()`
  sets `reviewStatus: APPROVED` on activate and back to `PENDING` on deactivate.
  That is documented there as deliberate — the staff screen shows a single
  switch — but it means staff deactivating a programme still costs its approval
  while an institution doing the same thing does not. **Two surfaces, two
  behaviours.** Not changed here: it was out of scope and its own decision.
- **No requirements editing.** `ProgrammeRequirement` (the structured matching
  values) is untouched; the free-text requirement columns on the programme are
  editable, the matcher's numbers are not.
- **No faculty assignment** — `facultyId` is a foreign key and nothing in this
  portal accepts an id it did not resolve itself.

## 8. How a future developer would extend this

Add fields to `EDITABLE` in the service and to the DTO. `EDITABLE` drives the
write, the change-detection and the audit payload together, so one list stays one
list.

**Never add `findUnique` to this service.** It cannot take a `providerId`, so its
presence would mean an unscoped read by definition — the boundary spec asserts
the file contains none.

If rejected-programme resubmission is wanted, it needs a reason attached to the
rejection first; without one the institution is being asked to guess.

## 9. Security layers applied

| Layer | Where |
|---|---|
| Authentication | `JwtAuthGuard` |
| Role | `RolesGuard` + `@Roles('PROVIDER')`; staff curation/activation/approve stay `PROVIDER_ADMIN`/`CATALOG_ADMIN` and a PROVIDER token gets 403 |
| Tenancy | Every read and write scoped by `{ id, providerId }` together — another institution's id matches no row and 404s, indistinguishable from a non-existent one |
| Field allow-list | `UpdateOwnProgrammeDto` / `CreateOwnProgrammeDto` — 21 fields |
| Unknown fields | Global `forbidNonWhitelisted` — a body carrying `providerId` or `reviewStatus` is a 400 |
| Read allow-list | Explicit `VISIBLE` select; `notes`, verification state and AI provenance are never fetched |
| Review gate | Create lands PENDING; a content edit returns APPROVED to PENDING |
| Destruction | No delete route, and the FKs would refuse one |
| Rate limit | 30 creates and 60 edits/toggles per minute per institution |
| Audit | `PROVIDER_PROGRAMME_{CREATED,UPDATED,ACTIVATED,DEACTIVATED}`, the edit carrying `changedFields` and `returnedToReview` |

## 10. Rollback instructions

Code-only; revert the commit. Programmes created through the portal remain, as
`source: MANUAL_ENTRY` rows with `sourceRef: provider-portal-<providerId>`.

**If you revert selectively, keep the `approveProgramme` change.** It is
independent of this portal and fixes a staff-side bug: without it, approving a
programme republishes one that was deliberately switched off.
