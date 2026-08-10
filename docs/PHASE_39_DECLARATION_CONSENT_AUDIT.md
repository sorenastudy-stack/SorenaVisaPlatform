# Phase 39: Declaration Consent Audit Trail

Session of 2026-08-10. Handover document — written so the next session, or Yashua reading it
alone, can pick up without needing the conversation.

**Shipped:** `7962541` (the audit trail) and `ca2075b` (an unrelated test fix), both pushed and
live. Migration `20260810113609_phase39_policy_acceptance_declarations` applied to production.

---

## 1. What this phase does

Closes a compliance gap: three client-facing declarations were legally meaningless as evidence.

The agent declaration (Step 7), admission acceptance (Step 8) and visa submit declaration
(Step 14) each wrote a single Boolean or timestamp onto the application row. That records the
**current** state and nothing else:

- A client who unticks the box clears it. The previous agreement leaves no trace.
- No version of the record says **what text** they agreed to.
- If the wording changes, there is no way to know which version anyone accepted.

In a dispute we could show that a box is ticked *today* — not that consent was given, when, or
to what. Each of the three now **also** writes an immutable `PolicyAcceptance` row at the moment
of agreement. The existing fields are untouched and remain the fast "currently agreed?" check.

### What was NOT the problem

The original brief assumed these were "UI-only gates — a local state variable that unblocks a
Next button". They were not. All three already PATCHed to the backend and are enforced at submit
(`admission.service.ts:359,361`). The gap was **evidentiary**, not functional: the data reached
the server, it just could not prove anything afterwards.

### Declaration count

The brief listed four declarations (agent, submit, privacy, consent-to-contact). In the code
there are **three tick points**, and the privacy and consent-to-contact wording lives *inside*
the Step 8 acceptance block as `admissionStep8TermsP2` and `P3`. All five paragraphs are
captured in the Step 8 snapshot, so coverage is complete — only the counting differs.

`ConsentRecord` (lead/marketing consent, written at lead capture) is a separate mechanism and
was explicitly **out of scope**. Untouched.

---

## 2. Files created or changed

**New**
| File | What it is |
|---|---|
| `backend/src/common/declarations.ts` | Canonical text of all three declarations + version. |
| `backend/src/common/declaration-acceptance.service.ts` | Writes the audit row; `requestOrigin()` helper. |
| `backend/src/common/declarations.spec.ts` | Guard: server text must equal the client's `en.json`. |
| `backend/src/common/declaration-acceptance.service.spec.ts` | Append-only, server-text, fail-safe. |

**Changed**
| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | 3 nullable columns + `DeclarationType` enum on `PolicyAcceptance`. |
| `backend/src/students/admission/admission.service.ts` | Records Step 7 + Step 8 on transition. |
| `backend/src/students/admission/admission.controller.ts` | Passes `requestOrigin(req)`. |
| `backend/src/students/visa/visa.service.ts` | Records Step 14 on transition. |
| `backend/src/students/visa/visa.controller.ts` | Passes `requestOrigin(req)`. |
| `backend/src/students/students.module.ts` | Registers the service. |

**Frontend: zero changes.** All three checkboxes already PATCHed to the backend; only the server
needed to write the row. Wiring it client-side would mean trusting the browser for a legal
record — see §9.

---

## 3. Database tables/columns added

No new table. `PolicyAcceptance` was extended, because the wallet path had already established
the right shape (who, when, which version, from where, on what device) and a second table would
mean two places to look during a dispute.

| Column | Type | Note |
|---|---|---|
| `declarationType` | `DeclarationType?` | NULL = the wallet cancellation/refund policy. |
| `declarationText` | `String?` | The literal wording, snapshotted. |
| `applicationId` | `String?` | **Deliberately not a foreign key** — see below. |

Plus `enum DeclarationType { AGENT_DECLARATION, ADMISSION_ACCEPTANCE, VISA_SUBMIT_DECLARATION }`
and indexes on `applicationId` and `declarationType`.

All three are nullable, so **every existing wallet row stays valid unchanged** — verified on
production (§6).

**Why `applicationId` has no FK.** An audit row must outlive the record it describes. A cascade
delete on the application would erase the very proof this table exists to keep.

**Why the text and not just a version.** `policyVersion` tells you *which* text; it does not
survive someone deleting the old wording from the codebase. The row has to stand alone years
later without a lookup into code history.

---

## 4. Environment variables added

**None.**

---

## 5. Third-party services connected

**None.**

---

## 6. How to test it works

**Automated** — 840/840 serial at `ca2075b`, including 12 new:

```bash
cd backend && npx jest --runInBand
```

**Live sanity checks, run against production after the migration:**

| Check | Result |
|---|---|
| Migration applied | ✅ `20260810113609_…` at 00:04:17 UTC, `rolled_back_at` null |
| Columns present on production | ✅ `applicationId`, `declarationText`, `declarationType` |
| Existing wallet row still reads | ✅ 1 row, `declarationType` NULL, `policyVersion` and `acceptedAt` intact |
| Step 7 → audit row | ✅ `AGENT_DECLARATION`, 156 chars of text |
| Step 8 → audit row | ✅ `ADMISSION_ACCEPTANCE`, 686 chars (all five paragraphs) |
| Step 14 → audit row | ✅ `VISA_SUBMIT_DECLARATION`, 104 chars |
| IP / user-agent captured | ✅ real client IP + browser UA on every row |
| `applicationId` linked | ✅ admission rows → admission app, visa row → visa app |
| **Append-only** | ✅ re-running the flow produced **2 rows per type**, none replaced |

Driven through a real browser session as `internal-test@sorenavisa.com`, hitting the same
endpoints the three steps use, so the requests carried a genuine user-agent and the proxy filled
`x-forwarded-for`.

⚠️ **Those 6 rows are test data on production.** They belong to the internal QA account and are
identifiable by `applicationId` = that account's applications. Remove them with the test account
if it is ever cleaned up (`create-internal-test-account.ts --undo`).

---

## 7. Known limitations

**1. The audit row is best-effort.** A failure is logged, never thrown. An audit write that can
take down the form producing it would cost more consent than it records. The trade-off: under a
database failure the client's tick would persist while the audit row does not.

**2. Only the transition is recorded.** The condition is `false → true`, not "is true". A client
re-saving the same step does not file a duplicate — but this also means that if the application
row were edited directly in the database, no audit row would follow.

**3. Server text can drift from the client's.** `declarations.spec.ts` compares against
`en.json` character for character, so drift fails CI — but only for the English text. The
declarations are English in both locales (Phase 29/30 decision #4), so there is nothing else to
check today. **If a Persian variant is ever added, this guard will not see it.**

**4. Nothing surfaces these rows in the UI.** There is no staff screen showing a client's consent
history; it is a database-level record. A dispute means a query, not a page.

**5. No backfill.** Clients who agreed before this deploy have their Boolean/timestamp and no
audit row. Their agreement is exactly as provable as it was yesterday — no worse, no better.

---

## 8. How a future developer would extend this

**Adding a fourth declaration.** Add the enum value in `schema.prisma`, the text in
`declarations.ts`, and the key in `DECLARATION_MESSAGE_KEYS`. `declarations.spec.ts` asserts that
every enum value has text, so a half-finished addition fails rather than snapshotting an empty
declaration.

**Changing the wording.** Update `declarations.ts` AND `en.json` together — the spec fails
otherwise — and bump `DECLARATION_VERSION`. Old rows keep their own text and their own version,
so a reword is never retroactive.

**Do not move the snapshot to the client.** The whole value of the record is that the text is the
server's. A browser-supplied string proves only what the browser claimed.

**If a staff-facing consent history is wanted**, the data is already there: query
`policy_acceptance` by `applicationId` or `userId`, ordered by `acceptedAt`. Every row is
self-contained.

---

## 9. Security layers applied

**The text is server-authoritative.** Nothing about the audit row comes from the request body.
The client can decide *whether* to tick; it cannot influence what the record says they ticked.

**IP and device come from the request, not the payload.** `requestOrigin()` reads
`x-forwarded-for` (first hop — Railway sits in front, so `req.ip` is the proxy) and the
`user-agent` header. Same derivation as the wallet path, kept in one function so the four call
sites cannot drift.

**`acceptedAt` is the column default.** Never client-supplied, so a client cannot backdate their
own consent.

**Append-only by construction.** The service exposes no update or delete path — proven by its
unit test needing only a `create` mock. Unticking and re-ticking writes a second row; both
survive, and the sequence is itself part of the record.

**No new endpoint or authorisation path.** The three existing PATCH routes are unchanged, still
behind `JwtAuthGuard + RolesGuard + EngagementPaidGuard`.

---

## 10. Rollback instructions

**Code:**

```bash
git revert 7962541
git push origin main
```

The three declarations go back to writing only their Boolean/timestamp. Existing audit rows are
untouched and stay readable.

**The migration does not need reversing.** It is additive and nullable: with the code reverted,
the three columns simply stop being written. Dropping them would destroy audit rows for no gain.

If they must go:

```sql
ALTER TABLE policy_acceptance
  DROP COLUMN "declarationType", DROP COLUMN "declarationText", DROP COLUMN "applicationId";
DROP TYPE "DeclarationType";
```

**Backup taken before the migration:** `D:/backups/prod-20260810-120233-pre-phase39.dump`,
verified restorable — restored into a scratch database and compared across all 123 tables. The
only difference was `_prisma_migrations` (117 in the backup, 118 on production), which is the
proof the backup predates the migration. All 122 other tables matched row for row.

---

## Commits in this session

| Hash | Message |
|---|---|
| `7962541` | feat(compliance): immutable audit trail for the three in-form declarations |
| `ca2075b` | test(fixtures): make the LIA auto-assign test independent of database state |

### `ca2075b` — unrelated, included here for the record

Two tests in `payments.controller.spec` had been failing for some time, and the failure read like
a broken feature. **The feature was fine.**

`assignLiaToCase` picks the lowest open-case count and breaks ties on `createdAt ASC`
(`lia-assignment.service.ts:168`) — among equally idle LIAs the **oldest** wins. The fixture
created its LIA fresh, making it the **newest**, and its comment claimed zero open cases was
enough to win.

That held only while the fixture's LIA was the only idle one. The local database now holds **56
active LIA users, every one left behind by an earlier test run**, 22 of them idle and older than
anything created today.

Fixed by backdating the fixture LIA to the epoch, so it is unambiguously the oldest idle LIA
whatever else is in the database. Purging the 56 leftovers was rejected: it would pass today and
break again on the next run.

---

## Still open

- **Parallel test runs still show 2–4 varying failures** across kanban, nurture and
  lia-assignment. Pre-existing pollution, separate from this work, noted for a future cleanup
  pass. Serial runs are clean.
- The 6 test audit rows on production (§6).
- No staff UI for consent history (§7.4).
- No backfill for pre-deploy agreements (§7.5).

## Untouched by this pass

The pricing/currency/GST thread is **mid-decision and was not touched**:
`payments.service.ts`, `stripe.service.ts`, `payments.controller.ts`, `session-config.ts`,
`session-pricing.ts`, `routing.ts`, `contracts.service.ts` — all verified unchanged. No
`fee-config.ts` was created.
