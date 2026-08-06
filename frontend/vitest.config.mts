import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// PR-PHASE33 — frontend test runner. Added to test the assessment picker through
// the REAL component, because the q16 id/key bug was invisible to the existing
// Node-only guard: that guard hand-feeds StudyField KEYS, while the picker emits
// IDS, so the guard passed 7/7 while every real submission scored 'Other'.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // Next.js sets jsx:"preserve" in tsconfig and injects the runtime itself, so
  // the test runner has to opt into the automatic runtime explicitly or every
  // render() fails with "React is not defined".
  esbuild: { jsx: 'automatic' },
});
