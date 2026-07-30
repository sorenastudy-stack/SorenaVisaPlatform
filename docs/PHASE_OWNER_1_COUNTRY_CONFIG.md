# PR-OWNER-1 (slice a) — Owner-level per-country config (institution distribution + AI agents)

Owner-editable, **per-country** config for (1) the institution-distribution
slot/ratio rules and (2) the 9 AI agents' settings — editable from the portal with
**no code deploy**. This is the config layer + Owner CRUD + portal UI only.
**The recommendation matcher is NOT wired to it yet — that is slice (b)** (see §7).

**Date:** 2026-07-31
**Status:** built + verified end-to-end (Owner can view/edit, values persist,
every write audited). Matcher still uses its current field-based scoring, unchanged.

---

## 1. What it does

Fills in two of the nine sections of RPD_16's Domain 16 (Country Intelligence &
Monetisation Config), scoped down to exactly the Owner's ask:

- **CountryExecutionConfig** — `slotCount` (total priority slots), `slotRules`
  (per-position allowed institution types + mandatory flag), and
  `institutionTypeWeighting` (default recommendation sort ratio).
- **CountryAIConfig + AIAgentConfig** — per-country guidance level + SOP-gate
  toggle, and per-agent `enabled` / `maxOptionsShown` for the 9 agents.

Everything is keyed by **`countryCode` string** (ISO 3166-1 alpha-2) — there is no
`Country` model (matches every existing convention). The full 9-section validation
gate (pricing, legal, visa, activation) stays **out of scope**.

## 2. Decisions applied (from the state-check sign-off)

- **OWNER role reused, not added.** No enum migration. Endpoints gate with the
  existing `RolesGuard` + `@Roles('OWNER')` (writes) / `@Roles('OWNER','SUPER_ADMIN')`
  (reads) — the same pattern as `/staff/settings/sla`.
- **No "Compliance Admin" gate.** Dropped for this phase (the role doesn't exist).
  If prompt-change review is wanted later it reuses `OwnerApprovalRequest`
  (SUPER_ADMIN proposes → OWNER approves), not a new role.
- **String-keyed `countryCode`** with `@@unique`. No `Country` model.
- **Naming:** `AIAgentConfig` (not `AgentConfig`) — avoids collision with the
  existing referral-agency models `AgentProfile` / `AffiliateAgent`.

## 3. Schema (migration `20260731000000_pr_owner_1_country_config`)

Isolated **additive** migration via the approved workaround
(`migrate diff → db execute → migrate resolve --applied`). Purely additive:
**4 new enums + 4 new tables + indexes + FKs, zero ALTER on existing tables.**
`migrate status` = "up to date".

| Object | Notes |
|---|---|
| enum `AIGuidanceLevel` | STRICT / MODERATE / LOW |
| enum `AIAgentType` | the 9 PRD_13 agents |
| enum `PromptVersionStatus` / `PromptType` | governance lifecycle (stub this phase) |
| `country_execution_configs` | `countryCode @unique`, `slotCount`, `slotRules` Json, `institutionTypeWeighting` Json, `updatedById` |
| `country_ai_configs` | `countryCode @unique`, `guidanceLevel`, `sopGateEnforcement`, `activePromptVersionId?` |
| `ai_agent_configs` | `@@unique([countryAIConfigId, agentType])`, `enabled`, `maxOptionsShown?`, `promptVersionId?`, `settingsJson?` |
| `prompt_versions` | governance **stub** — versioned storage, no review-workflow UI |

**Actor attribution** follows the `SlaConfig` convention: `updatedById` is a bare
column (NOT a Prisma `User` relation), so the migration never touches `users`.
Who-did-what is captured in the `audit_logs` row on every write.

## 4. API (mounted `/staff/settings/country-config/*`)

| Method / path | Role | Audited event |
|---|---|---|
| `GET /` | OWNER, SUPER_ADMIN | — (list configured countries) |
| `GET /:countryCode` | OWNER, SUPER_ADMIN | — (full config: execution + ai + agents) |
| `PATCH /:countryCode/execution` | **OWNER** | `COUNTRY_EXECUTION_CONFIG_UPDATED` |
| `PATCH /:countryCode/ai` | **OWNER** | `COUNTRY_AI_CONFIG_UPDATED` |
| `PATCH /:countryCode/ai/agents/:agentType` | **OWNER** | `AI_AGENT_CONFIG_UPDATED` |

Reads are open to SUPER_ADMIN for transparency; **writes are OWNER-only** and the
backend enforces it independently of the UI. Service does deep validation
(slotRules positions/types, weighting keys 0..1, agentType, slotCount 1..20,
promptVersionId existence). All three new event types have `audit.helper.ts`
summariser cases.

## 5. Portal UI

- New sidebar item **“Country Config”** (`/staff/country-config`), gated
  OWNER + SUPER_ADMIN.
- One page, country picker + three sections: **Institution distribution**
  (slot count, per-slot rules editor, weighting with a live Σ=1.00 check),
  **AI config** (guidance level, SOP-gate), **AI agents** (per-agent enable +
  max-options, saved per row).
- SUPER_ADMIN sees a **read-only** view (inputs disabled, "only the Owner can
  edit" notice); OWNER gets the save buttons.

## 6. Seed + verification

- **Seed** (`scripts/seed-country-config.ts`, idempotent) — NZ defaults:
  `slotCount 5`, `slotRules` per PRD_4 §8, weighting `PTE 0.4 > ITP 0.35 >
  UNIVERSITY 0.25`, `guidanceLevel STRICT`, 9 agents (RECOMMENDATION_EXPLAIN
  `maxOptionsShown 5`). Re-run keeps existing rows. Reusable:
  `seed-country-config.ts NZ AU IR …`.
- **Verified:** backend build clean; frontend `tsc --noEmit` exit 0; service
  **E2E 15/16** driving the real service (read seeded config → edit slotCount /
  weighting / guidanceLevel / sopGate / agent maxOptions all persist → 3 audit
  rows written → 6 validation rejections → restore to defaults). The 16th check
  was a false-negative from Postgres JSONB key-reordering in a strict string
  compare; the value round-trips correctly (`PTE>ITP>UNI` verified directly).
- Critical gates unaffected: **scoring + matching 60/60**.
- ⚠️ **Pre-existing test failures unchanged:** 7 suites / 10 tests
  (payments/documents/contracts/portal/case-documents) fail on `main` due to
  spec-file compile drift (e.g. `PortalService` arg-count `TS2554`), **unrelated
  to this slice** — proven identical with this slice stashed at HEAD baseline.

## 7. ⚠️ Flags for the Owner + slice (b)

- **College=PTE / Polytechnic=ITP mapping.** PRD_4 speaks "College / Polytechnic
  / University"; the authoritative enum (Phase 34) is `UNIVERSITY / ITP / PTE`.
  The NZ seed encodes College→PTE, Polytechnic→ITP. This is **seed DATA only** —
  fully editable via the UI, no migration needed to change it. Confirm the mapping
  is what you want.
- **`slotCount` vs `maxOptionsShown`.** Modelled as **separate** per your brief:
  `slotCount` = the committed 1..N priority list; an agent's `maxOptionsShown` =
  how many options it surfaces in one interaction. If they should be the same
  number for the recommendation agent, slice (b) can make it read `slotCount`
  instead of storing its own — say the word.
- **Reads open to SUPER_ADMIN** (writes OWNER-only). If you want the config
  fully Owner-exclusive (SUPER_ADMIN can't even view), flip the `GET` roles.

## 8. Next — slice (b) (NOT started; needs sign-off first)

Wire `matching.logic.ts` to read `CountryExecutionConfig` and add an
**institution-type-weighted term** to the fit score, plus a **separate** 5-slot
priority-list assignment function (PRD_4 treats list-generation and slot-selection
as two steps). Before writing it I'll report which tests/callers depend on the
current matcher output shape and confirm the weighting approach (new independent
weighted component vs. multiplier) against how the existing five weights combine.
