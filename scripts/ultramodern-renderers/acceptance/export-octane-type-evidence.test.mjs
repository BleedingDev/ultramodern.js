import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  exportOctaneTypeEvidence,
  resolveCheckedReactPackage,
  validateOctaneToolingReceipt,
} from './export-octane-type-evidence.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'octane-evidence-export-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'owner.d.ts');
  const target = path.join(root, 'react.d.ts');
  const statement = "import type * as React from 'react';";
  fs.writeFileSync(
    source,
    `${statement}\nexport type Element = React.ReactNode;\n`,
  );
  fs.writeFileSync(target, 'export type ReactNode = string;\n');
  const paths = [source, target].sort();
  const files = paths.map(realpath => {
    const bytes = fs.readFileSync(realpath);
    return { realpath, size: bytes.length, sha256: sha256(bytes) };
  });
  const edge = {
    kind: 'Imported',
    specifier: 'react',
    from: source,
    to: target,
  };
  const graph = paths
    .map(file => [file, file === target ? [edge] : []])
    .sort(([left], [right]) => left.localeCompare(right));
  // These small files test receipt validation only. They do not qualify Octane,
  // and are never exported as the maintained runtime's declaration corpus.
  const receipt = {
    passed: true,
    strictTypeClosure: true,
    canonicalGeneratedCompilerFlags: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    noPropertyAccessFromIndexSignature: true,
    isolatedRouterTypes: true,
    nativeFormatting: true,
    concreteDeclarations: true,
    negativeAuthoredDiagnostics: true,
    reactRuntimeInstalled: false,
    nativeChecker: {
      compilerVersion: '7.0.2',
      program: {
        compilerVersion: '7.0.2',
        diagnostics: [],
        config: {
          compilerOptions: {
            strict: true,
            isolatedModules: true,
            verbatimModuleSyntax: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            noPropertyAccessFromIndexSignature: true,
            noImplicitOverride: true,
            noFallthroughCasesInSwitch: true,
            noImplicitReturns: true,
            skipLibCheck: false,
            types: [],
          },
          files: [source],
        },
        files,
      },
    },
    nativeTypeInterop: {
      schemaVersion: 1,
      blanketReactTypeException: false,
      nonNativeRuntime: false,
      skipLibCheck: false,
      types: [],
      foreignRendererTypes: [],
      foreignRendererAugmentations: [],
      incomingGraph: graph,
      incomingEdges: [
        {
          ...edge,
          line: 1,
          sourceStatement: statement,
          sourceStatementSha256: sha256(Buffer.from(`${statement}\n`)),
        },
      ],
      canonicalTypeProgramSha256: sha256(
        Buffer.from(`${JSON.stringify(paths)}\n`),
      ),
      canonicalIncomingGraphSha256: sha256(Buffer.from(JSON.stringify(graph))),
    },
  };
  return { root, source, target, receipt };
}

function isolatedReactTypesFixture(t) {
  const { root } = fixture(t);
  const consumerRoot = path.join(root, 'consumer');
  const nativeRoot = path.join(consumerRoot, 'node_modules', 'octane');
  const reactRoot = path.join(nativeRoot, 'node_modules', '@types', 'react');
  fs.mkdirSync(reactRoot, { recursive: true });
  fs.writeFileSync(
    path.join(consumerRoot, 'package.json'),
    JSON.stringify({ name: 'consumer', dependencies: { octane: '0.7.1' } }),
  );
  fs.writeFileSync(
    path.join(nativeRoot, 'package.json'),
    JSON.stringify({
      name: 'octane',
      dependencies: { '@types/react': '19.2.18' },
    }),
  );
  const manifestFile = path.join(reactRoot, 'package.json');
  fs.writeFileSync(
    manifestFile,
    JSON.stringify({ name: '@types/react', version: '19.2.18' }),
  );
  const index = path.join(reactRoot, 'index.d.ts');
  const bytes = Buffer.from('export type ReactNode = string;\n');
  fs.writeFileSync(index, bytes);
  return {
    consumerRoot,
    nativeRoot,
    reactRoot,
    manifestFile,
    index,
    files: new Map([[index, bytes]]),
    interop: {
      reactPackage: { name: '@types/react', version: '19.2.18' },
      reactFiles: [
        {
          packagePath: '@types/react/index.d.ts',
          realpath: index,
          size: bytes.length,
          sha256: sha256(bytes),
        },
      ],
    },
  };
}

test('finds the genuinely checked core-owned React types without a consumer dependency', t => {
  const installed = isolatedReactTypesFixture(t);
  assert.throws(
    () =>
      createRequire(path.join(installed.consumerRoot, 'package.json')).resolve(
        '@types/react/package.json',
      ),
    { code: 'MODULE_NOT_FOUND' },
  );
  assert.equal(
    createRequire(path.join(installed.nativeRoot, 'package.json')).resolve(
      '@types/react/package.json',
    ),
    installed.manifestFile,
  );
  const resolved = resolveCheckedReactPackage(installed);
  assert.equal(resolved.root, installed.reactRoot);
  assert.equal(resolved.manifestFile, installed.manifestFile);
  assert.deepEqual(resolved.manifest, installed.interop.reactPackage);
});

test('rejects a React package index that was not in the checked program', t => {
  const installed = isolatedReactTypesFixture(t);
  installed.files.clear();
  assert.throws(
    () => resolveCheckedReactPackage(installed),
    /actual checked file closure/,
  );
});

test('rejects changed core-owned React declaration bytes', t => {
  const installed = isolatedReactTypesFixture(t);
  fs.writeFileSync(installed.index, 'export type ReactNode = number;\n');
  assert.throws(
    () => resolveCheckedReactPackage(installed),
    /checked bytes changed/,
  );
});

for (const [field, value] of [
  ['name', '@types/another-renderer'],
  ['version', '19.2.19'],
]) {
  test(`rejects changed checked React package ${field}`, t => {
    const installed = isolatedReactTypesFixture(t);
    fs.writeFileSync(
      installed.manifestFile,
      JSON.stringify({ ...installed.interop.reactPackage, [field]: value }),
    );
    assert.throws(
      () => resolveCheckedReactPackage(installed),
      /Checked React declaration package/,
    );
  });
}

test('retains actual checked file bytes and the complete incoming graph', t => {
  const { receipt, source, target } = fixture(t);
  const validated = validateOctaneToolingReceipt(receipt);
  assert.deepEqual([...validated.files.keys()], [source, target].sort());
  assert.ok(validated.files.get(source).equals(fs.readFileSync(source)));
  assert.equal(validated.program.files.length, 2);
  assert.equal(validated.interop.incomingGraph.length, 2);
  assert.equal(
    validated.interop.incomingGraph.reduce(
      (count, [, edges]) => count + edges.length,
      0,
    ),
    1,
  );
});

for (const [label, mutate, expected] of [
  [
    'a failed owning probe',
    receipt => {
      receipt.passed = false;
    },
    /Successful tooling check required: passed/,
  ],
  [
    'a missing actual program',
    receipt => {
      delete receipt.nativeChecker.program;
    },
    /Actual checked program facts/,
  ],
  [
    'a TypeScript nightly',
    receipt => {
      receipt.nativeChecker.compilerVersion = '7.0.0-dev.20260707.2';
    },
    /Stable TypeScript 7\.0\.2/,
  ],
  [
    'an older checked compiler',
    receipt => {
      receipt.nativeChecker.program.compilerVersion = '5.9.3';
    },
    /Checked program must use stable TypeScript 7\.0\.2/,
  ],
  [
    'actual program errors',
    receipt => {
      receipt.nativeChecker.program.diagnostics = [{ code: 2322 }];
    },
    /Checked program diagnostics/,
  ],
  [
    'disabled declaration checking',
    receipt => {
      receipt.nativeChecker.program.config.compilerOptions.skipLibCheck = true;
    },
    /Declaration checking must remain enabled/,
  ],
  [
    'a missing actual graph',
    receipt => {
      delete receipt.nativeTypeInterop.incomingGraph;
    },
    /Actual checked incoming graph/,
  ],
  [
    'a graph omitting checked files',
    receipt => {
      receipt.nativeTypeInterop.incomingGraph.pop();
    },
    /complete checked file closure/,
  ],
  [
    'an incomplete boundary edge',
    receipt => {
      receipt.nativeTypeInterop.incomingEdges[0].to = '/not-checked.d.ts';
    },
    /tested source and target/,
  ],
  [
    'a source line that was not observed',
    receipt => {
      receipt.nativeTypeInterop.incomingEdges[0].line = 2;
    },
    /Checked boundary source statement changed/,
  ],
]) {
  test(`rejects ${label}`, t => {
    const { receipt } = fixture(t);
    mutate(receipt);
    assert.throws(() => validateOctaneToolingReceipt(receipt), expected);
  });
}

test('rejects changed checked declaration bytes without trusting receipt hashes', t => {
  const { receipt, target } = fixture(t);
  fs.writeFileSync(target, 'export type ReactNode = number;\n');
  assert.throws(
    () => validateOctaneToolingReceipt(receipt),
    /checked bytes changed/,
  );
});

test('rejects a boundary edge removed from the actual graph even with a new graph digest', t => {
  const { receipt, target } = fixture(t);
  const interop = receipt.nativeTypeInterop;
  interop.incomingGraph.find(([file]) => file === target)[1] = [];
  interop.canonicalIncomingGraphSha256 = sha256(
    Buffer.from(JSON.stringify(interop.incomingGraph)),
  );
  assert.throws(
    () => validateOctaneToolingReceipt(receipt),
    /absent from the actual incoming graph/,
  );
});

test('a failed receipt cannot create authority or corpus outputs', async t => {
  const { root } = fixture(t);
  const toolingEvidenceFile = path.join(root, 'tooling-evidence.json');
  fs.writeFileSync(
    toolingEvidenceFile,
    JSON.stringify({ passed: false, failure: 'Native compilation failed' }),
  );
  const evidenceOut = path.join(root, 'output', 'authority.json.txt');
  const corpusDir = path.join(root, 'output', 'corpus');
  await assert.rejects(
    exportOctaneTypeEvidence({ toolingEvidenceFile, evidenceOut, corpusDir }),
    /Successful tooling check required: passed/,
  );
  assert.equal(fs.existsSync(path.dirname(evidenceOut)), false);
  assert.equal(fs.existsSync(corpusDir), false);
});
