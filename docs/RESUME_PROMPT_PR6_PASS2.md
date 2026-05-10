# Resume Prompt — PR 6 Pass 2 (Step 2 form fields)

_Paste this entire prompt at the start of a fresh Claude Code session to resume._

---

Resuming Sorena Executive Advisory Council project. Fresh Claude Code session.

WHERE WE ARE
Phase 1 — Application form. PRs 1-5 complete and verified. PR 6 (Step 2 form) in progress.

PR 6 PASS 1 DONE
DocumentUploader component built and working. Files:
- frontend/src/components/student/admission/DocumentUploader.tsx (NEW)
- frontend/src/components/student/admission/AdmissionFormContext.tsx (uploadDocument, deleteDocument added)
- frontend/src/components/student/admission/steps/Step4Documents.tsx (NEW — temporary placeholder, replaced by real Step 4 in PR 8)
- en.json + fa.json (11 admissionUpload* keys + admissionStep4Helper)
Browser-tested: drag-drop upload, view, download, delete all work.

PR 6 PASS 2 IN PROGRESS — TASK 0 NOT YET DONE
Step 2 form has not been started. Task 0 (two data files) was not completed before this session ended.

KNOWN ISSUE — CONTENT FILTER
Previous sessions repeatedly hit "Output blocked by content filtering policy" on Step 2 build. Trigger: dense legal-domain phrasing in i18n strings. Workaround for this build: use placeholder labels in i18n (Question1, FieldA, etc) — user will rewrite copy manually after structure is in place. Do NOT include words like "visa", "refused", "deportation", "refusal", "immigration enforcement" anywhere in code or i18n in this PR.

FIELD SPEC (exact DB column names — do not change)
Text/dropdown fields (all required):
- phone (text)
- phoneType (string: Mobile / Home / Work)
- countryOfBirth (string, dropdown from COUNTRIES list)
- citizenship (string, dropdown from COUNTRIES list)
- ethnicity (string, dropdown from ETHNICITIES list)
- passportNumber (string)

Boolean field:
- Frontend variable name: respondedYesToAdditionalQuestion
- DB column name: visaRefused
- Only the patchApplication call maps it back to "visaRefused" in the JSON body. All other frontend code uses respondedYesToAdditionalQuestion.

Upload slots (documentType values are opaque tokens — use as-is, no human-readable mapping):
- documentType="PASSPORT" — always required
- documentType="NZ_VISA_HISTORY" — optional
- documentType="VISA_REFUSAL_LETTER" — conditional (shown when respondedYesToAdditionalQuestion === true)

Validation logic for the registered stepHandler (before Next):
1. phone, phoneType, countryOfBirth, citizenship, ethnicity, passportNumber: all non-empty
2. At least one PASSPORT document exists in context.documents
3. respondedYesToAdditionalQuestion must not be null (must be true or false)
4. If respondedYesToAdditionalQuestion === true: at least one VISA_REFUSAL_LETTER document exists

Persist on Next:
  patchApplication({ phone, phoneType, countryOfBirth, citizenship, ethnicity, passportNumber, visaRefused: respondedYesToAdditionalQuestion })

TASK LIST (9 tasks total)
- Task 0 — Create frontend/src/lib/data/countries.ts and frontend/src/lib/data/ethnicities.ts
- Task 1 — Create Step2AdditionalInfo.tsx shell (imports, scaffold, register in shell switch)
- Task 2 — Add Step 2 field state to context / types
- Task 3 — Render fields 1–3 (phone text, phoneType dropdown, countryOfBirth dropdown)
- Task 4 — Render fields 4–6 (citizenship dropdown, ethnicity dropdown, passportNumber text)
- Task 5 — Wire all field state into AdmissionFormContext + patchApplication on Next
- Task 6 — Add PASSPORT upload slot (required)
- Task 7 — Add NZ_VISA_HISTORY upload slot (optional)
- Task 8 — Add VISA_REFUSAL_LETTER conditional slot + boolean question + show/hide logic + full validation

APPROACH
Build Step 2 in tiny tasks, one task per response. Use neutral placeholder copy in all i18n keys. After all 9 tasks compile clean and dev server stays up on port 3000, the user replaces placeholder i18n values in en.json manually, then we move to PR 7.

Confirm you've got this, and ask which task I want to start with. Do not start coding yet.
