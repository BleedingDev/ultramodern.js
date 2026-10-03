import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { inventory } from './inventory.mjs';
import {
  declaredKeys,
  declaredPropertyPaths,
  repositoryRoot,
  validateInventory,
} from './validate.mjs';

test('current configuration and capability references validate against actual owner sources', () => {
  const result = validateInventory();
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.equal(result.configSections, 17);
  assert.equal(result.certifiesRuntimeSupport, false);
});

test('a newly supported top-level section cannot be silently dropped from the inventory', () => {
  const candidate = structuredClone(inventory);
  candidate.config.sections = candidate.config.sections.filter(
    section => section.key !== 'environments',
  );
  assert.match(
    validateInventory(candidate).errors.join('\n'),
    /AppToolsUserConfig coverage drift/,
  );
});

test('every declared deployment target has an explicit owned profile', () => {
  const candidate = structuredClone(inventory);
  candidate.deploymentProfiles = candidate.deploymentProfiles.filter(
    profile => profile.target !== 'ghPages',
  );
  assert.match(
    validateInventory(candidate).errors.join('\n'),
    /Deployment target ghPages has no profile/,
  );
});

test('declared extension keys remain covered when provider aliases retain their own types', () => {
  const candidate = structuredClone(inventory);
  candidate.config.declaredTypes.find(
    type => type.symbol === 'DeployUserConfig',
  ).declaredKeys = ['target'];
  assert.match(
    validateInventory(candidate).errors.join('\n'),
    /Declared config keys drift: DeployUserConfig/,
  );
  assert.deepEqual(
    declaredKeys(
      `
    export type Config = SomeProvider['surface'] & {
      // comments and strings do not finish the declaration
      worker?: { name?: 'a;b';
        services?: Service[];
      };
      create?: (input: string) => { result: number };
    };
    export interface Unrelated { other?: string; }
  `,
      'Config',
    ),
    ['worker', 'create'],
  );
});

test('nested union fields remain separate from top-level declarations', () => {
  const source = `interface Config {
    rsc?: boolean | { environments?: { server?: string; client?: string } };
    worker?: { name?: string; bindings?: { service?: string } };
    server?: string;
  }`;
  assert.deepEqual(declaredKeys(source, 'Config'), ['rsc', 'worker', 'server']);
  assert.deepEqual(declaredPropertyPaths(source, 'Config'), [
    'rsc',
    'rsc.environments',
    'rsc.environments.server',
    'rsc.environments.client',
    'worker',
    'worker.name',
    'worker.bindings',
    'worker.bindings.service',
    'server',
  ]);
  const candidate = structuredClone(inventory);
  candidate.config.nestedTypes.find(
    type => type.symbol === 'DeployUserConfig',
  ).declaredPaths = ['worker.name'];
  assert.match(
    validateInventory(candidate).errors.join('\n'),
    /Nested config keys drift: DeployUserConfig/,
  );
});

test('real relative imports and Omit preserve inheritance, overrides and new direct/base keys', () => {
  const source = `import type { NeutralConfig as Base } from './base';
    interface Config extends Omit<Base<Left | Right>, 'plugins' | 'retired'> {
      plugins?: Plugin[];
      newDirect?: string;
    }`;
  let base = `export interface NeutralConfig<T> { inherited?: string; plugins?: unknown[]; retired?: boolean; }`;
  const options = {
    sourcePath: '/source/config.ts',
    readSource: path => (path === '/source/base.ts' ? base : undefined),
  };
  assert.deepEqual(declaredKeys(source, 'Config', options), [
    'inherited',
    'plugins',
    'newDirect',
  ]);
  base = base.replace('inherited?:', 'newInherited?: string; inherited?:');
  assert.deepEqual(declaredKeys(source, 'Config', options), [
    'newInherited',
    'inherited',
    'plugins',
    'newDirect',
  ]);
});

test('local aliases, transparent utilities and duplicate bases retain each immediate key once', () => {
  const source = `interface Base<T = Record<string, { headerOnly?: string }>> { inherited?: T; child?: Config; }
    type Alias = Required<Readonly<Base<Map<string, { inner?: unknown }>>>>;
    interface Config extends Alias, Pick<Base, 'inherited'> { own?: string }`;
  assert.deepEqual(declaredKeys(source, 'Config'), [
    'inherited',
    'child',
    'own',
  ]);
  assert.deepEqual(declaredPropertyPaths(source, 'Config'), [
    'inherited',
    'child',
    'own',
  ]);
});

test('comments, escaped strings and callback return types do not create member keys', () => {
  const source = String.raw`interface Config {
    /* interface Fake { hidden?: string; }; */
    first?: '/*not a comment*/; //still text';
    second?: 'escaped\'quote;{not a body}';
    callback?: (input: { parameterOnly?: string }) => { returnOnly?: string };
    readonly 'literal.with.dot'?: string;
    ['computedLiteral']?: string;
    // A semicolon-less property still ends before the next immediate property.
    semicolonless?: string
    next?: number;
  }`;
  assert.deepEqual(declaredKeys(source, 'Config'), [
    'first',
    'second',
    'callback',
    'literal.with.dot',
    'computedLiteral',
    'semicolonless',
    'next',
  ]);
});

test('root union/intersection literals include their own fields without flattening generic arguments', () => {
  const source = `type Config = boolean | ({ first?: { nested?: string }; collection?: Record<string, { value?: number }> } & { second?: string }) | { third?: string };`;
  assert.deepEqual(declaredKeys(source, 'Config'), [
    'first',
    'collection',
    'second',
    'third',
  ]);
  assert.deepEqual(declaredPropertyPaths(source, 'Config'), [
    'first',
    'first.nested',
    'collection',
    'second',
    'third',
  ]);
});

test('missing relative bases, cyclic inheritance and dynamic owned keys fail clearly', () => {
  const source = `import type { Base } from './base'; interface Config extends Base { own?: string; }`;
  assert.throws(
    () =>
      declaredKeys(source, 'Config', {
        sourcePath: '/source/config.ts',
        readSource: () => undefined,
      }),
    /Missing inherited declaration source/,
  );
  const files = {
    '/source/a.ts': `import type { B } from './b'; export interface A extends B { a?: string }`,
    '/source/b.ts': `import type { A } from './a'; export interface B extends A { b?: string }`,
  };
  assert.throws(
    () =>
      declaredKeys(files['/source/a.ts'], 'A', {
        sourcePath: '/source/a.ts',
        readSource: path => files[path],
      }),
    /Cyclic inherited config declaration/,
  );
  assert.throws(
    () =>
      declaredKeys('interface Config { [key: string]: unknown; }', 'Config'),
    /Unsupported dynamic declaration key/,
  );
});

test('React product requirements cannot become optional through capability classification', () => {
  const candidate = structuredClone(inventory);
  candidate.capabilities.find(
    row => row.id === 'ssg-by-entries',
  ).renderers.react.status = 'unresolved';
  assert.match(
    validateInventory(candidate).errors.join('\n'),
    /Current React capability ssg-by-entries may not be silently weakened/,
  );
});

test('unexecuted native support and RSC claims fail closed', () => {
  const candidate = structuredClone(inventory);
  candidate.capabilities.find(
    row => row.id === 'node-ssr',
  ).renderers.solid.status = 'supported';
  candidate.capabilities.find(
    row => row.id === 'react-rsc',
  ).renderers.octane.status = 'preview-after-proof';
  const errors = validateInventory(candidate).errors.join('\n');
  assert.match(errors, /Invalid solid status for node-ssr/);
  assert.match(errors, /octane\/react-rsc must reject explicitly/);
});

test('unsupported capabilities require a concrete rejection owner and gate', () => {
  const candidate = structuredClone(inventory);
  const cell = candidate.capabilities.find(
    row => row.id === 'cross-renderer-remotes',
  ).renderers.react;
  cell.expectedTest = { kind: 'positive-runtime', assertion: '' };
  const errors = validateInventory(candidate).errors.join('\n');
  assert.match(errors, /lacks a concrete expected test owner\/assertion/);
  assert.match(errors, /has no concrete proof gate/);
  assert.match(
    errors,
    /must name a positive runtime or explicit rejection test/,
  );
});

test('test references must be actual test files and source declarations cannot be called runtime tests', () => {
  const candidate = structuredClone(inventory);
  candidate.capabilities.find(
    row => row.id === 'svg-components',
  ).evidence[0].kind = 'runtime-test';
  assert.match(
    validateInventory(candidate).errors.join('\n'),
    /Test evidence points to a non-test file/,
  );
});

test('known unresolved deployment, SVG, mixed-entry and hydration gaps cannot disappear', () => {
  const candidate = structuredClone(inventory);
  candidate.explicitGaps = [];
  const errors = validateInventory(candidate).errors.join('\n');
  for (const id of [
    'worker-rsc-runtime',
    'native-svg-runtime',
    'mixed-entry-runtime',
    'ordinary-data-hydration-reuse',
  ]) {
    assert.ok(errors.includes(`Required explicit gap is missing: ${id}`));
  }
});

test('CLI validation is dependency-free and refuses misspelled arguments', () => {
  const cli = 'scripts/ultramodern-renderers/capabilities/validate.mjs';
  const valid = spawnSync(process.execPath, [cli], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Test references are not execution receipts/);
  const invalid = spawnSync(process.execPath, [cli, '--support'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Unknown arguments/);
});
