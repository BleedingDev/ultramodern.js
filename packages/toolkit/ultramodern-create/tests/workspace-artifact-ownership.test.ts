import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createVerticalDescriptor,
  shellApp,
} from '../src/ultramodern-workspace/descriptors';
import * as fileIO from '../src/ultramodern-workspace/fs-io';
import { formatGeneratedSourceCandidates } from '../src/ultramodern-workspace/fs-io';
import {
  createCanonicalWorkspaceArtifactFormatter,
  preserveConsumerWorkspaceArtifacts,
  workspaceArtifactCandidates,
} from '../src/ultramodern-workspace/workspace-artifact-ownership';

test('workspace ownership excludes application configs from every topology projection', () => {
  const catalog = createVerticalDescriptor('catalog', 3101);
  const orders = createVerticalDescriptor('orders', 3102);
  const apps = [{ ...shellApp, verticalRefs: ['catalog'] }, catalog];
  const alternateApps = [
    { ...shellApp, verticalRefs: ['catalog', 'orders'] },
    {
      ...shellApp,
      id: 'shell-admin',
      directory: 'apps/shell-admin',
      packageSuffix: 'shell-admin',
      mfName: 'shellAdmin',
      port: 3121,
      verticalRefs: ['orders'],
    },
    catalog,
    orders,
  ];

  const paths = workspaceArtifactCandidates(
    'workspace',
    apps,
    alternateApps,
  ).map(candidate => candidate.relativePath);

  assert.deepEqual(
    paths.filter(relativePath => relativePath.endsWith('/modern.config.ts')),
    [],
    'pristine and authored app configs are both outside generator ownership',
  );
  assert.ok(paths.includes('tsconfig.json'));
  assert.ok(paths.includes('zerops.yaml'));
  assert.ok(paths.some(relativePath => relativePath.startsWith('scripts/')));
});

test('an operation seed reuses generated evidence but never admits future candidates or stale consumer bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-artifact-operation-'));
  try {
    const relativePath = 'generated.ts';
    const before = 'export const port = {value: 3000};\n';
    const next = before.replace('3000', '3001');
    const [formattedBefore, formattedNext] = formatGeneratedSourceCandidates([
      [relativePath, before],
      ['future.ts', next],
    ]);
    const filename = path.join(root, relativePath);
    fs.writeFileSync(filename, formattedBefore!);
    const previousCandidates = [{ relativePath, content: before }];
    const seedCandidates = [
      ...previousCandidates,
      { relativePath, content: next },
    ];
    const format = rstest.spyOn(fileIO, 'formatGeneratedSourceCandidates');
    const formatter = createCanonicalWorkspaceArtifactFormatter(seedCandidates);
    const first = preserveConsumerWorkspaceArtifacts(
      root,
      previousCandidates,
      formatter,
    );
    assert.equal(first.io.write(filename, before), false);
    assert.equal(first.io.write(filename, next), true);
    assert.equal(fs.readFileSync(filename, 'utf8'), next);
    assert.equal(format.mock.calls.length, 1);

    // This matches a seeded future candidate, but the root still admits
    // only the previous topology. A fresh check must preserve these bytes.
    fs.writeFileSync(filename, formattedNext!);
    const second = preserveConsumerWorkspaceArtifacts(
      root,
      previousCandidates,
      formatter,
    );
    assert.deepEqual([...second.preservedPaths], [relativePath]);
    assert.equal(second.io.write(filename, before), false);
    assert.equal(fs.readFileSync(filename, 'utf8'), formattedNext);
    assert.equal(format.mock.calls.length, 2);

    createCanonicalWorkspaceArtifactFormatter(seedCandidates);
    assert.equal(
      format.mock.calls.length,
      3,
      'a later operation performs its own canonical formatting',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a seeded generated-data comparison still writes complete changed source bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-artifact-data-seed-'));
  try {
    const relativePath = 'check.mts';
    const filename = path.join(root, relativePath);
    const before =
      "const contract = {version: 'old'};\nconsole.log(contract);\n";
    const next = before.replace("'old'", "'new'");
    const candidates = [before, next].map(content => ({
      relativePath,
      content,
      generatedDataBinding: 'contract',
    }));
    const [formattedBefore] = formatGeneratedSourceCandidates([
      [relativePath, before],
    ]);
    fs.writeFileSync(filename, formattedBefore!);
    const formatter = createCanonicalWorkspaceArtifactFormatter(candidates);
    const guarded = preserveConsumerWorkspaceArtifacts(
      root,
      candidates,
      formatter,
    );
    assert.deepEqual([...guarded.canonicalGeneratedPaths], [relativePath]);
    assert.equal(guarded.io.write(filename, next), true);
    assert.equal(fs.readFileSync(filename, 'utf8'), next);

    const authored = `${next}console.log('consumer policy');\n`;
    fs.writeFileSync(filename, authored);
    const fresh = preserveConsumerWorkspaceArtifacts(
      root,
      candidates,
      formatter,
    );
    assert.deepEqual([...fresh.preservedPaths], [relativePath]);
    assert.equal(fresh.io.write(filename, before), false);
    assert.equal(fs.readFileSync(filename, 'utf8'), authored);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('seeded comparisons retain duplicate-path recognition and malformed-neighbor fallback', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-artifact-seed-fallback-'),
  );
  try {
    const generated = 'export const port = {value: 3000};\n';
    const wrong = generated.replace('3000', '4000');
    const malformed = 'invalid consumer source {';
    const equivalent = 'export const port={ value:3000 };\n';
    fs.writeFileSync(path.join(root, 'invalid.ts'), malformed);
    fs.writeFileSync(path.join(root, 'valid.ts'), equivalent);
    const candidates = [
      { relativePath: 'invalid.ts', content: generated },
      { relativePath: 'valid.ts', content: wrong },
      { relativePath: 'valid.ts', content: generated },
    ];
    const guarded = preserveConsumerWorkspaceArtifacts(
      root,
      candidates,
      createCanonicalWorkspaceArtifactFormatter(candidates),
    );
    assert.deepEqual([...guarded.preservedPaths], ['invalid.ts']);
    assert.deepEqual([...guarded.canonicalGeneratedPaths], ['valid.ts']);
    assert.equal(
      guarded.io.write(path.join(root, 'invalid.ts'), generated),
      false,
    );
    assert.equal(
      guarded.io.write(path.join(root, 'valid.ts'), generated),
      false,
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'invalid.ts'), 'utf8'),
      malformed,
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'valid.ts'), 'utf8'),
      equivalent,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unused invalid seed sources defer failure until the source is actually requested', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-artifact-seed-error-'),
  );
  try {
    const valid = {
      relativePath: 'valid.ts',
      content: 'export const value = 1;\n',
    };
    const invalid = {
      relativePath: 'future.ts',
      content: 'export const invalid = {',
    };
    const formatter = createCanonicalWorkspaceArtifactFormatter([
      valid,
      invalid,
    ]);
    fs.writeFileSync(path.join(root, valid.relativePath), valid.content);
    const guarded = preserveConsumerWorkspaceArtifacts(
      root,
      [valid],
      formatter,
    );
    assert.deepEqual([...guarded.canonicalGeneratedPaths], ['valid.ts']);
    assert.throws(
      () => preserveConsumerWorkspaceArtifacts(root, [invalid], formatter),
      /Failed to format generated UltraModern workspace output/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pre-install canonical refreshes preserve config bytes and permit changed JSON artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-artifact-noop-'));
  try {
    const relativePath = 'modern.config.ts';
    const filePath = path.join(root, relativePath);
    fs.writeFileSync(
      path.join(root, 'oxfmt.config.ts'),
      "import { defineConfig } from 'oxfmt';\nexport default defineConfig({});\n",
    );
    const generated =
      'export default {renderer: "solid", server: {port: 3000, ssr: true}};\n';
    const [formatted] = formatGeneratedSourceCandidates([
      [relativePath, generated],
    ]);
    assert.notEqual(formatted, generated);
    fs.writeFileSync(filePath, formatted!);
    const jsonPath = path.join(root, 'tsconfig.json');
    const previousJson = '{"files":["src/main.ts"]}\n';
    fs.writeFileSync(jsonPath, previousJson);
    const guarded = preserveConsumerWorkspaceArtifacts(root, [
      { relativePath, content: generated },
      { relativePath: 'tsconfig.json', content: previousJson },
    ]);
    assert.equal(guarded.io.write(filePath, generated), false);
    assert.equal(fs.readFileSync(filePath, 'utf8'), formatted);
    const changed = generated.replace('3000', '3001');
    assert.equal(guarded.io.write(filePath, changed), true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), changed);
    const nextJson = '{"files":["src/main.ts","src/api/clients.ts"]}\n';
    assert.equal(guarded.io.write(jsonPath, nextJson), true);
    assert.equal(fs.readFileSync(jsonPath, 'utf8'), nextJson);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generated contract data can refresh without treating authored behavior as generated', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-artifact-ownership-'));
  try {
    const relativePath = 'scripts/check.mts';
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath));
    const canonical =
      "const workspaceValidationContract = {version: 'new'};\nconsole.log(workspaceValidationContract);\n";
    const variants = [
      { source: canonical.replace("'new'", "'old'"), protected: false },
      {
        source: `${canonical}console.log('consumer authorization');\n`,
        protected: true,
      },
      {
        source: canonical.replace("'new'", 'getConsumerPolicy()'),
        protected: true,
      },
      {
        source: canonical.replace("{version: 'new'}", '{...consumerPolicy}'),
        protected: true,
      },
      { source: 'invalid consumer source {', protected: true },
    ];
    for (const variant of variants) {
      fs.writeFileSync(filePath, variant.source);
      const guarded = preserveConsumerWorkspaceArtifacts(root, [
        {
          relativePath,
          content: canonical,
          generatedDataBinding: 'workspaceValidationContract',
        },
      ]);
      assert.equal(guarded.preservedPaths.has(relativePath), variant.protected);
      guarded.io.write(filePath, canonical);
      assert.equal(
        fs.readFileSync(filePath, 'utf8'),
        variant.protected ? variant.source : canonical,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ownership batches duplicate candidates and reuses exact sources while checking current bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-artifact-batch-'));
  try {
    const before = 'export const port = {value: 3000};\n';
    const next = before.replace('3000', '3001');
    const [formattedBefore, formattedNext] = formatGeneratedSourceCandidates([
      ['first.ts', before],
      ['second.ts', next],
    ]);
    fs.writeFileSync(path.join(root, 'first.ts'), formattedBefore!);
    fs.writeFileSync(path.join(root, 'second.ts'), formattedNext!);
    const format = rstest.spyOn(fileIO, 'formatGeneratedSourceCandidates');
    const candidates = ['first.ts', 'second.ts'].flatMap(relativePath => [
      { relativePath, content: before },
      { relativePath, content: next },
    ]);
    const guarded = preserveConsumerWorkspaceArtifacts(root, candidates);
    assert.deepEqual(
      [...guarded.canonicalGeneratedPaths],
      ['first.ts', 'second.ts'],
    );
    assert.equal(
      format.mock.calls.length,
      1,
      'a matching candidate for each duplicate path needs only canonical formatting',
    );
    assert.equal(guarded.io.write(path.join(root, 'first.ts'), before), false);
    assert.equal(guarded.io.write(path.join(root, 'second.ts'), next), false);
    assert.equal(
      format.mock.calls.length,
      1,
      'validated exact source bytes need no additional process',
    );

    const firstPath = path.join(root, 'first.ts');
    const changed = before.replace('3000', '4000');
    fs.writeFileSync(firstPath, changed);
    assert.equal(guarded.io.write(firstPath, next), true);
    assert.equal(fs.readFileSync(firstPath, 'utf8'), next);
    assert.equal(
      format.mock.calls.length,
      2,
      'a changed current source is formatted again',
    );
    assert.equal(guarded.io.write(firstPath, next), false);
    assert.equal(format.mock.calls.length, 2);
    preserveConsumerWorkspaceArtifacts(root, candidates);
    assert.equal(
      format.mock.calls.length,
      3,
      'formatter evidence is local to one ownership check',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate paths still format and preserve authored source when no candidate matches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-artifact-unmatched-'));
  try {
    const relativePath = 'generated.ts';
    const filename = path.join(root, relativePath);
    const before = 'export const port = {value: 3000};\n';
    const next = before.replace('3000', '3001');
    const authored = `${before}console.log('consumer policy');\n`;
    fs.writeFileSync(filename, authored);
    const format = rstest.spyOn(fileIO, 'formatGeneratedSourceCandidates');
    const guarded = preserveConsumerWorkspaceArtifacts(root, [
      { relativePath, content: before },
      { relativePath, content: next },
    ]);

    assert.deepEqual([...guarded.canonicalGeneratedPaths], []);
    assert.deepEqual([...guarded.preservedPaths], [relativePath]);
    assert.equal(
      format.mock.calls.length,
      2,
      'nonmatching duplicates still format canonical and consumer sources',
    );
    assert.deepEqual(format.mock.calls[1]?.[0], [[relativePath, authored]]);
    assert.equal(guarded.io.write(filename, before), false);
    assert.equal(guarded.io.write(filename, next), false);
    assert.equal(fs.readFileSync(filename, 'utf8'), authored);
    assert.equal(format.mock.calls.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a matching duplicate never hides a malformed canonical candidate', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-artifact-invalid-dup-'),
  );
  try {
    const relativePath = 'generated.ts';
    const filename = path.join(root, relativePath);
    const generated = 'export const value = 1;\n';
    fs.writeFileSync(filename, generated);

    assert.throws(
      () =>
        preserveConsumerWorkspaceArtifacts(root, [
          { relativePath, content: generated },
          { relativePath, content: 'export const value = {' },
        ]),
      /Failed to format generated UltraModern workspace output/u,
    );
    assert.equal(fs.readFileSync(filename, 'utf8'), generated);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a formatter failure protects only invalid authored sources in its batch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-artifact-invalid-'));
  try {
    const generated = 'export const port = {value: 3000};\n';
    const malformed = 'invalid consumer source {';
    const equivalent = 'export const port={ value:3000 };\n';
    fs.writeFileSync(path.join(root, 'invalid.ts'), malformed);
    fs.writeFileSync(path.join(root, 'valid.ts'), equivalent);
    const guarded = preserveConsumerWorkspaceArtifacts(root, [
      { relativePath: 'invalid.ts', content: generated },
      { relativePath: 'valid.ts', content: generated },
    ]);
    assert.deepEqual([...guarded.preservedPaths], ['invalid.ts']);
    assert.deepEqual([...guarded.canonicalGeneratedPaths], ['valid.ts']);
    assert.equal(
      guarded.io.write(path.join(root, 'invalid.ts'), generated),
      false,
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'invalid.ts'), 'utf8'),
      malformed,
    );
    assert.equal(
      guarded.io.write(path.join(root, 'valid.ts'), generated),
      false,
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'valid.ts'), 'utf8'),
      equivalent,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ownership rejects external symlinks before comparing or refreshing their source', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-artifact-link-'));
  const root = path.join(tempRoot, 'workspace');
  const external = path.join(tempRoot, 'external.ts');
  try {
    fs.mkdirSync(root);
    const generated = 'export const value = 1;\n';
    fs.writeFileSync(external, generated);
    fs.symlinkSync(external, path.join(root, 'linked.ts'));
    assert.throws(
      () =>
        preserveConsumerWorkspaceArtifacts(root, [
          { relativePath: 'linked.ts', content: generated },
        ]),
      /Refusing to inspect an artifact outside the workspace/u,
    );
    assert.equal(fs.readFileSync(external, 'utf8'), generated);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('ownership keeps consumer filename rules separate from canonical comparisons', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-artifact-ignore-'));
  try {
    const relativePath = 'repos/consumer.ts';
    const filename = path.join(root, relativePath);
    const generated = 'export const port = {value: 3000};\n';
    const authored = 'export const port={ value:3000 };\n';
    fs.mkdirSync(path.dirname(filename));
    fs.writeFileSync(filename, authored);
    const nativeFormat = fileIO.formatGeneratedSourceCandidates;
    rstest
      .spyOn(fileIO, 'formatGeneratedSourceCandidates')
      .mockImplementation(sources =>
        sources.map(([filename, source]) =>
          // Model a native rule that leaves this literal consumer path untouched.
          filename === relativePath
            ? source
            : nativeFormat([[filename, source]])[0]!,
        ),
      );
    const candidates = [{ relativePath, content: generated }];
    for (const formatter of [
      undefined,
      createCanonicalWorkspaceArtifactFormatter(candidates),
      createCanonicalWorkspaceArtifactFormatter([
        { relativePath: 'different.ts', content: generated },
      ]),
    ]) {
      const guarded = preserveConsumerWorkspaceArtifacts(
        root,
        candidates,
        formatter,
      );
      assert.deepEqual([...guarded.preservedPaths], [relativePath]);
      assert.equal(guarded.io.write(filename, generated), false);
      assert.equal(fs.readFileSync(filename, 'utf8'), authored);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
