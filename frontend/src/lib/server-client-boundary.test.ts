import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// PR-BOUNDARY-SWEEP — no plain VALUE may cross from a 'use client' module into
// the server graph.
//
// Components crossing that line are the normal, supported case. A value —
// array, object, enum, helper function — is not: in a production build it
// arrives as an opaque client reference, so `.includes()` or calling it throws.
// That is how PAYABLE_STATUSES silently emptied the portal's "Outstanding"
// section, and why it took a production build to notice: dev renders it fine,
// `tsc` sees a perfectly good array, and the surrounding try/catch ate the
// error.
//
// This test is the sweep, kept. It was validated against the commit that
// carried the original bug (1ac9eba) and reported both call sites, so it is
// known to detect the thing it exists to prevent rather than merely passing.

// Forward slashes, always. path.resolve returns backslashes on Windows while
// the file list below is normalised, so an un-normalised ROOT makes every
// import fail to resolve and the sweep silently inspects nothing — passing for
// the wrong reason. That happened; hence the resolver self-check at the bottom.
const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.next/.test(e.name)) walk(p, out); }
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

const files = walk(ROOT);
const src = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const isClient = (f: string) => /^\s*(['"])use client\1/m.test((src.get(f) ?? '').slice(0, 400));

function exportedValueKind(file: string, name: string): string | null {
  const s = src.get(file) ?? '';
  const decl = s.match(
    new RegExp(`^export\\s+(?:declare\\s+)?(const|let|var|function|async function|class|enum|type|interface)\\s+${name}\\b`, 'm'),
  );
  if (decl) return decl[1];
  // `export { X } from '...'` / `export { X }` — a re-export is just as unsafe.
  if (new RegExp(`^export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`, 'm').test(s)) return 'reexport';
  return null;
}

/**
 * Is this crossing a React component (supported) rather than a value (the bug)?
 *
 * Decided from HOW THE IMPORTER USES IT — `<Name …>` in the importing file is
 * conclusive. Guessing from the declaration instead was wrong in both
 * directions: it cleared 16 components only by accident, and it flagged
 * TicketDetail as a violation because the first 1500 characters of its body are
 * hooks and handlers before any JSX appears.
 *
 * The declaration check is kept as a secondary signal for a component that is
 * re-exported or passed around rather than rendered in the importer.
 */
function isComponentCrossing(importer: string, target: string, name: string): boolean {
  if (!/^[A-Z]/.test(name) || /^[A-Z0-9_]+$/.test(name)) return false;   // UPPER_SNAKE = constant
  const usedAsJsx = new RegExp(`<${name}[\\s/>]`).test(src.get(importer) ?? '');
  if (usedAsJsx) return true;
  const s = src.get(target) ?? '';
  const body = (s.match(new RegExp(`(function|const)\\s+${name}\\b[\\s\\S]{0,4000}`, 'm')) ?? [''])[0];
  return /<[A-Za-z][^>]*[/>]|React\.(FC|ReactNode|ReactElement)|JSX\.Element|createElement/.test(body);
}

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = `${ROOT}/${spec.slice(2)}`;
  else if (spec.startsWith('.')) base = path.posix.normalize(`${path.posix.dirname(fromFile)}/${spec}`);
  else return null;
  for (const c of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (src.has(c)) return c;
  }
  return null;
}

describe("server/client boundary", () => {
  it('no server-graph module imports a VALUE from a "use client" module', () => {
    const violations: string[] = [];

    for (const file of files) {
      if (isClient(file)) continue;                       // only server-graph modules
      const s = src.get(file) ?? '';
      for (const m of s.matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
        const [, typeOnly, clause, spec] = m;
        if (typeOnly) continue;                           // `import type` is erased
        const target = resolveImport(file, spec);
        if (!target || !isClient(target)) continue;

        const named = (clause.match(/\{([\s\S]*?)\}/) ?? [, ''])[1] ?? '';
        for (const raw of named.split(',')) {
          const part = raw.trim();
          if (!part || /^type\s/.test(part)) continue;    // inline `type X`
          const name = part.split(/\s+as\s+/)[0].trim();
          if (!/^[A-Za-z0-9_$]+$/.test(name)) continue;

          const kind = exportedValueKind(target, name);
          if (!kind || kind === 'type' || kind === 'interface') continue;
          if (isComponentCrossing(file, target, name)) continue;

          violations.push(
            `${name} (${kind}) exported by ${target.replace(`${ROOT}/`, '')} ['use client'] ` +
            `and imported by ${file.replace(`${ROOT}/`, '')}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('the sweep actually inspected the codebase', () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files.filter(isClient).length).toBeGreaterThan(100);
  });

  // Counting files is not enough: the first version of this test resolved zero
  // imports (a Windows path-separator mismatch) and still passed both checks
  // above. This asserts the resolver actually connects modules, so "no
  // violations" means "looked and found none" rather than "looked at nothing".
  it('the import resolver actually resolves imports', () => {
    let resolvedClientImports = 0;
    for (const file of files) {
      if (isClient(file)) continue;
      for (const m of (src.get(file) ?? '').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const target = resolveImport(file, m[1]);
        if (target && isClient(target)) resolvedClientImports++;
      }
    }
    // Server pages importing client components is ordinary and pervasive here.
    expect(resolvedClientImports).toBeGreaterThan(20);
  });
});
