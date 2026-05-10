# Persian i18n Gaps — Phase 1 Audit
Date: 2026-05-10

## Summary
- Total empty Persian keys (en has value, fa is ""): 41
- Total keys already complete in fa.json: 40 (all Step 2 keys × 29, Step 1 welcome block × 10, Step 1 title × 1)
- Intentionally empty in both locales: 1 (`admissionStep2Helper`)

---

## Empty keys grouped by section

### Buttons / Shell (10 keys)

| Key | en.json value |
|-----|---------------|
| `admissionApply` | Apply |
| `admissionStarting` | Starting your application… |
| `admissionBack` | Back |
| `admissionNext` | Next |
| `admissionSubmit` | Submit |
| `admissionSaveForLater` | Save for later |
| `admissionSavedToast` | Progress saved. You can return anytime. |
| `admissionSubmittedTitle` | Application submitted |
| `admissionSubmittedBody` | Congratulations! Your application has been successfully submitted and you've completed the first step towards studying in New Zealand. Next, your application will be reviewed by our admissions team. We'll be in touch with you via email regarding the result of your application. If you need to contact us before then, please use the live chat or message your assigned consultant. |
| `admissionSubmittedSignoff` | Kind regards, The Sorena Team |

---

### Stage Progress Labels (4 keys)

| Key | en.json value |
|-----|---------------|
| `admissionStage1` | Apply |
| `admissionStage2` | Offer |
| `admissionStage3` | Acceptance |
| `admissionStage4` | Pre arrival |

---

### Step 1 — Programme Picker (7 keys)

| Key | en.json value |
|-----|---------------|
| `admissionStep1Helper` | Select the programme(s) you want to apply for. You can choose multiple programmes, but only one intake date per programme. |
| `admissionStep1ProgrammeLabel` | Programme |
| `admissionStep1ProgrammePlaceholder` | Select a programme |
| `admissionStep1IntakeLabel` | Intake |
| `admissionStep1IntakePlaceholder` | Select an intake |
| `admissionStep1AddButton` | Add programme |
| `admissionStep1EmptyState` | No programmes selected yet. Use the picker above to add one. |

---

### Step 1 — Validation & Errors (8 keys)

| Key | en.json value |
|-----|---------------|
| `admissionStep1NoChoices` | Add at least one programme before continuing. |
| `admissionStep1RemoveTooltip` | Remove this programme |
| `admissionStep1ReorderHint` | Drag to reorder by priority |
| `admissionStep1AddDuplicate` | This programme is already in your list. |
| `admissionStep1AddError` | Could not add programme. Please try again. |
| `admissionStep1RemoveError` | Could not remove programme. Please try again. |
| `admissionStep1ReorderError` | Could not reorder. Please try again. |
| `admissionStep1ProgrammesLoadError` | Could not load programmes. Please refresh. |

---

### Step 4 — Helper (1 key)

| Key | en.json value |
|-----|---------------|
| `admissionStep4Helper` | Upload any extra documents that support your application. |

---

### Upload Component (11 keys)

| Key | en.json value |
|-----|---------------|
| `admissionUploadDropzone` | Click to upload or drag a file |
| `admissionUploadMaxSize` | Up to 10 MB |
| `admissionUploadAllowedTypes` | PDF, JPG, PNG, or DOCX |
| `admissionUploadView` | View |
| `admissionUploadDownload` | Download |
| `admissionUploadRemove` | Remove |
| `admissionUploadRemoveConfirm` | Remove this file? |
| `admissionUploadSizeError` | File is over the size limit. |
| `admissionUploadTypeError` | This file type is not supported. |
| `admissionUploadFailed` | Upload failed. Please try again. |
| `admissionUploadDeleteFailed` | Could not remove file. Please try again. |

---

## Already complete in fa.json (no action needed)

| Section | Count |
|---------|-------|
| Step 1 title (`admissionStep1Title`) | 1 |
| Step 1 welcome block (WelcomeTitle, WelcomeIntro, DocumentsIntro, Doc1–4, DocumentsClosing, ProgrammeSectionTitle, ProgrammeSectionIntro) | 10 |
| Step 2 all fields, placeholders, options, uploads, validations | 29 |
| Step titles Steps 3–8 | 6 |
| **Total** | **46** |
