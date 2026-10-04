import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertReactBaselineReport,
  readReactBaselineReport,
} from './react-baseline-candidate.mjs';
import {
  createReactBaselineBuildToolDependencies,
  REACT_BASELINE_SUITES,
  trackedReactBaselineInputFiles,
} from './react-baseline-staging.mjs';

const version = '0.11.12';
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
function originalRscAuthority() {
  return {
    release: {
      packages: [
        {
          sourceName: '@modern-js/builder',
          targetName: '@bleedingdev/modern-js-builder',
          packageJson: {
            name: '@bleedingdev/modern-js-builder',
            devDependencies: {
              'rsbuild-plugin-rsc': '0.1.1',
              'react-server-dom-rspack': '0.1.0',
            },
            peerDependencies: {
              'rsbuild-plugin-rsc': '0.1.1',
              'react-server-dom-rspack': '0.1.0',
            },
            peerDependenciesMeta: {
              'rsbuild-plugin-rsc': { optional: true },
              'react-server-dom-rspack': { optional: true },
            },
          },
        },
      ],
    },
    fixture: {
      name: '@integration-test/routes-tanstack-rsc',
      dependencies: { 'react-server-dom-rspack': '0.1.0' },
    },
  };
}
function nativeReport() {
  const tests = REACT_BASELINE_SUITES.flatMap((testPath, suite) =>
    Array.from({ length: [9, 2, 1, 5][suite] }, (_, index) => ({
      testPath,
      status: 'pass',
      fullName: `original suite ${suite} case ${index}`,
    })),
  );
  return {
    tool: 'rstest',
    version,
    status: 'pass',
    summary: {
      testFiles: 4,
      failedFiles: 0,
      tests: 17,
      failedTests: 0,
      passedTests: 17,
      skippedTests: 0,
      todoTests: 0,
    },
    files: REACT_BASELINE_SUITES.map(testPath => ({
      testPath,
      status: 'pass',
      results: tests.filter(result => result.testPath === testPath),
    })),
    tests,
  };
}

test('restores only the original builder RSC test tool while preserving fixture and optional SDK contracts', () => {
  const { release, fixture } = originalRscAuthority();
  const original = JSON.stringify({ release, fixture });
  assert.deepEqual(createReactBaselineBuildToolDependencies(release, fixture), {
    'rsbuild-plugin-rsc': '0.1.1',
  });
  assert.equal(JSON.stringify({ release, fixture }), original);
});

test('RSC test transport rejects absent, ranged or mismatched builder tool declarations', () => {
  for (const change of [
    metadata => {
      delete metadata.devDependencies['rsbuild-plugin-rsc'];
    },
    metadata => {
      metadata.devDependencies['rsbuild-plugin-rsc'] = '^0.1.1';
    },
    metadata => {
      metadata.peerDependencies['rsbuild-plugin-rsc'] = '0.1.2';
    },
  ]) {
    const { release, fixture } = originalRscAuthority();
    change(release.packages[0].packageJson);
    assert.throws(
      () => createReactBaselineBuildToolDependencies(release, fixture),
      /exact version|versions must agree/u,
    );
  }
});

test('RSC test transport rejects foreign owners and an incompatible original fixture runtime', () => {
  const foreign = originalRscAuthority();
  foreign.release.packages[0].packageJson.name = 'foreign-builder';
  assert.throws(
    () =>
      createReactBaselineBuildToolDependencies(
        foreign.release,
        foreign.fixture,
      ),
    /accepted builder tarball/u,
  );
  const incompatible = originalRscAuthority();
  incompatible.fixture.dependencies['react-server-dom-rspack'] = '0.2.0';
  assert.throws(
    () =>
      createReactBaselineBuildToolDependencies(
        incompatible.release,
        incompatible.fixture,
      ),
    /runtime must match/u,
  );
});

test('RSC test transport cannot turn optional peers into native runtime dependencies', () => {
  for (const name of ['rsbuild-plugin-rsc', 'react-server-dom-rspack']) {
    const required = originalRscAuthority();
    required.release.packages[0].packageJson.peerDependenciesMeta[
      name
    ].optional = false;
    assert.throws(
      () =>
        createReactBaselineBuildToolDependencies(
          required.release,
          required.fixture,
        ),
      /must remain an optional peer/u,
    );
    const implicit = originalRscAuthority();
    implicit.release.packages[0].packageJson.dependencies = { [name]: '0.1.1' };
    assert.throws(
      () =>
        createReactBaselineBuildToolDependencies(
          implicit.release,
          implicit.fixture,
        ),
      /must remain opt-in/u,
    );
  }
});

test('admits the original tracked streaming dynamic route as a literal Git path', () => {
  const route =
    'tests/integration/ssr/fixtures/streaming/src/routes/user/[id]/page.loader.ts';
  assert.deepEqual(trackedReactBaselineInputFiles(repoRoot, [route]), [route]);
  assert.throws(
    () =>
      trackedReactBaselineInputFiles(repoRoot, [route.replace('[id]', '*')]),
    /has no tracked files/u,
  );
});

test('rejects traversal, absolute paths, NUL, newlines and generated input trees', () => {
  for (const input of [
    '../fixture.ts',
    'tests/../fixture.ts',
    '/tmp/fixture.ts',
    'tests//fixture.ts',
    'tests/./fixture.ts',
    'tests\\fixture.ts',
    'tests/fixture\0.ts',
    'tests/fixture\n.ts',
    'tests/fixture\r.ts',
    ':(glob)tests/*',
    'tests/node_modules/fixture.ts',
    'tests/build/fixture.ts',
  ]) {
    assert.throws(
      () => trackedReactBaselineInputFiles(repoRoot, [input]),
      /Invalid tracked React baseline input|dependency or build output/u,
    );
  }
});

test('requires all four native files with the original 9+2+1+5 case counts', () => {
  const report = nativeReport();
  assert.equal(assertReactBaselineReport(report, version), report.summary);
});

test('public-package 8 pass and 9 skip outcome cannot produce a success receipt', () => {
  const report = nativeReport();
  report.summary.passedTests = 8;
  report.summary.skippedTests = 9;
  report.tests.slice(0, 9).forEach(result => {
    result.status = 'skip';
  });
  assert.throws(
    () => assertReactBaselineReport(report, version),
    /17 actual passes and zero skips/u,
  );
});

test('an aggregate pass count cannot hide a skipped native case', () => {
  const report = nativeReport();
  report.tests[0].status = 'skip';
  assert.throws(
    () => assertReactBaselineReport(report, version),
    /did not run successfully/u,
  );
});

test('foreign files cannot replace an original suite', () => {
  const report = nativeReport();
  report.files[0].testPath = 'integration/substitute.test.ts';
  assert.throws(
    () => assertReactBaselineReport(report, version),
    /Missing or duplicate original suite/u,
  );
});

test('duplicated native cases cannot replace an original case', () => {
  const report = nativeReport();
  report.tests[1].fullName = report.tests[0].fullName;
  assert.throws(
    () => assertReactBaselineReport(report, version),
    /Duplicate original test record/u,
  );
});

test('unhandled native runner errors invalidate otherwise passing test records', () => {
  const report = nativeReport();
  report.unhandledErrors = [{ message: 'compiler close failed' }];
  assert.throws(
    () => assertReactBaselineReport(report, version),
    /unhandled errors/u,
  );
});

test('reads the native JSON reporter after real build output and quoted braces', () => {
  const report = nativeReport();
  report.tests[0].fullName += ' {"quoted": "\\"}"}';
  const bytes = JSON.stringify(report, null, 2);
  const parsed = readReactBaselineReport(
    `build completed\n${bytes}\n`,
    version,
  );
  assert.deepEqual(parsed.report, report);
  assert.equal(parsed.bytes.toString(), `${bytes}\n`);
});

test('missing, duplicate, truncated and wrong-version native reports reject', () => {
  const bytes = JSON.stringify(nativeReport());
  assert.throws(
    () => readReactBaselineReport('17 tests passed', version),
    /exactly one native/u,
  );
  assert.throws(
    () => readReactBaselineReport(`${bytes}\n${bytes}`, version),
    /exactly one native/u,
  );
  assert.throws(
    () => readReactBaselineReport(bytes.slice(0, -1), version),
    /truncated/u,
  );
  assert.throws(
    () => readReactBaselineReport(bytes, '0.11.11'),
    /version differs/u,
  );
});
