# Contract Send Button (Staff)

## 1. What this does

Staff can now send an engagement contract directly from the staff case-detail page
(`/staff/cases/[id]`). A gold-accented "Send contract" button appears in an
"Engagement contract" card **only when no contract exists yet** for that case. Clicking
it calls `POST /contracts`, which creates the DocuSign envelope (CLIENT → LIA →
DIRECTOR) and writes an `audit_logs` row of type `CONTRACT_SENT` attributed to the
logged-in staff user (who / when / which case). If a contract already exists, the panel
shows its current status (e.g. "Contract: SENT") instead of offering to re-send.

## 2. Files changed

- **backend/src/contracts/contracts.controller.ts** — the `POST /contracts` handler now
  reads the logged-in user via `@Req()` and passes an actor `{ id, name, role }` into
  `createContract` (guards/roles unchanged).
- **backend/src/contracts/contracts.service.ts** — `createContract(dto, actor)` accepts
  the actor and, after the contract + signers are persisted, writes one
  `CONTRACT_SENT` audit row attributed to that actor.
- **backend/src/common/audit/audit.helper.ts** — `summarizeAuditEntry()` gained a
  `CONTRACT_SENT` case returning "Contract sent to client" for the staff Activity feed.
- **frontend/src/components/staff/cases/detail/SendContractPanel.tsx** *(new)* — the
  client component: checks `GET /contracts/:caseId` on mount, renders the gold
  "Send contract" button when none exists (POSTs `/contracts`), or the contract status
  when one does; role-gated to OWNER/SUPER_ADMIN/ADMIN/LIA.
- **frontend/src/components/staff/cases/detail/CaseDetailClient.tsx** — imports and
  mounts `<SendContractPanel caseId={data.id} onSent={refresh} />` next to the
  assignments panel.

## 3. Database changes

**None** — the schema is untouched (no migration). Note: a new `audit_logs` **row
type** is written at send time (`eventType: CONTRACT_SENT`), but this uses the existing
`AuditLog` table and columns — **no new column or table**.

## 4. Env vars needed for a live send

Names only. The send **requires** these, which are currently **NOT set** in local
`backend/.env`:

- `CONTRACT_DIRECTOR_EMAIL`
- `CONTRACT_DIRECTOR_NAME`
- `DOCUSIGN_INTEGRATION_KEY`
- `DOCUSIGN_USER_ID`
- `DOCUSIGN_OAUTH_BASE`
- one of `DOCUSIGN_PRIVATE_KEY_PATH` **or** `DOCUSIGN_PRIVATE_KEY`

Already **set** locally: `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_BASE_URL`,
`DOCUSIGN_TEMPLATE_ID`. (The engagement-letter PDF asset at
`backend/assets/contract-templates/engagement-letter-v1.pdf` is also present.)

## 5. Third-party services

- **DocuSign** — sends the engagement-letter envelope. Managed in the DocuSign admin
  console (account, integration key / JWT app, users). Credentials live in **Railway
  env at deploy**, not in code.

## 6. How to test

1. Log in as staff with a send-eligible role (**OWNER / SUPER_ADMIN / ADMIN / LIA**).
2. Open a case whose client contact has both an **email** and a **full name**
   (`/staff/cases/[id]`).
3. Confirm the gold-accented **"Engagement contract"** card + **"Send contract"** button
   appear (they show only when no contract exists yet).
4. Click **Send contract**.
5. On a correctly configured environment, expect: a green toast **"Contract sent to
   client"**, the card flips to **"Contract: SENT"**, and an `audit_logs` row with
   `eventType = CONTRACT_SENT` attributed to the acting staff user (id / name / role).
6. Precondition failures surface as red toasts with the backend message:
   - **404** — case not found
   - **400** — contract already exists for this case
   - **400** — case has no client contact with email + full name
   - **422** — no LIA available to assign to this case

## 7. Known limitations

- **Live send is unverified locally** because the DocuSign JWT credentials and the
  director identity are not set in local `.env` — these are deploy-day config
  (`CONTRACT_DIRECTOR_EMAIL/NAME`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`,
  `DOCUSIGN_OAUTH_BASE`, `DOCUSIGN_PRIVATE_KEY_PATH`/`DOCUSIGN_PRIVATE_KEY`).
- The button is **only visible to OWNER / SUPER_ADMIN / ADMIN / LIA**.
- **One contract per case** — `Contract.caseId` is `@unique`; there is no re-send or
  void from the UI (a second send returns 400 "Contract already exists").

## 8. How to extend

- **Client self-serve send** — add a send trigger on the client portal case page
  (`frontend/src/app/portal/case/page.tsx`). (Note: `POST /contracts` is currently
  gated to staff roles; a client-facing path would need its own endpoint/authorization
  decision.)
- **"Waiting for contract" staff list** — a staff view that lists cases with no contract
  yet (or a contract stuck in SENT/VIEWED), so contracts don't get forgotten.
- **Contract void / resend** — a UI action to void the DocuSign envelope and allow a
  fresh send, which also relaxes the current one-contract-per-case constraint for
  legitimate re-issues.

## 9. Security layers applied

- **Access control** — server-side `@Roles('OWNER','SUPER_ADMIN','ADMIN','LIA')` +
  `JwtAuthGuard` / `RolesGuard` on `POST /contracts`. The frontend role gate in
  `SendContractPanel` is **cosmetic only**; the backend guard is the real boundary.
- **Audit log** — every send writes a `CONTRACT_SENT` row carrying the actor's
  `userId`, `actorNameSnapshot`, and `actorRoleSnapshot`.
- **Duplicate-send guard** — `createContract` returns **400** if a contract already
  exists for the case (`Contract.caseId @unique`).
- **Secrets in env vars, not code** — DocuSign credentials + director identity are read
  from environment variables.

## 10. Rollback

- Revert the single commit (`git revert <hash>`), or manually revert the 5 files listed
  in section 2.
- **No DB migration to undo** — nothing schema-level changed.
- Removing just the `SendContractPanel` import + mount in `CaseDetailClient.tsx` removes
  the button from the UI with **no backend impact** (the `POST /contracts` route and the
  audit row simply go unused).

## 11. DocuSign template-owned rules (⚠️ re-apply at go-live)

The engagement envelope is a **composite-template send**. Our backend references a saved
DocuSign template by id (`DOCUSIGN_TEMPLATE_ID`) and **deliberately does NOT set signer
tabs** — see `backend/src/contracts/docusign.service.ts` (`buildEnvelopeDefinition`,
"We deliberately do NOT set signer.tabs — that's the template's job now"). The template
therefore owns **all** field definitions and their validation:

- signature / date / full-name / passport text fields, and
- the **11 visa-type checkboxes** grouped as **`visaType`** (the LIA's selection, read
  back after signing by `getSelectedVisaType` → captured onto `Case.visaType`).

**Because these live in the template, they cannot be changed in this repo** — edit them
in the DocuSign web UI.

### The `visaType` "at least one required" rule
Our code only *reads* the selection and tolerates none being chosen (it logs
`no visaType selection found` and leaves `Case.visaType` null). So "the LIA must pick a
visa type to finish signing" is **enforced only by the template's checkbox-group
validation**, not by our code.

- **To require it:** open the template → LIA recipient → the `visaType` checkbox group →
  set the group rule to **minimum 1 selected** (and, for the intended "pick exactly one",
  cap **maximum 1** too).

### Where the template lives
| | |
|---|---|
| Env / account | **DocuSign Demo/Sandbox** (`account-d.docusign.com` / `demo.docusign.net`) |
| Template id | `c1c1b0f6-533e-4427-98db-c45cd5c666e8` |
| Direct link | `https://apps-d.docusign.com/send/templates/details/c1c1b0f6-533e-4427-98db-c45cd5c666e8` |

The template **name** is not stored in the repo (only the id) — find it in the UI by that id.

### ⚠️ Go-live warning
The id above is the **demo** template. When switching to production, `DOCUSIGN_TEMPLATE_ID`
will point at a **different** template object in the **production** DocuSign account. Any
template-owned validation — including the `visaType` **min-1** rule — **must be re-applied
to the production template**; it does not carry over from demo. Verify this as part of the
go-live checklist.
