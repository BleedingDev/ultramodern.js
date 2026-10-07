import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function confinedPath(root, relative) {
  assert(typeof relative === 'string' && relative.length > 0);
  assert(!path.isAbsolute(relative), 'Emitted paths must be relative');
  const target = path.resolve(root, relative);
  const delta = path.relative(root, target);
  assert(
    delta !== '..' && !delta.startsWith(`..${path.sep}`),
    `Emitted path escapes its output root: ${relative}`,
  );
  for (const candidate of [
    root,
    ...delta
      .split(path.sep)
      .filter(Boolean)
      .map((_, index, parts) => path.join(root, ...parts.slice(0, index + 1))),
  ]) {
    try {
      assert(
        !fs.lstatSync(candidate).isSymbolicLink(),
        `Proof path contains a symlink: ${candidate}`,
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return target;
}

export function fileEvidence(file, root) {
  confinedPath(root, path.relative(root, file));
  assert(fs.lstatSync(file).isFile(), 'Evidence must bind an ordinary file');
  const bytes = fs.readFileSync(file);
  return {
    path: path.relative(root, file).split(path.sep).join('/'),
    byteLength: bytes.length,
    sha256: sha256(bytes),
  };
}
