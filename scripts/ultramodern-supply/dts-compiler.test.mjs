import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const fixtureRequire = createRequire(
  new URL(
    '../../tests/integration/routes-tanstack-mf/mf-host/package.json',
    import.meta.url,
  ),
);
const require = createRequire(
  fixtureRequire.resolve('@module-federation/modern-js-v3'),
);
const packageRoot = path.dirname(
  path.dirname(require.resolve('@module-federation/dts-plugin')),
);

for (const format of ['esm', 'cjs']) {
  test(`${format} DTS launches native Windows compilers without shell parsing`, () => {
    const directory = path.join(
      packageRoot,
      format === 'esm' ? 'dist/esm' : 'dist',
    );
    const filename = fs
      .readdirSync(directory)
      .find(
        name =>
          name.startsWith('expose-rpc-') &&
          name.endsWith(format === 'esm' ? '.mjs' : '.js'),
      );
    assert.ok(filename);
    const source = fs.readFileSync(path.join(directory, filename), 'utf8');
    const executables = new Set([
      String.raw`C:\Program Files\Effect & TypeScript\tsc.exe`,
      String.raw`\\compiler-server\Effect TS\tsc.exe`,
    ]);
    const existsSync = filename => executables.has(filename);
    const resolveCompilerCommand = vm.runInNewContext(
      `${source.slice(source.indexOf('const getPMFromUserAgent ='), source.indexOf('const compileTs ='))}\nresolveCompilerCommand;`,
      {
        path: path.win32,
        isAbsolute: path.win32.isAbsolute,
        fs: { existsSync },
        existsSync,
        process: { platform: 'win32', env: {} },
      },
    );
    const tsconfig = String.raw`C:\My workspace\tsconfig.json`;
    for (const executable of executables) {
      const command = resolveCompilerCommand(
        { compilerInstance: executable },
        tsconfig,
      );
      assert.equal(command.executable, executable);
      assert.equal(command.shell, false);
      assert.deepEqual(Array.from(command.args), ['--project', tsconfig]);
    }
    const packageCommand = resolveCompilerCommand(
      { compilerInstance: 'vue-tsc --emitDeclarationOnly' },
      tsconfig,
    );
    assert.equal(packageCommand.executable, 'npx');
    assert.deepEqual(Array.from(packageCommand.args), [
      'vue-tsc',
      '--emitDeclarationOnly',
      '--project',
      tsconfig,
    ]);
  });
}
