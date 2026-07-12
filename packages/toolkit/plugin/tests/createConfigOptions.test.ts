import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@rstest/core';
import { createConfigOptions } from '../src/cli';

describe('createConfigOptions', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })),
    );
  });

  it('loads internal plugins before user config plugins', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'modern-plugin-config-'));
    tempDirs.push(cwd);

    await writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'create-config-options-test' }),
    );
    await writeFile(
      path.join(cwd, 'modern.config.cjs'),
      `
module.exports = {
  plugins: [
    {
      name: 'user-plugin',
      required: ['internal-plugin'],
      setup() {},
    },
  ],
};
`,
    );

    const result = await createConfigOptions({
      command: 'rstest',
      configFile: 'modern.config.cjs',
      cwd,
      internalPlugins: [
        {
          name: 'internal-plugin',
          setup() {},
        },
      ],
    });

    expect(result.getAppContext().plugins.map(plugin => plugin.name)).toEqual([
      'internal-plugin',
      'user-plugin',
    ]);
  });

  it('supports commands that intentionally run without a config file', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'modern-plugin-configless-'));
    tempDirs.push(cwd);

    await writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'create-config-options-configless-test' }),
    );

    const result = await createConfigOptions({
      command: 'serve',
      configFile: false,
      config: {},
      cwd,
    });

    expect(result.getAppContext().configFile).toBe(false);
    expect(result.config).toEqual({});
  });
});
