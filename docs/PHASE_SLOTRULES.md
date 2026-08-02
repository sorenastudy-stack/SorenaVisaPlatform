# PR-SLOTRULES — Owner-configurable mandatory institution-type rule + Featured pin

**Status:** BUILT + VERIFIED (2026-08-02). Six steps, all committed.
**Supersedes:** the deleted PR-RECS-2 PrioritySlot system (removed, not archived).

Delivers two Owner decisions (2026-08-01):
1. The mandatory institution-type "slot" rule is now **fully Owner-configurable per country**,
   with **University / ITP / PTE all equal, symmetric** entries — and enforced in the ONE real
   admission pathway (Apply/Study), not the parked PrioritySlot system.
2. **Featured** institutions are an **additive display pin** — surfaced *alongside* the normal
   options in Apply/Study Step 1, **never** substituting into a ranked/mandatory position, and
   **never** read by matching or slot-rule logic.

---

## The rule, precisely

Config lives on `CountryExecutionConfig.slotRules` (JSON):
```
{ enabled: bool, mandatorySlots: [{ position: Int, institutionType: "UNIVERSITY"|"ITP"|"PTE" }] }
```
- Each mandatory position requires **exactly** that type at that priority; every other position
  is unconstrained. `enabled:false` or empty `mandatorySlots` ⇒ rule off (nothing blocks).
- All three types are symmetric — a mandatory UNIVERSITY position is enforced exactly like ITP/PTE.
- **Fails closed:** a programme whose provider has no `institutionType` (null) never satisfies a
  mandatory position.
- "Full safety-net slate" = the list must reach each mandatory position with the right type. For
  the NZ default (pos 4 = ITP, pos 5 = PTE) that means ≥5 ranked choices with a Polytechnic 4th
  and a College 5th — the PRD_4 §8 intent, now Owner-editable.

`slotCount` remains top-level config metadata (bounds the position picker in the UI); it is **not**
an enforcement input — the rule is entirely `mandatorySlots`-driven.

## Enforcement points (decided; flagged for review)

| Path | Behaviour |
|---|---|
| **Submit** (`admission.service.submitApplication`) | **Full hard gate** — every mandatory position must be filled with the right type, else `BadRequestException` with per-position messages. |
| **Reorder** (student + staff) | **Reorder-hole guard** — rejects (before writing) a reorder that lands the wrong type in a reserved position. Incompleteness is allowed. |
| **Add / remove** | **Permissive** — re-sequencing on every keystroke would fight normal list-building; the Step-1 UX guides and submit is the guarantee. |

Type resolution is **server-side** (`programme → provider.institutionType`), never a client claim.
Pure decision logic is golden-frozen in `programme-choice-rules.logic.ts`; the I/O edge (config
load + type resolve + throw) is `programme-choice-rules.service.ts`, shared by the student and
staff modules.

**In-flight impact (as designed):** with NZ enabled, existing DRAFT applications missing a
Polytechnic 4th / College 5th are blocked at next submit until they comply (incl. the QA test
student's 1-choice draft).

## Owner controls (where)

- **Rule:** Country Config → `/staff/country-config` → "Institution distribution" → an **enable
  toggle** + a **mandatory-positions list** (position number + single institution-type dropdown,
  add/remove). All three types co-equal. No deploy.
- **Featured:** Universities → `/staff/universities` → edit institution → **"Featured institution"**
  checkbox.

## Student experience (Apply/Study Step 1)

- A **"Featured institutions"** section (tap to select, then pick an intake) — additive, above the
  normal picker.
- A **"Required positions"** checklist from the live rule (met/unmet), an institution-type badge on
  each chosen programme, and an amber hint on any choice at a mandatory position with the wrong
  type. New strings are inline English (Persian i18n stays frozen).
- Fed by public `GET /public/programme-choice-rules` and the extended `/public/programmes`
  (now returns `institutionType` + `isFeatured`).

## Commit trail

| Step | Commit | What |
|---|---|---|
| 1 (freeze) | `5f6122c` | pure `validateChoiceTypeRules` + adapted two-directional golden battery (16/16) |
| 2 (delete) | `0a5ce6d` | remove PR-RECS-2 (model + `DROP TABLE priority_slots` + `confirmedAt`; controllers/service/dto; trim matching.logic keeping InstitutionType; de-slot golden spec + seed). Kept `CONFIRMED` enum (RECS-1 queries it). |
| 3 (config) | `e3831cd` | reshape `slotRules` + DTO + `validateSlotRules` + Country-Config UI rework + NZ seed + live-row migration |
| 4 (enforce) | `945d6cb` | `ProgrammeChoiceRulesService` → submit gate + student/staff reorder guard, live config, fail-closed |
| 5 (featured+UX) | `2fdde37` | `isFeatured` (additive migration) + Universities checkbox + `/public/programmes` fields + `/public/programme-choice-rules` + Step-1 Featured section + required-positions UX |

## Verification

- Golden battery **16/16** (frozen before wiring); config/matching **38/38**; enforcement
  integration smoke vs the **live NZ config 10/10** (valid passes; incomplete / wrong-type /
  null-type blocked at submit; reorder-hole blocked; incomplete passes the write guard;
  fail-closed both paths); broad backend gate `matching + country-config + admission +
  staff-admission-choices + providers + public + scoring` **165/165**.
- Two isolated additive migrations (`DROP TABLE priority_slots` + `confirmedAt`; `isFeatured`),
  clean diffs, applied + resolved. Live NZ config row migrated in place to the new shape.
- Clean `nest build`; app boots with routes mapped; frontend production build compiles.
- Live endpoints verified: rules `{enabled:true, [{4,ITP},{5,PTE}]}`; programmes carry
  `institutionType` + `isFeatured`.

## Open items / honest notes

- **⚠️ TRACKED OPEN ITEM — hardcoded single-destination (`NZ`).** The rule reads a hardcoded
  `countryCode: 'NZ'` config in three places (`ProgrammeChoiceRulesService.DESTINATION`,
  `PublicService.programmeChoiceRules`, and the matcher's own `MatchingService` precedent it
  mirrors). **This is not a new risk** — it matches the existing matcher's single-destination
  assumption. **Decision: leave as-is for now** — correctly scoped, and multi-country is
  plumbing-only away (thread the student's destination country into `loadConfig()` /
  `programmeChoiceRules()` instead of the literal `'NZ'`; the config table is already keyed by
  `countryCode`, and the whole rule is per-country by construction).
  **Trigger to revisit: when a second destination country is actually onboarded.** Flagged
  deliberately because this entire feature exists *because* mandatory-slot policy varies by
  country, and multi-country is an active direction — so this must not be silently forgotten
  when that day comes. No work requested now.
- **Enforcement-point choice** (submit=full, reorder=hole-guard, add/remove=permissive) is a
  deliberate UX call — easy to tighten to hard-block add/remove if the Owner wants.
- The two-directional battery was **adapted** (not byte-verbatim) from the deleted PrioritySlot
  battery: the simpler configurable model retires the old count/position-integrity/allowedTypes/
  preferred cases.
- **11 pre-existing root-`tsc` errors** remain in unrelated test scripts + 3 portal specs (proven
  identical at HEAD, outside the production build) — untouched by this phase.
