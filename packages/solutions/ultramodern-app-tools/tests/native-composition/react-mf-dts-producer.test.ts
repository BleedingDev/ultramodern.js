import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  assertRendererGeneratedOutputOperationsAllowed,
  immutableRendererGeneratedOutputRegistration,
  type RendererGeneratedOutputValue,
} from '../../../app-tools-extensions/src/renderer-generated-outputs';
import {
  receiverOutputPath,
  resolveNativeReactReceiverCore,
  resolveReactReceiverDestinations,
  resolveReactReceiverImplementation,
  resolveReactReceiverProducer,
} from '../../src/native-composition/react-mf-dts-producer';
import type { ReceiverBeginDetails } from '../../src/native-composition/react-mf-dts-registry';
import { readRendererFrameworkPackage } from '../../src/native-composition/renderer-installed-profile';

const repositoryRoot = path.resolve(__dirname, '../../../../..');
const nativeApp = path.join(
  repositoryRoot,
  'tests/integration/routes-tanstack-mf/mf-remote',
);
const appRequire = createRequire(path.join(nativeApp, 'package.json'));
const nativeModule = appRequire.resolve(
  '@module-federation/modern-js-v3/ssr-plugin',
);
const nativeRequire = createRequire(nativeModule);
const enhancedModule = nativeRequire.resolve(
  '@module-federation/enhanced/rspack',
);
const rspackModule = createRequire(enhancedModule).resolve(
  '@module-federation/rspack/plugin',
);
const corePath = fs.realpathSync(
  createRequire(rspackModule).resolve('@module-federation/dts-plugin/core'),
);
const nativeOwner = readRendererFrameworkPackage({
  specifier: '@module-federation/modern-js-v3/ssr-plugin',
  filename: nativeModule,
});
const coreOwner = readRendererFrameworkPackage({
  specifier: '@module-federation/dts-plugin/core',
  filename: corePath,
});
const enhancedOwner = readRendererFrameworkPackage({
  specifier: '@module-federation/enhanced/rspack',
  filename: enhancedModule,
});
const rspackOwner = readRendererFrameworkPackage({
  specifier: '@module-federation/rspack/plugin',
  filename: rspackModule,
});
const managers = createRequire(corePath)('@module-federation/managers') as {
  utils: {
    parseOptions(
      options: RendererGeneratedOutputValue,
      simple: (item: unknown, key: string) => { key: string },
      complex: (item: unknown, key: string) => { key: string },
    ): [string, { key: string }][];
  };
};
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-dts-producer-'),
    ),
  );
  roots.push(root);
  const appDirectory = path.join(root, 'app');
  fs.mkdirSync(path.join(appDirectory, 'node_modules/@module-federation'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(appDirectory, 'package.json'),
    JSON.stringify({ name: 'native-dts-producer-fixture', version: '1.0.0' }),
  );
  // The fixture uses the genuine installed native plugin and its own public
  // dependency resolution. No resolution hook substitutes the DTS owner.
  fs.symlinkSync(
    nativeOwner.directory,
    path.join(appDirectory, 'node_modules/@module-federation/modern-js-v3'),
    'dir',
  );
  return { root, appDirectory };
}

function details(
  appDirectory: string,
  remotes: RendererGeneratedOutputValue = {
    alpha: 'alpha@http://localhost:3011/remoteEntry.js',
  },
  hostOptions: Record<string, RendererGeneratedOutputValue> = {},
): ReceiverBeginDetails {
  return {
    operation: 'consumeTypes',
    nativeOptions: {
      host: {
        context: appDirectory,
        moduleFederationConfig: { name: 'host', remotes },
        typesFolder: '@mf-types',
        ...hostOptions,
      },
    },
  };
}

const subtreeAliases = (
  destinations: Awaited<
    ReturnType<typeof resolveReactReceiverDestinations>
  >['destinations'],
) =>
  destinations
    .filter(destination => destination.scope === 'subtree')
    .map(destination => path.basename(destination.path.lexical))
    .sort();

describe('native receiver output destinations', () => {
  for (const [name, remotes] of [
    [
      'object',
      {
        beta: { external: ['beta@http://localhost:3012/remoteEntry.js'] },
        alpha: 'alpha@http://localhost:3011/remoteEntry.js',
      },
    ],
    [
      'array',
      [
        { beta: 'beta@http://localhost:3012/remoteEntry.js' },
        { alpha: ['alpha@http://localhost:3011/remoteEntry.js'] },
      ],
    ],
  ] as const) {
    it(`registers the aliases parsed by native MF ${name} remotes`, async () => {
      const { appDirectory } = fixture();
      const parsed = managers.utils.parseOptions(
        remotes,
        (_item, key) => ({ key }),
        (_item, key) => ({ key }),
      );
      const output = await resolveReactReceiverDestinations(
        details(appDirectory, remotes),
      );
      expect(subtreeAliases(output.destinations)).toEqual(
        parsed.map(([, item]) => item.key).sort(),
      );
      expect(subtreeAliases(output.destinations)).toEqual(['alpha', 'beta']);
      expect(output.destinations).toContainEqual({
        path: {
          lexical: path.join(appDirectory, '@mf-types/index.d.ts'),
          canonical: path.join(appDirectory, '@mf-types/index.d.ts'),
        },
        kind: 'file',
        scope: 'exact',
      });
      expect(
        output.destinations
          .filter(
            destination =>
              destination.kind === 'directory' && destination.scope === 'exact',
          )
          .map(destination => destination.path.lexical),
      ).toEqual([path.join(appDirectory, '@mf-types'), appDirectory].sort());
      expect(Object.isFrozen(output)).toBe(true);
      expect(Object.isFrozen(output.destinations)).toBe(true);
      expect(output.destinations.every(Object.isFrozen)).toBe(true);
    });
  }

  it('includes resolved URL aliases without recursively granting siblings', async () => {
    const { appDirectory } = fixture();
    const output = await resolveReactReceiverDestinations(
      details(
        appDirectory,
        { alpha: 'alpha@http://localhost:3011/entry.js' },
        {
          remoteTypeUrls: {
            actualRemote: { alias: 'gamma', zip: 'http://localhost/types.zip' },
            fallbackRemote: { zip: 'http://localhost/fallback.zip' },
          },
        },
      ),
    );
    expect(subtreeAliases(output.destinations)).toEqual([
      'alpha',
      'fallbackRemote',
      'gamma',
    ]);
    expect(
      output.destinations.some(
        destination =>
          destination.path.lexical === path.join(appDirectory, '@mf-types') &&
          destination.scope === 'subtree',
      ),
    ).toBe(false);
    expect(
      output.destinations.some(
        destination =>
          destination.path.lexical ===
          path.join(appDirectory, '@mf-types/unknown'),
      ),
    ).toBe(false);
    expect(
      output.destinations.some(
        destination =>
          destination.path.lexical === appDirectory &&
          destination.scope === 'subtree',
      ),
    ).toBe(false);
  });

  it('registers a configured external folder with exact ancestors', async () => {
    const { root, appDirectory } = fixture();
    const outside = path.join(root, 'generated/types');
    const output = await resolveReactReceiverDestinations(
      details(appDirectory, undefined, { typesFolder: outside }),
    );
    expect(subtreeAliases(output.destinations)).toEqual(['alpha']);
    expect(
      output.destinations
        .filter(
          destination =>
            destination.scope === 'exact' && destination.kind === 'directory',
        )
        .map(destination => destination.path.lexical),
    ).toEqual([outside, path.dirname(outside), root].sort());
    expect(
      output.destinations.some(
        destination =>
          destination.path.lexical === root && destination.scope === 'subtree',
      ),
    ).toBe(false);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('registers safe native nested aliases with exact intermediate directories', async () => {
    const { appDirectory } = fixture();
    const output = await resolveReactReceiverDestinations(
      details(appDirectory, {
        '@scope/remote': 'remote@http://localhost/entry.js',
      }),
    );
    const folder = path.join(appDirectory, '@mf-types');
    expect(output.destinations).toContainEqual({
      path: {
        lexical: path.join(folder, '@scope/remote'),
        canonical: path.join(folder, '@scope/remote'),
      },
      kind: 'directory',
      scope: 'subtree',
    });
    expect(output.destinations).toContainEqual({
      path: {
        lexical: path.join(folder, '@scope'),
        canonical: path.join(folder, '@scope'),
      },
      kind: 'directory',
      scope: 'exact',
    });
    expect(
      output.destinations.some(
        destination =>
          destination.path.lexical === path.join(folder, '@scope') &&
          destination.scope === 'subtree',
      ),
    ).toBe(false);
  });

  it('admits native no-remote consumption without granting an alias subtree', async () => {
    const { appDirectory } = fixture();
    const output = await resolveReactReceiverDestinations(
      details(appDirectory, {}),
    );
    expect(
      output.destinations.some(destination => destination.scope === 'subtree'),
    ).toBe(false);
    expect(
      output.destinations.find(destination => destination.kind === 'file')?.path
        .lexical,
    ).toBe(path.join(appDirectory, '@mf-types/index.d.ts'));
    expect(fs.existsSync(path.join(appDirectory, '@mf-types'))).toBe(false);
  });

  it('binds only the actual native dynamic update alias and detached request', async () => {
    const { appDirectory } = fixture();
    const update = {
      remoteName: 'dynamic',
      once: false,
      remoteInfo: {
        name: 'dynamic',
        alias: 'new-request-alias',
        url: 'http://localhost/entry.js',
      },
    };
    const output = await resolveReactReceiverDestinations({
      ...details(appDirectory),
      operation: 'updateTypes',
      update,
      remoteAlias: '@scope/cached',
    });
    expect(
      output.destinations.filter(
        destination => destination.scope === 'subtree',
      ),
    ).toEqual([
      {
        path: {
          lexical: path.join(appDirectory, '@mf-types/@scope/cached'),
          canonical: path.join(appDirectory, '@mf-types/@scope/cached'),
        },
        kind: 'directory',
        scope: 'subtree',
      },
    ]);
    expect(output.context).toMatchObject({
      nativeUpdate: { request: update, remoteAlias: '@scope/cached' },
    });
    update.remoteInfo.alias = 'mutated-after-registration';
    expect(JSON.stringify(output.context)).not.toContain(
      'mutated-after-registration',
    );
    expect(
      output.destinations.some(destination =>
        destination.path.lexical.endsWith('new-request-alias'),
      ),
    ).toBe(false);
  });

  it('rejects missing native update evidence and unsafe actual aliases before IO', async () => {
    const { appDirectory } = fixture();
    for (const input of [
      { operation: 'updateTypes', remoteAlias: 'alpha' },
      {
        operation: 'updateTypes',
        remoteAlias: '../outside',
        update: { remoteName: 'alpha' },
      },
      {
        operation: 'updateTypes',
        remoteAlias: 'unconfigured',
        update: { remoteName: 'unknown' },
      },
    ] as const)
      await expect(
        resolveReactReceiverDestinations({
          ...details(appDirectory),
          ...input,
        }),
      ).rejects.toThrow();
    expect(fs.existsSync(path.join(appDirectory, '@mf-types'))).toBe(false);
  });

  for (const badAlias of ['../outside', 'nested\\alias', '.', '..', '']) {
    it(`rejects the unsafe native alias ${JSON.stringify(badAlias)}`, async () => {
      const { appDirectory } = fixture();
      await expect(
        resolveReactReceiverDestinations(
          details(appDirectory, {
            [badAlias]: 'remote@http://localhost/entry.js',
          }),
        ),
      ).rejects.toThrow('exact relative destination alias');
      expect(fs.existsSync(path.join(appDirectory, '@mf-types'))).toBe(false);
    });
  }

  it('rejects an unsafe string alias retained by the actual native array parser', async () => {
    const { appDirectory } = fixture();
    const remotes = ['alpha@http://localhost:3011/remoteEntry.js'];
    expect(
      managers.utils.parseOptions(
        remotes,
        (_item, key) => ({ key }),
        (_item, key) => ({ key }),
      )[0]?.[1].key,
    ).toBe(remotes[0]);
    await expect(
      resolveReactReceiverDestinations(details(appDirectory, remotes)),
    ).rejects.toThrow('exact relative destination alias');
  });

  it('rejects unsafe resolved URL aliases', async () => {
    const { appDirectory } = fixture();
    await expect(
      resolveReactReceiverDestinations(
        details(
          appDirectory,
          {},
          {
            remoteTypeUrls: {
              remote: {
                alias: '../unknown',
                zip: 'http://localhost/types.zip',
              },
            },
          },
        ),
      ),
    ).rejects.toThrow('exact relative destination alias');
  });

  it('removes private transport seeds while preserving effective native data', async () => {
    const { appDirectory } = fixture();
    const input: ReceiverBeginDetails = {
      operation: 'consumeTypes',
      nativeOptions: {
        extraOptions: {
          ultramodernReceiverDts: { token: 'private-top-level' },
          keep: 'native-extra',
        },
        host: {
          context: appDirectory,
          moduleFederationConfig: {
            name: 'host',
            remotes: { alpha: 'alpha@http://localhost/entry.js' },
            dts: {
              extraOptions: {
                ultramodernReceiverDts: { token: 'private-host' },
                keep: true,
              },
            },
          },
        },
        remote: {
          moduleFederationConfig: {
            dts: {
              extraOptions: {
                ultramodernReceiverDts: { token: 'private-remote' },
                keep: 1,
              },
            },
          },
        },
      },
    };
    const output = await resolveReactReceiverDestinations(input);
    expect(JSON.stringify(output.effectiveOptions)).not.toContain('private-');
    expect(JSON.stringify(output.effectiveOptions)).not.toContain(
      'ultramodernReceiverDts',
    );
    expect(output.effectiveOptions).toMatchObject({
      extraOptions: { keep: 'native-extra' },
      host: {
        moduleFederationConfig: { dts: { extraOptions: { keep: true } } },
      },
      remote: {
        moduleFederationConfig: { dts: { extraOptions: { keep: 1 } } },
      },
    });
    expect(Object.isFrozen(output.effectiveOptions)).toBe(true);
  });

  it('rejects accessor descriptors without invoking their getters', async () => {
    let reads = 0;
    const nativeOptions = Object.defineProperty({}, 'host', {
      enumerable: true,
      get() {
        reads += 1;
        return {};
      },
    });
    await expect(
      resolveReactReceiverDestinations({
        operation: 'consumeTypes',
        nativeOptions,
      }),
    ).rejects.toThrow('accessors or hidden fields');
    expect(reads).toBe(0);
  });
});

describe('native receiver physical paths', () => {
  it('preserves missing destinations without creating them', () => {
    const { appDirectory } = fixture();
    const filename = path.join(appDirectory, 'new/deep/App.d.ts');
    expect(receiverOutputPath(filename, appDirectory)).toEqual({
      lexical: filename,
      canonical: filename,
    });
    expect(fs.existsSync(path.join(appDirectory, 'new'))).toBe(false);
  });

  it('rejects missing paths through a symlink', () => {
    const { root, appDirectory } = fixture();
    const target = path.join(root, 'actual');
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(appDirectory, 'linked'), 'dir');
    expect(() =>
      receiverOutputPath(
        path.join(appDirectory, 'linked/App.d.ts'),
        appDirectory,
      ),
    ).toThrow('unbound alias');
  });

  it('rejects existing descendants beneath a symlink ancestor', () => {
    const { root, appDirectory } = fixture();
    const target = path.join(root, 'actual');
    fs.mkdirSync(path.join(target, 'existing'), { recursive: true });
    fs.writeFileSync(path.join(target, 'existing/App.d.ts'), 'export {};\n');
    fs.symlinkSync(target, path.join(appDirectory, 'linked'), 'dir');
    expect(() =>
      receiverOutputPath(
        path.join(appDirectory, 'linked/existing/App.d.ts'),
        appDirectory,
      ),
    ).toThrow('unbound alias');
  });

  it('rejects a configured alias that resolves through an existing symlink', async () => {
    const { root, appDirectory } = fixture();
    const target = path.join(root, 'actual');
    fs.mkdirSync(target);
    fs.mkdirSync(path.join(appDirectory, '@mf-types'));
    fs.symlinkSync(target, path.join(appDirectory, '@mf-types/alpha'), 'dir');
    await expect(
      resolveReactReceiverDestinations(details(appDirectory)),
    ).rejects.toThrow('unbound alias');
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it('denies an unknown alias symlink before any generated output write', async () => {
    const { root, appDirectory } = fixture();
    const target = path.join(root, 'authored');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'sentinel.txt'), 'authored input');
    fs.mkdirSync(path.join(appDirectory, '@mf-types'));
    fs.symlinkSync(target, path.join(appDirectory, '@mf-types/unknown'), 'dir');
    const output = await resolveReactReceiverDestinations({
      ...details(appDirectory),
    });
    const registration = immutableRendererGeneratedOutputRegistration({
      schemaVersion: 1,
      id: 'native-destination-scope',
      pathFlavor: 'posix',
      producer: {
        packageName: coreOwner.name,
        version: coreOwner.version,
        packageDirectory: coreOwner.directory,
        modulePath: corePath,
        moduleDigest: createHash('sha256')
          .update(fs.readFileSync(corePath))
          .digest('hex'),
      },
      consumer: { id: 'native-host', projectRoot: appDirectory },
      generation: {
        operationId: 'update-native-alias',
        compilerId: 'client',
        generation: 1,
        revision: 'authored-baseline',
      },
      effectiveOptions: output.effectiveOptions,
      context: output.context,
      destinations: output.destinations,
      authoredPaths: [],
      protectedInputs: [],
    });
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [
        {
          operation: 'write',
          kind: 'file',
          before: {
            kind: 'missing',
            path: {
              lexical: path.join(appDirectory, '@mf-types/unknown/App.d.ts'),
              canonical: path.join(target, 'App.d.ts'),
            },
          },
        },
      ]),
    ).toThrow('registered destination');
    expect(fs.readdirSync(target)).toEqual(['sentinel.txt']);
    expect(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8')).toBe(
      'authored input',
    );
  });
});

describe('native receiver producer cohort', () => {
  it('selects the DTS owner of the native public constructor chain', () => {
    expect(resolveNativeReactReceiverCore(nativeApp)).toBe(corePath);
    const mfManifest = JSON.parse(
      fs.readFileSync(path.join(nativeOwner.directory, 'package.json'), 'utf8'),
    );
    const enhancedManifest = JSON.parse(
      fs.readFileSync(
        path.join(enhancedOwner.directory, 'package.json'),
        'utf8',
      ),
    );
    const rspackManifest = JSON.parse(
      fs.readFileSync(path.join(rspackOwner.directory, 'package.json'), 'utf8'),
    );
    expect(
      mfManifest.dependencies['@module-federation/enhanced'],
    ).toBeDefined();
    expect(
      enhancedManifest.dependencies['@module-federation/rspack'],
    ).toBeDefined();
    expect(
      rspackManifest.dependencies['@module-federation/dts-plugin'],
    ).toBeDefined();
  });

  it('ignores a same-name DTS decoy that only the Modern MF ancestor can resolve', () => {
    const { appDirectory } = fixture();
    const modules = path.join(appDirectory, 'node_modules/@module-federation');
    const mfSlot = path.join(modules, 'modern-js-v3');
    fs.unlinkSync(mfSlot);
    fs.cpSync(nativeOwner.directory, mfSlot, { recursive: true });
    fs.symlinkSync(
      enhancedOwner.directory,
      path.join(modules, 'enhanced'),
      'dir',
    );
    const decoy = path.join(modules, 'dts-plugin');
    fs.cpSync(coreOwner.directory, decoy, { recursive: true });
    const fixtureNativeRequire = createRequire(
      createRequire(path.join(appDirectory, 'package.json')).resolve(
        '@module-federation/modern-js-v3/ssr-plugin',
      ),
    );
    const ancestorCore = fs.realpathSync(
      fixtureNativeRequire.resolve('@module-federation/dts-plugin/core'),
    );
    expect(ancestorCore).toBe(path.join(decoy, 'dist/core.js'));
    expect(
      readRendererFrameworkPackage({
        specifier: '@module-federation/dts-plugin/core',
        filename: ancestorCore,
      }),
    ).toMatchObject({ name: coreOwner.name, version: coreOwner.version });
    expect(resolveNativeReactReceiverCore(appDirectory)).toBe(corePath);
    expect(resolveNativeReactReceiverCore(appDirectory)).not.toBe(ancestorCore);
  });

  it('binds the source adapter to the actual DTS owner used by the genuine native app', async () => {
    const implementationPath = resolveReactReceiverImplementation();
    const producer = await resolveReactReceiverProducer({
      appDirectory: nativeApp,
      implementationPath,
    });
    expect(producer).toEqual({
      packageName: coreOwner.name,
      version: coreOwner.version,
      packageDirectory: coreOwner.directory,
      modulePath: corePath,
      moduleDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(Object.isFrozen(producer)).toBe(true);
    expect(
      await resolveReactReceiverProducer({
        appDirectory: nativeApp,
        implementationPath,
      }),
    ).toEqual(producer);
  });

  it('rejects a different physical native DTS owner even when its name and version match', async () => {
    const { appDirectory } = fixture();
    const mfSlot = path.join(
      appDirectory,
      'node_modules/@module-federation/modern-js-v3',
    );
    fs.unlinkSync(mfSlot);
    // These are complete copies of genuine native packages, not fake core
    // exports. Only this fixture's physical dependency owner differs.
    fs.cpSync(nativeOwner.directory, mfSlot, { recursive: true });
    fs.cpSync(
      enhancedOwner.directory,
      path.join(appDirectory, 'node_modules/@module-federation/enhanced'),
      { recursive: true },
    );
    fs.cpSync(
      rspackOwner.directory,
      path.join(appDirectory, 'node_modules/@module-federation/rspack'),
      { recursive: true },
    );
    const differentDts = path.join(
      appDirectory,
      'node_modules/@module-federation/dts-plugin',
    );
    fs.cpSync(coreOwner.directory, differentDts, { recursive: true });
    const otherCore = resolveNativeReactReceiverCore(appDirectory);
    expect(otherCore).not.toBe(corePath);
    expect(
      readRendererFrameworkPackage({
        specifier: '@module-federation/dts-plugin/core',
        filename: otherCore,
      }),
    ).toMatchObject({ name: coreOwner.name, version: coreOwner.version });
    await expect(
      resolveReactReceiverProducer({
        appDirectory,
        implementationPath: resolveReactReceiverImplementation(),
      }),
    ).rejects.toThrow('different DTS package cohorts');
  });
});
