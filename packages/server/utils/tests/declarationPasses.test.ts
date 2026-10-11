import { fs } from '@modern-js/utils';
import * as actualRslib from '@rslib/core' with { rstest: 'importActual' };
import type { LibConfig } from '@rslib/core';
import os from 'os';
import path from 'path';
import { compile } from '../src';

const libConfigs: LibConfig[][] = [];

rstest.mock('@rslib/core', () => ({
  ...actualRslib,
  createRslib: (options: Parameters<typeof actualRslib.createRslib>[0]) => {
    libConfigs.push(options?.config?.lib ?? []);
    return actualRslib.createRslib(options);
  },
}));

describe('declarations across compile passes', () => {
  it('emits the declarations of every pass once, in the first pass', async () => {
    const appDirectory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'server-utils-dts-passes-')),
    );
    const distDir = path.join(appDirectory, 'dist');
    try {
      await fs.outputJSON(path.join(appDirectory, 'tsconfig.json'), {
        compilerOptions: {
          declaration: true,
          module: 'commonjs',
          target: 'ES2022',
          types: [],
        },
        include: ['api'],
      });
      // `api/` reaches `lib/a.ts`, which reaches `lib/b.ts`: three passes.
      await fs.outputFile(
        path.join(appDirectory, 'api/index.ts'),
        "export { a } from '../lib/a';\n",
      );
      await fs.outputFile(
        path.join(appDirectory, 'lib/a.ts'),
        "import { b } from './b';\n\nexport const a = (): string => 'a' + b;\n",
      );
      await fs.outputFile(
        path.join(appDirectory, 'lib/b.ts'),
        "export const b: string = 'b';\n",
      );

      await compile(
        appDirectory,
        {},
        {
          sourceDirs: [path.join(appDirectory, 'api')],
          distDir,
          tsconfigPath: path.join(appDirectory, 'tsconfig.json'),
          throwErrorInsteadOfExit: true,
        },
      );

      expect(libConfigs).toHaveLength(3);
      expect(libConfigs.map(libs => libs.some(lib => lib.dts))).toEqual([
        true,
        false,
        false,
      ]);
      for (const file of ['api/index.d.ts', 'lib/a.d.ts', 'lib/b.d.ts']) {
        expect(await fs.pathExists(path.join(distDir, file))).toBe(true);
      }
      expect(
        await fs.readFile(path.join(distDir, 'lib/a.d.ts'), 'utf8'),
      ).toContain('export declare const a: () => string;');
      const api = require(path.join(distDir, 'api/index.js'));
      expect(api.a()).toBe('ab');
    } finally {
      await fs.remove(appDirectory);
    }
  });
});
