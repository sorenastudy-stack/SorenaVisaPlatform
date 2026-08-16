# Phase — Persian: client portal case page, and the client report PDF

**Date:** 17 August 2026
**Status:** item 1 built and verified; **item 2 blocked pending an owner decision on the font**
**Scope:** deliberately two items out of a 21-item inventory. Owner decision, 17 Aug 2026:
everything else on that list stays English. See `BACKLOG.md` → *Persian / RTL* for the full
table and the per-item "deferred" marks.

## 1. What this phase does

**Item 7 — the client portal case page** (`/portal/case`) had 13 strings written directly into
the JSX of an otherwise fully-translated page. A Persian-speaking client saw a page that was
Persian everywhere except its most important column: the "what to do next" list, the pay
buttons, the wallet heading and the timeline heading. Those 13 strings now come from the
message catalogue like the rest of the page.

**Item 14 — the client readiness report PDF** was to be translated in the same phase. It is
**not built**: the font check that gates it failed, and the instruction was to stop and report
rather than substitute a font. §7 records exactly what was found.

## 2. Files created or changed

**Changed**
- `frontend/src/app/portal/case/page.tsx` — 13 literals replaced with `t(...)` calls
- `frontend/src/i18n/messages/en.json` — 13 keys added under `portal.case`
- `frontend/src/i18n/messages/fa.json` — the same 13 keys, in Persian

**Not changed, deliberately:** every other file on the 21-item inventory, including
`backend/src/scorecard/pdf/client-report.ts` (item 14, blocked) and the backend strings that
still surface *on this very page* — see §7.

### The 13 strings

| key under `portal.case` | English | Persian |
|---|---|---|
| `nextSteps.heading` | What to do next | قدم‌های بعدی |
| `nextSteps.allClear` | You’re all caught up — nothing needed from you right now. | همه چیز به‌روز است — در حال حاضر کاری از سمت شما لازم نیست. |
| `nextSteps.open` | Open | باز کردن |
| `nextSteps.checkEmail` | Check your email | ایمیل خود را بررسی کنید |
| `nextSteps.inReview` | In review | در حال بررسی |
| `nextSteps.signed` | Signed | امضا شد |
| `nextSteps.payNow` | Pay now | پرداخت کنید |
| `nextSteps.pay` | Pay | پرداخت |
| `walletHeading` | My wallet | کیف پول من |
| `timelineHeading` | Your case timeline | روند پرونده شما |
| `viewFullReport` | View full report | مشاهده گزارش کامل |
| `team.message` | Message your case team | ارسال پیام به تیم پرونده |
| `team.willReachOut` | Your team will reach out here as your application progresses. | با پیشرفت درخواست شما، تیم شما از همین‌جا با شما در تماس خواهد بود. |

`walletHeading` reuses the exact wording already in `wallet.title`, so the card and the page it
links to agree.

**The English is byte-identical to what the page rendered before.** This was checked rather
than assumed: an early draft of `allClear` used a straight apostrophe where the JSX had a
typographic one (`You're` vs `You’re`), which a browser check caught because the English
assertion stopped matching. Every one of the 13 values is now asserted to appear verbatim in
the pre-change file under `git show HEAD:`.

## 3. Database tables/columns added

**None.** No migration, no backfill.

## 4. Environment variables added

**None.**

## 5. Third-party services connected

**None.**

## 6. How to test it works

Catalogue parity first: **2,011 English keys / 2,006 Persian**, 13 added to each. The five
still absent from Persian are the pre-existing `staff.roles.*` labels — this phase introduced
no new gap.

Then the page itself, in a real browser, signed in as a real client with `NEXT_LOCALE=fa`:

1. **`<html lang="fa" dir="rtl">`**, no console errors, no raw i18n keys anywhere.
2. **All 13 strings verified individually** — for each: the English is *gone* and the Persian
   is present. Ten were exercised on existing dev clients; the other three plus one more
   (`allClear`, `open`, `pay`, `viewFullReport`) could not be reached by any of 60 dev clients,
   because no dev record produces a missing document, a second payable invoice, an empty
   next-step list, or a linked scorecard submission. Those four were verified on a **temporary
   client created and then deleted**, with the deletion asserted (0 rows left).
3. **An English baseline is captured first**, so the Persian assertions are known to be capable
   of failing — a check that only ever passes proves nothing.
4. **Dates stay Gregorian**: the rendered timeline reads `۱۷ اوت ۲۰۲۶` — "اوت" is August, not a
   Jalali month. Asserted as the absence of any Jalali year (۱۳xx/۱۴xx) plus the presence of a
   Gregorian one.
5. **RTL confirmed visually**, not just by the `dir` attribute: sidebar on the right, text
   right-aligned, chevrons mirrored (`rtl:rotate-180` was already in place).

Three earlier versions of this verification produced **false failures**, all of them the test's
fault, and all worth knowing about before writing the next one:

- `innerText` returns CSS-transformed text, and these headings are Tailwind `uppercase` — so a
  case-sensitive match for "What to do next" never fires. Compare case-insensitively.
- Substring matching cannot check short labels. `Pay` is inside `Pay now`; `Open` is inside
  `Case opened`; `Signed` is inside the backend's *"You're signed and your case has started!"*.
  Presence is now counted with exact, whitespace-normalised element text.
- `دی` (the Jalali month Dey) is a substring of ordinary Persian words — `قدم‌های بعدی` contains
  it. A Jalali *year* is unambiguous; a Jalali month name is not.

## 7. Known limitations

**Item 14 — the client report PDF — is BLOCKED, awaiting an owner decision.** The instruction
was to confirm Calibri's Persian coverage first and stop rather than silently substitute. It
was rendered through the real pipeline (pdfkit) and inspected as an image. Three findings:

1. **Calibri Regular and Bold are fine.** Full Persian coverage including the Persian-specific
   letters (پ چ ژ گ), correct right-to-left contextual shaping, zero `.notdef` glyphs.
2. **Calibri Italic has no Arabic glyphs at all** — 22 of 26 glyphs in a Persian test sentence
   come back `.notdef` and render as empty boxes. This is not cosmetic: `client-report.ts` uses
   `FONTS.ITALIC` in **four** places, all carrying real prose (the band meaning, the "every area
   has room to grow" sentence, the counsellor credential line, the category subtitles). Calibri
   Italic renders English perfectly — the gap is Arabic-script only.
3. **Latin inside a Persian string renders reversed.** `تاریخ صدور: 17 August 2026` comes out as
   `6202 tsuguA 71`, and `ICEF` as `FECI`. pdfkit applies one direction per run and does not do
   bidi. Wrapping the Latin in `U+200E` (LRM) fixes it; `U+2066`/`U+2069` isolates do **not** —
   they render as boxes. This matters directly for the "dates stay Gregorian" requirement: the
   date stays Gregorian, but without LRM it prints backwards.

There is also a **deployment and licensing** question, separate from the glyphs. Production is
`node:22-alpine`, which ships no system fonts, and the Dockerfile copies only `assets/`. Calibri
would have to be committed to the repo — and Calibri is licensed with Windows/Office, not
redistributable. Note the precedent already in this codebase: `engagement-letter-stamp.ts`
bundles **Caladea** precisely because it is the metric-compatible libre stand-in for Cambria.
The equivalent substitution for Calibri would be **Carlito** — but that is the owner's call to
make, which is why nothing was changed.

**The page still shows English that this phase did not touch — by design.** `/portal/case`
renders next-step and timeline text supplied by the backend: *"Pay account opening fee"*,
*"Provide your passport"*, *"Case opened"*, *"You're signed and your case has started!"*. Those
are backend-generated strings (inventory item 16), explicitly deferred. A Persian client will
see a Persian page with English item labels inside it. This is the expected outcome of the
chosen scope, not an oversight — but it is the most visible consequence of it.

**No Persian copy here has been reviewed by a native speaker.** That caveat covers the whole
catalogue and now these 13 strings too.

## 8. How a future developer would extend this

Add the key to `en.json` **and** `fa.json` in the same edit, and insert it *textually* — these
files round-trip badly through `JSON.parse`/`stringify`, which reformats unrelated blocks and
turns a 2-key addition into a 20-line diff.

Copy the English **verbatim** from the JSX, including typographic apostrophes and em dashes. A
straight-vs-curly apostrophe is invisible in review and silently changes rendered copy.

When verifying, assert **absence as well as presence**, capture the English baseline first, and
use exact element text for anything short enough to be a substring of something else. The three
false failures in §6 all came from skipping one of those.

## 9. Security layers applied

**None needed — this phase moved display strings only.** No endpoint, guard, query or
permission changed. The page remains a server component reading `/portal/me/case` with the
cookie-bound session, and the locale comes from the `NEXT_LOCALE` cookie, which carries no
authority: it selects a message catalogue and nothing else.

The temporary client created for verification was deleted in the same run, and the deletion was
asserted rather than assumed (user, contact, lead, case, application, document, two invoices and
the scorecard submission — 0 rows remaining).

## 10. Rollback instructions

Revert the commit. The 13 literals return to the JSX and the 13 keys leave both catalogues;
nothing else is affected. No migration ran, no data was written, and no other locale key was
touched, so there is nothing to unwind in the database.
