## Email service stub — sendEmail uses Nodemailer/mock, not Resend
PR 3 added a generic `sendEmail({ to, subject, html })` method to EmailService. It uses the same Nodemailer SMTP transport already in the codebase (prod only, requires EMAIL_HOST env var). In dev/staging it logs `[EMAIL MOCK]` to console. Real Resend integration is deferred — wire `@resend/node` and replace the Nodemailer transport when ready.

## In-app notification stub — Notification model not yet created
PR 3 submit endpoint triggers a consultant notification email but cannot write an in-app notification row — the `Notification` model does not exist in the Prisma schema. The submit handler logs `TODO: in-app notification to consultant <ownerId>` instead. Create the `Notification` model, add the migration, and replace the console.log with a `prisma.notification.create(...)` call in `submitApplication`.

## case.status is a free-form String, not an enum
The Case model's status field is a plain String column, not a Postgres enum. PR 3 writes 'APPLICATION_SUBMITTED' to it as a string literal on submit. Risk: nothing prevents arbitrary or misspelled values from being written. Fix later: define a CaseStatus Postgres enum, migrate the column, lock down accepted values. Tracked for post-Phase-1 cleanup.

## Schema vs DB drift — admission_applications.caseId
The DB has a UNIQUE constraint on caseId (added in migration 20260501000000_add_admission_form). The Prisma schema field is missing the @unique attribute, so Prisma TypeScript types don't allow findUnique({ where: { caseId } }) — we use findFirst as a workaround. Fix in next schema pass: add @unique to caseId in AdmissionApplication, run prisma migrate dev to generate a no-op migration that just updates the schema.prisma source of truth.

## Test 15 returned 404 not 403 (cross-user access)
The OTHER_TOKEN user had no Contact record, so resolveContactAndCase fails at the contact lookup before reaching the ownership check. Returns 404 'Student profile not found'. Functionally safe (cross-user access still blocked). For richer error semantics, the contact lookup should distinguish 'no contact for user' from 'wrong owner' and return 403 in the latter case. Revisit during PR 14 (agent role) when multi-user ownership patterns get more complex.

## Consultant notification path untested with real assigned consultant
PR 3.5 Test 18 confirmed the consultant notification path is correctly gated on case.ownerId being non-null. In the test the case.ownerId was NULL so the path was skipped. The not-skipped path (email mock + TODO log) needs verification once a real test case has an assigned staff member. Verify before Phase 1 sign-off.
