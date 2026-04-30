# Session State — 2026-04-27 (paused before Prisma version decision)

## Where we are

Backend is currently CRASHED in Railway production. The crash is now diagnosed but NOT fixed. We paused before committing the fix.

## Confirmed root cause

Prisma 7.7.0 changed its default engine type from "library" to "client". The new "client" engine requires either a Driver Adapter (e.g. @prisma/adapter-pg) or an Accelerate URL — a bare `new PrismaClient()` / `super()` call no longer works.

This is documented in:
- https://github.com/prisma/prisma/issues/28670
- https://github.com/prisma/prisma/discussions/29241

The Prisma maintainers' official recommendation in that discussion is: **downgrade to Prisma 6**.

The misleading error in Railway logs is:
`PrismaClientInitializationError: 'PrismaClient' needs to be constructed with a non-empty, valid 'PrismaClientOptions'`

This was confirmed via diagnostic logging added in commit 13d7aaf — DATABASE_URL reaches the container correctly (length 93, starts with `postgresql://postgre`), and the failure is at `super()` itself, not at connection time.

## Decision pending — DO THIS NEXT SESSION

Pick one:

**Option A (recommended) — Downgrade to Prisma 6**
- Change `@prisma/client` and `prisma` in backend/package.json from `^7.7.0` to `^6.0.0`
- Delete backend/prisma.config.ts if present (Prisma 6 doesn't use it)
- Keep PrismaService as bare `super()`
- Keep schema.prisma generator block with binaryTargets `["native", "linux-musl-openssl-3.0.x"]`
- Wipe node_modules + package-lock, npm install, npx prisma generate, npm run build
- Commit and push
- Estimated time: 10 min, low risk

**Option B — Keep Prisma 7, use pg driver adapter**
- Install `@prisma/adapter-pg` and `pg` (and `@types/pg` as dev dep)
- Rewrite PrismaService to build a `PrismaPg` adapter from `process.env.DATABASE_URL` and pass it to `super({ adapter })`
- Add `previewFeatures = ["driverAdapters"]` to schema generator block (if not already client engine type)
- Risk: moderate, more moving parts on launch day

## What's already in place (don't redo)

- Dockerfile fixed: openssl installed, prisma generate runs in builder before nest build, prod stage regenerates Prisma client (no copying from builder). File: backend/Dockerfile.
- schema.prisma generator has correct binaryTargets `["native", "linux-musl-openssl-3.0.x"]`.
- DATABASE_URL in Railway uses `${{Postgres.DATABASE_URL}}` template reference — Railway canvas shows the link arrow.
- Stripe live key was rotated (one was briefly exposed, replaced ~10 min later, no unauthorized activity confirmed in Stripe Payments + Security history).
- New STRIPE_SECRET_KEY is set in Railway Variables.
- backend/.dockerignore added to prevent stale dist/.
- Diagnostic logging is currently in PrismaService (logs DATABASE_URL presence, length, first 20 chars, NODE_ENV, super() success/failure with stack). Can be removed once Prisma is fixed.

## Recent commits (latest first)

- 13d7aaf — debug(backend): defensive Prisma init + .dockerignore (try/catch around super())
- c195c24 — docs: restore Section 10 rollback content that was overwritten
- 839ecd6 — docs: append Prisma+Alpine debug findings to Phase 6 doc
- 275ae6e — fix(backend): add openssl + linux-musl binary target for Prisma on Alpine
- 04f6cb6 — fix(backend): regenerate Prisma client in production stage instead of copying
- b430946 — (earlier Prisma attempts)
- 02250c8 — docs: add Phase 6 Payments handover document
- ef8a26e — fix(backend): generate Prisma client before nest build to fix Docker build

## Other pending items (from before this debug session)

- `app.sorenavisa.com` DNS not resolving. Domain registered at Dreamscape Networks; nameservers point to Wix DNS (ns12.wixdns.net / ns
