# Dev server usage — PM2

The backend (port 3001) and frontend (port 3000) are managed by PM2 in the background, so VS Code terminals don't have to stay open. You start them once per work session, walk away, close VS Code if you want, and they keep running.

## Daily commands (run from the repo root, `D:\SorenaVisaPlatform`)

| Command | What it does |
|---|---|
| `npm run dev:up` | Start the backend + frontend in the background. Once per day, or after a reboot. |
| `npm run dev:status` | Quick table — both apps, their PIDs, uptime, restart counter, memory. |
| `npm run dev:logs` | Tail both apps' logs live. Ctrl+C exits the tail (the apps keep running). |
| `npm run dev:logs:backend` | Same, but backend only. |
| `npm run dev:logs:frontend` | Same, but frontend only. |
| `npm run dev:restart` | Soft-restart both apps. Use when an app feels wedged. |
| `npm run dev:down` | Stop everything at end of day. |
| `npm run dev:nuke` | Delete PM2's entire memory of the two apps (rarely needed — only if PM2's internal state gets corrupted). |
| `npm run kill-stale` | Pre-existing escape hatch — force-kills anything on 3000 or 3001 without going through PM2. |

## Where things go

- Logs: `D:\SorenaVisaPlatform\logs\backend.log`, `backend.error.log`, `frontend.log`, `frontend.error.log` — gitignored by the existing `*.log` rule. Old log lines are kept; PM2 doesn't auto-rotate them.
- PM2 metadata: `C:\Users\OEM\.pm2\` (user-home, not in the repo). The `~/.pm2` folder survives across reboots, so PM2 remembers which apps it owns but they're stopped until you run `dev:up` again.
- Config: `ecosystem.config.js` at the repo root. Two apps (`sorena-backend`, `sorena-frontend`), each invoked via a small `scripts/pm2-npm-runner.js` shim that exists to work around a known PM2-on-Windows quirk where `cmd.exe /c npm run …` swallows signals + log output.

## What you NO LONGER have to do

- Keep two VS Code terminals open running `npm run dev`.
- Worry about Ctrl+C killing the server when you actually meant to copy text.
- Restart manually after a port collision — the existing `prestart:dev` / `predev` hooks (from commit `1da6a95`) still run inside the npm scripts, so every PM2 restart clears stale processes on 3000/3001 first.
- Reboot the machine to recover from a stuck server — `npm run dev:restart` is faster.

## What still goes wrong (and how to recover)

- **`dev:up` reports both online, but `dev:status` shows uptime not advancing.** Run `npm run dev:logs` and look at the first 30 lines of each app — usually a Prisma migration that wasn't applied, an .env value that's missing, or a TypeScript error in a file you just saved. The fix is in the app, not in PM2.
- **A page returns 502 / connection refused.** Run `npm run dev:status`. If the app shows `errored`, run `npm run dev:logs:<that-app>` to see the boot stack. Common causes: backend DB connection failure, frontend env var missing.
- **The `↺` restart counter keeps going up.** PM2 is killing-and-relaunching because the app keeps crashing. Stop with `npm run dev:down`, look at the log, fix the bug, `npm run dev:up`.
- **`npm run dev:up` says "already running" but nothing is on 3000/3001.** PM2's internal state thinks the apps are alive but the actual processes died ungracefully. Run `npm run dev:nuke` then `npm run dev:up`.
- **Killing the underlying node-listening process directly** (e.g. `Stop-Process -Id $listenerPid -Force`) **does NOT trigger a PM2 auto-restart** on Windows under the current wrapper architecture. PM2 only sees its direct child (the `pm2-npm-runner.js` shim); the leaf listener is two layers down. In real-world crashes (uncaught exception, OOM, etc.) the whole process tree dies together and PM2 restarts cleanly. To force a recovery manually, use `npm run dev:restart` instead of killing the listener.

## What we deliberately did NOT do

- **Auto-start on system boot.** PM2 ships a `pm2 startup` command that would boot the apps the moment you log into Windows. It's a great footgun for dev environments — you don't want a half-broken WIP branch silently running every time you turn the machine on. Always invoke `dev:up` explicitly.
- **Production deploy.** PM2 is wired as a dev tool only — it's in `devDependencies`, the `dev:*` scripts are obviously dev-named, and `ecosystem.config.js` references the dev `npm run start:dev` / `npm run dev` commands (not the prod `npm run start:prod` / `npm run start`). The production deploy (Railway / Vercel) is unchanged.
- **Inline secrets.** `ecosystem.config.js` only sets `PORT` per app. Real env values stay in `backend/.env` and `frontend/.env.local` — Nest's `@nestjs/config` and Next's built-in dotenv loader pick them up at boot exactly the way they always have.
