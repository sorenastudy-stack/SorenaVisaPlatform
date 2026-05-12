import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  rootDir: './src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
};

export default config;
