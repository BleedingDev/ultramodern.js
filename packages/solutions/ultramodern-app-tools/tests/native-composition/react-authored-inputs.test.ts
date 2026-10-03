import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@rstest/core';
import { captureConfigSourceSnapshot } from '../../src/native-composition/config-evaluator/source-snapshot';
import {
  reactInputGitPathspecs,
  reactWorkspaceCatalogInputs,
} from '../../src/native-composition/react-authored-inputs';
import { ReactTypedCssPhase } from '../../src/native-composition/react-typed-css-phase';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-react-authored-inputs-'),
  );
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return root;
}

function tracked(root: string, inputPaths: readonly string[]) {
  const canonicalRoot = fs.realpathSync.native(root);
  return execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '-z',
      '--',
      ...reactInputGitPathspecs(canonicalRoot, inputPaths),
    ],
    { cwd: canonicalRoot, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
}

describe('React authored Git inputs', () => {
  function workspace() {
    const root = fixture();
    const app = path.join(root, 'apps', 'shop');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), '{"name":"captured-app"}');
    fs.writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      'packages: [apps/*]\ncatalog: {}\n',
    );
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    return { root, app, snapshot };
  }

  it('retains original workspace YAML and all nearer absence candidates in the real phase baseline', () => {
    const { root, app, snapshot } = workspace();
    const inputs = reactWorkspaceCatalogInputs(app, snapshot);
    expect(inputs).toEqual(
      [
        path.join(app, 'pnpm-workspace.yaml'),
        path.join(root, 'apps', 'pnpm-workspace.yaml'),
        path.join(root, 'pnpm-workspace.yaml'),
      ].sort(),
    );
    const phase = new ReactTypedCssPhase({
      appDirectory: app,
      configurationSourceSnapshot: snapshot,
      inputPaths: inputs,
      produceTypedCss: false,
      internalDirectory: path.join(app, '.modern-js'),
      distDirectory: path.join(app, 'dist'),
      finalize: async () => {
        throw new Error(
          'No compiler was invoked in this source-baseline control',
        );
      },
    });
    phase.assertAuthoredInputsUnchanged();
    fs.appendFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      '# changed after phase capture\n',
    );
    expect(() => phase.assertAuthoredInputsUnchanged()).toThrow(
      'workspace catalog inputs changed',
    );
  });

  it.each([
    'yaml-change',
    'closer-creation',
  ] as const)('rejects original %s before a new phase can bless it', scenario => {
    const { root, app, snapshot } = workspace();
    const file = path.join(
      root,
      scenario === 'yaml-change' ? '' : 'apps',
      'pnpm-workspace.yaml',
    );
    fs.writeFileSync(file, 'packages: [apps/*]\n# subsequent authority\n');
    expect(
      () =>
        new ReactTypedCssPhase({
          appDirectory: app,
          configurationSourceSnapshot: snapshot,
          produceTypedCss: false,
          internalDirectory: path.join(app, '.modern-js'),
          distDirectory: path.join(app, 'dist'),
          finalize: async () => {
            throw new Error('No compiler was invoked');
          },
        }),
    ).toThrow('workspace catalog inputs changed');
  });

  it('rejects a closer declaration created after the genuine phase baseline', () => {
    const { root, app, snapshot } = workspace();
    const phase = new ReactTypedCssPhase({
      appDirectory: app,
      configurationSourceSnapshot: snapshot,
      produceTypedCss: false,
      internalDirectory: path.join(app, '.modern-js'),
      distDirectory: path.join(app, 'dist'),
      finalize: async () => {
        throw new Error('No compiler was invoked');
      },
    });
    fs.writeFileSync(
      path.join(root, 'apps', 'pnpm-workspace.yaml'),
      'packages: []\n',
    );
    expect(() => phase.assertAuthoredInputsUnchanged()).toThrow(
      'workspace catalog inputs changed',
    );
  });

  it('retains lexical and canonical workspace aliases from the original snapshot', () => {
    const { root, app } = workspace();
    const aliasRoot = fixture();
    const alias = path.join(aliasRoot, 'workspace');
    fs.symlinkSync(root, alias);
    const lexicalApp = path.join(alias, path.relative(root, app));
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [alias] });
    expect(reactWorkspaceCatalogInputs(lexicalApp, snapshot)).toContain(
      path.join(alias, 'pnpm-workspace.yaml'),
    );
    expect(reactWorkspaceCatalogInputs(lexicalApp, snapshot)).toContain(
      path.join(root, 'pnpm-workspace.yaml'),
    );
    fs.unlinkSync(alias);
    fs.symlinkSync(fixture(), alias);
    expect(() => reactWorkspaceCatalogInputs(lexicalApp, snapshot)).toThrow();
  });

  it('rejects a catalog declaration outside the original captured ancestry or absent original snapshot', () => {
    const { app } = workspace();
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [app] });
    expect(() => reactWorkspaceCatalogInputs(app, snapshot)).toThrow(
      'was not captured',
    );
    expect(() => reactWorkspaceCatalogInputs(app, undefined)).toThrow(
      'requires the original',
    );
  });
  it('keeps the exact app and literal shared file across lexical and physical workspace roots', () => {
    const root = fixture();
    const app = path.join(root, 'app');
    const shared = path.join(root, 'shared[1].ts');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'entry.ts'), 'export const app = 1;');
    fs.writeFileSync(shared, 'export const shared = 1;');
    fs.writeFileSync(
      path.join(root, 'shared1.ts'),
      'export const unrelated = 1;',
    );
    execFileSync('git', ['add', '.'], { cwd: root });
    expect(tracked(root, [app, shared])).toEqual([
      'app/entry.ts',
      'shared[1].ts',
    ]);
  });

  it('retains a tracked shared link when its actual target is outside the Git repository', () => {
    const root = fixture();
    const outside = fixture();
    const target = path.join(outside, 'input.ts');
    const link = path.join(root, 'shared.ts');
    fs.writeFileSync(target, 'export const shared = 1;');
    fs.symlinkSync(target, link);
    execFileSync('git', ['add', '.'], { cwd: root });
    expect(tracked(root, [link])).toEqual(['shared.ts']);
  });

  it('rejects empty and entirely outside scopes before Git can list the whole repository', () => {
    const root = fixture();
    const outside = fixture();
    expect(() => tracked(root, [])).toThrow('no valid scoped Git inputs');
    expect(() => tracked(root, [outside])).toThrow(
      'no valid scoped Git inputs',
    );
  });
});
