import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { captureConfigSourceSnapshot } from '../../src/native-composition/config-evaluator/source-snapshot';
import { resolveReactMetadataServerPlugin } from '../../src/native-composition/react-build-metadata';
import { createRendererBuildIdentityResolver } from '../../src/native-composition/renderer-build-resolution';
import { resolveRendererProfileMetadata } from '../../src/native-composition/renderer-profile';
import { reactRendererRegistration } from '../../src/renderers/react/registration';

describe('React metadata owning public export resolution', () => {
  it.each([
    {
      name: 'no TanStack registration',
      selected: false,
      app: true,
      sdk: true,
      owner: undefined,
    },
    {
      name: 'the application before the SDK fallback',
      selected: true,
      app: true,
      sdk: true,
      owner: 'app',
    },
    {
      name: 'the SDK fallback without an application package',
      selected: true,
      app: false,
      sdk: true,
      owner: 'sdk',
    },
    {
      name: 'neither application nor SDK package',
      selected: true,
      app: false,
      sdk: false,
      owner: undefined,
    },
  ] as const)('resolves the React build cohort with $name', ({
    selected,
    app,
    sdk,
    owner,
  }) => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'um-react-cohort-owner-'),
    );
    const appDirectory = path.join(workspace, 'app');
    const sdkDirectory = path.join(workspace, 'sdk');
    const registrarDirectory = path.join(sdkDirectory, 'src', 'composition');
    const filenames: Partial<Record<'app' | 'sdk', string>> = {};
    try {
      fs.mkdirSync(appDirectory, { recursive: true });
      fs.mkdirSync(registrarDirectory, { recursive: true });
      for (const [host, enabled] of [
        ['app', app],
        ['sdk', sdk],
      ] as const) {
        if (!enabled) continue;
        const packageDirectory = path.join(
          workspace,
          host,
          'node_modules',
          '@modern-js/plugin-tanstack',
        );
        const filename = path.join(packageDirectory, 'dist', 'cli.cjs');
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, 'module.exports = {};\n');
        fs.writeFileSync(
          path.join(packageDirectory, 'package.json'),
          JSON.stringify({
            name: '@modern-js/plugin-tanstack',
            version: '1.0.0',
            exports: { '.': { node: { require: './dist/cli.cjs' } } },
          }),
        );
        filenames[host] = fs.realpathSync(filename);
      }
      const resolve = () =>
        reactRendererRegistration.resolveBuildFrameworkModules({
          appDirectory,
          registrarDirectory,
          pluginNames: selected
            ? ['@modern-js/plugin-tanstack']
            : ['@modern-js/plugin-router'],
        });
      if (!selected) expect(resolve()).toEqual([]);
      else if (owner)
        expect(resolve()).toEqual([
          {
            specifier: '@modern-js/plugin-tanstack',
            filename: filenames[owner],
          },
        ]);
      else
        expect(resolve).toThrow(
          new Error(
            'The registered TanStack entry owner cannot be resolved from the application or selected framework',
          ),
        );
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it.each([
    { input: 'unrelated', changesIdentity: false },
    { input: 'compiled', changesIdentity: true },
    { input: 'configuration', changesIdentity: true },
    { input: 'packageMetadata', changesIdentity: true },
  ] as const)('selects actual compiler and consumed configuration inputs: $input', async ({
    input,
    changesIdentity,
  }) => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'um-react-inputs-'),
    );
    const root = path.join(workspace, 'app');
    const compiled = path.join(workspace, 'compiled.js');
    const configuration = path.join(workspace, 'configuration.js');
    const packageMetadata = path.join(workspace, 'package.json');
    const unrelated = path.join(workspace, 'unrelated.js');
    const owner = resolveRendererProfileMetadata(
      'react',
    ).frameworkPackages.find(
      binding => binding.specifier === '@modern-js/ultramodern-app-tools',
    )!;
    try {
      fs.mkdirSync(root);
      const hosting = path.join(root, 'node_modules', owner.specifier);
      fs.mkdirSync(path.dirname(hosting), { recursive: true });
      fs.symlinkSync(owner.directory, hosting, 'dir');
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          name: 'actual-react-inputs',
          private: true,
          dependencies: {
            [owner.specifier]:
              owner.name === owner.specifier
                ? owner.version
                : `npm:${owner.name}@${owner.version}`,
          },
        }),
      );
      fs.writeFileSync(compiled, 'export const compiled = 1;\n');
      fs.writeFileSync(configuration, 'export const configuration = 1;\n');
      fs.writeFileSync(packageMetadata, '{"name":"observed-config-owner"}\n');
      fs.writeFileSync(unrelated, 'export const unrelated = 1;\n');
      const resolve = createRendererBuildIdentityResolver('react');
      const context: Parameters<typeof resolve>[0] = {
        appDirectory: root,
        internalDirectory: path.join(root, 'internal'),
        distDirectory: path.join(root, 'dist'),
        packageName: 'actual-react-inputs',
        entrypoints: [
          { entryName: 'main', isMainEntry: true, entry: compiled },
        ],
        mode: 'production',
        pluginNames: ['@modern-js/plugin-router'],
        config: {
          source: {},
          output: {},
          server: {},
          html: {},
          bff: {},
          deploy: {},
          experiments: {},
        } as Parameters<typeof resolve>[0]['config'],
        inputFiles: Object.freeze([
          compiled,
          path.join(workspace, 'node_modules', 'installed', 'missing.js'),
        ]),
        consumedSourceInputs: {
          kind: 'observed-config-source-inputs',
          version: 1,
          observations: [
            {
              path: configuration,
              canonicalPath: configuration,
              operation: 'content',
              existed: true,
            },
            {
              path: workspace,
              canonicalPath: workspace,
              operation: 'directory',
              existed: true,
            },
          ],
          packageMetadata: [
            {
              path: packageMetadata,
              canonicalPath: packageMetadata,
              field: 'name',
              value: 'observed-config-owner',
            },
          ],
        },
        configurationSourceSnapshot: captureConfigSourceSnapshot({
          sourceRoots: [root],
          extraInputs: [configuration, packageMetadata, unrelated, workspace],
        }),
      };
      const initial = await resolve(context);
      fs.writeFileSync(
        { compiled, configuration, packageMetadata, unrelated }[input],
        input === 'packageMetadata'
          ? '{"name":"changed-config-owner"}\n'
          : `export const ${input} = 2;\n`,
      );
      const changed = await resolve(context);
      if (changesIdentity)
        expect(changed.inputDigest).not.toBe(initial.inputDigest);
      else expect(changed.inputDigest).toBe(initial.inputDigest);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it.each([
    '@modern-js/ultramodern-app-tools',
    '@bleedingdev/modern-js-ultramodern-app-tools',
  ])('self-resolves the mapped package hosted under %s', async dependencyKey => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-react-owner-'));
    const owner = path.join(root, 'node_modules', dependencyKey);
    const registrar = path.join(
      owner,
      'src/native-composition/react-build-metadata.ts',
    );
    const target = path.join(owner, 'dist/react-build-metadata-server.cjs');
    try {
      fs.mkdirSync(path.dirname(registrar), { recursive: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        'module.exports = () => ({ name: "real-owner" });',
      );
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'isolated-consumer' }),
      );
      fs.writeFileSync(
        path.join(owner, 'package.json'),
        JSON.stringify({
          name: '@bleedingdev/modern-js-ultramodern-app-tools',
          exports: {
            './react-build-metadata-server': {
              node: {
                require: './dist/react-build-metadata-server.cjs',
              },
            },
          },
        }),
      );
      const resolved = await resolveReactMetadataServerPlugin(
        pathToFileURL(registrar).href,
      );
      expect(resolved).toBe(fs.realpathSync(target));
      const requireFromApplication = createRequire(
        path.join(root, 'package.json'),
      );
      expect(requireFromApplication(resolved)().name).toBe('real-owner');
      if (dependencyKey === '@modern-js/ultramodern-app-tools')
        expect(() =>
          requireFromApplication.resolve(
            '@bleedingdev/modern-js-ultramodern-app-tools/react-build-metadata-server',
          ),
        ).toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a foreign registrar instead of loading an application-selected package', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-react-foreign-'));
    try {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'foreign-owner', exports: {} }),
      );
      await expect(
        resolveReactMetadataServerPlugin(
          pathToFileURL(path.join(root, 'source.ts')).href,
        ),
      ).rejects.toThrow('not its owning package');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
