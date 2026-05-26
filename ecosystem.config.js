// PM2 ecosystem config — dev only.
//
// Daily workflow lives in npm run dev:up / dev:down / dev:status /
// dev:logs from this directory. See docs/DEV_SERVER_USAGE.md.
//
// Each app shells out via npm so the existing prestart hooks
// (predev / prestart:dev → backend/scripts/kill-port.js) still fire
// on every restart — kill-port clears stale processes before the
// new instance binds. PM2 layers crash-recovery on top; the existing
// dev commands (npm run dev / npm run start:dev) remain a fallback.
//
// The PM2 env block sets PORT explicitly so each app always binds to
// the same port regardless of shell state. Real secrets stay in
// backend/.env and frontend/.env.local — Nest's @nestjs/config and
// Next's built-in dotenv loader pick them up at boot. We don't inline
// anything sensitive here.

const path = require('path');

// Every app runs through a thin Node wrapper (scripts/pm2-npm-runner.js)
// instead of `cmd.exe /c npm run …` directly. Reason: on Windows,
// cmd.exe intercepts the Ctrl+C/SIGTERM signals PM2 sends with its
// interactive "Terminate batch job (Y/N)?" prompt, which (a) stalls
// shutdown and (b) drops the child's stdout/stderr on the floor so
// PM2 logs come up empty. The wrapper spawns npm with `shell:true`
// + `stdio:'inherit'` and forwards signals down — PM2 gets one
// clean Node.js process to track. See the wrapper file's header for
// the full rationale.
const runnerScript = path.resolve(__dirname, 'scripts/pm2-npm-runner.js');
const runScript = (name) => ({
  script: runnerScript,
  args: ['run', name],
});

// Resolve log paths against the ecosystem-config directory, NOT each
// app's cwd. Without this, PM2 creates backend/logs/ and frontend/logs/
// (relative to each app's cwd) instead of using the repo-root logs/.
const logDir = path.resolve(__dirname, 'logs');

const sharedRestartPolicy = {
  autorestart: true,
  max_restarts: 5,
  min_uptime: '10s',
  kill_timeout: 5000,          // grace period for Nest to flush Prisma + Next.js to flush HMR sockets
  watch: false,                // Nest --watch and Next HMR handle file changes themselves
};

module.exports = {
  apps: [
    {
      name: 'sorena-backend',
      cwd: './backend',
      ...runScript('start:dev'),
      env: {
        PORT: '3001',
      },
      out_file: path.join(logDir, 'backend.log'),
      error_file: path.join(logDir, 'backend.error.log'),
      merge_logs: true,
      time: true,                // prefix log lines with timestamps
      ...sharedRestartPolicy,
    },
    {
      name: 'sorena-frontend',
      cwd: './frontend',
      ...runScript('dev'),
      env: {
        PORT: '3000',
      },
      out_file: path.join(logDir, 'frontend.log'),
      error_file: path.join(logDir, 'frontend.error.log'),
      merge_logs: true,
      time: true,
      ...sharedRestartPolicy,
    },
  ],
};
