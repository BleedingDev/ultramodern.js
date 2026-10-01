import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

describe('registerPathsLoader', () => {
  it('resolves CommonJS aliases through native synchronous loader hooks', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'modern-cjs-alias-'));
    const registerUrl = pathToFileURL(
      path.resolve(__dirname, '../../src/esm/register-esm.mjs'),
    ).href;
    writeFileSync(
      path.join(directory, 'fixture.mjs'),
      'export const value = 42;',
    );
    try {
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
import { createRequire } from 'node:module';
import { registerPathsLoader } from ${JSON.stringify(registerUrl)};
const hooks = await registerPathsLoader({
  appDir: ${JSON.stringify(directory)},
  baseUrl: ${JSON.stringify(directory)},
  paths: {
    '@fixture/module': ['fixture.mjs'],
    '@modern-js/utils': ['fixture.mjs'],
  },
});
try {
  console.log(createRequire(import.meta.url)('@fixture/module').value);
  console.log(createRequire(${JSON.stringify(registerUrl)})('@modern-js/utils').program ? 'framework' : 'shadowed');
} finally {
  hooks.deregister();
}
`,
        ],
        { cwd: directory, encoding: 'utf8' },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('42\nframework');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not use deprecated module.register when registerHooks is available', () => {
    const registerUrl = pathToFileURL(
      path.resolve(__dirname, '../../src/esm/register-esm.mjs'),
    ).href;
    const result = spawnSync(
      process.execPath,
      [
        '--trace-deprecation',
        '--input-type=module',
        '-e',
        `
import { registerPathsLoader } from ${JSON.stringify(registerUrl)};
const hooks = await registerPathsLoader({
  appDir: process.cwd(),
  baseUrl: process.cwd(),
  paths: {},
});
hooks?.deregister?.();
console.log('registered');
`,
      ],
      {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('registered');
    expect(result.stderr).not.toContain('DEP0205');
    expect(result.stderr).not.toContain('module.register() is deprecated');
  });
});
