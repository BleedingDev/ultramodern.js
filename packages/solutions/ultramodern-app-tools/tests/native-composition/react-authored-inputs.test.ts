import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@rstest/core';
import { reactInputGitPathspecs } from '../../src/native-composition/react-authored-inputs';

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
