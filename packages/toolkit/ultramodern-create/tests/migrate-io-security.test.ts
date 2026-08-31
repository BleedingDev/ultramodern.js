import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createMigrationIo,
  withStagedDryRunMigrationIo,
} from '../src/ultramodern-tooling/commands/migrate-strict-effect/io';

test('migration IO writes and removes normal paths inside the workspace', () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-io-in-root-'),
  );
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  const targetPath = path.join(workspaceRoot, 'apps/catalog/config.json');

  try {
    fs.mkdirSync(workspaceRoot);
    const io = createMigrationIo(workspaceRoot, false);

    assert.equal(io.write(targetPath, '{"safe":true}\n'), true);
    assert.equal(fs.readFileSync(targetPath, 'utf-8'), '{"safe":true}\n');
    assert.equal(io.remove(targetPath), true);
    assert.equal(fs.existsSync(targetPath), false);
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('migration IO refuses writes and removals through an escaping ancestor symlink', () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-io-symlink-'),
  );
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  const outsideRoot = path.join(temporaryRoot, 'outside');
  const outsideTarget = path.join(outsideRoot, 'config.json');

  try {
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(outsideRoot);
    fs.writeFileSync(outsideTarget, 'original\n');
    fs.symlinkSync(outsideRoot, path.join(workspaceRoot, 'apps'), 'dir');

    const io = createMigrationIo(workspaceRoot, false);
    const escapedPath = path.join(workspaceRoot, 'apps/config.json');

    assert.throws(
      () => io.write(escapedPath, 'changed\n'),
      /outside workspace|symlink/u,
    );
    assert.equal(fs.readFileSync(outsideTarget, 'utf-8'), 'original\n');
    assert.throws(() => io.remove(escapedPath), /outside workspace|symlink/u);
    assert.equal(fs.readFileSync(outsideTarget, 'utf-8'), 'original\n');
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('migration IO rejects escaping final-link writes but safely removes the link itself', () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-io-final-symlink-'),
  );
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  const outsideRoot = path.join(temporaryRoot, 'outside');
  const danglingTarget = path.join(outsideRoot, 'missing.json');
  const preservedTarget = path.join(outsideRoot, 'preserved.json');
  const danglingLink = path.join(workspaceRoot, 'dangling.json');
  const removableLink = path.join(workspaceRoot, 'removable.json');

  try {
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(outsideRoot);
    fs.writeFileSync(preservedTarget, 'preserved\n');
    fs.symlinkSync(danglingTarget, danglingLink, 'file');
    fs.symlinkSync(preservedTarget, removableLink, 'file');

    const io = createMigrationIo(workspaceRoot, false);
    assert.throws(
      () => io.write(danglingLink, 'escaped\n'),
      /outside workspace|symlink/u,
    );
    assert.equal(fs.existsSync(danglingTarget), false);
    assert.equal(fs.lstatSync(danglingLink).isSymbolicLink(), true);

    assert.equal(io.remove(removableLink), true);
    assert.equal(fs.existsSync(removableLink), false);
    assert.equal(fs.readFileSync(preservedTarget, 'utf-8'), 'preserved\n');
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('migration IO supports a symlinked workspace root and in-root directory aliases', () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-io-linked-root-'),
  );
  const realWorkspaceRoot = path.join(temporaryRoot, 'real-workspace');
  const linkedWorkspaceRoot = path.join(temporaryRoot, 'workspace');
  const realAppsRoot = path.join(realWorkspaceRoot, 'real-apps');
  const linkedTarget = path.join(linkedWorkspaceRoot, 'apps/config.json');
  const realTarget = path.join(realAppsRoot, 'config.json');

  try {
    fs.mkdirSync(realAppsRoot, { recursive: true });
    fs.symlinkSync(realWorkspaceRoot, linkedWorkspaceRoot, 'dir');
    fs.symlinkSync(realAppsRoot, path.join(realWorkspaceRoot, 'apps'), 'dir');

    const io = createMigrationIo(linkedWorkspaceRoot, false);
    assert.equal(io.write(linkedTarget, 'linked\n'), true);
    assert.equal(fs.readFileSync(realTarget, 'utf-8'), 'linked\n');
    assert.equal(io.remove(linkedTarget), true);
    assert.equal(fs.existsSync(realTarget), false);
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('migration dry-run performs no target mutation through an escaping ancestor symlink', () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-io-dry-run-'),
  );
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  const outsideRoot = path.join(temporaryRoot, 'outside');
  const outsideTarget = path.join(outsideRoot, 'config.json');

  try {
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(outsideRoot);
    fs.writeFileSync(outsideTarget, 'original\n');
    fs.symlinkSync(outsideRoot, path.join(workspaceRoot, 'apps'), 'dir');

    assert.throws(
      () =>
        withStagedDryRunMigrationIo(workspaceRoot, io =>
          io.write(
            path.join(io.workspaceRoot, 'apps/config.json'),
            'changed\n',
          ),
        ),
      /outside workspace|symlink/u,
    );
    assert.equal(fs.readFileSync(outsideTarget, 'utf-8'), 'original\n');
    assert.throws(
      () =>
        withStagedDryRunMigrationIo(workspaceRoot, io =>
          io.remove(path.join(io.workspaceRoot, 'apps/config.json')),
        ),
      /outside workspace|symlink/u,
    );
    assert.equal(fs.readFileSync(outsideTarget, 'utf-8'), 'original\n');
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('migration dry-run only plans normal in-workspace mutations', () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-io-dry-run-in-root-'),
  );
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  const existingPath = path.join(workspaceRoot, 'existing.txt');
  const newPath = path.join(workspaceRoot, 'nested/new.txt');

  try {
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(existingPath, 'original\n');
    const io = createMigrationIo(workspaceRoot, true);

    assert.equal(io.write(newPath, 'planned\n'), true);
    assert.equal(io.remove(existingPath), true);
    assert.equal(fs.existsSync(newPath), false);
    assert.equal(fs.readFileSync(existingPath, 'utf-8'), 'original\n');
    assert.deepEqual(io.plan, [
      '[dry-run] would write nested/new.txt',
      '[dry-run] would delete existing.txt',
    ]);
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('staged migration dry-run projects writes and removals without touching the source workspace', () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-io-staged-dry-run-'),
  );
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  const existingPath = path.join(workspaceRoot, 'existing.txt');
  const newPath = path.join(workspaceRoot, 'nested/new.txt');

  try {
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(existingPath, 'original\n');

    withStagedDryRunMigrationIo(workspaceRoot, io => {
      const stagedExistingPath = path.join(io.workspaceRoot, 'existing.txt');
      const stagedNewPath = path.join(io.workspaceRoot, 'nested/new.txt');
      assert.equal(io.write(stagedNewPath, 'projected\n'), true);
      assert.equal(io.remove(stagedExistingPath), true);
      assert.equal(fs.readFileSync(stagedNewPath, 'utf-8'), 'projected\n');
      assert.equal(fs.existsSync(stagedExistingPath), false);
    });

    assert.equal(fs.existsSync(newPath), false);
    assert.equal(fs.readFileSync(existingPath, 'utf-8'), 'original\n');
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('staged migration dry-run does not follow a symlinked workspace root back to its source', () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-io-staged-linked-root-'),
  );
  const realWorkspaceRoot = path.join(temporaryRoot, 'real-workspace');
  const linkedWorkspaceRoot = path.join(temporaryRoot, 'workspace');
  const realAppsRoot = path.join(realWorkspaceRoot, 'real-apps');
  const existingPath = path.join(realAppsRoot, 'existing.txt');
  const newPath = path.join(realAppsRoot, 'new.txt');

  try {
    fs.mkdirSync(realAppsRoot, { recursive: true });
    fs.writeFileSync(existingPath, 'original\n');
    fs.symlinkSync(realWorkspaceRoot, linkedWorkspaceRoot, 'dir');
    fs.symlinkSync(
      path.join(linkedWorkspaceRoot, 'real-apps'),
      path.join(realWorkspaceRoot, 'apps'),
      'dir',
    );

    withStagedDryRunMigrationIo(linkedWorkspaceRoot, io => {
      assert.equal(
        io.write(path.join(io.workspaceRoot, 'apps/new.txt'), 'projected\n'),
        true,
      );
      assert.equal(
        io.remove(path.join(io.workspaceRoot, 'apps/existing.txt')),
        true,
      );
    });

    assert.equal(fs.existsSync(newPath), false);
    assert.equal(fs.readFileSync(existingPath, 'utf-8'), 'original\n');
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
