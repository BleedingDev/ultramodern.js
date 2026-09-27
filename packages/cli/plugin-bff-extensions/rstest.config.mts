import { withTestPreset } from '@scripts/rstest-config';

export default withTestPreset({
  root: __dirname,
  testEnvironment: 'node',
  globals: true,
  output: {
    // Load the Effect BFF runtime as the server does: one installed copy that
    // the lambdas under test import too.
    externals: [/^@modern-js\/bff-effect(?:\/|$)/],
  },
});
