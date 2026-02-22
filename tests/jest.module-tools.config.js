module.exports = {
  collectCoverage: false,
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/integration/module/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/api-service-koa/api/',
    '/api-service-koa/dist',
    '/api/tests',
  ],
  transform: {
    '^.+.tsx?$': 'ts-jest',
  },
};
