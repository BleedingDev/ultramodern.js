import { withTestPreset } from '@scripts/rstest-config';

// NOTE: this config's `include` glob matches the fork-owned guards under
// tests/utils/*.test.ts, which assert published package surfaces rather than
// package sources. The shared rstest preset sets passWithNoTests:false, and
// the "test:utils" script (tests/package.json, reached via the "test" chain)
// plus the "Test - Published package surfaces" CI step
// (.github/workflows/integration-test.yml) do not override it. If the
// last file is ever removed, retire this config + the "test:utils" script +
// the CI step together so the glob is never left empty.
export default withTestPreset({
  root: __dirname,
  include: ['utils/*.test.ts'],
  testEnvironment: 'node',
  globals: true,
});
