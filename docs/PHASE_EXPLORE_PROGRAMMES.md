# Phase: Explore Programmes (student map + detail)

Built 2026-08-06. The first student-facing surface over the imported catalogue: a map of
institutions, a ranked list of programmes priced for the signed-in student, and a detail page per
programme.

---

## 1. What this phase does

`/student/explore` — results list on the **LEFT**, New Zealand map on the **RIGHT** (Owner's
confirmed preference). Search, four sort orders, and clicking a map pin filters the list to that
institution. `/student/explore/[programmeId]` — one programme in full: cost breakdown, entry
requirements, intakes, what changed since the student last looked, and matched videos.

Three things here are **functional additions, not UI**:

* **Featured-first sorting now exists.** `isFeatured` was a column read in `public.service.ts`
  with no `orderBy` on it anywhere, so the flag had no effect on anything. It is now the primary
  sort key on every ordering.
* **`ContentMatchingAgent` has a caller.** It and `YoutubeCorpusService` were dead code —
  `YOUTUBE_API_KEY` was configured in every environment and never used. `ExploreModule` is its
  first consumer.
* **Institutions have coordinates.** `latitude`/`longitude` did not exist; 90 of 91 are now
  geocoded.

Articles are deliberately **out of scope** — `ProgrammeArticle` exists in the schema and nothing
in this build references it.

---

## 2. Files created or changed

**Backend**
| File | What |
|---|---|
| `src/explore/explore.logic.ts` + spec | new — sorting, featured-first, map-pin grouping (10 tests) |
| `src/explore/explore.service.ts` | new — list / detail / changes / videos |
| `src/explore/explore.controller.ts` | new — 4 routes, STUDENT-gated |
| `src/explore/explore.module.ts` | new — first wiring of ContentMatchingAgent |
| `src/explore/dto/explore-query.dto.ts` | new — sort/search/level/budget validation |
| `src/providers/geocode.logic.ts` + spec | new — query building, NZ-bounds rejection (27 tests) |
| `scripts/geocode-providers.ts` | new — Nominatim pass, rate-limited |
| `scripts/seed-explore-demo-local.ts` | new — LOCAL ONLY, see §7 |
| `prisma/schema.prisma` + migration | +4 nullable columns on `education_providers` |
| `src/app.module.ts` | registers `ExploreModule` |

**Frontend**
| File | What |
|---|---|
| `app/student/explore/page.tsx` | new route |
| `app/student/explore/[programmeId]/page.tsx` | new detail route |
| `components/student/explore/ExploreClient.tsx` | new — list left, map right |
| `components/student/explore/ExploreMap.tsx` | new — Leaflet, client-only |
| `components/student/explore/ProgrammeDetailClient.tsx` | new — detail, changes, videos |
| `package.json` | + `leaflet`, `react-leaflet`, `@types/leaflet` |

---

## 3. Database tables/columns added

Migration `20260806000000_pr_explore_provider_coordinates` — **additive only**, four nullable
columns on `education_providers`:

| Column | Why |
|---|---|
| `latitude` / `longitude` | map pin; nullable because an institution that cannot be geocoded confidently gets **no pin rather than a wrong one** |
| `geocodedAt` | so a re-run retries only the misses instead of re-geocoding all 91 |
| `geocodeSource` | provenance, e.g. `nominatim:campus` vs `nominatim:city` — a city-level pin is town-accurate, not campus-accurate, and that distinction is recorded |

No table altered, nothing dropped.

---

## 4. Environment variables added

**None.** `YOUTUBE_API_KEY` was already set locally and on production; this phase is the first
code path that actually reads it in a request. `GEOCODER_CONTACT` is optional and only affects the
User-Agent the geocoding script sends (defaults to `admin@sorenavisa.com`).

---

## 5. Third-party services connected

**OpenStreetMap / Nominatim** — map tiles and geocoding. No API key, no account, no billing.
Chosen over Mapbox/Google deliberately: ~90 pins in one country does not justify a paid tier, and
the tiles come from the same dataset the geocoder used.

**YouTube Data API** — via the pre-existing `YoutubeCorpusService`, now actually called.

---

## 6. How to test it works

```bash
cd backend  && npm run start:dev
cd frontend && npm run dev
# sign in as a STUDENT, then open
# http://localhost:3000/student/explore
```

Verified 2026-08-06 by browser click-through as a real STUDENT account:

| Check | Result |
|---|---|
| Layout | first card x=361, map x=998 — **list is left of map**, measured not eyeballed |
| Map | 8 tiles loaded, 14 pins rendered, featured pins gold |
| Pricing | nationality IR resolved; `NZ$23,946 your cost / year` |
| Conditional fee | shows the institution's own wording in italics, no invented number |
| Detail page | cost breakdown, requirements, intakes all render |
| What changed | two real audited edits shown with strikethrough old → new |
| Videos | 2 cards render via the manual-override path |
| Console errors | none |

Test suite: **808 passing across 72 suites** (37 new: 27 geocode, 10 explore).

---

## 7. Known limitations

1. **The map shows only what is genuinely approved.** Explore reuses the Recommendation Engine's
   gate — `APPROVED && isActive && provider.status === 'ACTIVE'`. On production that is currently
   20 programmes across 3 institutions, so Explore will show exactly those, not 1,123. This is
   correct, not a bug, but it will look sparse until curation progresses.
2. **AI video matching currently returns nothing for most programmes.** The wiring works — 186
   videos are fetched from the Sorena Visa channel with the existing key, and the agent responds
   in ~5s — but the channel's content is general migration/study-in-NZ material, largely in
   Persian, while the agent's prompt insists "Relevance to New Zealand study in general is NOT
   enough" and returns an empty array rather than padding. Zero matches across 12 varied
   programmes tested. So per-programme video content needs either channel content at programme or
   subject level, a deliberately looser matching rule, or the manual override. **The manual
   override works today** and is the only reliable way to get videos on a programme right now.
3. **One institution has no pin.** Eastwest College of Intercultural Studies — its source
   location reads "specific city not stated on pages reviewed". It appears in results normally and
   the list names it as unmapped. Never silently dropped.
4. **53 of the 90 pins are city-level**, i.e. accurate to the town, not the campus. Recorded in
   `geocodeSource` so a later pass can improve them.
5. **"What changed" is per-device.** The last-viewed timestamp is in `localStorage`, so a student
   on a second device sees the full history again. Storing it server-side would need a table.
6. **No shortlist/save.** The design artifact's "shortlist" is currently the ranked results list;
   nothing is persisted per student yet.
7. **`maxTuitionNZD` filtering is built and validated but not surfaced in the UI.**

---

## 8. How a future developer would extend this

* **Pin accuracy** — re-run `geocode-providers.ts --retry-misses`; it only touches rows with a
  null coordinate. To improve city-level pins, clear `geocodedAt` for rows where `geocodeSource`
  ends in `:city` and re-run.
* **Video matching** — the honest fix is content, not code. If matching must be loosened, change
  the prompt in `content-matching.agent.ts`; do not loosen it silently, because "a video about NZ
  visas" appearing under a dance certificate is worse than no video.
* **A real shortlist** would need a `StudentShortlist` table; the sort keys and pricing resolution
  are already reusable.
* **Do not loosen `STUDENT_VISIBLE`** in `explore.service.ts` to make the map look fuller. It is
  the same gate the matching engine uses, and it is what stops unapproved programmes reaching
  students.

---

## 9. Security layers applied

* **Layer 2 — access control.** Every `/explore` route is `@Roles('STUDENT')` behind
  `JwtAuthGuard`, matching how `/student/*` is gated in the frontend and how the recommendations
  endpoints are gated. **No user id is ever accepted from the client** — nationality, and
  therefore pricing, is resolved from the authenticated token only.
* **Enumeration.** A programme that is not student-visible returns the same 404 as one that does
  not exist, so an unapproved programme cannot be discovered by guessing ids.
* **Layer 6 — audit.** This phase is read-only; it writes nothing. "What changed" *reads* the
  audit trail the curation screen writes, which is why it can only ever report changes that
  actually happened.
* **Input validation.** `ExploreQueryDto` whitelists sort/search/level/budget with length and
  range caps; `ValidationPipe` rejects anything else.
* **Third-party rate limits.** The geocoder obeys Nominatim's 1 req/sec policy with a real
  User-Agent — breaching it would get the platform's IP blocked and take the map down for
  everyone.

---

## 10. Rollback instructions

```bash
git revert <commit>
```

The migration is additive and safe to leave in place — the four columns are nullable and nothing
else reads them. To remove them anyway:

```sql
ALTER TABLE "education_providers"
  DROP COLUMN "latitude", DROP COLUMN "longitude",
  DROP COLUMN "geocodedAt", DROP COLUMN "geocodeSource";
```

No student data is created by this phase, so there is nothing to clean up.

---

## Appendix A — the geocoding approach

Free, keyless, and paired with the Leaflet/OSM map.

**Rate limiting.** Nominatim's policy is an absolute maximum of 1 request/second with an
identifying User-Agent. The script waits **1,100 ms** between calls and sends
`SorenaVisaPlatform/1.0 (<contact>)`. A 429 or 403 **aborts the whole run** rather than continuing
to hammer it. 91 institutions take roughly 3–5 minutes.

**Queries, most specific first.** The stored `city` is free text and only sometimes a city — 51 of
92 values contain parentheses, notes or campus lists:

```
"Auckland (99 Khyber Pass Road, Grafton, Auckland 1023)"   ← a full street address
"Auckland (City) and Christchurch"                          ← two campuses
"Invercargill (HyFlex option available)"                    ← a note
"Dunedin; Auckland"  ·  "Auckland / Christchurch / Tauranga" ← lists
"Hamilton City Campus"  ·  "Madras Street Campus"            ← not a city at all
```

So `locationCandidates()` **extracts a street address from the brackets when one is present** —
that is the best input available, better than the city — and otherwise reduces the messy string to
its first usable place name. Queries are then tried in order: street address → institution + city
→ institution alone → bracketed acronym → **city alone, always last**, because the final rung is
labelled a city-level (approximate) match rather than a campus pin.

**New Zealand bounds rejection.** Every result is checked against a NZ bounding box
(lat −47.5…−34.0, lon 166.0…179.5, covering Stewart Island and the Chathams) and **rejected
outright if outside**, no matter how confident the geocoder was. This is not theoretical: "Lincoln
University" matches strongly in Nebraska, "Canterbury" in Kent, and "Wellington" in Somerset. A
rejected result leaves the coordinate null.

**Never guesses.** An institution that cannot be matched keeps null coordinates, is named in the
run report, and still appears in Explore results — just without a pin. A pin in the wrong place
would be read by a student as fact.

**Outcome:** 24 campus-accurate, 13 institution-level, 53 city-level, **1 not pinned**.

---

## Appendix B — the local-only demo activation script

`scripts/seed-explore-demo-local.ts` — **local development only. It cannot run against
production**: it refuses unless `DATABASE_URL` points at localhost, the same guard as
`catalogue-import-local.ts`.

It exists because Explore's visibility gate is strict and correct: a fresh local database has
almost nothing approved, so the map renders nearly empty and the layout cannot be reviewed. The
script marks a spread of **real imported programmes** (54 across 14 institutions, mixing featured
and non-featured) as APPROVED + active and their institutions ACTIVE, so the screen can be
reviewed with real names, real fees and real coordinates.

```bash
npx ts-node --transpile-only scripts/seed-explore-demo-local.ts          # activate
npx ts-node --transpile-only scripts/seed-explore-demo-local.ts --undo   # revert
```

---

## Appendix C — running the geocoder against a non-local database

`geocode-providers.ts` is genuinely useful against production — that is how the live map got its
pins — so it does not refuse outright the way `catalogue-import-local.ts` does. Instead it
**gates**: a non-local `DATABASE_URL` requires `--confirm-production`, and without the flag it
stops with exit 1.

```bash
# local — no flag needed
npx ts-node --transpile-only scripts/geocode-providers.ts

# production — deliberate, and take a backup first
DATABASE_URL=<prod> npx ts-node --transpile-only scripts/geocode-providers.ts --confirm-production
```

"Local" is deliberately narrow: anything that is not `localhost`/`127.0.0.1` is gated, so a
staging or demo URL is caught too. The point is that nobody with a production URL already exported
in their shell can geocode the live catalogue by accident.

It writes **only** `latitude`, `longitude`, `geocodedAt` and `geocodeSource` on
`education_providers`, and nothing else — two `update` calls, no other table or column.

**It does not touch production and must never be run against it.** On production, activation is
the Owner's decision, made on the curation screen, one programme at a time.

---

## Addendum — updated PTE workbook (2026-08-06)

An updated `NZ_International_PTE_Programmes_2026_2027.xlsx` added two institutions the original
had missed. The pre-overwrite original was recovered from commit `7ffd2e5` and kept alongside as
`…_ORIGINAL.xlsx` so the two can be diffed rather than trusted.

**Imported:** 4 Future Skills programmes + 2 Bridge International College programmes.
Production went 95 → **96** providers and 1,123 → **1,129** programmes. All 6 landed PENDING and
inactive; nothing became student-visible.

**Future Skills** got a seventh alias (`Future Skills Academy Limited` → `Future Skills`) so the
4 programmes filled the empty record the platform already had, instead of creating a duplicate.

**Bridge is a NEW provider, deliberately not merged into ICL.** The workbook's own note says it is
"part of ICL Education Group", but it holds its own NZQA Provider ID (737569001). Separate
registration = separate legal entity, the same test the original 6 aliases were resolved by.

### FOLLOW-UP: two Seafield programmes have corrected data waiting

The updated workbook also **rewrote two existing Seafield School of English rows** — renaming them
from "… (Academic) Level 5" to "… (Academic)" with the level moved into the strand, plus corrected
2026/2027 intakes, a fee year, and a `Single-source → Verified` upgrade.

They were **deliberately deferred**, not missed. The importer is create-if-absent and keys partly
on programme name, so importing them would have produced four rows for two real courses with the
corrections stranded on the new copies. The deferral lives in code as `DEFERRED_ROWS` in
`catalogue-workbook.logic.ts`, and every parse run reports what it skipped — it cannot quietly
disappear.

**To close it:** teach the importer to update an existing row (match on provider + level + strand
rather than name), then remove the two `DEFERRED_ROWS` entries. That is a real behaviour change to
a service that has never updated anything, so it deserves its own tested pass. Small, and safe to
do after launch.

### FOLLOW-UP: 373 programmes are labelled more confidently than their source

Found while checking the new rows' flags. The import mapped **any** non-empty "Verification
Status" cell to `VERIFIED`:

```ts
verificationStatus: row.verificationStatus ? 'VERIFIED' : null   // ← the bug
```

The source does not use tidy labels — it writes a sentence whose first words carry the confidence
("Single-source (fee/IELTS from IDP only…)"). Across the three workbooks: **471 Verified,
379 Single-source, 278 Double-checked**. Every one of the 379 was stored as fully VERIFIED.

Fixed going forward by `parseVerificationStatus()`, which maps Single-source → `NEEDS_RECHECK`,
Verified/Double-checked → `VERIFIED`, and anything unrecognised → `NEEDS_RECHECK` (fail toward
"look at this", never toward "trusted"). The 6 new rows were corrected on production —
4 are now NEEDS_RECHECK.

**The other ~373 pre-existing rows are still mislabelled.**
`scripts/backfill-verification-status.ts` recomputes the column from the workbooks and is ready to
run (dry-run by default, `--confirm-production` required, touches one column and nothing else).
Held pending Owner sign-off because it rewrites a third of the catalogue's confidence metadata.
