import fs from 'node:fs';
import path from 'node:path';

export function resolveCreatePackageRoot(fromDir: string): string {
  let candidate = fromDir;

  while (true) {
    if (
      fs.existsSync(path.join(candidate, 'package.json')) &&
      fs.existsSync(path.join(candidate, 'template-workspace'))
    ) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error('Unable to resolve create package root');
    }
    candidate = parent;
  }
}
