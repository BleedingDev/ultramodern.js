import fs from 'node:fs';
import path from 'node:path';

export function resolveCreatePackageRoot(fromDir: string): string {
  const candidates = [
    fromDir,
    path.resolve(fromDir, '..'),
    path.resolve(fromDir, '..', '..'),
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    if (
      fs.existsSync(path.join(candidate, 'package.json')) &&
      fs.existsSync(path.join(candidate, 'template-workspace'))
    ) {
      return candidate;
    }
  }

  throw new Error('Unable to resolve create package root');
}
