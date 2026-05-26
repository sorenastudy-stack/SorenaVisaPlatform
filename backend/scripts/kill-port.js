#!/usr/bin/env node
/**
 * kill-port.js — kill whatever Node process is listening on the given
 * TCP port(s). Used as a `prestart:dev` hook so a stale backend from a
 * previous session can't squat 3001 and crash the next `nest start --watch`.
 *
 * Built-ins only (no npm deps). Windows-first; falls back to lsof on
 * macOS/Linux.
 *
 * Exit codes:
 *   0  — port was free, OR a squatter was found and successfully killed.
 *   1  — a squatter was found but the kill failed (so start:dev won't
 *        run alongside it).
 *
 * Logging: every action is announced. Never silent.
 *
 * Usage:
 *   node scripts/kill-port.js 3001
 *   node scripts/kill-port.js 3000 3001
 */

'use strict';

const os = require('os');
const { execSync } = require('child_process');

const isWindows = os.platform() === 'win32';

function logInfo(msg)  { process.stdout.write(`[kill-port] ${msg}\n`); }
function logError(msg) { process.stderr.write(`[kill-port] ${msg}\n`); }

function findPidsOnPortWindows(port) {
  // netstat -ano output line example (after the column headers):
  //   "  TCP    0.0.0.0:3001    0.0.0.0:0    LISTENING    25672"
  // We only want LISTENING rows for the requested port.
  let raw;
  try {
    raw = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
  } catch (err) {
    logError(`netstat failed: ${err.message}`);
    return [];
  }
  const pids = new Set();
  const localPattern = new RegExp(`[:.]${port}\\b`);
  for (const line of raw.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    if (!localPattern.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[parts.length - 1], 10);
    if (Number.isFinite(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

function findPidsOnPortUnix(port) {
  try {
    const raw = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: 'utf8' });
    return raw
      .split(/\s+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

function describePid(pid) {
  if (isWindows) {
    // PowerShell first — wmic was removed in recent Windows 11 builds.
    try {
      const ps = `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`;
      const raw = execSync(ps, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const line = raw.trim();
      if (line) return line;
    } catch {
      /* fall through to wmic, then to a final default */
    }
    try {
      const raw = execSync(
        `wmic process where ProcessId=${pid} get CommandLine /value`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const m = raw.match(/CommandLine=(.*)/);
      if (m && m[1] && m[1].trim()) return m[1].trim();
    } catch {
      /* fall through */
    }
    return '(unknown — both PowerShell and wmic unavailable)';
  }
  try {
    const raw = execSync(`ps -p ${pid} -o args=`, { encoding: 'utf8' });
    return raw.trim() || '(unknown)';
  } catch {
    return '(unknown)';
  }
}

function killPid(pid) {
  try {
    if (isWindows) {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    return true;
  } catch (err) {
    logError(`Failed to kill PID ${pid}: ${err.message}`);
    return false;
  }
}

function clearPort(port) {
  const pids = isWindows ? findPidsOnPortWindows(port) : findPidsOnPortUnix(port);
  if (pids.length === 0) {
    logInfo(`Port ${port} free.`);
    return true;
  }
  let allKilled = true;
  for (const pid of pids) {
    const cmd = describePid(pid);
    logInfo(`Killing PID ${pid} on port ${port} — ${cmd}`);
    if (!killPid(pid)) allKilled = false;
  }
  return allKilled;
}

function main() {
  const ports = process.argv
    .slice(2)
    .map((a) => parseInt(a, 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 65536);

  if (ports.length === 0) {
    logError('Usage: kill-port.js <port> [more ports...]');
    process.exit(1);
  }

  let ok = true;
  for (const port of ports) {
    if (!clearPort(port)) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

main();
