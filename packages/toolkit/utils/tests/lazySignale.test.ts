import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';

const packageRoot = path.resolve(__dirname, '..');
type ModuleKind = 'source' | 'cjs' | 'esm';
type Action = 'cold' | 'use' | 'subclass';

function fixture(run: (fixture: { root: string }) => void) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'utils-lazy-signale-',
      ),
    ),
  );
  const manifest = path.join(root, 'package.json');
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      name: 'authored-signale-fixture',
      type: 'module',
      signale: {
        displayBadge: false,
        displayLabel: false,
        displayScope: true,
        uppercaseLabel: true,
      },
    }),
  );
  try {
    run({ root });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runChild(root: string, kind: ModuleKind, action: Action) {
  const output = execFileSync(
    process.execPath,
    [
      path.join(__dirname, 'fixtures/lazy-signale-inspect.mjs'),
      JSON.stringify([packageRoot, root, kind, action]),
    ],
    { cwd: packageRoot, encoding: 'utf8', timeout: 30000 },
  );
  return JSON.parse(output);
}

function expectCold(root: string, kind: ModuleKind) {
  const result = runChild(root, kind, 'cold');
  expect(result.nativeInitiallyCached).toBe(false);
  expect(result.utilsInitiallyCached).toBe(false);
  expect(result.value).toEqual({
    constant: 'index',
    symbolKinds: ['function', 'function'],
    nativeLoaded: false,
  });
  expect(result.manifestRead).toBe(false);
}

function expectNativeUse(root: string, kind: ModuleKind) {
  const result = runChild(root, kind, 'use');
  expect(result.nativeInitiallyCached).toBe(false);
  expect(result.utilsInitiallyCached).toBe(false);
  expect(result.value).toMatchObject({
    nativeLoaded: true,
    prototypesMatch: true,
    singletonConstructorPrototype: true,
    instancePrototype: true,
    lazyInstance: true,
    nativeInstance: true,
    initialSettings: {
      displayBadge: false,
      displayLabel: false,
      displayScope: false,
      uppercaseLabel: true,
    },
    configuredSettings: {
      displayBadge: false,
      displayLabel: false,
      displayScope: true,
      uppercaseLabel: false,
      displayTimestamp: true,
    },
    disabled: true,
    enabled: true,
    disabledAgain: true,
    scope: {
      name: ['child'],
      nativeInstance: true,
      nativePrototype: true,
      timers: true,
      stream: true,
      secrets: true,
      customLabel: 'passed',
    },
  });
  expect(result.value.scope.settings).toEqual(result.value.configuredSettings);
  expect(result.manifestRead).toBe(true);
}

describe('lazy Signale source exports', () => {
  it('imports source utils, a constant, and lazy symbols without reading app settings', () =>
    fixture(({ root }) => expectCold(root, 'source')));

  it('preserves native construction and settings from source', () =>
    fixture(({ root }) => expectNativeUse(root, 'source')));

  it('preserves a native subclass prototype and methods through the lazy source constructor', () =>
    fixture(({ root }) => {
      const result = runChild(root, 'source', 'subclass');
      expect(result.nativeInitiallyCached).toBe(false);
      expect(result.value).toEqual({
        derivedInstance: true,
        lazyInstance: true,
        nativeInstance: true,
        derivedPrototype: true,
        inheritedPrototype: true,
        marker: 'derived-method',
      });
      expect(result.manifestRead).toBe(true);
    }));
});

describe('lazy Signale public package exports', () => {
  for (const kind of ['cjs', 'esm'] as const) {
    it(`keeps the cold public ${kind} import, constant, and symbols independent of app settings`, () =>
      fixture(({ root }) => expectCold(root, kind)));

    it(`preserves native behavior and settings through the public ${kind} export`, () =>
      fixture(({ root }) => expectNativeUse(root, kind)));
  }
});
