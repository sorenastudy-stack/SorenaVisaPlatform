# Phase 38: Assessment Go-Live — StudyField Data and the Flag Flip

Session of 2026-08-08. Handover document — written so the next session, or Yashua reading it
alone, can pick up without needing the conversation.

**The 31-question v2 assessment is LIVE on production.** `NEXT_PUBLIC_ASSESSMENT_LIVE=true` on
the `ample-dream` production service; `/start` now leads to `/assessment`, and the old
57-question `/scorecard` funnel is no longer the entry point.

**Commit:** `c79293a` (scripts + mapping). The flag is an environment variable, not code.

---

## 1. What this phase does

Closes the last blocker to launching the redesigned assessment, then launches it.

1. **Seeded the StudyField taxonomy on production** — 11 categories, 23 fields, 12 relations.
   The tables existed but held zero rows, so the required Q13 picker rendered empty and the
   form could not be completed at all.
2. **Tagged all 1,129 programmes to study fields**, which the matcher needs to return anything.
3. **Fixed the mapping that made that tagging worth doing** — 220 of 1,129 programmes were
   falling into `other`; now 13.
4. **Added production guards** to the seed script and the new backfill script.
5. **Flipped the go-live flag** and verified the live form end to end in a real browser.

### The root cause, because it is not obvious

`programme-import.service.ts` already tags every programme it creates:

```ts
const sf   = studyFieldKey(s(row['Subject Area']), progName);
const sfId = fieldByKey[sf.key];
if (sfId) await this.prisma.programmeStudyField.upsert({ ... });
```

`fieldByKey` is read from `study_fields`. On production that table was **empty** when the
catalogue was imported, so `sfId` was `undefined` every time and the `if` never fired. 1,129
programmes were created with no tags, silently — a missing tag is not an error.

**The seed simply needed to run before the import, and did not.** Everything else in this phase
follows from that one ordering mistake.

---

## 2. Files created or changed

| File | Change |
|---|---|
| `backend/scripts/seed-study-fields.ts` | Production guard + `--dry-run`. |
| `backend/scripts/backfill-programme-study-fields.ts` | **New.** Tags existing programmes. |
| `backend/src/providers/import/programme-import.logic.ts` | `studyFieldKey()` mapping fix. |

The backfill does **not** reimplement the mapping — it imports `studyFieldKey()` from
`programme-import.logic.ts`, so the backfill and the importer cannot drift, and a programme
re-imported later lands where it landed here. The same function also feeds the websync
extractor, so the mapping fix improves all three paths at once.

---

## 3. Database tables/columns added

**None.** All four tables were created by `20260730010000_phase32_studyfield_taxonomy`, which was
already applied on production — confirmed before touching anything by the backend returning
`200 []` rather than a 500 (a missing table would make Prisma throw).

**Rows written on production, and nothing else:**

| Table | Before | After |
|---|---|---|
| `study_field_categories` | 0 | **11** |
| `study_fields` | 0 | **23** |
| `study_field_relations` | 0 | **12** (all APPROVED) |
| `programme_study_fields` | 0 | **1,129** |

Verified by direct query, not by trusting script output. `education_programmes` (1,129),
`education_providers` (96) and `study_fields` (23) were re-counted afterwards and are unchanged.
Every write is an upsert on a natural key — no `deleteMany`, no `TRUNCATE`.

---

## 4. Environment variables added

**`NEXT_PUBLIC_ASSESSMENT_LIVE=true`** — set on the **production** environment, `ample-dream`
service. Previously set only on demo.

It is read in three places, all of which changed behaviour at once:

| File | Effect |
|---|---|
| `frontend/src/app/start/page.tsx` | The funnel CTA now points at `/assessment`, not `/scorecard/landing`. |
| `frontend/src/app/assessment/page.tsx` | The "Preview build — not yet live" banner is suppressed. |
| `frontend/src/app/page.tsx` | Landing-page CTA follows the same switch. |

`NEXT_PUBLIC_*` is inlined at build time, so setting it triggered a rebuild; the flip took about
two minutes to appear. **Reverting is equally fast and needs no deploy of code** — remove the
variable and the old funnel returns.

---

## 5. Third-party services connected

**None.**

---

## 6. How to test it works

**The scripts** (both are idempotent and safe to re-run):

```bash
cd backend
npx ts-node --transpile-only scripts/seed-study-fields.ts --dry-run
npx ts-node --transpile-only scripts/backfill-programme-study-fields.ts --dry-run
```

Against production both should now report every row as an UPDATE / already-tagged. A wall of
CREATEs would mean the target is not production.

**Tests:** 225/225 across `src/providers`, including the websync specs that share
`studyFieldKey()`.

**The live form — smoke-tested in a real browser against `app.sorenavisa.com`**, walking all
eight steps as an applicant would, twice:

| Check | Business profile | Engineering profile |
|---|---|---|
| `/start` leads to `/assessment` | ✅ | ✅ |
| "Preview build" banner gone | ✅ | ✅ |
| Q13 shows the study fields | **23 options** | 23 options |
| All 8 steps traversable | ✅ 1→8 | ✅ 1→8 |
| Submission succeeds | ✅ 99/100, Band 6 | ✅ 99/100, Band 6 |
| Results page | **9 real recommendations** | Advisor fallback message |
| Blank page or crash | none | none |
| JS errors | none | none |

The business run returned real programmes with provider, city and tuition — e.g. *Master of
Management by Thesis — ICL, Auckland, NZD 48,500*. The engineering run correctly showed
"No matching programmes yet — your case advisor will help identify options", because no
engineering programme is currently activated.

**One finding from the smoke test worth keeping.** The first run returned zero recommendations
even for business. It was not a bug: the robot answered CERTIFICATE for desired level (the first
option), and the active pool holds only three certificates, none of them business. Isolated by
relaxing one criterion at a time against the live endpoint — dropping `desiredLevels` returned
20 programmes, confirming the matcher was working the whole time. **If recommendations ever look
empty, check the level and location filters before suspecting the matcher.**

---

## 7. Known limitations

**1. The recommendation pool is 28 programmes, not 1,129.** The matcher only sees
`reviewStatus=APPROVED AND isActive AND provider.status=ACTIVE`. Yashua has activated 5 of 96
institutions so far and will work through the rest as he reviews them. **This is the intended
workflow, not a gap** — no bulk-activate tooling is wanted.

The active pool covers six study fields, heavily weighted to one:

```
business_management 20 · hospitality_culinary 4 · construction_trades 1
education_teaching 1 · healthcare_medical 1 · it_computer_science 1
```

An applicant outside those six gets an accurate score and band plus the advisor message. This
will enrich itself as institutions are activated; nothing further is needed in code.

**2. 13 programmes still fall back to `other`** — "Unspecified" (11), "Other" (1) and
"Technology" (1). Genuinely unplaceable; forcing them would be guessing.

**3. Three study fields have no programmes**: `project_management`, `healthcare_management`,
`hospitality_management`. They are business specialisations that no raw subject area reaches. An
applicant can still pick them; the matcher falls back to related fields.

**4. `provider_scholarships` is empty on production.** The nationality field became a searchable
ISO-code picker earlier today, which fixed a real scoping bug — but it has nothing to act on
until scholarships are entered.

**5. 8 of the 28 active programmes have no tuition figure.** Their cards render without a price.

**6. The declaration is not recorded.** It gates Submit and nothing more — no timestamp, no
stored consent. If it is ever needed as evidence, that is a backend change.

**7. The 50 frontend tests still do not run in CI.** Carried from Phase 36/37 and now guarding a
form that is live.

---

## 8. How a future developer would extend this

**Adding a subject area that maps badly.** Edit `studyFieldKey()` in
`programme-import.logic.ts` — one function, three consumers. Then re-run the backfill; it is
idempotent.

**⚠ One caveat if you re-map an existing programme.** The backfill upserts and never deletes, so
a programme moving from `other` to `law_government` would end up with **both** tags. Re-mapping
existing rows needs a delete-then-tag pass; adding new rules for currently-unmapped rows does
not.

**Ordering matters in `studyFieldKey()`.** Culinary sits above the arts branch so "Culinary Arts"
stays hospitality. Add new rules with that in mind and check the before/after distribution.

**Always run a new import AFTER the taxonomy is seeded.** That ordering is the entire cause of
this phase. A fresh environment should run `seed-study-fields.ts` before any catalogue import.

**To roll the launch back**, see §10 — it is one environment variable.

---

## 9. Security layers applied

**Two production guards added**, matching `geocode-providers.ts` and
`backfill-verification-status.ts`: any non-local `DATABASE_URL` requires `--confirm-production`.
"Local" is deliberately narrow — anything that is not `localhost`/`127.0.0.1` is treated as
production, so demo and staging are gated too. `--dry-run` is allowed anywhere because it writes
nothing.

**Backup before writing.** `D:/backups/prod-20260808-124255.dump`, taken before either script
ran, and **proved restorable** rather than merely created: restored into a scratch database and
compared row-for-row across all 123 tables (1,941 rows, zero differences), then the scratch copy
was dropped because it held real user data.

**No new attack surface.** No new endpoint, no new authorisation path. The flag changes which
form the funnel points at; both were already public routes.

**Credentials were never printed.** The production URL was pulled via the Railway CLI into a
file and only its hostname was ever displayed.

---

## 10. Rollback instructions

**To un-launch (fastest, no deploy of code):**

```bash
railway variables -e production -s ample-dream --unset NEXT_PUBLIC_ASSESSMENT_LIVE
```

Railway rebuilds the frontend (~2 minutes); `/start` returns to `/scorecard/landing` and the
preview banner reappears. `/assessment` stays reachable directly, as it was before.

**To revert the code:**

```bash
git revert c79293a
git push origin main
```

This restores the old `studyFieldKey()` mapping and removes both guards. It does **not** remove
the seeded rows or the tags — see below.

**To undo the data** (only if genuinely wanted — this would re-break the form):

```sql
DELETE FROM programme_study_fields;
DELETE FROM study_field_relations;
DELETE FROM study_fields;
DELETE FROM study_field_categories;
```

Or restore `prod-20260808-124255.dump`, which predates every write in this phase.

**Reverting the code without touching the data is safe** and is the right partial rollback: the
seeded taxonomy and the tags are correct regardless of which mapping version is in the tree.

---

## Commits in this session

| Hash | Message |
|---|---|
| `a6d1317` | feat(forms): session-scoped autosave, and searchable country/phone pickers platform-wide |
| `24b4350` | docs: Phase 36 handover |
| `0d32f0c` | chore(frontend): delete LeadForm — dead code |
| `6b13e1f` | docs: correct the LeadForm-deletion hash |
| `0ac7756` | feat(assessment): multi-step form with per-step validation and a declaration |
| `8a47b06` | docs: Phase 37 handover |
| `c79293a` | feat(catalogue): seed the StudyField taxonomy on production and tag every programme |

---

## Still open

**On the assessment itself** (none of these block the launch):

- ~12 UI strings to Persian + an RTL pass — the scorecard *questions* explicitly do **not** need
  translating
- The result-gate decision
- AI foundation + Recommendation Explanation Agent — `whyThisFits` currently returns one
  generic line ("Matches your preferred field of study")
- Programme enrichment data — descriptions, career outcomes and highlights are empty
- Wiring vitest into CI
- Recording the declaration
- Retiring `/scorecard` once the new form has proven itself

**Elsewhere, unchanged:**

- Seafield's 2 deferred programmes — needs the importer to update in place
- 4 institutions without coordinates
- The unexplained 2026-08-05 Future Skills activation
- The marketing site's lead form may share the empty-option enum bug recorded in the Phase 36
  doc — cannot be checked from this repo
- Remaining launch work: OPS portal, Sales portal, legacy `/admin/*`, Student portal My Case /
  Payments, client portal polish
