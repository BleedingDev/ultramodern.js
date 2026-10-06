import { fs } from '@modern-js/utils';
import os from 'os';
import path from 'path';
import clientGenerator, {
  buildClientTypeFacade,
  readDirectoryFiles,
} from '../src/utils/clientGenerator';

describe('clientGenerator', () => {
  it('does not advertise API exports when no client artifacts are generated', async () => {
    const appDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bff-client-gen-'));
    const lambdaDir = path.join(appDir, 'api', 'lambda');

    try {
      await fs.mkdir(lambdaDir, { recursive: true });
      await fs.writeFile(
        path.join(lambdaDir, 'user.ts'),
        'export default function handler() {}',
      );
      await fs.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: 'test-app' }, null, 2),
      );

      await clientGenerator({
        prefix: '/api',
        appDir,
        apiDir: path.join(appDir, 'api'),
        lambdaDir,
        existLambda: false,
        relativeDistPath: 'dist',
        relativeApiPath: 'api',
        apiFiles: [path.join(lambdaDir, 'user.ts')],
      });

      const packageJson = await fs.readJSON(path.join(appDir, 'package.json'));
      expect(packageJson.exports).not.toHaveProperty('./api/*');
    } finally {
      await fs.remove(appDir);
    }
  });

  it('publishes every declaration under the configured distPath', async () => {
    // A non-default distPath guards against the glob being hardcoded to `dist`.
    const relativeDistPath = 'dist-1';
    const appDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bff-client-gen-'));
    const lambdaDir = path.join(appDir, 'api', 'lambda');

    try {
      await fs.mkdir(lambdaDir, { recursive: true });
      await fs.writeFile(
        path.join(lambdaDir, 'user.ts'),
        'export default function handler() {}',
      );
      await fs.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: 'test-app' }, null, 2),
      );

      await clientGenerator({
        prefix: '/api',
        appDir,
        apiDir: path.join(appDir, 'api'),
        lambdaDir,
        existLambda: false,
        relativeDistPath,
        relativeApiPath: 'api',
        apiFiles: [path.join(lambdaDir, 'user.ts')],
      });

      const packageJson = JSON.parse(
        await fs.readFile(path.join(appDir, 'package.json'), 'utf8'),
      );

      expect(packageJson.files).toContain(`${relativeDistPath}/**/*.d.ts`);
    } finally {
      await fs.remove(appDir);
    }
  });

  describe('readDirectoryFiles', () => {
    it('only processes the API files it is handed, ignoring stray artifacts', async () => {
      const appDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bff-read-dir-'));
      const lambdaDir = path.join(appDir, 'api', 'lambda');

      try {
        await fs.mkdir(lambdaDir, { recursive: true });
        const apiFile = path.join(lambdaDir, 'index.ts');
        await fs.writeFile(apiFile, 'export default () => {};');
        // Stray artifacts a bare readdir would have swept in.
        await fs.writeFile(path.join(lambdaDir, 'index.d.ts'), '');
        await fs.writeFile(path.join(lambdaDir, 'index.test.ts'), '');

        const files = await readDirectoryFiles(appDir, lambdaDir, 'dist', [
          apiFile,
        ]);

        expect(files).toHaveLength(1);
        expect(files[0].resourcePath).toBe(apiFile);
      } finally {
        await fs.remove(appDir);
      }
    });
  });

  describe('buildClientTypeFacade', () => {
    it('re-exports the default binding only when the module has one', () => {
      const withDefault = buildClientTypeFacade(
        './dist/client/index.d.ts',
        './dist/api/lambda/index.d.ts',
        true,
      );
      // Relative, POSIX, and no `.d.ts` suffix.
      expect(withDefault).toContain(
        `export { default } from '../api/lambda/index';`,
      );
      expect(withDefault).toContain(`export * from '../api/lambda/index';`);

      const withoutDefault = buildClientTypeFacade(
        './dist/client/upload.d.ts',
        './dist/api/lambda/upload.d.ts',
        false,
      );
      expect(withoutDefault).not.toContain('export { default }');
      expect(withoutDefault).toContain(`export * from '../api/lambda/upload';`);
    });

    it('appends a .js extension to the re-export in esm output', () => {
      const facade = buildClientTypeFacade(
        './dist/client/index.d.ts',
        './dist/api/lambda/index.d.ts',
        true,
        true,
      );
      // node16/nodenext consumers need the explicit extension; TS maps
      // `./x.js` back to `./x.d.ts`.
      expect(facade).toContain(
        `export { default } from '../api/lambda/index.js';`,
      );
      expect(facade).toContain(`export * from '../api/lambda/index.js';`);
    });

    it('resolves the specifier from nested client locations', () => {
      const facade = buildClientTypeFacade(
        './dist/client/user/index.d.ts',
        './dist/api/lambda/user/index.d.ts',
        false,
      );
      expect(facade).toContain(`export * from '../../api/lambda/user/index';`);
    });
  });
});

describe('BFF extension artifact publication', () => {
  async function fixture() {
    const appDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bff-artifacts-'));
    const apiDir = path.join(appDir, 'api');
    await fs.ensureDir(apiDir);
    await fs.outputJSON(path.join(appDir, 'package.json'), {
      name: 'artifact-producer',
    });
    const options = {
      appDir,
      apiDir,
      lambdaDir: path.join(apiDir, 'lambda'),
      prefix: '/api',
      existLambda: false,
      relativeDistPath: 'output',
      relativeApiPath: 'api',
      apiFiles: [],
    };
    const generation = {
      appDirectory: appDir,
      apiDirectory: apiDir,
      lambdaDirectory: options.lambdaDir,
      prefix: '/api',
      existLambda: false,
      relativeDistPath: 'output',
      apiFiles: [],
      requestId: 'artifact-producer',
    };
    return { appDir, options, generation };
  }

  test('publishes extension code and declarations with one final manifest write after entries', async () => {
    const { appDir, options, generation } = await fixture();
    try {
      const write = rstest.spyOn(fs.promises, 'writeFile');
      await clientGenerator(options, {
        generation,
        modifyArtifacts: async context => ({
          ...context,
          additionalArtifacts: [
            {
              sourcePath: 'effect/index.ts',
              code: 'export const client = 42;',
              declaration: 'export declare const client: 42;',
            },
          ],
        }),
        beforePublish: async () => {
          expect(
            await fs.readFile(
              path.join(appDir, 'output/client/effect/index.js'),
              'utf8',
            ),
          ).toBe('export const client = 42;');
          expect(
            (await fs.readJSON(path.join(appDir, 'package.json'))).exports,
          ).toBeUndefined();
          return { '@fixture/producer-runtime': '1.2.3' };
        },
      });
      expect(
        write.mock.calls.filter(
          ([file]) => file === path.join(appDir, 'package.json'),
        ),
      ).toHaveLength(1);
      const manifest = await fs.readJSON(path.join(appDir, 'package.json'));
      expect(manifest.dependencies).toEqual({
        '@fixture/producer-runtime': '1.2.3',
      });
      expect(manifest.exports['./api/effect/index']).toMatchObject({
        import: './output/client/effect/index.js',
        types: './output/client/effect/index.d.ts',
      });
      expect(
        await fs.readFile(
          path.join(appDir, 'output/client/effect/index.d.ts'),
          'utf8',
        ),
      ).toBe('export declare const client: 42;');
      expect(
        (await fs.readJSON(path.join(appDir, 'output/client/package.json')))
          .type,
      ).toBe('module');
    } finally {
      rstest.restoreAllMocks();
      await fs.remove(appDir);
    }
  });

  test.each([
    '../outside.ts',
    '/absolute.ts',
    'a/../entry.ts',
    'nested\\entry.ts',
    'entry.txt',
  ])('rejects invalid artifact source path %s', async sourcePath => {
    const { appDir, options, generation } = await fixture();
    try {
      await expect(
        clientGenerator(options, {
          generation,
          modifyArtifacts: async context => ({
            ...context,
            additionalArtifacts: [{ sourcePath, code: '', declaration: '' }],
          }),
          beforePublish: async () => {},
        }),
      ).rejects.toThrow('Invalid BFF client artifact source path');
    } finally {
      await fs.remove(appDir);
    }
  });

  test('rejects duplicate generated export/output identities before publishing', async () => {
    const { appDir, options, generation } = await fixture();
    try {
      await expect(
        clientGenerator(options, {
          generation,
          modifyArtifacts: async context => ({
            ...context,
            additionalArtifacts: ['index.ts', 'index.js'].map(sourcePath => ({
              sourcePath,
              code: '',
              declaration: '',
            })),
          }),
          beforePublish: async () => {
            throw new Error('must not reach publisher');
          },
        }),
      ).rejects.toThrow('BFF client artifact collision');
      expect(
        (await fs.readJSON(path.join(appDir, 'package.json'))).exports,
      ).toBeUndefined();
    } finally {
      await fs.remove(appDir);
    }
  });

  test('rejects dependency conflicts without changing the existing manifest', async () => {
    const { appDir, options, generation } = await fixture();
    const manifest = {
      name: 'artifact-producer',
      dependencies: { '@fixture/runtime': '1.0.0' },
    };
    await fs.outputJSON(path.join(appDir, 'package.json'), manifest);
    try {
      await expect(
        clientGenerator(options, {
          generation,
          modifyArtifacts: async context => context,
          beforePublish: async () => ({ '@fixture/runtime': '2.0.0' }),
        }),
      ).rejects.toThrow('package.json dependency conflict');
      expect(await fs.readJSON(path.join(appDir, 'package.json'))).toEqual(
        manifest,
      );
    } finally {
      await fs.remove(appDir);
    }
  });

  test('extension failures propagate and cannot replace generation identity', async () => {
    const { appDir, options, generation } = await fixture();
    try {
      await expect(
        clientGenerator(options, {
          generation,
          modifyArtifacts: async () => {
            throw new Error('extension rejected');
          },
          beforePublish: async () => {},
        }),
      ).rejects.toThrow('extension rejected');
      await expect(
        clientGenerator(options, {
          generation,
          modifyArtifacts: async context => ({
            ...context,
            generation: { ...generation },
          }),
          beforePublish: async () => {},
        }),
      ).rejects.toThrow('generation identity');
    } finally {
      await fs.remove(appDir);
    }
  });
});

describe('native client transform publication', () => {
  test.each([false, true])(
    'routes the configured plugin to lambda rendering and preserves publication on failure=%s',
    async reject => {
      const appDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'bff-transform-publish-'),
      );
      try {
        const lambdaDir = path.join(appDir, 'api/lambda');
        const resourcePath = path.join(lambdaDir, 'ping.ts');
        await fs.outputFile(resourcePath, 'export default () => "pong";');
        await fs.outputFile(
          path.join(appDir, 'dist/api/lambda/ping.d.ts'),
          'declare const handler: () => string; export default handler;',
        );
        const manifest = { name: 'neutral-transform-producer' };
        await fs.outputJSON(path.join(appDir, 'package.json'), manifest);
        const plugin = path.join(appDir, 'transform.cjs');
        await fs.writeFile(
          plugin,
          reject
            ? 'exports.modifyClient = () => { throw new Error("rejected publication"); };'
            : 'exports.modifyClient = draft => { draft.statements.push("export const neutralValue = 42;"); };',
        );
        const publication = clientGenerator({
          appDir,
          apiDir: path.join(appDir, 'api'),
          lambdaDir,
          prefix: '/api',
          port: 3000,
          existLambda: true,
          relativeDistPath: 'dist',
          relativeApiPath: 'api',
          apiFiles: [resourcePath],
          clientCodegenPlugin: plugin,
          requestId: 'configured-client-id',
        });
        if (reject) {
          await expect(publication).rejects.toMatchObject({
            name: 'ClientCodegenError',
          });
          expect(await fs.readJSON(path.join(appDir, 'package.json'))).toEqual(
            manifest,
          );
        } else {
          await publication;
          expect(
            await fs.readFile(path.join(appDir, 'dist/client/ping.js'), 'utf8'),
          ).toContain('neutralValue = 42');
          expect(
            await fs.readFile(path.join(appDir, 'dist/client/ping.js'), 'utf8'),
          ).toContain('requestId: "configured-client-id"');
          expect(
            await fs.readFile(
              path.join(appDir, 'dist/client/ping.d.ts'),
              'utf8',
            ),
          ).toContain('../api/lambda/ping.js');
          expect(
            (await fs.readJSON(path.join(appDir, 'package.json'))).exports,
          ).toHaveProperty('./api/ping');
        }
      } finally {
        await fs.remove(appDir);
      }
    },
  );
});
