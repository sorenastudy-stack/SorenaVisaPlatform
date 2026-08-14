import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  rootDir: './src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },

  // PR-TEST-ISOLATION — one Postgres schema per worker.
  //
  // The suite shared one database across 19 workers, so any test asserting on an
  // unfiltered query ("OWNER sees every lead", "total commissions earned") was
  // reading rows other workers were concurrently creating and deleting. That
  // produced both hard failures ("Field contact is required to return data, got
  // null") and drifting aggregates, in a set that changed from run to run.
  //
  // setupFiles, NOT setupFilesAfterEnv: specs construct a PrismaClient at module
  // load and the client reads DATABASE_URL at construction. Rewriting it any
  // later leaves already-imported clients on the shared database — the very bug
  // this removes, reintroduced silently.
  globalSetup: '<rootDir>/../test/global-setup.ts',
  globalTeardown: '<rootDir>/../test/global-teardown.ts',
  setupFiles: ['<rootDir>/../test/set-worker-schema.ts'],
};

export default config;
