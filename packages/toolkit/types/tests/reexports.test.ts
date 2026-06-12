import fs from 'node:fs';
import path from 'node:path';

const PKG_ROOT = path.resolve(__dirname, '..');

/**
 * Upstream Modern.js v3.2.1 ships `export * from './middleware'` in
 * server/index.d.ts although no middleware.d.ts exists on disk. The line is
 * kept verbatim for merge friendliness, so it is allowlisted here.
 * Do NOT add fork-introduced entries to this list — fix the export instead
 * (a merge resolution once resurrected `export * from './babel'` without the
 * file, shipping a broken published .d.ts; this test exists to prevent that).
 */
const KNOWN_UPSTREAM_DANGLING = new Set([
  path.join('server', 'index.d.ts') + " -> './middleware'",
]);

const collectDtsFiles = (dir: string, files: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectDtsFiles(fullPath, files);
    } else if (entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
};

const relativeSpecifierResolves = (
  fromFile: string,
  specifier: string,
): boolean => {
  const base = path.resolve(path.dirname(fromFile), specifier);
  return (
    fs.existsSync(`${base}.d.ts`) ||
    fs.existsSync(path.join(base, 'index.d.ts')) ||
    (specifier.endsWith('.d.ts') && fs.existsSync(base))
  );
};

describe('shipped .d.ts files', () => {
  it('should have every relative import/re-export resolve to a file on disk', () => {
    const specifierPattern =
      /from\s+['"](\.[^'"]+)['"]|import\(['"](\.[^'"]+)['"]\)/g;
    const dangling: string[] = [];

    for (const file of collectDtsFiles(PKG_ROOT)) {
      const source = fs.readFileSync(file, 'utf-8');
      for (const match of source.matchAll(specifierPattern)) {
        const specifier = match[1] ?? match[2];
        const key = `${path.relative(PKG_ROOT, file)} -> '${specifier}'`;
        if (KNOWN_UPSTREAM_DANGLING.has(key)) {
          continue;
        }
        if (!relativeSpecifierResolves(file, specifier)) {
          dangling.push(key);
        }
      }
    }

    expect(dangling).toEqual([]);
  });
});
