import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createUltramodernReleaseBuildMarker,
  resolveUltramodernReleaseIdentity,
  resolveUltramodernSourceRevision,
} from '../src/ultramodern-release-identity';

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

  it('uses and trims the immutable revision override', () => {
    withSourceRevision(`  ${sourceRevision}  `, () => {
      expect(resolveUltramodernSourceRevision('/does/not/matter')).toBe(
        sourceRevision,
      );
    });
  });

  it('treats an explicit workspace sentinel as unset', () => {
    withSourceRevision(sourceRevision, () => {
      expect(
        resolveUltramodernSourceRevision('/does/not/matter', 'workspace'),
      ).toBe(sourceRevision);
    });
  });

  it('resolves a git revision when no override exists', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ultramodern-release-identity-'),
    );
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: directory });
      execFileSync('git', ['config', 'user.email', 'test@example.test'], {
        cwd: directory,
      });
      execFileSync('git', ['config', 'user.name', 'UltraModern Test'], {
        cwd: directory,
      });
      fs.writeFileSync(path.join(directory, 'source.txt'), 'release source\n');
      execFileSync('git', ['add', 'source.txt'], { cwd: directory });
      execFileSync('git', ['commit', '--quiet', '-m', 'source'], {
        cwd: directory,
      });
      const expected = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: directory,
        encoding: 'utf8',
      }).trim();

      expect(
        withSourceRevision(undefined, () =>
          resolveUltramodernSourceRevision(directory),
        ),
      ).toBe(expected);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('never labels tracked or untracked dirty source as clean HEAD', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ultramodern-release-dirty-'),
    );
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: directory });
      execFileSync('git', ['config', 'user.email', 'test@example.test'], {
        cwd: directory,
      });
      execFileSync('git', ['config', 'user.name', 'UltraModern Test'], {
        cwd: directory,
      });
      const sourcePath = path.join(directory, 'source.txt');
      fs.writeFileSync(sourcePath, 'clean source\n');
      execFileSync('git', ['add', 'source.txt'], { cwd: directory });
      execFileSync('git', ['commit', '--quiet', '-m', 'source'], {
        cwd: directory,
      });
      const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: directory,
        encoding: 'utf8',
      }).trim();

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

      execFileSync('git', ['restore', 'source.txt'], { cwd: directory });
      fs.writeFileSync(path.join(directory, 'untracked.txt'), 'untracked\n');
      expect(
        withSourceRevision(head, () =>
          resolveUltramodernSourceRevision(directory),
        ),
      ).toBe('workspace');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an explicit revision that differs from clean Git HEAD', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ultramodern-release-mismatch-'),
    );
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: directory });
      execFileSync('git', ['config', 'user.email', 'test@example.test'], {
        cwd: directory,
      });
      execFileSync('git', ['config', 'user.name', 'UltraModern Test'], {
        cwd: directory,
      });
      fs.writeFileSync(path.join(directory, 'source.txt'), 'source\n');
      execFileSync('git', ['add', 'source.txt'], { cwd: directory });
      execFileSync('git', ['commit', '--quiet', '-m', 'source'], {
        cwd: directory,
      });

      expect(() =>
        withSourceRevision(secondSourceRevision, () =>
          resolveUltramodernSourceRevision(directory),
        ),
      ).toThrow('does not match clean Git HEAD');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves the generation marker only for an uncommitted workspace', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ultramodern-release-workspace-'),
    );
    try {
      expect(
        withSourceRevision(undefined, () =>
          resolveUltramodernReleaseIdentity({
            generationBuildMarker,
            unitId,
            workspaceRoot: directory,
          }),
        ),
      ).toEqual({
        buildMarker: generationBuildMarker,
        sourceRevision: 'workspace',
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
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

  it('keeps nested final deployment output outside the clean source identity', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ultramodern-release-output-ignore-'),
    );
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: directory });
      execFileSync('git', ['config', 'user.email', 'test@example.test'], {
        cwd: directory,
      });
      execFileSync('git', ['config', 'user.name', 'UltraModern Test'], {
        cwd: directory,
      });
      fs.writeFileSync(
        path.join(directory, '.gitignore'),
        '.output/\n**/.output/\n',
      );
      fs.writeFileSync(path.join(directory, 'source.txt'), 'source\n');
      execFileSync('git', ['add', '.gitignore', 'source.txt'], {
        cwd: directory,
      });
      execFileSync('git', ['commit', '--quiet', '-m', 'source'], {
        cwd: directory,
      });
      const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: directory,
        encoding: 'utf8',
      }).trim();

      const outputDirectory = path.join(directory, 'verticals/catalog/.output');
      fs.mkdirSync(outputDirectory, { recursive: true });
      fs.writeFileSync(path.join(outputDirectory, 'index.js'), 'built\n');

      expect(
        withSourceRevision(undefined, () =>
          resolveUltramodernSourceRevision(directory),
        ),
      ).toBe(head);
      expect(
        execFileSync(
          'git',
          ['status', '--porcelain=v1', '--untracked-files=all'],
          {
            cwd: directory,
            encoding: 'utf8',
          },
        ).trim(),
      ).toBe('');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
