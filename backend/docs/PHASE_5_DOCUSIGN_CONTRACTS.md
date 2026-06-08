# PHASE 5 — DocuSign Engagement-Letter Contract System

> **Save location:** `docs/PHASE_5_DOCUSIGN_CONTRACTS.md`
> **Status:** Complete and verified by live multi-signer send (DocuSign DEMO).
> **Covers:** Sub-phases 5G (PDF identity stamping) + 5H (composite-template send).

---

## 1. What this phase does

This phase sends the Sorena engagement letter (the client–Sorena consulting agreement) out for legally binding electronic signature through DocuSign. When a case is ready, the system auto-assigns the responsible Licensed Immigration Adviser (LIA), stamps that LIA's name and IAA licence number directly onto the PDF, then sends the document to three signers in sequence — Client, then LIA, then Director — using a pre-built DocuSign template that owns all the signature, date, and form-field positions. As each person signs, DocuSign notifies the platform via a webhook, and the contract's status is kept in sync in the database. The result is a fully executed, audit-trailed agreement with no manual paperwork.

---

## 2. Files created or changed

### `backend/src/contracts/`

| File | Purpose |
|---|---|
| `contracts.controller.ts` | HTTP layer — `POST /contracts` (create + send), `GET /contracts/:caseId`, `POST /contracts/webhook` (DocuSign Connect callback). Role guard restricts create to OWNER / SUPER_ADMIN / ADMIN / LIA. |
| `contracts.module.ts` | NestJS module wiring (DocuSignService, ContractsService, dependencies). |
| `contracts.service.ts` | Core orchestration. `createContract` (auto-assign LIA → stamp PDF → composite-template send → write `Contract` + 3 `ContractSigner` rows); `handleWebhook` (idempotent per-recipient status sync); `getSigningUrl`. |
| `contracts.service.spec.ts` | DB-level tests: webhook idempotency + status mapping against a real PrismaClient with the DocuSign SDK mocked. |
| `contract-status.ts` | `docusignToContractStatus()` — maps DocuSign envelope status → internal `ContractStatus` enum. |
| `docusign.service.ts` | DocuSign integration. JWT-grant auth + in-memory token cache; **composite-template envelope builder** (`buildEnvelopeDefinition`); `createEnvelope` / `getSigningUrl` / `syncStatus` / `listRecipients`; exports `TEMPLATE_ROLE_CLIENT/LIA/DIRECTOR` constants + `TemplateRoleName` type. |
| `docusign.service.spec.ts` | Pure-function spec for composite-template envelope shape (envelope-level, ServerTemplate, InlineTemplate recipients, substituted document). |
| `engagement-letter-stamp.ts` | `stampLiaIdentity(pdfBytes, identity)` — pdf-lib + Caladea font; stamps LIA name + IAA number at 4 fixed positions. **Unchanged this phase.** |
| `engagement-letter-stamp.spec.ts` | Round-trips the stamped PDF via pdfjs-dist to verify positions, idempotency, anchor-collision guards. **Unchanged this phase.** |
| `dto/create-contract.dto.ts` | `CreateContractDto` — request body shape for `POST /contracts`. |

### `backend/scripts/`

| File | Purpose |
|---|---|
| `test-docusign-jwt.ts` | One-shot JWT-grant probe — mints a token, prints expiry/scope, no send. |
| `test-docusign-service-cache.ts` | Verifies the token cache (mint count stays at 1 across consecutive calls). |
| `test-docusign-multi-signer-send.ts` | End-to-end probe: stamps the PDF + sends a composite-template envelope to 3 emails from CLI flags. **This is the calibration / smoke-test tool.** |
| `calibrate-stamp-coordinates.ts` | One-shot calibration — derives the 4 stamp (x,y) coordinates from the live PDF. **Re-run only if the PDF is replaced.** |

### What changed in 5H (the composite-template migration)

The send path was rewritten **from code-built anchored tabs to a DocuSign composite template.** All anchor-tab construction was deleted (`buildClientTabs` / `buildLiaTabs` / `buildDirectorTabs` / `buildTabsForRole` / `applyAnchor` + ~13 anchor/visa/offset constants). `EnvelopeRecipientSpec.role` was replaced by `templateRole`. `BuildEnvelopeOptions` gained `templateId`. `docusign.service.ts` shrank by ~290 lines. The stamping module was **not** touched.

---

## 3. Database tables / columns

### `contracts` (Prisma model `Contract`, PK `id`)

| Column | Purpose |
|---|---|
| `caseId` | FK to `Case`, **unique** — one contract per case. |
| `templateId` | Reserved field; **currently unused by code** (kept for future). |
| `docusignEnvelopeId` | DocuSign envelope GUID returned at send time. |
| `status` | `ContractStatus` enum — DRAFT / SENT / SIGNED / DECLINED / EXPIRED / VOIDED. |
| `signedAt` | Envelope-level completion timestamp. |
| `declinedAt` | Envelope-level decline timestamp. |
| `expiredAt` | Envelope-level expiry timestamp. |
| `signedFileUrl` | DocuSign URI for the signed PDF (`envelope.documents[0].uri`). |
| `auditTrailUrl` | DocuSign URI for the certificate of completion. |
| `createdAt` / `updatedAt` | Timestamps. |

### `contract_signers` (Prisma model `ContractSigner`, PK `id`, unique `(contractId, routingOrder)`)

| Column | Purpose |
|---|---|
| `contractId` | FK to `Contract` (cascade on delete). |
| `role` | `ContractSignerRole` — CLIENT / GUARDIAN / PARTNER / FAMILY_MEMBER / LIA / DIRECTOR (descriptive; not unique). |
| `routingOrder` | Integer; matches DocuSign routing order + recipient slot. |
| `signerName` | Identity snapshot — name as sent to DocuSign at creation time. |
| `signerEmail` | Identity snapshot — email as sent to DocuSign at creation time. |
| `signingOnBehalfOf` | GUARDIAN-only: minor student's name (legal record of relationship). |
| `userId` | Optional FK to `User` (LIA/DIRECTOR always; others when an account exists). SetNull on user delete. |
| `status` | `ContractSignerStatus` — PENDING / SENT / VIEWED / SIGNED / DECLINED. |
| `viewedAt` / `signedAt` / `declinedAt` | Per-signer timestamps from webhook re-sync. |
| `declineReason` | DocuSign's free-text decline reason. |
| `docusignRecipientId` | DocuSign-side recipientId ("1"/"2"/"3") for webhook lookup. |
| `createdAt` / `updatedAt` | Timestamps. |

---

## 4. Environment variables added (names only — never commit values)

| Var | Purpose |
|---|---|
| `DOCUSIGN_INTEGRATION_KEY` | DocuSign app integration key (Client ID). |
| `DOCUSIGN_USER_ID` | DocuSign user GUID to impersonate (JWT subject). |
| `DOCUSIGN_OAUTH_BASE` | `account-d.docusign.com` (DEMO) / `account.docusign.com` (prod). |
| `DOCUSIGN_PRIVATE_KEY_PATH` | Filesystem path to the JWT RSA private key (gitignored). |
| `DOCUSIGN_ACCOUNT_ID` | DocuSign account GUID under which envelopes are created. |
| `DOCUSIGN_BASE_URL` | DocuSign REST API host (DEMO: `https://demo.docusign.net/restapi`). |
| **`DOCUSIGN_TEMPLATE_ID`** | **NEW this phase.** UUID of the saved composite template owning all field positions + roles. |
| `CONTRACT_DIRECTOR_EMAIL` | Director's email (signer 3). |
| `CONTRACT_DIRECTOR_NAME` | Director's display name (signer 3). |
| `DOCUSIGN_ACCESS_TOKEN` | **Legacy — no longer read.** Deadweight from the pre-JWT era; safe to remove. |

---

## 5. Third-party services connected

**DocuSign** (currently the DEMO environment, `appdemo.docusign.com`). Handles e-signature, sequential routing, signer email invitations, the signed-PDF, and the certificate of completion.

- **Auth:** JWT Grant (server-to-server, no interactive login). Requires one-time admin consent for the integration key.
- **Where to manage:** DocuSign Admin → the composite template lives under **Templates** ("Sorena Engagement Letter — Multi-signer v1"). The integration key, JWT consent, and Connect (webhook) config live under **Settings → Apps and Keys** and **Settings → Connect**.
- **Template:** 3 roles with exact names `Client`, `LIA`, `Director`. The template owns every signing field. The code supplies only the document bytes + signer identities.

**Going live:** switch `DOCUSIGN_OAUTH_BASE` and `DOCUSIGN_BASE_URL` to production hosts, recreate the template in the production account, and update `DOCUSIGN_TEMPLATE_ID` + `DOCUSIGN_ACCOUNT_ID` to the production values.

---

## 6. How to test it works (manual)

1. Confirm `backend/.env` contains `DOCUSIGN_TEMPLATE_ID=<template uuid>` and restart the backend.
2. From `backend/`, run the end-to-end probe (PowerShell — run the `cd` and the command on separate lines; `&&` is not supported):
   ```
   npx ts-node scripts/test-docusign-multi-signer-send.ts --client-email "<you>" --client-name "Test Client" --lia-email "<you>" --lia-name "Test LIA" --director-email "<you>" --director-name "Test Director" --lia-iaa "202300520"
   ```
3. Expect terminal output ending in `[OK] Envelope dispatched.` with an `envelopeId`.
4. The Client inbox receives the invitation first. Sign as Client → the LIA invitation then sends → sign as LIA → the Director invitation sends → sign as Director.
5. Verify on the signed document: the LIA's **name + IAA licence number** appear in the stamped spots (page 1 §2 and page 11 LIA column), and the template fields (signatures, dates, client name/passport, the 11 visa checkboxes) all render and were completed.
6. Inspect the envelope in the DEMO UI by searching its `envelopeId`.

**Automated:** `npx jest src/contracts/` → 29 tests pass across 3 suites (contracts.service 4, docusign.service 15, engagement-letter-stamp 10). Full backend: 117/117.

---

## 7. Known limitations

- **Visa checkboxes are not group-validated.** The 11 visa checkboxes are independent fields. The intended "tick exactly one" rule (min=1/max=1) is **not enforced** in the template — the LIA is trusted to tick the correct single box. *Add a DocuSign checkbox group later if enforcement becomes necessary.*
- **PDF wording inconsistency.** Page 2 still reads "Where multiple visas are ticked, fees are charged per visa," which contradicts the one-visa-per-letter rule. Reword the PDF when convenient.
- **Cosmetic polish outstanding.** Field font sizes and minor visual alignment in the template are not finalised (deferred — non-blocking).
- **DEMO only.** Not yet pointed at a DocuSign production account.
- **`templateId` column unused.** The `Contract.templateId` DB column is reserved but not written; the template is sourced from the env var.
- **Probe writes no DB row.** `test-docusign-multi-signer-send.ts` sends a real envelope but does not persist a `Contract` record (by design — it uses a synthetic `probeCaseId`).

---

## 8. How a future developer would extend this

- **Change where fields sit on the page:** edit the DocuSign template in the DocuSign UI — *not* the code. The code no longer positions fields.
- **Change the LIA stamping (name/IAA):** `engagement-letter-stamp.ts`. If the underlying PDF is replaced, re-run `scripts/calibrate-stamp-coordinates.ts` to re-derive the 4 coordinates.
- **Add/relabel a signer role:** add the role in the DocuSign template (with an exact role name), add a matching `TEMPLATE_ROLE_*` constant in `docusign.service.ts`, and build the corresponding signer spec (with `templateRole`) in `contracts.service.ts`.
- **React to new signing events:** extend `handleWebhook` in `contracts.service.ts` and the mapping in `contract-status.ts`.
- **Generate an in-app signing link** (embedded signing instead of email): `getSigningUrl` already exists in `docusign.service.ts`; surface it through the controller.

---

## 9. Security layers applied (from the project's 10-layer standard)

This feature handles personal data (passport numbers, identity details), so the following layers apply:

- **Layer 2 — Row-Level Security / scoped access:** `POST /contracts` is guarded to OWNER / SUPER_ADMIN / ADMIN / LIA only (controller role guard). Contract reads are by `caseId`.
- **Layer 3 — Secrets in env vars:** all DocuSign credentials, the account/template IDs, and the director identity are in `backend/.env`; the JWT RSA private key is on disk at `DOCUSIGN_PRIVATE_KEY_PATH` and **gitignored** (`backend/keys/docusign_private.key`). Nothing is hardcoded.
- **Layer 4 — HTTPS only:** all DocuSign API + webhook traffic is HTTPS (DocuSign requirement + Vercel default for the callback).
- **Layer 6 — Audit trail:** every signer action is recorded per-recipient in `contract_signers` (viewed/signed/declined timestamps + decline reason); DocuSign's own certificate of completion is stored via `auditTrailUrl`.
- **Layer 7 — File handling:** the signed PDF is referenced by DocuSign-side signed URLs (`signedFileUrl` / `auditTrailUrl`), not stored unprotected.

Identity values sent to DocuSign are **snapshotted** into `contract_signers` (`signerName`/`signerEmail`) so the legal record reflects exactly what was sent at signing time.

---

## 10. Rollback instructions

The previous code-built-tabs approach was **removed**, so rollback is git-based, not a config toggle.

1. **Fast disable (stop sending):** remove or blank `DOCUSIGN_TEMPLATE_ID` in `backend/.env` and restart. `createEnvelope` throws when the template ID is missing, which halts all sends without code changes.
2. **Full revert to the anchor approach:** `git revert` (or check out) the 5H migration commit. This restores `buildClientTabs/buildLiaTabs/buildDirectorTabs/buildTabsForRole/applyAnchor`, the anchor/visa constants, and the old `EnvelopeRecipientSpec.role` field. Note the anchor approach was abandoned because it was unreliable — revert only as a last resort.
3. **Data:** rollback does not require DB migration changes; `contracts` / `contract_signers` schemas are unchanged by the 5H switch. No data migration to undo.
4. After any rollback, run `npx jest src/contracts/` to confirm the suite matches the restored code path.
