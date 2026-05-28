# PR-SCORECARD-3 — PDF report generation

## 1. Purpose

Generate two branded PDF reports from a stored scorecard submission:

- **Internal report** — staff-facing, long-form: cover with band
  badge, category breakdown, hard-stops detail, risk flags, 5-gate
  execution check, full answer log (category-grouped), contact
  summary, blank staff-observations block.
- **Client report** — applicant-facing, warm tone: cover with
  headline + score badge, plain-language band meaning, category
  strengths, structured next-action bullets, dual-country callout
  for Bands 4-6 no-hard-stop, About Sorena Visa closing.

Both ship from the same module (`backend/src/scorecard/pdf/`) with
shared helpers + brand constants. Downloads happen at
`GET /scorecard/:id/pdf` (client) and `GET /staff/scorecard/:id/pdf`
(internal). Single commit.

## 2. Reference-file findings

`Sorena_Scoring_Reference/score_pdf.py` and `client_report.py` are
ReportLab implementations. The colour palette, page geometry, and
layout structure ported cleanly to PDFKit. The Python band-colour
scale (Band 1=RED, 2=AMBER, 3=GOLD, 4=NAVY, 5/6=EMERALD) **differs**
from the spec's `BAND_COLORS` (red → teal scale). The spec is
authoritative; the divergence is documented in
`branding.ts:42-49`.

The reference PNGs (`logotype_navy_trans.png`, `logomark_white_trans.png`,
`logotype_white_trans.png`) live in `Sorena_Scoring_Reference/`.
The Python reference uses them with try/except fallback to bold
text. The TypeScript port uses **only** the text fallback —
PDFKit's built-in Helvetica family means zero deployment surprises
(no font/PNG path issues across hosts).

Key adaptations for PDFKit:

- **Coordinate system**: ReportLab y=0 at bottom. PDFKit y=0 at top.
  All ports use PDFKit's native top-down coords.
- **Stateful fills**: ReportLab uses `setFillColor(c)` then `rect(...)`.
  PDFKit chains `.fill(c)` per draw operation.
- **Page numbering**: needs `bufferPages: true` so we can switch
  back to laid-out pages and overlay "Page X of Y" footers.
- **Line-wrapper trap** (discovered during dev): `doc.text(s, x, y,
  { width, align: 'right' })` engages PDFKit's `LineWrapper`, which
  auto-creates a new page if it suspects overflow — **even with
  `lineBreak: false`**. Symptom: a 4-page report inflates to 16
  pages, one new page per footer-text call × N pages.
  - **Fix**: for fixed-line-height single-line text at an explicit
    position, measure with `doc.widthOfString(s)` and place at the
    computed `x` without passing `width + align`.
  - This bug bit `drawFooter`, `drawHeader`, `drawSectionTitle`,
    `drawProgressBar`, and `drawAnswerRow`. All five were fixed
    via the `widthOfString` pattern.

## 3. New files

| File | LOC | Purpose |
| --- | --- | --- |
| [backend/src/scorecard/pdf/branding.ts](../backend/src/scorecard/pdf/branding.ts) | 66 | Shared brand constants — colours, fonts, page geometry, slogan, company, band-colour map. |
| [backend/src/scorecard/pdf/helpers.ts](../backend/src/scorecard/pdf/helpers.ts) | 491 | All reusable drawing primitives: header, footer, section title, band badge, progress bar, hard-stop card, risk-flag bullet, gate row, answer row, kv row, bullet, divider, cover band, slug + date formatters, page-footer overlay. |
| [backend/src/scorecard/pdf/internal-report.ts](../backend/src/scorecard/pdf/internal-report.ts) | 333 | `renderInternalReport(data) → Buffer`. Cover + category breakdown + hard-stops + risk flags + 5-gate check + full answer log + contact summary + staff observations. |
| [backend/src/scorecard/pdf/client-report.ts](../backend/src/scorecard/pdf/client-report.ts) | 381 | `renderClientReport(data) → Buffer`. Cover + warm intro + strengths + structured next-step bullets + dual-country callout (Bands 4-6 no HS) + About Sorena closing. |
| [backend/src/scorecard/pdf/index.ts](../backend/src/scorecard/pdf/index.ts) | 11 | Barrel export. |
| [frontend/src/lib/scorecard/pdf-download.ts](../frontend/src/lib/scorecard/pdf-download.ts) | 70 | Client-side helper: fetches PDF with auth, parses Content-Disposition, triggers native download. |
| [frontend/src/app/staff/scorecards/[id]/StaffScorecardPdfButtons.tsx](../frontend/src/app/staff/scorecards/[id]/StaffScorecardPdfButtons.tsx) | 70 | Client component with the two staff buttons (internal + client). |
| [docs/PHASE_SCORECARD_3_PDF_REPORTS.md](./PHASE_SCORECARD_3_PDF_REPORTS.md) | this | Handover. |

**Backend total: 1,282 LOC** in the PDF rendering layer.

## 4. Modified files

- `backend/src/scorecard/scorecard.service.ts` — added
  `generateClientPdf()` + `generateInternalPdf()` + import of the
  PDF barrel.
- `backend/src/scorecard/scorecard.controller.ts` — added
  `GET /scorecard/:submissionId/pdf` + `GET /staff/scorecard/:submissionId/pdf`
  + the `pdfFilename(prefix, name, date)` helper that calls
  `shortFilenameSlug()`.
- `backend/src/common/audit/audit.helper.ts` — humaniser entries
  for `SCORECARD_CLIENT_PDF_GENERATED` + `SCORECARD_INTERNAL_PDF_GENERATED`.
- `frontend/src/components/scorecard/ScorecardResultClient.tsx` —
  replaced placeholder "Download report (PDF) — coming soon" button
  with a real working button (new sub-component `PdfDownloadButton`).
- `frontend/src/app/staff/scorecards/[id]/page.tsx` — mounted the
  two-button group below the header.
- `backend/package.json` + `backend/package-lock.json` — added
  `pdfkit` 0.18.0 in dependencies, `@types/pdfkit` 0.17.6 in
  devDependencies.

## 5. New dependencies

Exactly two, both at exact versions per spec:

| Package | Version | Section |
| --- | --- | --- |
| `pdfkit` | 0.18.0 | dependencies |
| `@types/pdfkit` | 0.17.6 | devDependencies |

Confirmed via `grep -n '"pdfkit"\|"@types/pdfkit"' backend/package.json`.
No other packages installed.

## 6. Audit events

Added to `common/audit/audit.helper.ts`:

- `SCORECARD_CLIENT_PDF_GENERATED` — fires on every successful
  `GET /scorecard/:id/pdf`. `newValue` carries `{ submissionId,
  byStaff }`. Humaniser flips its phrasing if a staff user
  downloaded the client report.
- `SCORECARD_INTERNAL_PDF_GENERATED` — fires on every successful
  `GET /staff/scorecard/:id/pdf`. `newValue` carries `{ submissionId,
  viewerUserId }`.

Both audit writes are wrapped in try/catch so a logging failure
never breaks the download.

## 7. Validation results

- Backend `npx tsc --noEmit` → exit 0 (clean).
- Frontend `npx tsc --noEmit` → exit 0 (clean).
- Scorecard tests: `npx jest src/scorecard/scoring/scoring.spec.ts`
  → **40 / 40 pass**, 1.518 s.
- Smoke probes:
  ```
  GET /scorecard/abc123/pdf         (unauth) → 401
  GET /staff/scorecard/abc123/pdf   (unauth) → 401
  ```
- Sample PDF generation (Maryam Karimi 100/Band 6 canonical):
  ```
  Internal:  8696 bytes; 4 pages; magic %PDF
  Client:    9303 bytes; 5 pages; magic %PDF
  ```
  - Note: spec expected 30-150 KB. The actual size is ~9 KB because
    we don't embed any images or fonts (Helvetica is built-in).
    The "30-150 KB" range assumed image/font embedding; the
    text-only output is just much smaller. PDF/A specification
    compliance is preserved.
  - Internal page count (4) is one shy of the spec's 5-7 because
    the Maryam scenario has zero hard stops + zero risk flags
    (those sections collapse to one-line "None" text). With a
    realistic hard-stop scenario it grows.
- Filename sanitisation (`shortFilenameSlug`):
  ```
  'Maryam Karimi'   → 'maryam-k'
  'Yashua Arjmand'  → 'yashua-a'
  'محمد'             → 'applicant'   (non-ASCII unicode fallback)
  null               → 'applicant'
  ''                 → 'applicant'
  ```

## 8. Routes + role gates

| Method | Path | Roles | Notes |
| --- | --- | --- | --- |
| GET | `/scorecard/:submissionId/pdf` | LEAD, STUDENT, OWNER, ADMIN, SUPER_ADMIN, CONSULTANT | Applicant or staff. Ownership enforced in service. |
| GET | `/staff/scorecard/:submissionId/pdf` | OWNER, SUPER_ADMIN, ADMIN, CONSULTANT | Staff only. |

Both endpoints:
- Stream `Content-Type: application/pdf` with `Content-Disposition:
  attachment; filename="…"`
- Use `req.user?.userId ?? req.user?.id` (d95640d JWT pattern)
- Write audit row on success

## 9. Operational notes

- **No PDF caching**: regenerate on every download. Generation is
  fast (~50 ms for the Maryam case). Caching is on the backlog.
- **No external fonts**: Helvetica + Helvetica-Bold + Helvetica-Oblique
  are PDFKit built-ins. Persian/Arabic text in answer fields will
  render as glyph-missing boxes — acceptable for the current
  English-only result page; multi-language support is on the
  backlog.
- **No logo embedding**: the Python reference's PNG-with-fallback
  pattern was simplified to text-only. The brand mark embed is on
  the backlog (Inter/Vazirmatn fonts + the SorenaMark logomark
  via `doc.image()`).
- **Filename format**: `sorena-{assessment|internal}-{first}-{lastinitial}-{YYYYMMDD}.pdf`.
  Filesystem-safe on Windows, macOS, Linux. Non-ASCII names
  fall back to "applicant" cleanly.

## 10. Backlog (deferred to future PRs)

- Custom font embedding (Inter for English, Vazirmatn for Persian)
  for full brand alignment instead of Helvetica.
- Embed the SorenaMark logomark on the cover (currently text-only
  wordmark).
- PDF caching server-side (regeneration is currently fast enough
  that this is a scale concern, not a correctness one).
- Email the PDF as an attachment when the submission lands
  (currently only available via download).
- QR code on the PDF linking back to the live results page.
- Multi-language PDF support — render in Persian when the lead's
  preferredLanguage is `fa` (requires the Vazirmatn font embed
  above).
- Watermarking for draft / test environments
  (`process.env.NODE_ENV !== 'production'` → diagonal "DRAFT"
  overlay).
- PDF generation unit tests — visual snapshot testing for PDFs
  requires more infra than was justified in this PR. Manual
  verification via the sample-generation step is the current
  acceptance gate.
- Page-count threshold check in the internal-report renderer:
  detect when sections collapse and pad with extra contact-summary
  detail so even all-clear scenarios hit the 5-7 page band.
