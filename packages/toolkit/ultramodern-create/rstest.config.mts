import { withTestPreset } from '@scripts/rstest-config';

export default withTestPreset({
  root: __dirname,
  testEnvironment: 'node',
  globals: true,
  // Most tests generate a whole workspace on disk; on Windows runners that
  // alone takes 15-40s, so the shared 30s default fails them at random.
  testTimeout: 120_000,
  hookTimeout: 120_000,
});
