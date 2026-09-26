import fs from 'node:fs';
import path from 'node:path';
import {
  createUltramodernReleaseBuildMarker,
  resolveUltramodernReleaseIdentity,
  resolveUltramodernSourceRevision,
} from '@modern-js/app-tools-extensions/release-identity';
import { createGitFixture } from '../../../../../scripts/lib/git-fixture.js';

const generationBuildMarker = '0123456789abcdef';
const sourceRevision = 'a'.repeat(40);
const secondSourceRevision = 'b'.repeat(40);
const unitId = 'acme/catalog';

const withSourceRevision = <T>(
  revision: string | undefined,
  run: () => T,
): T => {
  const previous = process.env.ULTRAMODERN_SOURCE_REVISION;
  if (revision === undefined) {
    delete process.env.ULTRAMODERN_SOURCE_REVISION;
  } else {
    process.env.ULTRAMODERN_SOURCE_REVISION = revision;
  }

  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.ULTRAMODERN_SOURCE_REVISION;
    } else {
      process.env.ULTRAMODERN_SOURCE_REVISION = previous;
    }
  }
};

describe('UltraModern release identity', () => {
  it('derives a deterministic marker from unit, generation marker, and source revision', () => {
    const marker = createUltramodernReleaseBuildMarker({
      generationBuildMarker,
      sourceRevision,
      unitId,
    });

    expect(marker).toMatch(/^[a-f0-9]{16}$/u);
    expect(
      createUltramodernReleaseBuildMarker({
        generationBuildMarker,
        sourceRevision,
        unitId,
      }),
    ).toBe(marker);
    expect(
      new Set([
        marker,
        createUltramodernReleaseBuildMarker({
          generationBuildMarker: 'fedcba9876543210',
          sourceRevision,
          unitId,
        }),
        createUltramodernReleaseBuildMarker({
          generationBuildMarker,
          sourceRevision: secondSourceRevision,
          unitId,
        }),
        createUltramodernReleaseBuildMarker({
          generationBuildMarker,
          sourceRevision,
          unitId: 'acme/inventory',
        }),
      ]),
    ).toHaveLength(4);
  });

  it('trims an immutable revision override and treats a workspace sentinel as unset', () => {
    withSourceRevision(`  ${sourceRevision}  `, () => {
      expect(resolveUltramodernSourceRevision('/does/not/matter')).toBe(
        sourceRevision,
      );
    });
    withSourceRevision(sourceRevision, () => {
      expect(
        resolveUltramodernSourceRevision('/does/not/matter', 'workspace'),
      ).toBe(sourceRevision);
    });
  });

  it('never labels tracked or untracked dirty source as clean HEAD', () => {
    const {
      cleanup,
      git,
      repoDir: directory,
    } = createGitFixture({
      prefix: 'ultramodern-release-dirty-',
    });
    try {
      git(['init', '--quiet']);
      const sourcePath = path.join(directory, 'source.txt');
      fs.writeFileSync(sourcePath, 'clean source\n');
      git(['add', 'source.txt']);
      git(['commit', '--quiet', '-m', 'source']);
      const head = git(['rev-parse', 'HEAD']);

      fs.writeFileSync(sourcePath, 'dirty tracked source\n');
      expect(
        withSourceRevision(head, () =>
          resolveUltramodernSourceRevision(directory),
        ),
      ).toBe('workspace');
      expect(
        withSourceRevision(undefined, () =>
          resolveUltramodernReleaseIdentity({
            generationBuildMarker,
            sourceRevision: head,
            unitId,
            workspaceRoot: directory,
          }),
        ),
      ).toEqual({
        buildMarker: generationBuildMarker,
        sourceRevision: 'workspace',
      });

      git(['restore', 'source.txt']);
      fs.writeFileSync(path.join(directory, 'untracked.txt'), 'untracked\n');
      expect(
        withSourceRevision(head, () =>
          resolveUltramodernSourceRevision(directory),
        ),
      ).toBe('workspace');
    } finally {
      cleanup();
    }
  });

  it('rejects an explicit revision that differs from clean Git HEAD', () => {
    const {
      cleanup,
      git,
      repoDir: directory,
    } = createGitFixture({
      prefix: 'ultramodern-release-mismatch-',
    });
    try {
      git(['init', '--quiet']);
      fs.writeFileSync(path.join(directory, 'source.txt'), 'source\n');
      git(['add', 'source.txt']);
      git(['commit', '--quiet', '-m', 'source']);

      expect(() =>
        withSourceRevision(secondSourceRevision, () =>
          resolveUltramodernSourceRevision(directory),
        ),
      ).toThrow('does not match clean Git HEAD');
    } finally {
      cleanup();
    }
  });

  it('never labels dirty source as clean HEAD when a git hook exported GIT_DIR', () => {
    const {
      cleanup,
      git,
      repoDir: directory,
    } = createGitFixture({
      prefix: 'ultramodern-release-git-dir-',
    });
    const previous = process.env.GIT_DIR;
    try {
      git(['init', '--quiet']);
      fs.writeFileSync(path.join(directory, 'source.txt'), 'source\n');
      git(['add', 'source.txt']);
      git(['commit', '--quiet', '-m', 'source']);
      const head = git(['rev-parse', 'HEAD']);
      fs.writeFileSync(path.join(directory, 'source.txt'), 'dirty source\n');

      process.env.GIT_DIR = path.join(directory, 'missing-git-dir');
      expect(
        withSourceRevision(head, () =>
          resolveUltramodernSourceRevision(directory),
        ),
      ).toBe('workspace');
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
      cleanup();
    }
  });

  it('binds an explicit release revision without consulting the workspace', () => {
    expect(
      resolveUltramodernReleaseIdentity({
        generationBuildMarker,
        sourceRevision,
        unitId,
        workspaceRoot: '/does/not/exist',
      }),
    ).toEqual({
      buildMarker: createUltramodernReleaseBuildMarker({
        generationBuildMarker,
        sourceRevision,
        unitId,
      }),
      sourceRevision,
    });
  });

  it('rejects non-exact synthetic revisions outside Git', () => {
    expect(() =>
      resolveUltramodernReleaseIdentity({
        generationBuildMarker,
        sourceRevision: 'revision-one',
        unitId,
        workspaceRoot: '/does/not/exist',
      }),
    ).toThrow('must be an exact lowercase 40- or 64-character Git object ID');
  });
});
