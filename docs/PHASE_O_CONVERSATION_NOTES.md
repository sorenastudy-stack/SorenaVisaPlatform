# PHASE-O — LIA conversation notes

LIA advisers can record free-form, rich-text notes of their conversations with a
client, attached to a **Case**. The notes are strictly private to the legal team
— **LIA, OWNER, SUPER_ADMIN only**. The consultant/support assigned to the same
case cannot see them, and the client never sees them anywhere. Enforcement is
**server-side in the service layer** (the UI gating and controller `@Roles` are
redundant belts on top). This PR also introduces the **first shared
`RichTextEditor`**, built to be reused for the ticket composer next.

## 1. What this PR does

- New `CaseConversationNote` model (additive migration) — a case-attached note
  with author, timestamps, and a **sanitized-HTML** body. Distinct from
  `LegalNote` (which is encrypted, create-only, carries formal legal decisions,
  and has a wider 4-role audience) — see §7 for why it was **not** overloaded.
- New `case-conversation-notes` Nest module: `GET/POST /cases/:caseId/conversation-notes`,
  `PATCH/DELETE /cases/:caseId/conversation-notes/:noteId`.
- **Server-side XSS sanitization** on every write via a new shared allowlist
  sanitizer (`common/html/rich-text-sanitizer.ts`, using `sanitize-html`).
- Shared **`RichTextEditor`** (`components/ui/RichTextEditor.tsx`) — bold, italic,
  underline, bullet/numbered lists, links. Dependency-free (contentEditable +
  execCommand).
- **`ConversationNotesPanel`** wired into the two places the three allowed roles
  view a case: the **LIA portal** (`/lia/cases/[id]`, where legal notes already
  live — the primary home, reachable by LIA/OWNER/SUPER_ADMIN) and the **staff
  portal** case detail as a role-gated **Notes** tab.
- Audit-logs create / edit / delete.

## 2. Data model + visibility rule

`model CaseConversationNote` → table `case_conversation_notes`:

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT (cuid) | PK |
| `caseId` | TEXT | FK → `cases(id)` **ON DELETE CASCADE** |
| `authorId` | TEXT | FK → `users(id)` **ON DELETE NO ACTION** (RESTRICT-equivalent) |
| `bodyHtml` | TEXT | server-sanitized HTML, never raw client input |
| `createdAt` | TIMESTAMP(3) | default now() |
| `updatedAt` | TIMESTAMP(3) | Prisma `@updatedAt` |

Index `(caseId, createdAt)` for the per-case, newest-first list.

**The allowlist (read AND write):** `LIA`, `OWNER`, `SUPER_ADMIN` — primary *or*
secondary role (via `hasRole`, matching every other gate on the platform). Anyone
else — `CONSULTANT`, `SUPPORT`, `SALES`, the client, etc. — gets **403**.
**Edit/delete:** the note's author, or any `OWNER`/`SUPER_ADMIN`.

## 3. Where enforcement lives (defense in depth)

1. **Service layer (the real boundary)** — `CaseConversationNotesService`
   re-checks the 3-role allowlist on **every** method (`assertActorAllowed`), so
   the rule holds even if a controller is refactored or a method is called from
   elsewhere. Mutations additionally run `assertCanMutate` (author-or-elevated)
   and `loadNoteInCase` (the note must belong to the `caseId` in the route — a
   mismatched caseId is a 404, never a cross-case reach).
2. **Controller** — `@UseGuards(JwtAuthGuard, RolesGuard)` +
   `@Roles('LIA','OWNER','SUPER_ADMIN')` 403s before the service is even reached.
   Writes are `@Throttle`d (create 20/min, edit+delete 30/min).
3. **UI** — the Notes tab/panel only renders for the three roles. Cosmetic only;
   the server is the boundary.

The actor is built **only from the verified JWT** (`req.user`), never from the
body — no `userId`/`caseId` is trusted as identity.

## 4. Files changed

- **Schema/migration:** `backend/prisma/schema.prisma` (new model + reverse
  relations on `Case` and `User`), `backend/prisma/migrations/20260719120000_case_conversation_notes/migration.sql`.
- **Sanitizer (shared, new):** `backend/src/common/html/rich-text-sanitizer.ts`.
- **Module (new):** `backend/src/case-conversation-notes/` — `dto/conversation-note.dto.ts`,
  `case-conversation-notes.service.ts`, `.controller.ts`, `.module.ts`; registered
  in `backend/src/app.module.ts`.
- **Dependency:** `sanitize-html` (prod) + `@types/sanitize-html` (dev) in
  `backend/package.json`.
- **Frontend (new):** `components/ui/RichTextEditor.tsx`,
  `components/cases/ConversationNotesPanel.tsx`.
- **Frontend (wiring):** `components/staff/cases/detail/CaseTabs.tsx` (+`notes`
  tab), `.../CaseDetailClient.tsx` (role-gated tab), `app/lia/cases/[id]/page.tsx`
  (panel under the legal-notes card, gated to the 3 roles).
- **i18n:** none. The `notes` tab is labelled by an **English literal** in
  `CaseTabs` (not a `t()` key) — the feature is English-only and Persian is
  frozen, so no `fa`/`en` dictionary keys were added.
- **Test (gitignored):** `backend/scripts/test-conversation-notes.ts`.

## 5. Configuration

- New production dependency **`sanitize-html`** — installed via `npm ci` on
  deploy (already in `package.json`/lockfile). No env vars.
- **Additive migration** applied on deploy by the existing pre-deploy
  `npm run migrate:deploy` chain. No config change.

## 6. How to test

`backend/scripts/test-conversation-notes.ts` — **35/35 PASS** (run from
`backend/`: `npx ts-node scripts/test-conversation-notes.ts`). Exercises the
service directly (where enforcement lives):

- LIA creates → note persists in DB + appears in the list; **newest-first**; shows
  author name + timestamp.
- **OWNER** and **SUPER_ADMIN** can read.
- **CONSULTANT** and **SUPPORT** on the SAME case → **403 on read AND write**.
- **Client** (STUDENT) → **403 on read AND write**.
- Author edits own (body changes, `updatedAt` advances); **OWNER deletes another
  author's note**; **CONSULTANT** edit/delete → 403; a **different LIA** (not
  author, not elevated) → 403, and `canEdit=false` is what the server hands the UI.
- Note is **scoped to its case**: update/delete via the wrong `caseId` → 404.
- **XSS sanitized server-side** (proven on the stored row): `<script>`, `<img>`,
  `onerror`, `onclick`, and `javascript:` URLs are all stripped; safe `<b>`/`<u>`
  and an `https://` link survive and the link is hardened with `rel="noopener…"`.
- A body that sanitizes to nothing (e.g. only `<script>`) is **rejected**.
- Audit rows written for CREATE / EDIT / DELETE with the actor's role snapshot.

`nest build` clean; frontend `tsc --noEmit` clean (0 errors).

## 7. Known limitations / deliberate exclusions

- **`LegalNote` was deliberately NOT reused.** It means something else: formal
  legal decisions, **encrypted** at rest, create-only, 4-role (incl. ADMIN). These
  conversation notes are plain sanitized HTML, mutable, and a strictly narrower
  3-role audience. Overloading it would have blurred two very different security
  and lifecycle models.
- **Notes body is not encrypted at rest** (unlike `LegalNote`). They are
  operational conversation records, not privileged legal opinions; the row is
  protected by the same DB access controls as every other case row, and the
  read audience is already the narrowest on the platform.
- **Staff-portal Notes tab gates on the primary role only** (`StaffMe` carries no
  `secondaryRoles`). A user whose LIA is a *secondary* role won't see the tab in
  the staff portal — but they reach the panel via the **LIA portal**, and the
  backend still allows them (it uses `hasRole`, primary-or-secondary). No access
  is lost; only a redundant tab is hidden.
- **`execCommand` is deprecated** but chosen deliberately for a zero-dependency
  editor ("keep it simple"). If a richer editor is needed later, swap
  `RichTextEditor` internals — the server sanitizer is the security boundary
  regardless of the editor.

## 8. How to extend

- **Reuse the editor for tickets:** import `RichTextEditor` and post the HTML to a
  ticket endpoint that runs `sanitizeRichText` server-side before storing. Do
  **not** trust the editor's output — sanitize on the server every time.
- **Widen/narrow the audience:** change `NOTE_ROLES` (read/write) and
  `ELEVATED_ROLES` (edit-any) at the top of
  `case-conversation-notes.service.ts`, and mirror the controller `@Roles` + the
  two UI gates. The service is the source of truth.
- **Allow more formatting:** add tags/attributes to the allowlist in
  `rich-text-sanitizer.ts` (add a toolbar button to match). Keep it an allowlist.

## 9. Security

- **Server-side role gate on read AND write**, enforced in the service (not just
  the controller or UI), 3-role allowlist. CONSULTANT/SUPPORT/client → 403 proven
  by test.
- **Actor identity from the JWT only** — no `userId`/`caseId` trusted from the
  body; the note is re-verified to belong to the route's case on every note-scoped
  op.
- **Stored HTML sanitized server-side** against an allowlist before persistence;
  client HTML is never trusted, and a payload that reduces to nothing is rejected.
  Surviving links are forced to `rel="noopener noreferrer nofollow"` +
  `target="_blank"`.
- **Rate-limited** writes (`@Throttle`).
- **Audited** — create/edit/delete each write an `AuditLog` row with the actor's
  role snapshot.

## 10. Rollback procedure

- **Code:** revert the commit — the module unregisters, the routes 404, and the
  UI panel/tab disappear. Frontend and backend can roll back independently
  (frontend-only revert just removes the panel; the endpoints simply go unused).
- **Data/schema:** the migration is **additive** — one new table, two indexes,
  two FKs; no existing object is touched. To roll back the schema:
  `DROP TABLE "case_conversation_notes";` (drops the notes and their FKs cleanly;
  nothing else references the table). Safe to leave in place even if the feature
  is disabled — it simply holds no rows.
