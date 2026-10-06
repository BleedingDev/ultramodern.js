import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, rstest } from '@rstest/core';
import {
  assertConfigSourceSnapshotUnchanged,
  CONFIG_SOURCE_SNAPSHOT_EXCLUSIONS,
  captureConfigSourceSnapshot,
  createConfigSourceCoverageMatcher,
} from '../../src/native-composition/config-evaluator/source-snapshot';

function fixture(run: (directory: string) => void): void {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-source-snapshot-')),
  );
  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe('bounded config source snapshots', () => {
  it.each([
    ['posix', path.posix],
    ['win32', path.win32],
  ] as const)('matches native %s coverage semantics', (_name, paths) => {
    const roots =
      paths.sep === '/'
        ? ['/Root', '/']
        : [
            'C:\\Root',
            'C:\\',
            '\\\\Server\\Share',
            '\\\\?\\C:\\Root',
            '\\\\?\\C:\\',
            '\\\\.\\C:\\',
            '\\\\?\\Volume{uuid}\\',
            '\\\\?\\UNC\\Server\\Share\\',
          ];
    const names = ['File.ts', 'file.ts', 'İ.ts', 'i\u0307.ts', 'Ä.ts', 'ä.ts'];
    const coverage = roots.flatMap(root => [
      { path: paths.join(root, 'exact'), recursive: false },
      { path: paths.join(root, 'recursive'), recursive: true },
      { path: paths.join(root, 'recursive', 'child'), recursive: false },
      { path: `${paths.join(root, 'recursive')}${paths.sep}`, recursive: true },
      ...names.map(name => ({
        path: paths.join(root, name),
        recursive: false,
      })),
    ]);
    const candidates = roots.flatMap(root => [
      root,
      paths.join(root, 'exact'),
      paths.join(root, 'exact', 'child'),
      paths.join(root, 'exact-sibling'),
      paths.join(root, 'recursive'),
      paths.join(root, 'recursive', 'child', 'deep'),
      paths.join(root, 'recursive-sibling'),
      `${root}${paths.sep}recursive${paths.sep}.${paths.sep}child${paths.sep}..${paths.sep}next`,
      `${root}${paths.sep}${paths.sep}recursive${paths.sep}child${paths.sep}`,
      ...names.flatMap(name => [
        paths.join(root, name),
        paths.join(root, name, 'child'),
      ]),
      paths.join(root, 'RECURSIVE', 'CHILD'),
    ]);
    if (paths.sep === '\\') {
      candidates.push(
        'c:/root/recursive/child',
        'D:\\Root\\recursive\\child',
        '\\\\server\\share\\recursive\\child',
        '\\\\Server\\OtherShare\\recursive\\child',
      );
    }
    const matches = createConfigSourceCoverageMatcher(coverage, paths);
    const legacy = (input: string) =>
      coverage.some(boundary => {
        const relative = paths.relative(boundary.path, input);
        return (
          relative === '' ||
          (boundary.recursive &&
            relative !== '..' &&
            !relative.startsWith(`..${paths.sep}`) &&
            !paths.isAbsolute(relative))
        );
      });
    for (const input of candidates) expect(matches(input)).toBe(legacy(input));
    for (const root of roots) {
      const rootOnly = [{ path: root, recursive: true }];
      const rootMatches = createConfigSourceCoverageMatcher(rootOnly, paths);
      for (const input of candidates) {
        const relative = paths.relative(root, input);
        expect(rootMatches(input)).toBe(
          relative === '' ||
            (relative !== '..' &&
              !relative.startsWith(`..${paths.sep}`) &&
              !paths.isAbsolute(relative)),
        );
      }
    }
  });

  it('matches native Windows coverage with expanding Unicode case folding', () => {
    const paths = path.win32;
    for (const root of ['C:\\İ', 'C:\\i\u0307', '\\\\Server\\İ']) {
      const matches = createConfigSourceCoverageMatcher(
        [{ path: root, recursive: true }],
        paths,
      );
      for (const input of [
        root,
        paths.join(root, 'x..'),
        paths.join(root, 'child'),
        paths.join(root, 'child', 'next'),
        `${root}-sibling`,
        root.toLowerCase(),
        paths.join(root.toLowerCase(), 'x..'),
      ]) {
        const relative = paths.relative(root, input);
        expect(matches(input)).toBe(
          relative === '' ||
            (relative !== '..' &&
              !relative.startsWith(`..${paths.sep}`) &&
              !paths.isAbsolute(relative)),
        );
      }
    }
  });

  it('bounds coverage comparisons with many explicit files outside the source root', () =>
    fixture(directory => {
      const external = path.join(directory, 'aa-external');
      const source = path.join(directory, 'zz-source');
      fs.mkdirSync(external);
      fs.mkdirSync(source);
      const extraInputs = Array.from({ length: 128 }, (_, index) =>
        path.join(external, `input-${index}.ts`),
      );
      for (const input of extraInputs) fs.writeFileSync(input, input);
      for (let index = 0; index < 128; index++)
        fs.writeFileSync(
          path.join(source, `source-${index}.ts`),
          String(index),
        );
      const comparisons = rstest.spyOn(path, 'relative');
      try {
        const snapshot = captureConfigSourceSnapshot({
          sourceRoots: [source],
          extraInputs,
        });
        expect(
          snapshot.states.filter(state => state.kind === 'file'),
        ).toHaveLength(256);
        expect(comparisons.mock.calls.length).toBeLessThan(16 * (256 + 1));
        comparisons.mockClear();
        expect(() =>
          assertConfigSourceSnapshotUnchanged(snapshot),
        ).not.toThrow();
        expect(comparisons.mock.calls.length).toBeLessThan(16 * (256 + 1));
        expect(
          captureConfigSourceSnapshot({
            sourceRoots: [source],
            extraInputs: [...extraInputs].reverse(),
          }),
        ).toEqual(snapshot);
      } finally {
        comparisons.mockRestore();
      }
    }));

  it('bounds path-resolution work for many declared inputs during capture and validation', () =>
    fixture(directory => {
      const extraInputs = Array.from({ length: 128 }, (_, index) =>
        path.join(directory, `input-${index}.ts`),
      );
      for (const input of extraInputs) fs.writeFileSync(input, input);
      const resolutions = rstest.spyOn(fs.realpathSync, 'native');
      try {
        const snapshot = captureConfigSourceSnapshot({
          sourceRoots: [directory],
          extraInputs,
        });
        expect(
          snapshot.states.filter(state => state.kind === 'file'),
        ).toHaveLength(extraInputs.length);
        expect(resolutions.mock.calls.length).toBeLessThan(
          12 * (extraInputs.length + 1),
        );
        resolutions.mockClear();
        expect(() =>
          assertConfigSourceSnapshotUnchanged(snapshot),
        ).not.toThrow();
        expect(resolutions.mock.calls.length).toBeLessThan(
          12 * (extraInputs.length + 1),
        );
        expect(
          captureConfigSourceSnapshot({
            sourceRoots: [directory],
            extraInputs: [...extraInputs].reverse(),
          }),
        ).toEqual(snapshot);
      } finally {
        resolutions.mockRestore();
      }
    }));

  it('round-trips serialized snapshots and normalizes reordered duplicate inputs', () =>
    fixture(directory => {
      const source = path.join(directory, 'source');
      const extra = path.join(directory, 'package.json');
      fs.mkdirSync(source);
      fs.writeFileSync(
        path.join(source, 'modern.config.ts'),
        'export default {};',
      );
      fs.writeFileSync(extra, '{}');
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [source, source],
        extraInputs: [extra],
      });
      expect(snapshot.kind).toBe('bounded-config-source-snapshot');
      expect(snapshot.exclusions).toEqual(CONFIG_SOURCE_SNAPSHOT_EXCLUSIONS);
      expect(
        captureConfigSourceSnapshot({
          sourceRoots: [source],
          extraInputs: [extra, extra],
        }),
      ).toEqual(snapshot);
      expect(() =>
        assertConfigSourceSnapshotUnchanged(
          JSON.parse(JSON.stringify(snapshot)),
        ),
      ).not.toThrow();
      expect(() =>
        assertConfigSourceSnapshotUnchanged({
          ...snapshot,
          digest: 'tampered',
        }),
      ).toThrow('Invalid config source snapshot');
    }));

  it.each([
    'edit',
    'add',
    'delete',
    'mode',
  ] as const)('detects an authored file %s', mutation =>
    fixture(directory => {
      const file = path.join(directory, 'config.ts');
      fs.writeFileSync(file, 'first');
      fs.chmodSync(file, 0o600);
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [directory],
      });
      if (mutation === 'edit') fs.writeFileSync(file, 'other');
      if (mutation === 'add')
        fs.writeFileSync(path.join(directory, 'imported.ts'), 'added');
      if (mutation === 'delete') fs.unlinkSync(file);
      if (mutation === 'mode') fs.chmodSync(file, 0o700);
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(
        'Config source snapshot changed',
      );
    }));

  it('keeps missing source roots and extra inputs so later creation invalidates them', () =>
    fixture(directory => {
      const root = path.join(directory, 'missing-root');
      const extra = path.join(directory, 'missing.json');
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [root],
        extraInputs: [extra],
      });
      expect(snapshot.states.map(state => state.kind)).toEqual([
        'missing',
        'missing',
      ]);
      fs.writeFileSync(extra, '{}');
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(
        extra,
      );
      fs.unlinkSync(extra);
      fs.mkdirSync(root);
      fs.writeFileSync(path.join(root, 'source.ts'), 'created');
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(root);
    }));

  it('ignores generated and dependency directories while retaining explicitly requested inputs', () =>
    fixture(directory => {
      for (const name of CONFIG_SOURCE_SNAPSHOT_EXCLUSIONS) {
        fs.mkdirSync(path.join(directory, name));
        fs.writeFileSync(path.join(directory, name, 'generated.ts'), 'before');
      }
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [directory],
      });
      for (const name of CONFIG_SOURCE_SNAPSHOT_EXCLUSIONS) {
        fs.writeFileSync(path.join(directory, name, 'generated.ts'), 'after');
      }
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).not.toThrow();
      const extra = path.join(directory, 'dist', 'generated.ts');
      const explicit = captureConfigSourceSnapshot({
        sourceRoots: [directory],
        extraInputs: [extra],
      });
      fs.writeFileSync(extra, 'explicit change');
      expect(() => assertConfigSourceSnapshotUnchanged(explicit)).toThrow(
        extra,
      );
    }));

  it('follows authored file and sibling directory aliases without mistaking them for cycles', () =>
    fixture(directory => {
      const target = path.join(directory, 'authored');
      fs.mkdirSync(target);
      const file = path.join(target, 'source.ts');
      fs.writeFileSync(file, 'before');
      fs.symlinkSync('authored', path.join(directory, 'first'));
      fs.symlinkSync('authored', path.join(directory, 'second'));
      fs.symlinkSync('authored/source.ts', path.join(directory, 'config.ts'));
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [directory, target],
      });
      expect(
        snapshot.states.filter(state => state.kind === 'symlink'),
      ).toHaveLength(3);
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).not.toThrow();
      fs.writeFileSync(file, 'after');
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(file);
    }));

  it('detects symlink retargeting even when referent bytes are identical', () =>
    fixture(directory => {
      fs.writeFileSync(path.join(directory, 'first.ts'), 'same');
      fs.writeFileSync(path.join(directory, 'second.ts'), 'same');
      const alias = path.join(directory, 'config.ts');
      fs.symlinkSync('first.ts', alias);
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [directory],
      });
      fs.unlinkSync(alias);
      fs.symlinkSync('second.ts', alias);
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(
        alias,
      );
    }));

  it('rejects a live alias retarget while its referent is being captured', () =>
    fixture(directory => {
      const first = path.join(directory, 'first.ts');
      const second = path.join(directory, 'second.ts');
      const alias = path.join(directory, 'alias.ts');
      fs.writeFileSync(first, 'same');
      fs.writeFileSync(second, 'same');
      fs.symlinkSync('first.ts', alias);
      const originalRead = fs.readFileSync;
      let retargeted = false;
      const read = rstest
        .spyOn(fs, 'readFileSync')
        .mockImplementation((...args) => {
          const result = Reflect.apply(originalRead, fs, args);
          if (!retargeted && typeof args[0] === 'number') {
            retargeted = true;
            fs.unlinkSync(alias);
            fs.symlinkSync('second.ts', alias);
          }
          return result;
        });
      try {
        expect(() =>
          captureConfigSourceSnapshot({ sourceRoots: [directory] }),
        ).toThrow('changed during snapshot capture');
        expect(retargeted).toBe(true);
      } finally {
        read.mockRestore();
      }
    }));

  it('rejects escaping links and does not let an explicit file authorize its siblings', () =>
    fixture(directory => {
      const root = path.join(directory, 'source');
      const sibling = path.join(directory, 'source-other');
      fs.mkdirSync(root);
      fs.mkdirSync(sibling);
      const allowed = path.join(sibling, 'package.json');
      fs.writeFileSync(allowed, '{}');
      fs.writeFileSync(path.join(sibling, 'secret.ts'), 'outside');
      fs.symlinkSync(sibling, path.join(root, 'escape'));
      expect(() =>
        captureConfigSourceSnapshot({
          sourceRoots: [root],
          extraInputs: [allowed],
        }),
      ).toThrow('symlink escapes captured coverage');
    }));

  it('retains initial boundaries when an explicit symlink root is retargeted', () =>
    fixture(directory => {
      const first = path.join(directory, 'first');
      const second = path.join(directory, 'second');
      fs.mkdirSync(first);
      fs.mkdirSync(second);
      fs.writeFileSync(path.join(first, 'config.ts'), 'same');
      fs.writeFileSync(path.join(second, 'config.ts'), 'same');
      const root = path.join(directory, 'root');
      fs.symlinkSync(first, root);
      const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
      fs.unlinkSync(root);
      fs.symlinkSync(second, root);
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(
        'symlink escapes captured coverage',
      );
    }));

  it.each([
    false,
    true,
  ])('rejects an external intermediate link before covered reentry, missing=%s', dangling =>
    fixture(directory => {
      const root = path.join(directory, 'source');
      const shortcut = path.join(directory, 'shortcut');
      fs.mkdirSync(root);
      if (!dangling) fs.writeFileSync(path.join(root, 'target.json'), '{}');
      fs.symlinkSync('target.json', path.join(root, 'target-link.json'));
      fs.symlinkSync(path.join(root, 'target-link.json'), shortcut);
      fs.symlinkSync(`${root}/../shortcut`, path.join(root, 'membership'));
      expect(() =>
        captureConfigSourceSnapshot({ sourceRoots: [root] }),
      ).toThrow('unbounded symlink intermediate');
    }));

  it('captures an explicitly declared intermediate link and detects its restored retarget', () =>
    fixture(directory => {
      const root = path.join(directory, 'source');
      const shortcut = path.join(directory, 'shortcut');
      fs.mkdirSync(root);
      fs.writeFileSync(path.join(root, 'target.json'), '{}');
      fs.writeFileSync(path.join(root, 'other.json'), '{}');
      fs.symlinkSync(path.join(root, 'target.json'), shortcut);
      fs.symlinkSync(shortcut, path.join(root, 'membership'));
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [root],
        extraInputs: [shortcut],
      });
      expect(snapshot.states.find(state => state.path === shortcut)?.kind).toBe(
        'symlink',
      );
      fs.unlinkSync(shortcut);
      fs.symlinkSync(path.join(root, 'other.json'), shortcut);
      fs.unlinkSync(shortcut);
      fs.symlinkSync(path.join(root, 'target.json'), shortcut);
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(
        'Config source snapshot changed',
      );
    }));

  it('owns an installed-dependency symlink reached through its own symlinked ancestor directory', () =>
    fixture(directory => {
      // Simulate a real project living under a symlinked ancestor, the way a
      // macOS default TMPDIR sits under /var -> /private/var: the project
      // root is only reachable by first resolving an unrelated ancestor
      // symlink, and only then do we reach the dependency's own symlink
      // (e.g. a pnpm/workspace link under node_modules).
      const realAncestor = path.join(directory, 'real-ancestor');
      fs.mkdirSync(realAncestor);
      const ancestorLink = path.join(directory, 'ancestor-link');
      fs.symlinkSync(realAncestor, ancestorLink);
      const root = path.join(ancestorLink, 'project');
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'project' }),
      );
      const dependencyTarget = path.join(directory, 'dependency');
      fs.mkdirSync(dependencyTarget);
      fs.writeFileSync(
        path.join(dependencyTarget, 'package.json'),
        JSON.stringify({ name: 'dependency' }),
      );
      const dependencySlot = path.join(root, 'node_modules', 'dependency');
      fs.mkdirSync(path.dirname(dependencySlot), { recursive: true });
      fs.symlinkSync(dependencyTarget, dependencySlot);
      // Ownership snapshots (no source roots, only explicit extraInputs) must
      // not misclassify the dependency symlink as an unbounded escape purely
      // because an earlier, unrelated ancestor symlink already resolved part
      // of the path.
      expect(() =>
        captureConfigSourceSnapshot({
          sourceRoots: [],
          extraInputs: [
            path.join(root, 'package.json'),
            path.join(dependencySlot, 'package.json'),
          ],
        }),
      ).not.toThrow();
    }));

  it('allows root exit and reentry through ordinary directories', () =>
    fixture(directory => {
      const root = path.join(directory, 'source');
      fs.mkdirSync(root);
      fs.writeFileSync(path.join(root, 'target.json'), '{}');
      fs.symlinkSync(
        `${root}/../source/target.json`,
        path.join(root, 'membership'),
      );
      const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).not.toThrow();
    }));

  it('rejects declared normalization that erases a link even when its current physical target agrees', () =>
    fixture(directory => {
      const shared = path.join(directory, 'shared');
      fs.mkdirSync(path.join(shared, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(shared, 'config.json'), '{}');
      fs.symlinkSync('sub', path.join(shared, 'link'));
      const raw = `${shared}/link/../config.json`;
      expect(fs.realpathSync(raw)).toBe(fs.realpathSync(path.normalize(raw)));
      expect(() =>
        captureConfigSourceSnapshot({
          sourceRoots: [shared],
          extraInputs: [raw],
        }),
      ).toThrow('cannot normalize a path across symlink ancestors');
    }));

  it.each(['self', 'ancestor'] as const)('rejects a %s symlink cycle', cycle =>
    fixture(directory => {
      const target = cycle === 'self' ? 'loop' : '.';
      fs.symlinkSync(target, path.join(directory, 'loop'));
      expect(() =>
        captureConfigSourceSnapshot({ sourceRoots: [directory] }),
      ).toThrow('symlink cycle');
    }));

  it('rejects aliases into excluded directories', () =>
    fixture(directory => {
      fs.mkdirSync(path.join(directory, 'dist'));
      fs.writeFileSync(
        path.join(directory, 'dist', 'generated.ts'),
        'generated',
      );
      fs.symlinkSync('dist/generated.ts', path.join(directory, 'config.ts'));
      expect(() =>
        captureConfigSourceSnapshot({ sourceRoots: [directory] }),
      ).toThrow('excluded directory');
    }));

  it('requires absolute source roots and inputs', () => {
    expect(() =>
      captureConfigSourceSnapshot({ sourceRoots: ['relative'] }),
    ).toThrow('absolute path');
    expect(() =>
      captureConfigSourceSnapshot({
        sourceRoots: [],
        extraInputs: ['relative'],
      }),
    ).toThrow('absolute path');
  });

  it('retains a dangling authored symlink and notices its referent appearing', () =>
    fixture(directory => {
      const referent = path.join(directory, 'later.ts');
      fs.symlinkSync('later.ts', path.join(directory, 'config.ts'));
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [directory],
      });
      expect(
        snapshot.states.some(
          state => state.path === referent && state.kind === 'missing',
        ),
      ).toBe(true);
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).not.toThrow();
      fs.writeFileSync(referent, 'created');
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(
        referent,
      );
    }));

  it('rejects a replaced symlink ancestor of a missing explicit input', () =>
    fixture(directory => {
      const parent = path.join(directory, 'parent');
      const outside = path.join(directory, 'outside');
      fs.mkdirSync(parent);
      fs.mkdirSync(outside);
      const input = path.join(parent, 'future.json');
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [],
        extraInputs: [input],
      });
      fs.rmdirSync(parent);
      fs.symlinkSync(outside, parent);
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(
        'symlink escapes captured coverage',
      );
    }));

  it('tracks the physical import base of equal-content inputs behind an ancestor symlink', () =>
    fixture(directory => {
      const root = path.join(directory, 'covered');
      for (const name of ['first', 'second']) {
        const authored = path.join(root, name);
        fs.mkdirSync(authored, { recursive: true });
        fs.writeFileSync(
          path.join(authored, 'config.ts'),
          'export { default } from "./value.ts";',
        );
        fs.writeFileSync(path.join(authored, 'value.ts'), name);
      }
      const selector = path.join(directory, 'selected');
      fs.symlinkSync(path.join(root, 'first'), selector);
      const input = path.join(selector, 'config.ts');
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [root],
        extraInputs: [input],
      });
      fs.unlinkSync(selector);
      fs.symlinkSync(path.join(root, 'second'), selector);
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(
        input,
      );
    }));

  it.each([
    false,
    true,
  ])('resolves symlink parents before dot segments, dangling=%s', dangling =>
    fixture(directory => {
      const root = path.join(directory, 'source');
      const outside = path.join(directory, 'outside');
      fs.mkdirSync(root);
      fs.mkdirSync(path.join(outside, 'deep'), { recursive: true });
      fs.writeFileSync(path.join(root, 'secret.ts'), 'inside');
      if (!dangling)
        fs.writeFileSync(path.join(outside, 'secret.ts'), 'outside');
      fs.symlinkSync(
        path.join(outside, 'deep'),
        path.join(root, 'node_modules'),
      );
      fs.symlinkSync('node_modules/../secret.ts', path.join(root, 'config.ts'));
      expect(() =>
        captureConfigSourceSnapshot({ sourceRoots: [root] }),
      ).toThrow('symlink escapes captured coverage');
    }));

  it('follows an authored regular file named like an excluded directory', () =>
    fixture(directory => {
      const file = path.join(directory, 'dist');
      fs.writeFileSync(file, 'authored');
      fs.symlinkSync('dist', path.join(directory, 'config.ts'));
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [directory],
      });
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).not.toThrow();
      fs.writeFileSync(file, 'changed');
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(file);
    }));

  it('excludes operational temporary trees while retaining explicitly declared temporary source inputs', () =>
    fixture(directory => {
      const temporarySource = path.join(directory, '.tmp/selection.ts');
      const installed = path.join(directory, 'node_modules/provider/index.js');
      fs.mkdirSync(path.dirname(temporarySource), { recursive: true });
      fs.mkdirSync(path.dirname(installed), { recursive: true });
      fs.writeFileSync(temporarySource, 'before');
      fs.writeFileSync(installed, 'provider');
      fs.symlinkSync(installed, path.join(directory, '.tmp/native-provider'));
      const ordinary = captureConfigSourceSnapshot({
        sourceRoots: [directory],
      });
      const explicit = captureConfigSourceSnapshot({
        sourceRoots: [directory],
        extraInputs: [temporarySource],
      });
      expect(
        ordinary.states.some(state =>
          state.path.startsWith(`${directory}/.tmp/`),
        ),
      ).toBe(false);
      fs.writeFileSync(temporarySource, 'after');
      expect(() => assertConfigSourceSnapshotUnchanged(ordinary)).not.toThrow();
      expect(() => assertConfigSourceSnapshotUnchanged(explicit)).toThrow(
        temporarySource,
      );
    }));

  it.each([
    'apps/dist',
    'verticals/dist',
    'packages/coverage',
  ])('retains authored workspace package %s and ignores its own output directories', relative =>
    fixture(directory => {
      const authoredRoot = path.join(directory, relative);
      const source = path.join(authoredRoot, 'src', 'config.ts');
      const generated = path.join(authoredRoot, 'dist', 'bundle.js');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.mkdirSync(path.dirname(generated), { recursive: true });
      fs.writeFileSync(source, 'before');
      fs.writeFileSync(generated, 'before');
      const workspace = captureConfigSourceSnapshot({
        sourceRoots: [directory],
      });
      const app = captureConfigSourceSnapshot({ sourceRoots: [authoredRoot] });
      fs.writeFileSync(generated, 'after');
      expect(() =>
        assertConfigSourceSnapshotUnchanged(workspace),
      ).not.toThrow();
      expect(() => assertConfigSourceSnapshotUnchanged(app)).not.toThrow();
      fs.writeFileSync(source, 'changed');
      expect(() => assertConfigSourceSnapshotUnchanged(workspace)).toThrow(
        source,
      );
      expect(() => assertConfigSourceSnapshotUnchanged(app)).toThrow(source);
    }));

  it.each([
    'file',
    'directory',
  ] as const)('rejects atomic %s replacement during capture', kind =>
    fixture(directory => {
      const root = path.join(directory, 'source');
      fs.mkdirSync(root);
      const file = path.join(root, 'config.ts');
      fs.writeFileSync(file, 'same bytes');
      let replaced = false;
      const originalRead = fs.readFileSync;
      const originalList = fs.readdirSync;
      const replacement =
        kind === 'file'
          ? rstest.spyOn(fs, 'readFileSync').mockImplementation((...args) => {
              const result = Reflect.apply(originalRead, fs, args);
              if (!replaced && typeof args[0] === 'number') {
                replaced = true;
                const next = path.join(directory, 'replacement.ts');
                fs.writeFileSync(next, 'same bytes');
                fs.renameSync(next, file);
              }
              return result;
            })
          : rstest.spyOn(fs, 'readdirSync').mockImplementation((...args) => {
              const result = Reflect.apply(originalList, fs, args);
              if (!replaced && args[0] === root) {
                replaced = true;
                fs.renameSync(root, path.join(directory, 'previous'));
                fs.mkdirSync(root);
                fs.writeFileSync(path.join(root, 'config.ts'), 'same bytes');
              }
              return result;
            });
      try {
        expect(() =>
          captureConfigSourceSnapshot({ sourceRoots: [root] }),
        ).toThrow('changed during snapshot capture');
      } finally {
        replacement.mockRestore();
      }
    }));

  it('detects a temporary renderer edit even after original bytes and modification time are restored', () =>
    fixture(directory => {
      const file = path.join(directory, 'modern.config.ts');
      const original = 'export default { renderer: "solid" };';
      fs.writeFileSync(file, original);
      const times = fs.statSync(file);
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [directory],
      });
      fs.writeFileSync(file, 'export default { renderer: "octane" };');
      fs.writeFileSync(file, original);
      fs.utimesSync(file, times.atime, times.mtime);
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(file);
    }));

  it('detects a symlink A-to-B-to-A retarget even after its original target is restored', () =>
    fixture(directory => {
      fs.writeFileSync(path.join(directory, 'solid.ts'), 'solid');
      fs.writeFileSync(path.join(directory, 'octane.ts'), 'octane');
      const link = path.join(directory, 'modern.config.ts');
      fs.symlinkSync('solid.ts', link);
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [directory],
      });
      fs.unlinkSync(link);
      fs.symlinkSync('octane.ts', link);
      fs.unlinkSync(link);
      fs.symlinkSync('solid.ts', link);
      expect(fs.readlinkSync(link)).toBe('solid.ts');
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(link);
    }));

  it('allows excluded output creation without persisting directory timestamps', () =>
    fixture(directory => {
      fs.writeFileSync(
        path.join(directory, 'modern.config.ts'),
        'export default {};',
      );
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [directory],
      });
      fs.mkdirSync(path.join(directory, 'dist'));
      fs.writeFileSync(path.join(directory, 'dist', 'bundle.js'), 'generated');
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).not.toThrow();
    }));

  it.each([
    'apps',
    'verticals',
    'packages',
  ])('retains authored package names through a symlinked %s group', group =>
    fixture(directory => {
      const physicalGroup = path.join(directory, 'shared', group);
      const authored = path.join(physicalGroup, 'dist');
      const source = path.join(authored, 'src', 'config.ts');
      const generated = path.join(authored, 'dist', 'bundle.js');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.mkdirSync(path.dirname(generated), { recursive: true });
      fs.writeFileSync(source, 'before');
      fs.writeFileSync(generated, 'before');
      fs.symlinkSync(physicalGroup, path.join(directory, group));
      const snapshot = captureConfigSourceSnapshot({
        sourceRoots: [directory],
      });
      fs.writeFileSync(generated, 'after');
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).not.toThrow();
      fs.writeFileSync(source, 'changed');
      expect(() => assertConfigSourceSnapshotUnchanged(snapshot)).toThrow(
        source,
      );
    }));
});
