import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PKG_ROOT = path.resolve(__dirname, '..');
const TSC_BIN = path.resolve(PKG_ROOT, '../../../node_modules/.bin/tsc');

/**
 * Upstream Modern.js declares one member inside an already ambient namespace.
 * TypeScript reports it even though consumers can use the package normally,
 * so that existing diagnostic is allowlisted here.
 * Do NOT add fork-introduced entries to this list — fix the export instead
 * (a merge resolution once resurrected `export * from './babel'` without the
 * file, shipping a broken published .d.ts; this test exists to prevent that).
 */
const KNOWN_UPSTREAM_DANGLING = new Set([
  "packages/hoist-non-react-statics.d.ts(59,3): error TS1038: A 'declare' modifier cannot be used in an already ambient context.",
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

describe('shipped .d.ts files', () => {
  it('resolves every relative import and re-export through TypeScript', () => {
    const result = spawnSync(
      TSC_BIN,
      [
        '--ignoreConfig',
        '--noEmit',
        '--module',
        'nodenext',
        '--moduleResolution',
        'nodenext',
        '--target',
        'esnext',
        '--types',
        'node,react',
        ...collectDtsFiles(PKG_ROOT).map(file => path.relative(PKG_ROOT, file)),
      ],
      {
        cwd: PKG_ROOT,
        encoding: 'utf8',
      },
    );

    const diagnostics = `${result.stdout}${result.stderr}`
      .split(/\r?\n/u)
      .filter(Boolean);
    expect(
      diagnostics.filter(
        diagnostic => !KNOWN_UPSTREAM_DANGLING.has(diagnostic),
      ),
    ).toEqual([]);
    expect(diagnostics).toEqual([...KNOWN_UPSTREAM_DANGLING]);
  });
});
