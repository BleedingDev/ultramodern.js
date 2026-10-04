import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertReactBaselineReport,
  readReactBaselineReport,
} from './react-baseline-candidate.mjs';
import { REACT_BASELINE_SUITES } from './react-baseline-staging.mjs';

const version = '0.11.12';
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
