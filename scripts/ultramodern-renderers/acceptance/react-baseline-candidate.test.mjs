import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertReactBaselineReport,
  readReactBaselineReport,
  readReactMfDiagnosticReport,
  selectReactBaselineRun,
} from './react-baseline-candidate.mjs';
import {
  assertReactBaselineDataLoaderPackageCurrent,
  assertReactBaselineInputsUnchanged,
  auditReactBaselineConsumerOutputs,
  createReactBaselineBuildToolDependencies,
  createReactBaselineRootDeclarationDependencies,
  materializeReactBaselineDataLoaderPackage,
  REACT_BASELINE_SUITES,
  trackedReactBaselineInputFiles,
} from './react-baseline-staging.mjs';

const version = '0.11.12';
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const routerMirror =
  'tests/integration/routes-tanstack-mf/mf-host/src/modern-tanstack/index/router.gen.ts';
const authoredRoute =
  'tests/integration/routes-tanstack-mf/mf-host/src/routes/page.tsx';
const undeclaredGenerated =
  'tests/integration/routes-tanstack-mf/mf-host/src/undeclared.gen.ts';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function prerequisiteFixture(t) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'react-baseline-public-members-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const consumerRoot = path.join(root, 'consumer');
  fs.mkdirSync(consumerRoot);
  // These bytes exercise transport only; they claim no package/compiler qualification.
  const fileContents = new Map([
    ['package.json', Buffer.from('{"name":"@candidate/plugin-data-loader"}\n')],
    [
      'dist/esm/runtime/index.mjs',
      Buffer.from('export const runtime = true;\n'),
    ],
    [
      'dist/types/runtime/index.d.ts',
      Buffer.from('export declare const runtime: true;\n'),
    ],
    ['src/runtime/index.ts', Buffer.from('export const runtime = true;\n')],
    ['bin/public.js', Buffer.from('#!/usr/bin/env node\n')],
  ]);
  const inspection = {
    fileContents,
    files: [...fileContents].map(([memberPath, bytes]) => ({
      path: memberPath,
      size: bytes.length,
      mode: memberPath.startsWith('bin/') ? 0o755 : 0o644,
    })),
  };
  return { root, consumerRoot, inspection };
}

function consumerAuditFixture(t) {
  const { root, consumerRoot } = prerequisiteFixture(t);
  const sourceRoot = path.join(root, 'source');
  const files = [
    [routerMirror, fs.readFileSync(path.join(repoRoot, routerMirror))],
    [authoredRoute, fs.readFileSync(path.join(repoRoot, authoredRoute))],
    [undeclaredGenerated, Buffer.from('export const authored = true;\n')],
  ];
  for (const directory of [sourceRoot, consumerRoot]) {
    for (const [relativePath, bytes] of files) {
      const file = path.join(directory, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
    }
  }
  return {
    root,
    sourceRoot,
    stage: {
      workDir: consumerRoot,
      inputFiles: files.map(([relativePath, bytes]) => ({
        relativePath,
        sha256: digest(bytes),
      })),
    },
  };
}

test('records the exact native TanStack mirror after regeneration while initial and source bytes stay strict', t => {
  const { sourceRoot, stage } = consumerAuditFixture(t);
  assertReactBaselineInputsUnchanged(stage);
  const initial = auditReactBaselineConsumerOutputs(stage);
  assert.equal(initial.length, 1);
  assert.equal(initial[0].sha256, initial[0].originalSha256);
  // Transport control only; actual native generation is exercised by MF acceptance.
  const generated = Buffer.from('export const nativeRouter = "regenerated";\n');
  fs.writeFileSync(path.join(stage.workDir, routerMirror), generated);
  const outputs = auditReactBaselineConsumerOutputs(stage);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].relativePath, routerMirror);
  assert.equal(outputs[0].producer, '@modern-js/plugin-tanstack');
  assert.equal(
    outputs[0].implementation,
    'packages/runtime/plugin-tanstack/src/cli/artifacts.ts',
  );
  assert.equal(outputs[0].originalSha256, initial[0].sha256);
  assert.equal(outputs[0].sha256, digest(generated));
  assert.equal(outputs[0].size, generated.length);
  assert.throws(
    () => assertReactBaselineInputsUnchanged(stage),
    /input changed/u,
  );
  assertReactBaselineInputsUnchanged(stage, sourceRoot);
  fs.writeFileSync(path.join(sourceRoot, routerMirror), generated);
  assert.throws(
    () => assertReactBaselineInputsUnchanged(stage, sourceRoot),
    /input changed/u,
  );
});

test('consumer audit rejects authored changes and undeclared generated-looking files', t => {
  for (const relativePath of [authoredRoute, undeclaredGenerated]) {
    const { stage } = consumerAuditFixture(t);
    fs.writeFileSync(path.join(stage.workDir, relativePath), 'changed bytes\n');
    assert.throws(
      () => auditReactBaselineConsumerOutputs(stage),
      /input changed/u,
    );
  }
});

test('native router output rejects linked files, linked parents and empty bytes', t => {
  for (const replacement of ['file-link', 'parent-link', 'empty']) {
    const { root, stage } = consumerAuditFixture(t);
    const file = path.join(stage.workDir, routerMirror);
    if (replacement === 'empty') {
      fs.writeFileSync(file, '');
    } else if (replacement === 'file-link') {
      const outside = path.join(root, 'outside.ts');
      fs.writeFileSync(outside, 'export const router = true;\n');
      fs.unlinkSync(file);
      fs.symlinkSync(outside, file);
    } else {
      const directory = path.dirname(file);
      const outside = path.join(root, 'outside');
      fs.renameSync(directory, outside);
      fs.symlinkSync(outside, directory, 'dir');
    }
    assert.throws(
      () => auditReactBaselineConsumerOutputs(stage),
      /Expected ordinary input file|Expected ordinary input directory|must be nonempty/u,
    );
  }
});

test('materializes every public data-loader member as exact physical files in the original layout', t => {
  const { consumerRoot, inspection } = prerequisiteFixture(t);
  const materialization = materializeReactBaselineDataLoaderPackage({
    consumerRoot,
    inspection,
  });
  assert.equal(
    materialization.path,
    path.join(consumerRoot, 'packages/cli/plugin-data-loader'),
  );
  for (const directory of [
    'packages',
    'packages/cli',
    materialization.relativeDirectory,
  ]) {
    assert.ok(fs.lstatSync(path.join(consumerRoot, directory)).isDirectory());
  }
  assert.equal(materialization.files.length, inspection.fileContents.size);
  for (const [relativePath, bytes] of inspection.fileContents) {
    const file = path.join(materialization.path, relativePath);
    assert.ok(fs.lstatSync(file).isFile());
    assert.equal(fs.realpathSync(file), file);
    assert.ok(fs.readFileSync(file).equals(bytes));
  }
  assertReactBaselineDataLoaderPackageCurrent(materialization);
  assert.throws(
    () =>
      materializeReactBaselineDataLoaderPackage({ consumerRoot, inspection }),
    /must be fresh/u,
  );
});

test('data-loader materialization rejects linked parents and an existing linked destination before outside writes', t => {
  for (const linkedPath of ['packages', 'packages/cli/plugin-data-loader']) {
    const { root, consumerRoot, inspection } = prerequisiteFixture(t);
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    const destination = path.join(consumerRoot, linkedPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(outside, destination, 'dir');
    assert.throws(
      () =>
        materializeReactBaselineDataLoaderPackage({ consumerRoot, inspection }),
      /ordinary data-loader directory|must be fresh/u,
    );
    assert.deepEqual(fs.readdirSync(outside), []);
  }
});

test('data-loader receipt validation rejects changed public bytes and replacement links', t => {
  const { root, consumerRoot, inspection } = prerequisiteFixture(t);
  const materialization = materializeReactBaselineDataLoaderPackage({
    consumerRoot,
    inspection,
  });
  const relativePath = 'dist/esm/runtime/index.mjs';
  const runtime = path.join(materialization.path, relativePath);
  fs.writeFileSync(runtime, 'foreign runtime\n');
  assert.throws(
    () => assertReactBaselineDataLoaderPackageCurrent(materialization),
    /Public data-loader bytes changed/u,
  );
  fs.writeFileSync(runtime, inspection.fileContents.get(relativePath));
  const outside = path.join(root, 'foreign-runtime.mjs');
  fs.writeFileSync(outside, inspection.fileContents.get(relativePath));
  fs.unlinkSync(runtime);
  fs.symlinkSync(outside, runtime);
  assert.throws(
    () => assertReactBaselineDataLoaderPackageCurrent(materialization),
    /Expected ordinary data-loader file/u,
  );
});

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

test('restores only the original monorepo root React declaration context without changing declarations', () => {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  );
  const original = JSON.stringify(rootPackage);
  assert.deepEqual(
    createReactBaselineRootDeclarationDependencies(rootPackage),
    {
      '@types/react': rootPackage.devDependencies['@types/react'],
      '@types/react-dom': rootPackage.devDependencies['@types/react-dom'],
    },
  );
  assert.equal(JSON.stringify(rootPackage), original);
  const testsPackage = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'tests/package.json'), 'utf8'),
  );
  assert.throws(
    () => createReactBaselineRootDeclarationDependencies(testsPackage),
    /original monorepo root/u,
  );
});

test('React declaration context rejects absent or aliased original root type declarations', () => {
  const original = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  );
  for (const name of ['@types/react', '@types/react-dom']) {
    for (const specification of [undefined, 'npm:foreign-types@19.3.0']) {
      const rootPackage = structuredClone(original);
      rootPackage.devDependencies[name] = specification;
      assert.throws(
        () => createReactBaselineRootDeclarationDependencies(rootPackage),
        /must declare a direct React type version/u,
      );
    }
  }
});

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

function nativeMfReport() {
  const report = nativeReport();
  report.files = [report.files[0]];
  report.tests = report.files[0].results;
  report.summary.testFiles = 1;
  report.summary.tests = 9;
  report.summary.passedTests = 9;
  return report;
}

test('MF9 selection preserves default all17 and rejects qualification receipt usage', () => {
  const baseline = selectReactBaselineRun({ receipt: '/owned/receipt.json' });
  assert.equal(baseline.diagnostic, false);
  assert.equal(baseline.commandName, 'react17');
  assert.equal(baseline.suites, REACT_BASELINE_SUITES);
  const diagnostic = selectReactBaselineRun({ diagnostic: 'mf9' });
  assert.equal(diagnostic.diagnostic, true);
  assert.equal(diagnostic.commandName, 'mf9');
  assert.deepEqual(diagnostic.suites, [REACT_BASELINE_SUITES[0]]);
  assert.throws(
    () =>
      selectReactBaselineRun({
        diagnostic: 'mf9',
        receipt: '/owned/receipt.json',
      }),
    /cannot write a baseline receipt/u,
  );
  assert.throws(
    () => selectReactBaselineRun({ diagnostic: 'substitute' }),
    /only supported diagnostic profile/u,
  );
});

test('genuine-shaped MF9 results remain diagnostic and cannot qualify all17', () => {
  const report = nativeMfReport();
  const stdout = `native build output\n${JSON.stringify(report)}\n`;
  assert.deepEqual(readReactMfDiagnosticReport(stdout, version).report, report);
  assert.throws(
    () => readReactBaselineReport(stdout, version),
    /17 actual passes and zero skips/u,
  );
  assert.throws(
    () => readReactMfDiagnosticReport(JSON.stringify(nativeReport()), version),
    /exactly its original test file/u,
  );
  report.files[0].testPath = 'integration/substitute.test.ts';
  assert.throws(
    () => readReactMfDiagnosticReport(JSON.stringify(report), version),
    /foreign file/u,
  );
});

test('MF9 diagnostics retain real failed setup and skips without calling them a pass', () => {
  const report = nativeMfReport();
  report.status = 'fail';
  report.files[0].status = 'fail';
  report.files[0].errors = [
    { message: 'Native build inputs changed (buildMarker)' },
  ];
  report.tests.slice(0, 8).forEach(record => {
    record.status = 'skip';
  });
  Object.assign(report.summary, {
    failedFiles: 1,
    passedTests: 1,
    skippedTests: 8,
  });
  report.unhandledErrors = [{ message: 'actual late compiler error' }];
  const parsed = readReactMfDiagnosticReport(JSON.stringify(report), version);
  assert.deepEqual(parsed.report, report);
  assert.equal(parsed.report.summary.skippedTests, 8);
  assert.equal(parsed.report.unhandledErrors.length, 1);
  report.status = 'pass';
  assert.throws(
    () => readReactMfDiagnosticReport(JSON.stringify(report), version),
    /file did not pass/u,
  );
});

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
