import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fs } from '@modern-js/utils';
import { compile } from '../../../server/utils/src';

describe('BFF Node compiler', () => {
  test.each([
    ['commonjs', '>=26.10.0'],
    ['module', '^26.10.0 || >=28'],
  ] as const)(
    'compiles and runs %s output with the %s Node engine',
    async (moduleType, nodeEngine) => {
      const appDirectory = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), 'bff-node-engine-')),
      );
      const apiDirectory = path.join(appDirectory, 'api');
      const distDirectory = path.join(appDirectory, 'dist');
      const tsconfigPath = path.join(appDirectory, 'tsconfig.json');
      try {
        await fs.outputJSON(path.join(appDirectory, 'package.json'), {
          type: moduleType,
          engines: { node: nodeEngine },
        });
        await fs.outputJSON(tsconfigPath, {
          compilerOptions: {
            module: moduleType === 'module' ? 'esnext' : 'commonjs',
            moduleResolution: 'bundler',
            target: 'ES2022',
            types: [],
            noEmitOnError: true,
          },
          include: ['api'],
        });
        await fs.outputFile(
          path.join(apiDirectory, 'index.ts'),
          [
            'export const respond = (value?: string) => value ?? "node-api";',
            "export const load = () => import('./helper');",
            ...(moduleType === 'module'
              ? [
                  'declare global { interface ImportMeta { dirname: string } }',
                  'export const directory = import.meta.dirname;',
                ]
              : []),
            '',
          ].join('\n'),
        );
        await fs.outputFile(
          path.join(apiDirectory, 'helper.ts'),
          'export const value = "node-helper";\n',
        );

        await compile(
          appDirectory,
          {},
          {
            sourceDirs: [apiDirectory],
            distDir: distDirectory,
            tsconfigPath,
            moduleType,
            throwErrorInsteadOfExit: true,
          },
        );

        const output = path.join(distDirectory, 'api/index.js');
        expect(await fs.pathExists(`${output}.map`)).toBe(true);
        const api =
          moduleType === 'module'
            ? await import(pathToFileURL(output).href)
            : require(output);
        expect(api.respond()).toBe('node-api');
        expect(api.respond('response')).toBe('response');
        await expect(api.load()).resolves.toMatchObject({
          value: 'node-helper',
        });
        if (moduleType === 'module') {
          expect(api.directory).toBe(path.join(distDirectory, 'api'));
        }
      } finally {
        await fs.remove(appDirectory);
      }
    },
  );
});
