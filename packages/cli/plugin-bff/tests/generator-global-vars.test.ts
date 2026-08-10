import { fs } from '@modern-js/utils';
import os from 'os';
import path from 'path';
import { createBffGenerator } from '../src/cli/generator';
import { serializeServerGlobalVars } from '../src/cli/serverGlobalVars';

describe('BFF compiler global variables', () => {
  it('resolves the server option chain and rejects values without an exact JSON representation', () => {
    expect(
      serializeServerGlobalVars((_config: unknown, context: unknown) => ({
        CONTEXT: context,
        NULL_VALUE: null,
      })),
    ).toEqual({
      CONTEXT: '{"env":"server","target":"node"}',
      NULL_VALUE: 'null',
    });

    expect(() =>
      serializeServerGlobalVars({
        NOT_SERIALIZABLE: undefined,
      }),
    ).toThrow(
      'source.globalVars["NOT_SERIALIZABLE"] cannot be serialized exactly for BFF compilation.',
    );
  });

  it('emits a Node-executable Effect entry when it imports raw TypeScript from a workspace package', async () => {
    const workspaceDirectory = await fs.realpath(
      await fs.mkdtemp(
        path.join(os.tmpdir(), 'plugin-bff-workspace-typescript-'),
      ),
    );
    const appDirectory = path.join(workspaceDirectory, 'verticals', 'catalog');
    const apiDirectory = path.join(appDirectory, 'api');
    const sharedDirectory = path.join(appDirectory, 'shared');
    const distDirectory = path.join(appDirectory, 'dist');
    const packageDirectory = path.join(
      workspaceDirectory,
      'packages',
      'raw-contract',
    );
    const packageLink = path.join(
      appDirectory,
      'node_modules',
      '@fixture',
      'raw-contract',
    );
    const esmDependencyDirectory = path.join(
      appDirectory,
      'node_modules',
      '@fixture',
      'esm-runtime',
    );
    const tsconfigPath = path.join(appDirectory, 'tsconfig.json');

    await fs.outputJSON(path.join(packageDirectory, 'package.json'), {
      name: '@fixture/raw-contract',
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': './src/index.ts',
      },
    });
    await fs.outputFile(
      path.join(packageDirectory, 'src/index.ts'),
      "export const workspaceValue: string = 'raw-workspace-typescript';\n",
    );
    await fs.ensureDir(path.dirname(packageLink));
    await fs.symlink(
      packageDirectory,
      packageLink,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await fs.outputJSON(path.join(esmDependencyDirectory, 'package.json'), {
      name: '@fixture/esm-runtime',
      version: '1.0.0',
      type: 'module',
      exports: {
        types: './index.d.ts',
        default: './index.js',
      },
    });
    await fs.outputFile(
      path.join(esmDependencyDirectory, 'index.d.ts'),
      'export declare const runtimeValue: string;\n',
    );
    await fs.outputFile(
      path.join(esmDependencyDirectory, 'index.js'),
      "export const runtimeValue = 'esm-runtime';\n",
    );
    await fs.outputJSON(tsconfigPath, {
      compilerOptions: {
        declaration: false,
        module: 'CommonJS',
        moduleResolution: 'Node',
        noEmitOnError: true,
        target: 'ES2020',
      },
      include: ['api', 'shared'],
    });
    await fs.outputFile(
      path.join(apiDirectory, 'index.ts'),
      [
        "import { workspaceValue } from '@fixture/raw-contract';",
        "import { runtimeValue } from '@fixture/esm-runtime';",
        "export default () => workspaceValue + ':' + runtimeValue;",
        '',
      ].join('\n'),
    );

    const api = {
      getAppContext: () => ({
        appDirectory,
        apiDirectory,
        bffRuntimeFramework: 'effect',
        distDirectory,
        isProd: true,
        moduleType: 'commonjs',
        sharedDirectory,
      }),
      getNormalizedConfig: () => ({
        bff: {
          runtimeFramework: 'effect',
        },
        resolve: {},
        server: {
          tsconfigPath,
        },
        source: {},
      }),
    };

    try {
      const { compileApi } = createBffGenerator(api as never);
      await compileApi();

      const compiledEntry = path.join(distDirectory, 'api/index.js');
      await fs.remove(esmDependencyDirectory);
      const runtime = require(compiledEntry) as {
        default: () => string;
      };
      expect(runtime.default()).toBe('raw-workspace-typescript:esm-runtime');
    } finally {
      await fs.remove(workspaceDirectory);
    }
  });

  it('embeds exact release identity without touching near matches, strings, or comments', async () => {
    const appDirectory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-bff-global-vars-')),
    );
    const sharedDirectory = path.join(appDirectory, 'shared');
    const apiDirectory = path.join(appDirectory, 'api');
    const distDirectory = path.join(appDirectory, 'dist');
    const tsconfigPath = path.join(appDirectory, 'tsconfig.json');
    const buildMarker = 'catalog-build-2026.07.18+exact';
    const releaseVersion = '1.2.3-release.4';
    const sourceRevision = 'release/erp-10@4f2a9c7';

    await fs.outputJSON(tsconfigPath, {
      compilerOptions: {
        declaration: false,
        module: 'CommonJS',
        moduleResolution: 'Node',
        noEmitOnError: true,
        target: 'ES2020',
      },
      include: ['api', 'shared'],
    });
    await fs.outputFile(
      path.join(sharedDirectory, 'ultramodern-build.ts'),
      [
        'declare const ULTRAMODERN_BUILD_MARKER: string;',
        'declare const ULTRAMODERN_SOURCE_REVISION: string;',
        'declare const ULTRAMODERN_BUILD_MARKER_NEAR_MATCH: string;',
        '',
        '// ULTRAMODERN_BUILD_MARKER must remain a comment token.',
        "const markerTokenText = 'ULTRAMODERN_BUILD_MARKER';",
        'export const ultramodernApiMarker = {',
        '  buildMarker: ULTRAMODERN_BUILD_MARKER,',
        '  sourceRevision: ULTRAMODERN_SOURCE_REVISION,',
        '  markerTokenText,',
        '  nearMatchType:',
        "    typeof ULTRAMODERN_BUILD_MARKER_NEAR_MATCH === 'undefined'",
        "      ? 'undefined'",
        "      : 'defined',",
        '} as const;',
        '',
      ].join('\n'),
    );
    await fs.outputFile(
      path.join(apiDirectory, 'backend-federation.ts'),
      [
        'declare const ULTRAMODERN_BUILD_MARKER: string;',
        'declare const ULTRAMODERN_RELEASE_VERSION: string;',
        'declare const ULTRAMODERN_SOURCE_REVISION: string;',
        'export const backendFederationContract = {',
        '  buildMarker: ULTRAMODERN_BUILD_MARKER,',
        '  releaseVersion: ULTRAMODERN_RELEASE_VERSION,',
        '  sourceRevision: ULTRAMODERN_SOURCE_REVISION,',
        '};',
      ].join('\n'),
    );
    const unrelatedBrowserOutput = path.join(
      distDirectory,
      'static/browser.js',
    );
    await fs.outputFile(
      unrelatedBrowserOutput,
      'globalThis.browserMarker = ULTRAMODERN_BUILD_MARKER;\n',
    );
    const unrelatedBrowserStat = await fs.stat(unrelatedBrowserOutput);

    const api = {
      getAppContext: () => ({
        appDirectory,
        apiDirectory,
        distDirectory,
        isProd: true,
        moduleType: 'commonjs',
        sharedDirectory,
      }),
      getNormalizedConfig: () => ({
        resolve: {},
        server: {
          tsconfigPath,
        },
        source: {
          globalVars: {
            ULTRAMODERN_BUILD_MARKER: buildMarker,
            ULTRAMODERN_RELEASE_VERSION: releaseVersion,
            ULTRAMODERN_SOURCE_REVISION: sourceRevision,
          },
        },
      }),
    };

    try {
      const { compileApi } = createBffGenerator(api as never);
      await compileApi();

      const compiledPath = path.join(
        distDirectory,
        'shared/ultramodern-build.js',
      );
      expect(await fs.stat(unrelatedBrowserOutput)).toMatchObject({
        ino: unrelatedBrowserStat.ino,
        mtimeMs: unrelatedBrowserStat.mtimeMs,
        size: unrelatedBrowserStat.size,
      });

      const runtime = require(compiledPath) as {
        ultramodernApiMarker: {
          buildMarker: string;
          markerTokenText: string;
          nearMatchType: string;
          sourceRevision: string;
        };
      };
      expect(runtime.ultramodernApiMarker).toEqual({
        buildMarker,
        sourceRevision,
        markerTokenText: 'ULTRAMODERN_BUILD_MARKER',
        nearMatchType: 'undefined',
      });

      const compiledBackendFederation = require(
        path.join(distDirectory, 'api/backend-federation.js'),
      ) as {
        backendFederationContract: {
          buildMarker: string;
          releaseVersion: string;
          sourceRevision: string;
        };
      };
      expect(compiledBackendFederation.backendFederationContract).toEqual({
        buildMarker,
        releaseVersion,
        sourceRevision,
      });
    } finally {
      await fs.remove(appDirectory);
    }
  });
});
