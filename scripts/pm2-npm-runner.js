#!/usr/bin/env node
/**
 * pm2-npm-runner.js — bridge between PM2 and an `npm run <script>` invocation.
 *
 * Why this exists. PM2 on Windows can't spawn `npm.cmd` directly
 * (Node tries to parse it as a JS module and crashes on the
 * `:: Created by npm` header). The standard workaround — pointing
 * PM2 at `cmd.exe /c npm run <script>` — kind-of works, but cmd.exe
 * intercepts SIGINT/SIGTERM with its interactive
 * "Terminate batch job (Y/N)?" prompt and doesn't reliably forward
 * stdio back up to PM2, so logs are empty and the underlying
 * Node tree orphans when PM2 wants to stop it.
 *
 * This script is a thin Node-based wrapper that:
 *   * spawns npm with `shell: true` so .cmd resolution works on
 *     Windows and a bare `npm` works on POSIX
 *   * inherits stdio so PM2 captures the child's stdout/stderr
 *     directly into its log files
 *   * forwards SIGINT / SIGTERM (and the synthetic kill PM2 uses
 *     on Windows: writing 'shutdown\n' to stdin) so the npm/Node
 *     tree exits cleanly when PM2 asks
 *
 * Usage from ecosystem.config.js:
 *   { script: 'scripts/pm2-npm-runner.js', args: ['run', 'start:dev'], cwd: './backend' }
 *
 * Everything PM2 sees is a single Node.js process (this script), so
 * the existing PM2 conventions (cwd, env, restart policy, kill_timeout)
 * all behave exactly as documented.
 */

'use strict';

const { spawn } = require('child_process');

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('[pm2-npm-runner] Usage: pm2-npm-runner.js <npm args...>\n');
  process.exit(2);
}

// shell:true lets us call bare `npm` cross-platform; on Windows the
// shell resolves .cmd, on POSIX the shell finds npm in PATH.
const child = spawn('npm', args, {
  stdio: 'inherit',
  shell: true,
  // Inherit the env we were given (PM2 already merged its `env` block
  // into our process.env before launching us).
  env: process.env,
});

let shuttingDown = false;
const forwardSignal = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  // On POSIX we can signal the child directly; on Windows kill()
  // is best-effort but combined with PM2's kill_timeout grace period
  // it gives Nest / Next time to flush.
  try { child.kill(signal); } catch { /* child may have already exited */ }
};

process.on('SIGINT',  () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));
process.on('SIGHUP',  () => forwardSignal('SIGTERM'));

// PM2 on Windows uses 'process.send({type:"shutdown"})' to ask the
// app to shut down. Listen for it and translate to a child kill.
process.on('message', (msg) => {
  if (msg === 'shutdown' || (msg && msg.type === 'shutdown')) {
    forwardSignal('SIGTERM');
  }
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(0);   // we asked for it; treat as a clean stop
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  process.stderr.write(`[pm2-npm-runner] failed to spawn npm: ${err.message}\n`);
  process.exit(1);
});
