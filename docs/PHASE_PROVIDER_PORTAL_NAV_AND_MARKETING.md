# Provider Portal — Navigation reorganisation and marketing materials

**Status:** DONE — 18 August 2026
**Depends on:** the whole provider portal (slices A–F and the pricing follow-ups).
**Rules unchanged:** review gate, ownership boundary, pricing specificity. This moved
things and added one capability; it changed no rule.

---

## 1. What this phase does

Three placement changes and one new feature:

- **Performance is hidden from the nav.** The page, its endpoint, its guards and
  its tests are untouched and still work if opened directly. Restoring it is one
  commented line in `ProviderShell.tsx`.
- **"Your institution" became a profile page.** The spreadsheet uploader left it;
  the stats and the slice-B profile fields stayed; **marketing materials** arrived.
- **Each spreadsheet upload moved to the thing it acts on.** The programme sheet
  now sits with the single-programme form; the fee and scholarship sheets sit
  with the pricing tools.

`ProviderImportSection` gained a `kinds` prop so one component serves both
locations. Nothing about the upload changed — same dry run, same apply, same
review gate, same ownership scoping, same endpoints.

## 2. What I found on upload and moderation precedent

**The upload pattern already existed and is reused, not reinvented.**
`ProvidersService.setProgrammeCoverImage` is the closest match and this follows it
exactly: multipart through the API, a mime whitelist and size cap enforced on the
bytes the server holds, a key **derived server-side**, and the **key** stored on
the row — never a URL. Downloads use `R2Service.getPresignedDownloadUrl`, the same
mechanism `documents.service` uses for client files, at the same 60-second TTL.

Multipart rather than a presigned upload URL, deliberately: a presigned PUT is
signed before anyone has seen the bytes, so the content type is whatever the
browser claimed. Here the server holds the file and can check it — and does,
including that the extension agrees with the declared type.

**On moderation, the precedent points two ways depending on how you frame it:**

| Precedent | Reviewed? |
|---|---|
| Staff-uploaded assets (programme cover image) | **No** — uploaded by the party who would review it |
| Provider-submitted data that reaches students (prices, programmes) | **Yes** — the whole point of this build |
| Client-uploaded documents (`CaseDocumentReview`) | **Yes** — staff record a decision per document |
| `DocumentUploadStatus.PENDING` | **Not moderation** — it is transfer state (presigned URL issued, upload unconfirmed) |

Read as "comparable staff-facing upload", the answer is no review. Read as
"external party submits a file", the answer is review — and every external upload
in the platform is reviewed today.

**I implemented it review-gated** (`reviewStatus` defaults to PENDING), because
that is the safer direction, it matches everything else a provider submits in
this portal, and it is one line to remove. The provider sees *Received* rather
than *PENDING*, so no workflow promise is made to them either way.

**⚠ Worth your decision:** the gate is currently administrative — nothing in the
platform surfaces these files automatically, so a human is in the loop by
construction. It only becomes load-bearing if marketing assets are ever displayed
somewhere automatically (an Explore card, a provider profile page). If they never
will be, the gate can go; if they might, it should stay. That is the question I
could not answer from the code.

## 3. Database changes

Migration `20260818090000_provider_marketing_assets` — one new table, additive,
no backfill:

`provider_marketing_assets` — `providerId`, unique `r2Key`, `fileName`,
`contentType`, `sizeBytes`, `label?`, `reviewStatus` (default PENDING),
`isActive` (default true), `uploadedById?`, timestamps. FKs: provider `Cascade`,
uploader `SetNull`.

Nothing else changed. The nav and tab moves are frontend-only.

## 4. Environment variables

None added — R2 is already configured and in use.

## 5. Third-party services

None added. Cloudflare R2, already in use for documents, contracts and programme
cover images.

## 6. How to test it works

**What was actually run, 18 Aug 2026** — over HTTP, two institutions:

```
29/29 checks passed
  the fee sheet still dry-runs from its new home    4 rows, dryRun true
    and still applies, landing PENDING              review gate intact
  the programme sheet still dry-runs and applies    PENDING and inactive
  Performance still answers when hit directly       HTTP 200, own programmes only
  a PDF uploads                                     PENDING, label kept
    key derived server-side, namespaced by institution
    the row stores a KEY, not a URL
  an image uploads
  a script is refused                               400
  a mismatched name and type is refused             400
  a 21 MB file is refused                           400
    and none of the refusals created a row
  a download is a short-lived presigned URL         60s
  B sees none of A's files / cannot link / cannot remove    0, 404, 404
  B's own upload lands under B's prefix
  removing deactivates, the row survives, it drops off the list
  upload, download and removal are all audited      3 event types
```

**In a real browser**: **18/18** — the nav shows three destinations with
Performance absent, the institution page keeps its stats and offers marketing
materials (accepting `.pdf,.jpg,.jpeg,.png,.webp,.svg` only) with no spreadsheet
uploader, Programmes carries the programme sheet with **no** money-sheet tabs,
Country groups carries both money sheets and **not** the programme one, and
`/provider/analytics` still renders when opened directly.

Suites: backend **117 / 1455**, frontend **7 / 77**.

A placement test (`provider-nav.test.ts`) asserts that no sheet type is offered
in two places at once — it caught exactly that during the build, when the
programme sheet's import was added to `ProviderProgrammes` but the component was
never actually rendered.

## 7. Known limitations

- **Staff have no screen for these files.** They are stored, audited and
  downloadable by the institution, but nothing staff-side lists them yet. The
  review status therefore has no reviewer UI — an Owner would query the table.
- **No preview.** Files open through a presigned URL in a new tab; there are no
  thumbnails.
- **No virus scanning.** Neither has any other upload in this platform; if that
  is wanted it should be added for all of them at once, not just this one.
- **SVG is accepted**, which can contain script. It is never rendered inline by
  the platform — downloads go through a presigned URL to R2 — but if these files
  are ever displayed in-page, SVG should be dropped from the whitelist or
  sanitised first.
- **Performance is hidden by a commented line**, not a feature flag. That is
  deliberate for a one-line restore, but it will not survive a refactor that
  tidies comments.

## 8. How a future developer would extend this

`ProviderImportSection` takes `kinds`; place it wherever a sheet belongs and the
placement test will hold you to one home per sheet type.

For marketing assets, `ALLOWED` in `provider-marketing.service.ts` is the single
whitelist — mime and extensions together. The key derivation is the other thing
to leave alone: nothing the caller sends may reach it.

To restore Performance, uncomment the line in `NAV`.

## 9. Security layers applied

| Layer | Where |
|---|---|
| Authentication / role | `JwtAuthGuard`, `RolesGuard`, `@Roles('PROVIDER')` |
| Tenancy | Institution from the guard; every asset lookup scoped `{ id, providerId }`; the R2 key is namespaced by provider id |
| File type | Whitelist on mime **and** extension, and the two must agree |
| File size | 20 MB, checked on the bytes the server holds |
| Storage | Key derived server-side; the row stores a key, never a URL; no public path |
| Download | Fresh 60-second presigned URL per request, audited |
| Destruction | Removal deactivates the row and keeps the object |
| Rate limit | 12 uploads/minute per institution |
| Audit | `PROVIDER_MARKETING_ASSET_{UPLOADED,DOWNLOADED,REMOVED}` |

## 10. Rollback instructions

The nav and tab moves are frontend-only — reverting the commit restores the old
layout exactly, including Performance in the nav.

The marketing table is additive. Reverting the code leaves it in place with its
rows intact and nothing reading them. To remove it as well:

```sql
DROP TABLE provider_marketing_assets;
```

The R2 objects under `provider-marketing/` are not removed by that and would need
a separate sweep — deliberately, since dropping a table should not delete files.
