# Filling in the institution spreadsheets

**For:** whoever is collecting programme, tuition and scholarship data.
**You do not need to understand the system.** Fill in the columns below, upload, and the
screen tells you if anything needs fixing before it saves.

Templates live beside this file in `docs/import-templates/`:

| File | What it is for |
|---|---|
| `1-programmes-BLANK.xlsx` | the list of courses an institution offers |
| `1-programmes-template.xlsx` | the same, with two filled-in example rows |
| `2-scholarships-BLANK.xlsx` / `-template.xlsx` | scholarships, by student nationality |
| `3-tuition-BLANK.xlsx` / `-template.xlsx` | tuition fees, by student nationality |
| `3-tuition-template-country-sections.xlsx` | the same, in the alternative layout (see below) |

Every example row in every template has been run through the real importer and accepted
with **zero errors**, so if you copy their shape you will not hit a validation problem.

---

## How to upload

Staff portal → **Universities** → open the institution → **Edit**.

- **Programmes** upload sits on the institution page.
- **Tuition and scholarships** sit lower down, in the pricing section.

Every upload is **two steps**:

1. **Check the file.** Nothing is saved. The screen shows which countries it found, how many
   rows it read, and any rows that need attention — each with **the row number as it appears
   in Excel**, so you can go straight to it.
2. **Confirm and import.** Only now is anything saved.

A bad file can never save silently. If you are unsure, press *Check the file* and read what
comes back — that is exactly what it is for.

One file per institution. Maximum file size 5 MB. `.xlsx`, `.xlsm` and `.xls` all work.

---

## 1. Programmes

Put the courses on a sheet named **`Programme Database`**. (If the workbook has only one
sheet, any name works — but naming it that is safest.)

Column names must match **exactly**, including punctuation and capitals.

| Column | Required? | What to put |
|---|---|---|
| `Programme/Qualification` | **Required** | Full course name. **A row with this blank is skipped entirely.** |
| `Brand` | only for the all-institutions file | Institution name. Ignored when you upload from one institution's page. |
| `Provider Entity` | optional | Legal company name |
| `Major/Strand` | optional | e.g. `Software Development` |
| `Qualification Type` | strongly recommended | e.g. `Bachelor's Degree`, `New Zealand Diploma`, `Master's` |
| `NZQF Level` | strongly recommended | A number **3–10**. Anything outside that is ignored and the course defaults to level 4. |
| `Subject Area` | strongly recommended | e.g. `Information Technology`. Unrecognised subjects still import, and are listed back to you. |
| `Duration` | optional | Free text — `3 years`, `18 months`, `12 weeks` all work and are converted automatically. |
| `Delivery` | optional | `On-campus` / `Blended` / `Online` |
| `Campus/City` | optional | Used to tell apart the same course at two campuses |
| `Student Visa Suitable` | optional | `Yes` / `No` |
| `Tuition Fee (NZD)` | optional | The standard fee, as a number. This is the **fallback** used when there is no nationality-specific rate. |
| `Fee Basis` | optional | `per year` / `whole programme` / `per credit` |
| `Fee Year` | optional | e.g. `2026` |
| `2027 Fee Status` | optional | `confirmed` / `projected` |
| `Scholarship/Study Grant` | optional | Free-text note (this is *not* the scholarship sheet) |
| `English Requirement` | optional | Free text. An IELTS score in the text is picked up automatically. |
| `Academic/Subject Prerequisites` | optional | Free text |
| `Other Requirements` | optional | Free text |
| `Remaining 2026 Intake(s)` | optional | e.g. `Jul 2026, Oct 2026` |
| `Published 2027 Intake(s)` | optional | e.g. `Feb 2027, Jul 2027` |
| `Projected 2027 Intake(s)` | optional | Marked as needing reconfirmation |
| `Programme URL` | recommended | Official course page |
| `Secondary Verification Source` | optional | A second URL |
| `Verified Date` | optional | A date |
| `Verification Status` | optional | `Verified` / `Needs recheck` / `Unverified` |
| `Notes` | optional | Free text |

Separate several intakes with commas, semicolons or slashes — `Feb 2027, Jul 2027` and
`Feb 2027; Jul 2027` are both read correctly.

> **Everything imports as PENDING and hidden from students.** Someone has to approve each
> course before it becomes visible. Uploading can never put unchecked data in front of a
> client.

---

## 2. Tuition fees, by nationality

This is the sheet that lets a student from Iran see a different fee from a student from India.

### Two layouts — both work

**Layout A — a `Country` column on every row** (`3-tuition-template.xlsx`):

| Country | Tuition Fee | Level | Fee Year | Term | Notes |
|---|---|---|---|---|---|
| Iran | NZD 24,500 | Bachelor's | 2026 | | Standard international rate |
| Iran | NZD 28,900 | Master's | 2026 | | |
| India | NZD 23,800 | Bachelor's | 2026 | | |

**Layout B — country headings between blocks of rows**
(`3-tuition-template-country-sections.xlsx`): a row with **exactly one filled cell** naming a
country starts a new section, and every row beneath it belongs to that country until the next
heading.

### The columns

| Column | Required? | Notes |
|---|---|---|
| Country | **Required** (column *or* section heading) | See the accepted names below |
| Tuition Fee | **Required** | A money amount. `NZD 24,500`, `24500`, `$24,500` all work. |
| Level | optional | Leave **blank** to mean "any level" |
| Fee Year | optional | e.g. `2026` |
| Term | optional | e.g. `Semester 1` |
| Notes | optional | Free text |

The heading does not have to be the exact word — `Country`, `Nationality`, `Citizenship`,
`Region` and `Student type` are all recognised for the country column, and `Tuition Fee`,
`Annual Fee`, `International Fee`, `Tuition per year`, `Amount`, `Rate`, `Cost` and `Price`
are all recognised for the fee.

### Two rules that will catch you out

**Tuition may never be a percentage.** `20%` is rejected with
*"Tuition can't be a percentage"*. A percentage discount is a **scholarship** — put it on the
scholarship sheet. Only a scholarship may be a percentage.

**Fees must be in New Zealand dollars.** A row in another currency is accepted by the
importer but is then **silently ignored** when a student's fee is worked out, and they are
shown the standard fee instead. Convert to NZD before you upload.

### How the system picks which row applies

When several rows could apply to one student, the **most specific** wins:

1. course **and** level match
2. course matches
3. level matches
4. applies to the whole institution

If two rows are still tied, the one with the **later `Fee Year`** wins. If nothing matches,
the standard `Tuition Fee (NZD)` from the programmes sheet is used — and the system records
that it fell back, so it is never a silent guess.

Practically: **write one row per (nationality, level) you want to price differently, and leave
`Level` blank for a rate that covers everything else.**

---

## 3. Scholarships, by nationality

Same two layouts, same country rules.

| Column | Required? | Notes |
|---|---|---|
| Country | **Required** | Column or section heading |
| Scholarship Name | **Required** | A row without a name is rejected |
| Amount | **Required** | `NZD 5,000` **or** `10%` — both are allowed here |
| Type | optional | `Fixed` / `Percentage`. Usually worked out from the amount. |
| Level | optional | Blank = any level |
| Eligibility | optional | Free text — conditions, criteria, notes |

Recognised headings include `Scholarship Name`, `Award Name`, `Award`, `Title`, and for the
amount `Amount`, `Value`, `Award Value`, `NZD`, `Fee Reduction`, `Discount`.

---

## Country names the system recognises

Write the country in plain English. All of these are understood, in any capitalisation, and
extra words like "students", "nationals", "applicants" or "fees" are ignored — so
`Iranian students` and `Fees for Iran` both work.

Iran · India · China · Vietnam · Philippines · Sri Lanka · Nepal · Bangladesh · Pakistan ·
Thailand · Indonesia · Malaysia · Japan · South Korea · Taiwan · Hong Kong · Brazil ·
Colombia · Chile · Russia · Turkey · Saudi Arabia · United Arab Emirates · Egypt · Nigeria ·
Kenya · South Africa · Fiji · Samoa · Tonga · United Kingdom · United States · Australia ·
New Zealand · Myanmar · Cambodia · Mongolia · Uzbekistan · Iraq · Afghanistan

Common alternatives work too — `UAE`, `PRC`, `Persia`, `Burma`, `Ceylon`, `Türkiye`, `KSA`,
`Domestic` (= New Zealand).

**A near miss is caught, not guessed.** Typing `Irann` is flagged with a suggestion of `iran`
— but it is **never applied automatically**. You fix the spelling and re-upload.

**A country not on this list cannot be imported yet.** It needs adding to the system first.

---

## What the messages mean

| Message | What happened | What to do |
|---|---|---|
| **Country name not recognised** | The country is misspelled or not on the list | Fix the spelling, or ask for the country to be added |
| **No country for this row** | No `Country` column, and no country heading above the row | Add a `Country` column, or a heading row |
| **No scholarship name** | The name cell is empty | Fill it in |
| **Amount missing or unreadable** | Blank, `TBC`, or not a number | Put a real number, or delete the row |
| **Tuition can't be a percentage** | A `%` in a tuition fee | Move it to the scholarship sheet |
| **Level not recognised** | e.g. `Foundation Studies` | Use one of: Certificate, Diploma, Bachelor's, Graduate Certificate, Graduate Diploma, Postgraduate Certificate, Postgraduate Diploma, Master's, PhD — or leave blank for "any level" |

Rows that are flagged are the only ones that do not import. Everything else still goes in, so
you can fix the flagged rows and re-upload just those.

---

## Two things these spreadsheets cannot set yet

Worth knowing before you plan a data-collection round, because both matter for what students
are eventually shown.

**Intake months** — the sheet's intake columns are stored as text (`Feb 2027`), which is what
the student sees. They do **not** populate the separate month list the system uses to work out
*"is this intake far enough away for a visa?"*. That list is empty for every course in
production today. Filling it needs a small addition to the importer — roughly half a day —
otherwise it has to be typed in per course.

**Institution type** (University / ITP / PTE) — there is currently **no way to set or correct
this from the staff screens at all**. It is only ever set by the original bulk load, from
which file an institution arrived in. In production today 72 institutions are marked PTE,
1 ITP, 23 have nothing, and **none is marked University**. Any feature that treats
universities differently will behave oddly until this is fixed, and it cannot be fixed by
uploading a spreadsheet.

Both are small pieces of work. Neither blocks collecting the data in the meantime.
