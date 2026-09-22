import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as utils from '@modern-js/utils' with { rstest: 'importActual' };
import { loadInternalPlugins } from '../../src/utils/loadPlugins';

const mockCompatibleRequire = rstest.fn(async (..._args: unknown[]) => {
  throw new Error('Plugin requires the native ESM loader.');
});

rstest.mock('@modern-js/utils', () => ({
  __esModule: true,
  ...utils,
  compatibleRequire: (...args: unknown[]) => mockCompatibleRequire(...args),
  dynamicImport: async (specifier: string) => ({
    default: JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          'console.log(JSON.stringify((await import(process.argv[1])).default))',
          specifier,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    ),
  }),
}));

it('loads async ESM CLI plugins from paths containing URL delimiters', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-plugin #'));
  const plugin = path.join(directory, 'async-plugin.mjs');
  try {
    fs.writeFileSync(
      plugin,
      'await Promise.resolve(); export default { name: "async-plugin" };',
    );
    await expect(
      loadInternalPlugins(directory, {
        'async-plugin': { path: plugin, forced: true },
      }),
    ).resolves.toEqual([{ name: 'async-plugin' }]);
    expect(mockCompatibleRequire).toHaveBeenCalled();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

import { execFileSync } from 'node:child_process';
