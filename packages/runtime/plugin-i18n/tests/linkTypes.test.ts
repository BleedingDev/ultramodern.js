import { execFileSync } from 'node:child_process';
import path from 'node:path';

const fixtureDir = path.resolve(__dirname, 'type-fixture');

function resolveTsgoBin() {
  const pkgPath = require.resolve('@typescript/native-preview/package.json');
  const pkgDir = path.dirname(pkgPath);
  const pkg = require(pkgPath) as {
    bin?:
      | string
      | {
          tsgo?: string;
        };
  };
  const binEntry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tsgo;
  return path.resolve(pkgDir, binEntry ?? 'bin/tsgo.js');
}

const tsgoBin = resolveTsgoBin();

describe('Link type-level tests', () => {
  test('fixture type-checks correctly: valid uses compile, invalid uses are rejected', () => {
    try {
      execFileSync(
        process.execPath,
        [tsgoBin, '--noEmit', '-p', 'tsconfig.json'],
        {
          cwd: fixtureDir,
          stdio: 'pipe',
        },
      );
    } catch (e: any) {
      const stdout = e?.stdout ? String(e.stdout) : '';
      const stderr = e?.stderr ? String(e.stderr) : '';
      throw new Error(`TypeScript type-check failed:\n${stdout}\n${stderr}`);
    }
  }, 60_000);
});
