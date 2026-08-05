# Follow-up: dependency security backlog

Raised 2026-08-05 during the production deploy of the 81-commit gap. **Deliberately
NOT bundled into that deploy** — every item below is either pre-existing in
production or needs a breaking upgrade that deserves its own focused pass.

Baseline at the time: `npm audit` (backend) reported **43 vulnerabilities — 4 low,
24 moderate, 14 high, 1 critical**.

---

## 1. `xlsx` (SheetJS) — HIGH, no fix available

| | |
|---|---|
| Advisories | Prototype Pollution (GHSA-4r6h-8v6p-xvw6), ReDoS (GHSA-5pgg-2g8v-p4x9) |
| Fix via npm | **None.** SheetJS moved off the public npm registry; the registry copy is frozen at a vulnerable version. |
| Declared in | `backend/package.json` → `devDependencies` |
| Used by | `providers/import/programme-import.logic.ts`, `providers/import/sheet-parse.logic.ts` (scholarship + tuition importers) |

**Why it was accepted for now — exposure is narrow:**

- All three upload endpoints are `@Roles('OWNER','SUPER_ADMIN')` — not public, not
  client-facing.
- Reaching the parser requires an authenticated Owner session.
- The module is **lazily loaded** behind a Proxy, so it is not resident unless an
  import actually runs.
- Input is a spreadsheet the Owner uploads themselves.

Realistic threat is "Owner uploads a maliciously crafted .xlsx", not remote
exploitation.

**Options when this is picked up:**

1. Install SheetJS from the vendor's own registry (`https://cdn.sheetjs.com/`),
   which publishes patched versions npm does not carry.
2. Swap to a maintained alternative (e.g. `exceljs`) — larger change; the parsers
   are pure-logic and well covered by tests, so the blast radius is contained.
3. Accept and document, given the role gate.

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
