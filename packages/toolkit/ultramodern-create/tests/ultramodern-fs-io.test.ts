import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeFile } from '../src/ultramodern-workspace/fs-io';

test('writeFile refuses symlinked directories that escape the workspace root', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-fs-io-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const outsideRoot = path.join(tempRoot, 'outside');
  const escapedFile = path.join(outsideRoot, 'escaped.txt');

  try {
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(outsideRoot);
    fs.symlinkSync(outsideRoot, path.join(workspaceRoot, 'apps'), 'dir');

    assert.throws(
      () => writeFile(workspaceRoot, 'apps/escaped.txt', 'escaped\n'),
      /outside workspace root|symlink/i,
    );
    assert.equal(fs.existsSync(escapedFile), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
