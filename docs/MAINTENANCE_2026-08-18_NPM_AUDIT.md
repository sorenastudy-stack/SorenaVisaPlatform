# Maintenance — npm audit remediation, 18 August 2026

Not a phase. Dependency hygiene plus one dead-code removal, recorded because two
of the decisions are ones a future reader would otherwise have to re-derive.

**Patched (non-breaking).** `multer` 2.0.2 → 2.2.0, five DoS advisories on the
library all 22 upload routes run on — there were two copies and the one that
mattered was Nest's, since `@nestjs/platform-express@10` pins `"multer": "2.0.2"`
exactly, so it needed an `overrides` entry (written as `"$multer"`, because npm
rejects an override that disagrees with the direct dependency). `axios` 1.15.2 →
1.19.0, which also carried `form-data` 4.0.5 → 4.0.6; most of axios's advisories
need a configured proxy and we configure none, but the ReDoS and `maxBodyLength`
ones were reachable through the web-sync fetcher, which also gained an 8 MB
`maxContentLength`/`maxBodyLength` cap it never had. `nanoid` 3.3.16 → 3.3.18 and
`postcss` 8.5.19 → 8.5.26, both under `sanitize-html`. Production advisories went
18 → 13.

**Deferred, with reasons.** *Prisma 6 → 7* — npm reports a fix as available for
`prisma`/`@prisma/config`/`deepmerge-ts`, but 6.19.3 is already the latest 6.x and
`@prisma/config` pins `deepmerge-ts` at exactly 7.1.5, so the only real fix is the
major; the advisory is stack exhaustion while Prisma merges its own config at CLI
time, not an attacker-reachable path. *NestJS 10 → 11* — the whole
`@nestjs/core`/`common`/`platform-express`/`throttler` cluster plus the `express`,
`body-parser`, `qs` and `file-type` versions Nest pins. Nest 10 receives no
patches, so every fix is in 11.x, but the applicability is thin: the `@nestjs/core`
advisory (CVE-2026-35515) is **SSE injection**, and this app has no `@Sse`
endpoints and emits no `text/event-stream` at all. Both are support-driven work
needing their own session, not urgent security work. Also deferred:
`@anthropic-ai/sdk`, whose advisory covers a local-filesystem memory tool we do
not use.

**EmailService and nodemailer were deleted.** If you grep for "email" and find only
`MailService`, this is why. `EmailModule` provided an `EmailService` that built an
SMTP transport at every boot — and **nothing ever injected it**; no code called
`sendEmail` or `sendVerificationEmail`. Every real send has gone through
`MailService` (Resend over HTTPS) for some time. The SMTP credentials that dead
path would have used did not even authenticate (`verify()` returned `535` on
nodemailer 6 and 9 alike), which is unsurprising for code nothing exercises. So it
was not a fallback: a loaded library, a live SMTP connection at boot, and no
reachable send behind it. The stale `SMTP_HOST`/`USER`/`PASS`/`PORT`/`SECURE`
variables were removed from Railway in the same round — note `backend/test-email.js`
still reads those names, but it is a standalone diagnostic wired to no npm script
that reads local `.env`, not Railway. Seven CRLF header-injection tests went with
the deletion; no equivalent was written for `MailService`, because its injection
surface is different rather than merely smaller — it sends `from`/`to`/`subject`/
`html` as JSON to Resend's API and assembles no headers itself (no `headers`, no
`reply_to`, no `bcc`/`cc`), so MIME composition happens server-side where a test
here could not meaningfully pin it.

Verified: backend 1507/1507, clean build, the 22-route EICAR matrix green after the
multer bump, and `MailService` confirmed live end-to-end through the compiled class
with two messages accepted by Resend. Commits `5f615c7`, `968c4f5`, `e4fc059`.
Fuller dependency context lives in
[FOLLOWUP_DEPENDENCY_SECURITY.md](FOLLOWUP_DEPENDENCY_SECURITY.md).

**Update — the Prisma advisory was closed without the major.** The
`prisma`/`@prisma/config`/`deepmerge-ts` chain deferred above is resolved by a single
`"overrides": { "deepmerge-ts": "^8.0.0" }` entry. `@prisma/config` pins `deepmerge-ts`
at exactly 7.1.5, so npm cannot move it any other way — but nothing stops an override,
and the Prisma CLI is unaffected (`generate`, `validate` and `migrate status` all verified
on the newer transitive dependency). That took production advisories from 12 to 1; the
only survivor is `@anthropic-ai/sdk`, whose advisory covers a local-filesystem memory tool
this app does not use. **A full Prisma 6 → 7 migration was scoped first and deliberately
deferred**: it needs driver adapters at 75 `new PrismaClient()` sites, a required generator
`output` path which changes all 193 `@prisma/client` imports, and an ESM-vs-CommonJS
decision in a CommonJS NestJS app. Worth noting one thing the audit settled either way —
the current `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` is already correct for
the `node:22-alpine` production image, and Prisma 7 would remove that setting entirely
along with the Rust engine. None of that is urgent now that no advisory forces it; revisit
it for support currency, not for security. Commit `5cb6b90`.

