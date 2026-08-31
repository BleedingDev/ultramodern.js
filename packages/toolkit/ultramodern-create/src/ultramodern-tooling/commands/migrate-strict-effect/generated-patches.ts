import fs from 'node:fs';
import path from 'node:path';

import type { MigrationIo } from './io';

export function ensureGeneratedPatchFile(
  io: MigrationIo,
  relativePatchPath: string,
  sourcePatchPath: string,
) {
  const targetPath = path.join(io.workspaceRoot, relativePatchPath);
  const patch = fs.readFileSync(sourcePatchPath, 'utf-8');
  return io.write(targetPath, patch);
}

export function removeGeneratedPatchFileIfUnchanged(
  io: MigrationIo,
  relativePatchPath: string,
  sourcePatchPath: string,
) {
  const targetPath = path.join(io.workspaceRoot, relativePatchPath);
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const patch = fs.readFileSync(sourcePatchPath, 'utf-8');
  if (fs.readFileSync(targetPath, 'utf-8') !== patch) {
    return false;
  }

  return io.remove(targetPath);
}
