# Phase — Persian: client portal case page, and the client report PDF

**Date:** 17 August 2026
**Status:** both items built and verified
**Scope:** deliberately two items out of a 21-item inventory. Owner decision, 17 Aug 2026:
everything else on that list stays English. See `BACKLOG.md` → *Persian / RTL* for the full
table and the per-item "deferred" marks.

## 1. What this phase does

**Item 7 — the client portal case page** (`/portal/case`) had 13 strings written directly into
the JSX of an otherwise fully-translated page. A Persian-speaking client saw a page that was
Persian everywhere except its most important column: the "what to do next" list, the pay
buttons, the wallet heading and the timeline heading. Those 13 strings now come from the
message catalogue like the rest of the page.

**Item 14 — the client readiness report PDF** now renders in Persian for a Persian client. The
document is chosen per client from `Contact.preferredLanguage`, embeds Vazirmatn (Helvetica, the
previous font, has no Persian glyphs at all), mirrors its row furniture for right-to-left, and
substitutes a lighter weight where English uses italic. Getting there required three fonts to be
tested and two rejected; §7 records the evidence.

## 2. Files created or changed

**Changed**
- `frontend/src/app/portal/case/page.tsx` — 13 literals replaced with `t(...)` calls
- `frontend/src/i18n/messages/en.json` — 13 keys added under `portal.case`
- `frontend/src/i18n/messages/fa.json` — the same 13 keys, in Persian

**Created — item 14**
- `backend/src/scorecard/pdf/fonts.ts` — registers the three Vazirmatn faces
- `backend/src/scorecard/pdf/client-report.copy.ts` — all 48 strings, both languages
- `backend/src/scorecard/pdf/client-report.spec.ts` — regression guards (§6)
- `backend/assets/fonts/vazirmatn-{regular,bold,light}.ttf` + `VAZIRMATN-LICENSE.txt`

**Changed — item 14**
- `backend/src/scorecard/pdf/client-report.ts` — literals replaced by the copy table; RTL layout
- `backend/src/scorecard/pdf/helpers.ts` — optional `ReportStyle` on six helpers, defaulting to
  exactly the previous English behaviour, so the internal report is untouched
- `backend/src/scorecard/scorecard.service.ts` — resolves the locale from the client's contact

**Dockerfile** — `COPY assets ./assets/` already shipped the fonts directory (it was added for
Caladea) and `.dockerignore` excludes nothing there, so no copy step was needed. What was added
is a **build-time assertion** that the fonts arrived intact, following the `RUN pg_dump --version`
precedent ten lines above it: open each face with fontkit and shape a Persian sentence. A missing,
truncated or Persian-less TTF now fails the image build — which leaves the running deploy
untouched — instead of surfacing when a client downloads their report.

**Not changed, deliberately:** every other file on the 21-item inventory, and the backend strings
that still surface *on this very page* and inside the Persian PDF — see §7.

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

### Item 14 — the client report PDF

1. **Font coverage first, as a gate.** All three Vazirmatn weights checked through fontkit — the
   same library pdfkit embeds fonts with — for the Persian-specific letters (پ چ ژ گ ک ی) and a
   full test sentence: **11/11 codepoints, 0 `.notdef`** in Regular, Bold and Light. The two
   rejected fonts were measured the same way (§7).
2. **The English report is unchanged, byte-for-byte.** An English PDF was rendered from the
   *pre-change* build, then again after, and compared: **identical apart from the generation
   timestamp and the `/ID` derived from it**. This caught a real regression mid-build — measuring
   text for the new height-aware callouts emitted an extra PDF font operator on the English path
   and shifted it by 3 bytes. The measurement is now inside the RTL branch.
3. **Every page of the Persian PDF was rasterised and read**, not merely generated. Confirmed: no
   empty boxes anywhere; the four secondary passages render in Light and read as quieter asides
   rather than emphasis; dates and `ICEF` read left-to-right; word order, spacing and the RTL
   mirroring (bars filling from the right, bullets on the right, columns swapped) are correct.
   Two layout defects were found and fixed this way — the progress-bar labels were struck through
   by their own bars (Persian descenders sit lower than Helvetica's), and the philosophy callout
   overflowed its fixed-height panel because Persian runs longer than the English it replaced.
4. **14 regression tests** (`client-report.spec.ts`) lock the findings: English category names
   still match the scoring engine, the English wording is unchanged, an English render embeds no
   font, no Persian digits and no parentheses appear anywhere in the Persian copy, dates stay
   Gregorian with Latin numerals, and `padScriptBoundaries` pads only true boundaries. Two of
   them failed on first run and drove code fixes, so they are known to be capable of failing.
5. **The production image proves it itself.** Docker is not installed on the build machine, so
   rather than assert from the Dockerfile that the font would be present, the Dockerfile now
   asserts it at build time (§2). Railway's own production build runs that check, so a green
   deploy *is* the verification. The check was confirmed able to fail: a Persian-less font
   reports 14 missing glyphs, and a truncated TTF throws outright.
6. **1265 tests / 105 suites.**

## 7. Known limitations

**The font took three attempts, and the first two failed for different reasons.**

| Font | Persian coverage | Verdict |
|---|---|---|
| Calibri | Regular/Bold full; **Italic 1 of 11 codepoints** | rejected — italic renders as empty boxes, and it is not redistributable |
| Carlito | **1 of 11 in every weight** | rejected — a Latin/Greek/Cyrillic face; no Persian at all |
| **Vazirmatn** | **11 of 11, all weights, 0 `.notdef`** | shipped — SIL OFL, covers Latin too |

Carlito was the obvious choice on paper: metric-compatible with Calibri, freely redistributable,
and the exact parallel to the existing Caladea/Cambria precedent in `engagement-letter-stamp.ts`.
It has no Persian whatsoever. The lesson is that the precedent was about *metrics*, not scripts —
Caladea has no Persian either. Metric compatibility was moot regardless: this report is set in
**Helvetica**, not Calibri, so there was no Calibri layout to preserve.

**Persian has no italic**, so the four passages English sets in italic use Vazirmatn **Light**.

### Three rendering defects that only a rendered page would reveal

Each of these passed a type-check and a glyph-coverage check and still produced a wrong document.

1. **Arabic-Indic digits reverse.** `۱۷ اوت ۲۰۲۶` printed as `۷۱ اوت ۶۲۰۲`, and a score of `۱۰۰`
   as `۰۰۱`. fontkit folds them into the surrounding Arabic run and reverses them with it.
   **U+200E does not rescue them** — the LRM-wrapped and bare forms render identically. Fixed by
   keeping every numeral Latin: dates use `fa-IR-u-ca-gregory-nu-latn`, scores stay ASCII.
2. **One space vanished per line.** pdfkit trims leading whitespace; the RTL reversal moves the
   string's *last* space into the leading position, where it is eaten — gluing the final two
   words together (`شماشخصی`). Fixed with a trailing space that gives the trim something
   expendable. NBSP "fixes" it too, but pins the string into one token so it renders
   left-to-right — worse.
3. **Spaces at a script boundary are displaced**, not deleted: `اوت  17صدور:` — two on one side,
   none on the other. Fixed by doubling the boundary space, restricted to a true Arabic↔Latin
   boundary so the space inside "Maryam Karimi" is left alone.

**U+200E was implemented, tested and removed.** It was required under Calibri, but with
Vazirmatn pages rendered with and without it are identical, and it interfered with boundary
spacing. Keeping an inert safeguard that reads like a working one is worse than not having it;
`helpers.ts` records the finding where the next person will look.

**Parentheses are unusable in Persian copy here.** pdfkit does not mirror paired punctuation for
RTL, so `(1 تا 3 سال)` renders with the brackets swapped onto the wrong words. The three strings
that used them were rewritten with commas. A test enforces this.

### Still English inside the Persian PDF, by design

The scoring engine's advice text — `nextActionContent` (lead-in, heading, bullets), `bandName`
and `bandRange` — is stored per submission in English only. That is inventory **item 2**, which
the owner deferred, so a Persian report carries an English recommendation block. `nextActionTextFa`
exists in the database but holds English ("Persian mirrors English per Fix 9").

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

**For the PDF: render it and look at it.** Every one of the five Persian defects in §7 passed a
type-check, and three of them passed a glyph-coverage check too. Reversed digits, a swallowed
space and a callout overflowing its panel are only visible on a rasterised page.

Adding a locale to the report means adding a `ReportCopy` entry and, if the script needs it, a
font in `fonts.ts`. Keep helper defaults exactly as they are — the English document is asserted
byte-for-byte, and an unconditional `font()` call is enough to break that.

Do not "improve" the Persian copy by localising the numerals or adding parentheses. Both render
incorrectly, and both are covered by tests that explain why.

## 9. Security layers applied

**None needed — this phase moved display strings and added a font.** No endpoint, guard, query
or permission changed. The report locale comes from `Contact.preferredLanguage`, a field that
already existed and carries no authority: it selects a copy table.

One deliberate choice: the PDF follows the **client's** language, not the downloader's, so a
staff member fetching a Persian client's report sees exactly the document the client receives.
The ownership check on that endpoint is unchanged. The page remains a server component reading `/portal/me/case` with the
cookie-bound session, and the locale comes from the `NEXT_LOCALE` cookie, which carries no
authority: it selects a message catalogue and nothing else.

The temporary client created for verification was deleted in the same run, and the deletion was
asserted rather than assumed (user, contact, lead, case, application, document, two invoices and
the scorecard submission — 0 rows remaining).

## 10. Rollback instructions

Revert the commit. The 13 literals return to the JSX, the 13 keys leave both catalogues, the
report reverts to English-only and the Vazirmatn files leave `assets/`. No migration ran and no
data was written, so there is nothing to unwind in the database.

Reverting only the PDF half is also safe: `client-report.ts`, `client-report.copy.ts`,
`fonts.ts`, the fonts and the `ReportStyle` parameters are self-contained, and the case-page
change shares nothing with them.
