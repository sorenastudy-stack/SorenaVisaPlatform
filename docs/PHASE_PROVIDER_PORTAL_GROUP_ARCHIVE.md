# Provider Portal — Archiving a country group

**Status:** DONE — 17 August 2026
**Depends on:** Slice E (country groups), per-programme group pricing, group default pricing.
**Closes:** the gap recorded earlier — *"clearing a default still doesn't let you delete the group."*

---

## 1. What this phase does

"Delete" on a country group now **archives** it, matching how removal already
works everywhere else in this portal: programmes are *stopped*, prices are
*cleared*, nothing priced is ever destroyed.

The bug being fixed was specific. Deletion was a hard `DELETE`, and the pricing
rows hold a `RESTRICT` foreign key, so it was refused whenever any rate had
**ever** referenced the group — including rates the institution had already
cleared. A group could therefore become permanently undeletable simply by having
once been priced. The blocker has moved from *"any row exists"* to *"any row is
live"*, which is what makes clearing prices actually unlock it.

## 2. The decision in step 3 — blocked, not auto-deactivated

**If a group is still in active use — a live default, or a live per-programme
override — archiving is REFUSED.** The institution clears those prices first
(each of which deactivates, never deletes), and then archiving succeeds.

The alternative was to auto-deactivate the group's prices along with it. That
would let one click on a button previously labelled *Delete* silently change what
real students are quoted, across every programme using that group, with nothing
on screen saying so. This portal has made the same call twice already:

- **Slice E** refused to null these references on delete, because doing so *"would
  quietly change what a student is quoted with nothing tying it to this action."*
- **Slice D** stopped approval from publishing, so that re-approving something an
  institution had switched off could not silently republish it.

Clearing a price is a visible, per-rate decision with its own review
consequences. Archiving a group is not, and should not become one by proxy. The
refusal names what is in the way and promises nothing will be deleted:

> "South Asia" is still used by 2 fees and 1 scholarship. Clear those prices
> first, then archive the group — nothing will be deleted.

## 3. Database changes

Migration `20260817222500_nationality_group_archive` — one nullable column:

```sql
ALTER TABLE "nationality_groups" ADD COLUMN "archivedAt" TIMESTAMP(3);
```

A timestamp rather than a boolean: *when was this retired* is the question asked
afterwards, and a boolean cannot answer it. No backfill — `NULL` means active,
which every existing row already is.

**The unique index on `(providerId, name)` was left alone.** Prisma cannot express
a partial unique index, so instead of weakening the constraint the service treats
only an **active** namesake as a clash and renames an archived one out of the way
(`South Asia (archived 2026-08-17)`). Retiring a group therefore does not burn its
name.

## 4. Environment variables

None added.

## 5. Third-party services

None added.

## 6. How to test it works

**Country groups** → the button now reads **Archive**. It is disabled while any
price is live, with a tooltip saying what to clear first.

**What was actually run, 17 Aug 2026** — over HTTP:

```
26/26 checks passed
  a group with a default price + a programme override    3 pricing rows
  archiving refused while prices are live                409, group still active
    the message says what to do and promises no deletion
  clearing the prices                                    0 live, all 3 rows still exist
  archiving now succeeds                                 200, archived=true
    the group ROW still exists, stamped, countries intact
    PRICE HISTORY IS BYTE-FOR-BYTE UNTOUCHED             identical amounts + review states
  gone from the active list                              0 groups listed
  cannot be picked on the programme form                 0 offered
  a price cannot be set on it by id                      404
  nor through the older rate endpoint                    404
  nor edited back into use                               404
    and none of those attempts wrote anything            0 rows
  the archived name can be used again                    201
    the archived one renamed, not overwritten            "South Asia (archived 2026-08-17)"
  A cannot archive B's group                             404, B still active
  the archive is audited with what was retained          3 rows retained
```

**In a real browser**: **11/11** — the button says *Archive* (no *Delete*
anywhere), is disabled with the tooltip while a price is live, becomes available
once cleared, the group leaves the list, the row survives stamped with its
archive time, and the $25,000 rate is still there at `APPROVED`.

Suites: backend **114 / 1434**, frontend **6 / 66**.

**The guards were proven able to fail:**

| Reintroduced mistake | Suite |
|---|---|
| archiving turned back into a hard delete | RED |
| cleared prices counted again (the original bug) | RED |
| archived groups shown in the active list again | RED |
| a rate attachable to an archived group | RED |
| the per-programme write path walking archived groups | RED |
| (restored) | GREEN |

That fourth-from-last one matters most: if the per-programme **write** path still
walked archived groups, its reconcile loop would deactivate the rates they hold —
turning an archive into exactly the silent price change this design refuses.

## 7. Known limitations

- **No un-archive.** The row and its history survive, but there is no button to
  bring a group back; it needs a database update. Adding one is small — the
  guards are all `archivedAt: null` — but nobody has asked for it.
- **No archived view.** An institution cannot see what it retired, only that the
  name is free again. History lives in the audit trail, which is staff-side.
- **An archived group's rates vanish from the pricing screen.** Deliberate — the
  page contradicted itself otherwise — but it means a cleared, archived rate is
  invisible to the institution even though it still exists.
- **Archiving is per-group and manual.** No bulk retire.
- **The rename-on-clash is one-way.** If the archived namesake is ever restored,
  it keeps its `(archived …)` suffix.

## 8. How a future developer would extend this

`ACTIVE_ONLY` and `selectable()` in `nationality-group.service.ts` are the two
places that define "can this group be chosen". Anything new that offers a group
must go through one of them.

**The most dangerous edit here is not on the archive path.** It is any query that
*walks* groups to reconcile pricing — `provider-programme-pricing.service.ts`
does exactly that, and if it ever sees an archived group it will deactivate its
rates. That query is filtered, and the spec fails if the filter goes.

Un-archiving is `archivedAt: null` plus a name-collision check against active
groups.

## 9. Security layers applied

| Layer | Where |
|---|---|
| Authentication / role | `JwtAuthGuard`, `RolesGuard`, `@Roles('PROVIDER')` |
| Tenancy | The group is resolved as `{ id, providerId, archivedAt: null }`; another institution's group 404s, archived or not |
| Destruction | No `nationalityGroup.delete` anywhere; archiving writes one timestamp and touches no priced row |
| Money safety | Refused while any rate is live, so no single action can move a student's quoted price |
| Re-entry | An archived group cannot be edited, priced, or attached to by id — four separate 404s |
| Audit | `PROVIDER_NATIONALITY_GROUP_ARCHIVED` with the archive time and the count of pricing rows retained |

## 10. Rollback instructions

Reverting the code restores hard-delete behaviour, which will then be refused by
the FK again for any group that has ever been priced — the original gap. Archived
groups would also reappear in the active list, since nothing would read
`archivedAt`.

If reverting, retire them by hand first:

```sql
-- see what is archived before deciding
SELECT id, name, "archivedAt" FROM nationality_groups WHERE "archivedAt" IS NOT NULL;
```

The column itself is additive and safe to leave in place; dropping it is only
necessary if the schema must match an older client exactly.
