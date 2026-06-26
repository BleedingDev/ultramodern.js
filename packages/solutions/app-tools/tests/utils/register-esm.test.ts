import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

describe('registerPathsLoader', () => {
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
