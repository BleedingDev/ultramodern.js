module.exports = {
  collectCoverage: false,
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/integration/routes-tanstack/tests/**/*.test.ts',
    '<rootDir>/integration/routes-tanstack-mf/tests/**/*.test.ts',
    '<rootDir>/integration/routes-tanstack-create-routes/tests/**/*.test.ts',
    '<rootDir>/integration/bff-runtime-parity/tests/**/*.test.ts',
  ],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {
    '^.+.tsx?$': 'ts-jest',
  },
};
