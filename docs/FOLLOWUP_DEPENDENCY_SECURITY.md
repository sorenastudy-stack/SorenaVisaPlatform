# Follow-up: dependency security backlog

Raised 2026-08-05 during the production deploy of the 81-commit gap. **Deliberately
NOT bundled into that deploy** — every item below is either pre-existing in
production or needs a breaking upgrade that deserves its own focused pass.

Baseline at the time: `npm audit` (backend) reported **43 vulnerabilities — 4 low,
24 moderate, 14 high, 1 critical**.

---

## 1. `xlsx` (SheetJS) — ✅ RESOLVED 18 August 2026

| | |
|---|---|
| Advisories | Prototype Pollution (GHSA-4r6h-8v6p-xvw6), ReDoS (GHSA-5pgg-2g8v-p4x9) |
| Resolution | Pinned to `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` — the vendor's own registry, which publishes the patched versions npm does not carry (option 1 below). `npm audit --omit=dev` now reports nothing against `xlsx`. |
| Declared in | `backend/package.json` → **`dependencies`** (see below) |
| Used by | `providers/import/programme-import.logic.ts`, `sheet-parse.logic.ts`, `scholarship-import.logic.ts`, `catalogue-workbook.logic.ts` |

**Two things in the original assessment turned out to be wrong, and both are worth recording.**

**It was in `devDependencies`, which meant production never installed it at all.** Every
spreadsheet importer — nine routes — had been answering
`400 "Could not read the spreadsheet: Cannot find module 'xlsx'"` to any valid upload since Phase
34, roughly five months. Two things hid it: each parser defers `require('xlsx')` behind a Proxy so
boot never depends on it (true, and it let the service start healthy while the feature was broken),
and the importers rewrite any parse error into "Could not read the spreadsheet", so a missing
module read as a bad file. Found as a side effect of the antivirus slice-2 live verification, not
by the audit.

**"Exposure is narrow — Owner only" was also wrong.** Three importer routes are Owner-gated, but
the other six are provider-portal routes reachable by **external institutions** with the PROVIDER
role. So the realistic threat was not only "Owner uploads a crafted .xlsx" — an outside party
could reach the parser. That is why the CDN pin was taken rather than accepting the risk.

⚠️ **Trade-off now in force:** this dependency no longer comes from the npm registry. Builds
depend on `cdn.sheetjs.com` being reachable, and **`npm audit` cannot track future advisories
against a URL dependency** — SheetJS releases have to be checked by hand. A CDN outage fails the
build, not the running service.

Fixed in `f16ab89` (move to `dependencies`, lockfile regenerated — the lock carried `"dev": true`
and `npm ci --omit=dev` reads the lock, so editing package.json alone would have changed nothing)
and `479c7b1` (CDN pin). All nine importer routes verified live afterwards: clean workbooks
accepted and rows actually imported, EICAR still refused at 422.

---

## 2. Nine dependencies needing BREAKING upgrades

`npm audit fix --force` flags each of these as a semver-major change. All are
**pre-existing and already live in production** — this deploy did not introduce or
worsen them.

| Package | Note |
|---|---|
| `@nestjs/cli` | Build tooling |
| `@nestjs/platform-express` | Core HTTP adapter — highest-risk upgrade |
| `multer` | DoS via incomplete cleanup; used by every file upload |
| `nodemailer` | Email to unintended domain (interpretation conflict) |
| `pdfjs-dist` | Arbitrary JS execution on malicious PDF — used by contract stamping |
| `glob` | Command injection via CLI `-c/--cmd` (CLI path only) |
| `picomatch` | Method injection in POSIX character classes |
| `tmp` | Arbitrary write via symlink `dir` parameter |
| `tar` (**CRITICAL**) | Arbitrary file create/overwrite via hardlink path traversal — transitive |

**Suggested order** — highest real exposure first, one at a time with the full
suite between each:

1. `tar` (critical, transitive — may resolve via a parent bump alone)
2. `multer` + `pdfjs-dist` — both sit on real user-supplied input paths
3. `nodemailer`
4. `@nestjs/platform-express` + `@nestjs/cli` — do these together, expect API churn
5. `glob` / `picomatch` / `tmp` — tooling-side, lowest exposure

---

## 3. Open question — Playwright browser binary in production

`playwright` is correctly in `dependencies` (NOT test-only): `websync/page-fetch.service.ts`
dynamically imports it to render JS-driven institution pages for the catalogue crawl.

`npm install playwright` fetches the package but **not necessarily the Chromium
binary** (normally `npx playwright install`). If the binary is absent in the Railway
image, `ensureBrowser()` catches the failure, logs
`"Headless browser unavailable — continuing static-only"`, and the crawl silently
degrades to static fetching — missing any change that only appears after JS runs.

**Action:** check production logs for that line. If present, either add a
`playwright install chromium` build step or accept static-only and remove the
dependency.
