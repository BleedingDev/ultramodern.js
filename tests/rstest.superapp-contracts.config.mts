import { withTestPreset } from '@scripts/rstest-config';

export default withTestPreset({
  root: __dirname,
  testEnvironment: 'node',
  globals: true,
  include: [
    'integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts',
    'integration/routes-tanstack-create-routes/tests/create-routes-contract.test.ts',
    'integration/superapp-portfolio/tests/index.test.ts',
  ],
  testTimeout: 1000 * 60 * 5,
  hookTimeout: 1000 * 60 * 5,
});
