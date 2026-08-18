# Phase 42 — Antivirus: clamd hardening

**Status:** DONE — 18 August 2026
**Commits:** `8a55a3d`, `fdc5d81`, `1ad8479`, `e043375`, `908b101`, `15f2071`, `f2b59ab`
**Follows** [PHASE_41](PHASE_41_ANTIVIRUS_SLICE2_ALL_UPLOAD_POINTS.md), which scanned all 21
in-handler upload routes against a scanner still running stock settings.

---

## 1. What this phase does

The scanner had been running `clamav/clamav:stable` with default settings, which meant three
things were true and none of them obvious: encrypted archives and password-protected documents
passed as **clean** because clamd cannot see inside them, macros in legacy OLE2 containers were
never examined, and `StreamMaxLength` sat on an undocumented 25 MB default that happened to be
above our largest 20 MB upload cap by coincidence rather than decision.

The `clamav` service now builds from `clamav/Dockerfile` in this repo, carrying its own
`clamd.conf` additions. Eleven directives are confirmed live in the running container — read back
from clamd's own startup log, not merely asserted at build time — and a password-protected ZIP is
now refused end to end through a real upload route. A Railway volume holds the signature database
so it survives deploys, seeded on first boot from the image's own copy rather than by a cold
download.

The reason this took seven commits is recorded in §8: every deployment failed silently until the
actual cause turned out to have nothing to do with ClamAV.

## 2. Files created or changed

**Created — `clamav/`**
| File | Purpose |
|---|---|
| `clamav/Dockerfile` | Builds from `clamav/clamav:stable`, applies the hardening, asserts it, and seeds the volume. |
| `clamav/hardening.conf` | The eleven directives, appended to the image's own `clamd.conf`. |
| `clamav/expected-config.txt` | Name=value pairs the build checks against `clamconf`, so a typo fails the build. |
| `clamav/seed-and-start.sh` | First-boot seed for the signature volume; execs the upstream `/init` unchanged. |
| **`clamav/railway.json`** | **The fix.** Scopes this service to its own Dockerfile build with empty build/start/pre-deploy commands. See §8. |

`clamav/Dockerfile.bare` was added in `908b101` purely as a diagnostic — a Dockerfile containing
nothing but `FROM`, used to prove the failure was independent of our image content. It is deleted
in this commit; the finding it produced is written up in §8 instead.

**How the hardening is applied.** The Dockerfile does not replace `clamd.conf` — it deletes any
existing line for each directive we set and appends our block, so the socket, user and logging
settings the container needs to boot are preserved and each directive appears exactly once
(clamd does not reliably let a later line override an earlier one).

**Railway service configuration** (not files — recorded here because it is not visible in the
repo):
- `source`: `clamav/clamav:stable` image → repo `sorenastudy-stack/SorenaVisaPlatform`
- `rootDirectory`: `/clamav`
- `railwayConfigFile`: `clamav/railway.json` — set explicitly rather than relying on
  root-directory discovery, since the root file's own `"rootDirectory": "backend"` is part of what
  confused resolution
- `watchPatterns`: `["clamav/**"]`, so backend pushes no longer rebuild the scanner and trigger
  needless fail-closed windows
- New volume `clamav-volume` mounted at `/var/lib/clamav`, state `READY`

**Related, but documented elsewhere — the `xlsx` dependency.** `backend/package.json` and
`package-lock.json` changed in `f16ab89` and `479c7b1`: `xlsx` moved from `devDependencies` to
`dependencies` (production had never installed it, so all nine importer routes returned *"Cannot
find module 'xlsx'"* for roughly five months), then pinned to the patched
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` because the npm registry copy carries two
unfixed high-severity advisories. That work is written up in
[FOLLOWUP_DEPENDENCY_SECURITY.md](FOLLOWUP_DEPENDENCY_SECURITY.md) §1 and
[BACKLOG.md](BACKLOG.md); it is not repeated here beyond this pointer.

## 3. Database / config changes

**No migration. No schema change.** Nothing in this phase touches `schema.prisma`, Prisma, or any
application table. No new audit event types — the events from
[PHASE_41](PHASE_41_ANTIVIRUS_SLICE2_ALL_UPLOAD_POINTS.md) are unchanged and still the only ones
the scanner writes.

The configuration that did change is entirely Railway-side and listed in §2.

## 4. Environment variables added

**None.** `CLAMAV_HOST` and `CLAMAV_PORT` on the backend are unchanged and still resolve
correctly — verified by 9/9 live route checks after the redeploy. `CLAMAV_TIMEOUT_MS` remains
unset and defaults to 20000.

The warning from slices 1 and 2 still stands: **unsetting `CLAMAV_HOST` does not disable
scanning**, it refuses every upload on the platform.

## 5. Third-party services connected

**No new service.** The same `clamav` service in `peaceful-imagination` → production, still
private-network only at `clamav.railway.internal:3310`, no public domain, no ingress. What changed
is how it is built (repo + Dockerfile instead of the stock image) and that it now has a volume.

Signatures continue to come from `database.clamav.net` via `freshclam`; egress works, confirmed
post-deploy (§6).

## 6. How to test it works

**Confirm the hardening is live** — the point is to read it from the *running* container, not from
the file we wrote:

```bash
railway logs --service clamav --lines 200 | grep -iE \
  "Alerting of encrypted|OLE2|Limits:|Heuristic alerting|clamd started"
```

Expect:

```
Alerting of encrypted archives _and_ documents enabled.
Alerting of encrypted archives enabled.
Alerting of encrypted documents enabled.
OLE2 support enabled.
OLE2: Alerting on all VBA macros.
Heuristic alerting enabled for scans that exceed set maximums.
Limits: Global size limit set to 419430400 bytes.
Limits: File size limit set to 104857600 bytes.
Limits: Recursion level limit set to 17.
Limits: Files limit set to 10000.
socket found, clamd started.
```

`StreamMaxLength` is **not** printed by clamd at startup. It is asserted at build time against
`clamconf` as `52428800`; the build fails if it is wrong.

**Confirm signature freshness:**

```bash
railway logs --service clamav --lines 120 | grep -iE "daily|main.cvd|bytecode"
```

Post-deploy: `daily.cvd` 28095 (355,605 sigs), `main.cvd` 63 (3,287,027 sigs), `bytecode.cvd` 339.

**Confirm the volume:** `clamav-volume` at `/var/lib/clamav`, `READY`. On the deploy that attached
it, the log read `[seed] /var/lib/clamav already populated — leaving it alone` and freshclam went
straight to an incremental update — no cold download, so no avoidable fail-closed window.

**The encrypted-archive test** — this is the one that could not be run before this phase. Build a
password-protected ZIP (any tool; the verification script built one in-process with ZipCrypto and
a harmless text file) and upload it to any route that accepts a zip-based type, e.g. a `.xlsx`
importer. **Expect HTTP 422** — clamd cannot open it, and "I could not look" is now a refusal
rather than silence.

**EICAR and the clean control**, per the standing discipline:

```
X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
```

⚠️ **Assert the payload is 68 bytes before sending it.** A 67-byte near-miss is not EICAR, and
clamd correctly calls it clean — which reads exactly like a scanner that has stopped working. This
cost real time in this phase (§7) and the check is now baked into the verification script.

**Verified 18 Aug 2026, post-deploy and post-volume: 9/9.**

| Route | EICAR | Clean control |
|---|---|---|
| payment receipt | 422, plain message | 201 |
| case visa document | 422, plain message | 201 |
| staff programme importer | 422, plain message | — |

Plus 3/3 on the encrypted ZIP, and clamd logging the matching
`instream(...): Eicar-Test-Signature FOUND` lines.

## 7. Known limitations

- **The R2 presigned case-document flow is still NOT covered.**
  `backend/src/documents/documents.service.ts` — `POST /cases/:caseId/documents/request-upload` →
  browser PUTs straight to Cloudflare R2 → `/confirm`. The backend never holds the bytes, so
  there is nothing to scan in a handler and no amount of clamd hardening reaches it. **7
  `UPLOADED` rows exist in production, unscanned.** This is also the one gap the EICAR route
  matrix structurally cannot detect, because it has no in-handler route to name. Deferred to its
  own pass: it needs a staging prefix, a scan job, an `AVAILABLE` gate on the download endpoint,
  and a backfill of the 7.
- **clamd does not log clean scans.** Only detections produce `instream(...)` lines. This is worth
  knowing before you use log silence as evidence of anything — during this phase I read "no
  instream lines" as "the backend never called clamd" and spent a long time chasing a
  non-existent connectivity fault.
- **`StreamMaxLength` is invisible at runtime.** It is only provable via `clamconf`, which is why
  the build-time assertion exists. If an app-level cap is ever raised above 20 MB, this is the
  number that must move first.
- **`AlertExceedsMax` is unreachable in practice.** App caps are ≤20 MB against a 400 MB scan
  budget. It is on because the default direction is wrong, not because it fires.
- **`OLE2BlockMacros` alerts on *any* VBA macro in a legacy OLE2 container.** No current upload
  surface accepts `.doc`/`.xls`, so this should never produce a false positive — but if a legacy
  Office format is ever whitelisted, expect macro-bearing files to be refused outright.
- **The volume seed runs only when the volume is empty.** If the database is ever corrupted rather
  than absent, the seed will not repair it; delete the volume contents (or the volume) to force a
  reseed.
- **No quarantine, no staff visibility, no cleanup job** for stored files — all unchanged from
  slices 1 and 2.

## 8. How a future developer would extend this

### ⚠️ The monorepo lesson — read this before adding any service

**Any service in this repo that points at the repo root inherits `/railway.json`, which is the
backend's config-as-code.** It declares:

```json
{ "build":  { "buildCommand": "npm install && npm run build" },
  "deploy": { "startCommand": "node dist/main",
              "preDeployCommand": "npm run migrate:deploy" },
  "rootDirectory": "backend" }
```

Point a new service at this repo and Railway applies all of that to it. For the ClamAV service the
consequence was that Railway ran `npm run migrate:deploy` as a **pre-deploy step** — in its own
step, *before* the container starts — inside an image with no node and no package.json. The
deployment died before any container existed, so `railway logs -d` returned **nothing at all**.

That produced **four silent, log-less deployment failures**, and it is a genuinely nasty one to
diagnose because:

- The build succeeds and the image pushes. Only the deploy fails.
- There is no container output to read, because there was never a container.
- **Config-as-code overrides the dashboard and the API.** Clearing `startCommand` and
  `preDeployCommand` via `serviceInstanceUpdate` worked — the instance read back `""` and `[]` —
  and the very next deployment snapshot still had the backend's values, because every snapshot is
  rebuilt from `railway.json`.
- Checking `serviceInstance` therefore tells you nothing. **Check the deployment's own snapshot**
  (`deployment(id:){ meta }`), which is what Railway actually deploys with.
- It is not your Dockerfile. A Dockerfile containing nothing but `FROM clamav/clamav:stable`
  failed identically — that is the experiment that finally isolated it.

**So: give every new service its own `railway.json`**, scoped to itself, exactly as
`clamav/railway.json` and the frontend's existing `frontend/railway.json` do:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build":  { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": { "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 10 }
}
```

Set `railwayConfigFile` on the service explicitly (`clamav/railway.json`) rather than trusting
root-directory discovery — the root file's own `"rootDirectory": "backend"` interferes. Omit
`buildCommand`, `startCommand` and `preDeployCommand` entirely so the image's own `ENTRYPOINT`
runs. And set `watchPatterns` to that service's directory, or every backend push rebuilds it.

### Adding or changing a clamd directive

1. Add the line to `clamav/hardening.conf` with a comment saying *why* — the file is the record of
   intent, not just configuration.
2. Add the expected `Name=value` to `clamav/expected-config.txt`, using the expanded byte count
   clamd reports (`50M` comes back as `52428800`). The build fails if clamd's own parser disagrees.
3. Deploy, then confirm it in the **running** container's startup log. Build-time proof is not
   runtime proof; several directives appear in the log with different wording than the directive
   name (`AlertEncrypted` → *"Alerting of encrypted archives _and_ documents enabled."*).
4. If the directive is one clamd does not print at startup, say so in §6 and rely on the build
   assertion — do not claim it is verified live when it is not.

Use `clamconf` in **full**, never `clamconf -n`: the `-n` form prints only values that differ from
built-in defaults, so a directive set *to* a default is correctly absent. An earlier version of
the build check used `-n` and failed claiming `ScanOLE2` was missing when it was simply already
correct.

## 9. Security layers applied

**Layer 7 — File uploads.** This phase is entirely layer 7, at the scanner rather than the
application. All eleven directives confirmed **live in the running container**, read from clamd's
own startup output:

| Directive | Value | How it was confirmed live |
|---|---|---|
| `AlertEncrypted` | yes | *"Alerting of encrypted archives _and_ documents enabled."* |
| `AlertEncryptedArchive` | yes | *"Alerting of encrypted archives enabled."* |
| `AlertEncryptedDoc` | yes | *"Alerting of encrypted documents enabled."* |
| `ScanOLE2` | yes | *"OLE2 support enabled."* |
| `OLE2BlockMacros` | yes | *"OLE2: Alerting on all VBA macros."* |
| `AlertExceedsMax` | yes | *"Heuristic alerting enabled for scans that exceed set maximums."* |
| `MaxScanSize` | 400 MB | *"Limits: Global size limit set to 419430400 bytes."* |
| `MaxFileSize` | 100 MB | *"Limits: File size limit set to 104857600 bytes."* |
| `MaxRecursion` | 17 | *"Limits: Recursion level limit set to 17."* |
| `MaxFiles` | 10000 | *"Limits: Files limit set to 10000."* |
| `StreamMaxLength` | 50 MB | Build-time `clamconf` assertion (`52428800`) — clamd does not print it |

The four limits are at, not below, what the stock image was already logging. They are written down
so a future image bump that quietly reduces a default shows up as a diff rather than as a
behaviour change nobody noticed.

**The encrypted-archive control is proven, not assumed.** A password-protected ZIP sent through a
real upload route returned **HTTP 422**. Before this phase clamd could not open it and said
nothing, and the application read that silence as clean — the exact shape of a security control
that appears present and is not.

**Layer 3 — Env vars.** No change; `CLAMAV_HOST` unset still means UNAVAILABLE, never CLEAN.

**Layer 4 — HTTPS / network.** No change. clamd remains private-network only, no ingress. The
volume adds no network surface.

**Layer 9 — npm audit.** No production dependency changed in this phase. (The `xlsx` move and CDN
pin are covered in [FOLLOWUP_DEPENDENCY_SECURITY.md](FOLLOWUP_DEPENDENCY_SECURITY.md) §1.)

**Layers 1, 2, 5, 6, 8, 10** — unchanged. Auth, role gates, throttling, audit logging, session
expiry and backups are untouched by this phase; the application-side scanning contract from
[PHASE_41](PHASE_41_ANTIVIRUS_SLICE2_ALL_UPLOAD_POINTS.md) is unchanged and still fails closed.

## 10. Rollback instructions

Everything here is scoped to the `clamav` service. **No rollback below touches the backend, the
receipt scanning from slice 1, or the 21-route scanning from slice 2** — none of that code is in
this phase's commits.

**To drop the hardening but keep the service building from the repo** — revert the config and
redeploy:

```bash
git revert f2b59ab 15f2071 8a55a3d      # seed, railway.json, hardening
```

⚠️ Reverting `15f2071` removes `clamav/railway.json`, which re-exposes the service to the
backend's root `/railway.json` and will bring back the silent deployment failure in §8. If you are
reverting the hardening but want the service to keep deploying, **keep `clamav/railway.json`** and
revert only `8a55a3d` (plus `fdc5d81`, the assertion fix).

**To return the service to the stock image entirely** — fastest and safest, and what to reach for
if clamd will not start:

```graphql
mutation {
  serviceInstanceUpdate(
    serviceId: "0ae05cb2-997a-40c6-9258-656ff4f42904"
    environmentId: "8ed15e4e-81e3-45bb-8bb8-27d8faa4abf8"
    input: { source: { image: "clamav/clamav:stable" }
             startCommand: "", preDeployCommand: [], buildCommand: ""
             rootDirectory: "", dockerfilePath: "" }
  )
}
```

⚠️ **GraphQL `null` is silently ignored on these fields — use empty string / empty array**, or
the clear does not take. This is not obvious and cost time to discover.

Scanning keeps working after this: the stock image still detects malware, it simply stops
refusing encrypted archives and OLE2 macros, and `StreamMaxLength` returns to its undocumented
default.

**The volume** can stay attached across either rollback — it holds only the signature database,
and the stock image uses the same `/var/lib/clamav` path. If you do detach it, expect one slow
first boot while freshclam downloads from scratch, during which **every upload on the platform is
refused** because the scanner is unreachable and the design fails closed. Prefer to leave it.

**Do not** revert `f16ab89` / `479c7b1` as part of a clamav rollback — those are the `xlsx`
dependency fix, unrelated to the scanner, and reverting them breaks all nine spreadsheet
importers.
