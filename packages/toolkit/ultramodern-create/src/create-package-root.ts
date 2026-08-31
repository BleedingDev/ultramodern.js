import fs from 'node:fs';
import path from 'node:path';

/**
 * The deepest known callers live three directories below the package root
 * (dist/esm-node/ultramodern-workspace and dist/cjs/ultramodern-workspace);
 * a small fixed bound keeps the walk from silently matching an unrelated
 * ancestor that happens to contain package.json + template-workspace/.
 */
const MAX_WALK_UP_LEVELS = 5;

export function resolveCreatePackageRoot(fromDir: string): string {
  let candidate = fromDir;

  for (let level = 0; level <= MAX_WALK_UP_LEVELS; level++) {
    if (
      fs.existsSync(path.join(candidate, 'package.json')) &&
      fs.existsSync(path.join(candidate, 'template-workspace'))
    ) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      break;
    }
    candidate = parent;
  }

  throw new Error(
    `Unable to resolve the @modern-js/ultramodern-create package root (a directory containing both package.json and template-workspace/) within ${MAX_WALK_UP_LEVELS} levels above ${fromDir}`,
  );
}
