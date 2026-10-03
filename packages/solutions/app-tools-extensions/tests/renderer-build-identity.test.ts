import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rs } from '@rstest/core';
import {
  type RendererBuildIdentityOptions,
  type RendererFrameworkPackageBinding,
  resolveRendererBuildIdentities,
} from '../src/renderer-build-identity';

const temporaryRoots = new Set<string>();
afterEach(async () => {
  for (const root of temporaryRoots)
    await fs.rm(root, { recursive: true, force: true });
  temporaryRoots.clear();
});

async function write(file: string, value: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value);
}

async function fixture(
  git = false,
): Promise<RendererBuildIdentityOptions & { workspace: string }> {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), 'renderer-build-identity-'),
  );
  temporaryRoots.add(workspace);
  const projectRoot = path.join(workspace, 'apps', 'shop');
  await write(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ name: '@demo/shop', version: '1.0.0' }),
  );
  await write(
    path.join(projectRoot, 'src', 'App.tsx'),
    'export default () => <main>native</main>;\n',
  );
  await write(
    path.join(projectRoot, 'src', 'style.css'),
    'main { color: red; }\n',
  );
  await write(
    path.join(projectRoot, 'modern.config.ts'),
    'export default { renderer: "solid" };\n',
  );
  await write(
    path.join(workspace, 'shared', 'price.ts'),
    'export const price = 12;\n',
  );
  const packages = [
    {
      name: '@solidjs/compiler',
      version: '2.0.0-rc.13',
      dependencies: { '@babel/parser': '^8.0.6' },
    },
    {
      name: '@solidjs/web',
      version: '2.0.0-rc.13',
      dependencies: { 'solid-js': '2.0.0-rc.13' },
    },
    { name: 'solid-js', version: '2.0.0-rc.13' },
    {
      name: '@tanstack/solid-router',
      version: '2.0.0-rc.8',
      dependencies: { '@tanstack/router-core': '1.171.22' },
    },
    { name: '@tanstack/router-core', version: '1.171.22' },
    { name: '@babel/parser', version: '8.0.6' },
  ];
  for (const manifest of packages) {
    const directory = path.join(projectRoot, 'node_modules', manifest.name);
    await write(path.join(directory, 'package.json'), JSON.stringify(manifest));
    await write(
      path.join(directory, 'index.js'),
      `export const identity = ${JSON.stringify(`${manifest.name}@${manifest.version}`)};\n`,
    );
  }
  if (git) {
    await write(
      path.join(workspace, '.gitignore'),
      'node_modules/\ndist/\n.ultramodern/\n.modern/\n',
    );
    const run = (args: string[]) =>
      execFileSync('git', args, { cwd: workspace, stdio: 'ignore' });
    run(['init']);
    run(['add', '.']);
    run([
      '-c',
      'user.name=Renderer identity fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'fixture source',
    ]);
  }
  const profile: RendererBuildIdentityOptions['profile'] = {
    renderer: 'solid',
    protocolVersion: 1,
    compiler: { name: '@solidjs/compiler', version: '2.0.0-rc.13' },
    hydration: { name: '@solidjs/web', version: '2.0.0-rc.13' },
    router: {
      name: '@tanstack/solid-router',
      version: '2.0.0-rc.8',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.22',
    },
    dependencies: { 'solid-js': '2.0.0-rc.13' },
    sourceExtensions: ['.tsx', '.ts'],
    jsxImportSource: '@solidjs/web',
  };
  return {
    workspace,
    projectRoot,
    renderer: 'solid',
    profile,
    routerBindings: ownedRouterBindings({ renderer: 'solid', profile }),
    entryNames: ['main', 'admin'],
    mode: 'production',
    inputDirectories: [path.join(workspace, 'shared')],
    configuration: { server: { ssr: true }, renderer: 'solid' },
  };
}

async function writeFixturePackage(
  directory: string,
  manifest: {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
  },
) {
  await write(path.join(directory, 'package.json'), JSON.stringify(manifest));
  await write(
    path.join(directory, 'index.js'),
    `export const identity = ${JSON.stringify(`${manifest.name}@${manifest.version}`)};\n`,
  );
}

async function rendererFixture(renderer: 'react' | 'octane') {
  const options = await fixture();
  options.renderer = renderer;
  options.configuration = { renderer, server: { ssr: true } };
  await write(
    path.join(options.projectRoot, 'modern.config.ts'),
    `export default { renderer: ${JSON.stringify(renderer)} };\n`,
  );
  const modules = path.join(options.projectRoot, 'node_modules');
  if (renderer === 'react') {
    // This directory belongs to the newly created controlled fixture.
    await fs.rm(path.join(modules, '@tanstack'), {
      recursive: true,
      force: true,
    });
    options.profile = {
      renderer,
      protocolVersion: 1,
      compiler: { name: '@rsbuild/plugin-react', version: '2.1.0' },
      hydration: { name: 'react-dom', version: '19.3.0' },
      router: {
        name: 'react-router',
        version: '7.18.4',
        coreName: 'react-router',
        coreVersion: '7.18.4',
      },
      dependencies: { react: '19.3.0' },
    };
    for (const manifest of [
      { name: '@rsbuild/plugin-react', version: '2.1.0' },
      { name: 'react', version: '19.3.0' },
      {
        name: 'react-dom',
        version: '19.3.0',
        dependencies: { react: '19.3.0' },
      },
      {
        name: 'react-router',
        version: '7.18.4',
        dependencies: { react: '19.3.0' },
      },
      {
        name: 'react-router-dom',
        version: '7.18.4',
        dependencies: {
          react: '19.3.0',
          'react-dom': '19.3.0',
          'react-router': '7.18.4',
        },
      },
    ]) {
      await writeFixturePackage(path.join(modules, manifest.name), manifest);
    }
  } else {
    options.profile = {
      renderer,
      protocolVersion: 1,
      compiler: { name: '@octanejs/rspack-plugin', version: '0.1.55' },
      hydration: { name: 'octane', version: '0.7.1' },
      router: {
        name: '@octanejs/tanstack-router',
        version: '0.1.60',
        coreName: '@tanstack/router-core',
        coreVersion: '1.171.15',
      },
      dependencies: { octane: '0.7.1' },
    };
    for (const manifest of [
      { name: '@octanejs/rspack-plugin', version: '0.1.55' },
      { name: 'octane', version: '0.7.1' },
      {
        name: '@octanejs/tanstack-router',
        version: '0.1.60',
        dependencies: { '@tanstack/router-core': '1.171.15' },
      },
      { name: '@tanstack/router-core', version: '1.171.15' },
    ]) {
      await writeFixturePackage(path.join(modules, manifest.name), manifest);
    }
  }
  options.routerBindings = ownedRouterBindings(options);
  return options;
}

async function publishedPeerFixture(authority: 'sdk' | 'app' = 'sdk') {
  const options = await rendererFixture('react');
  const version = '3.9.0-ultramodern.2026100301';
  const canonicalSDK = '@modern-js/ultramodern-app-tools';
  const sdkName = '@bleedingdev/modern-js-ultramodern-app-tools';
  const providerName = '@bleedingdev/modern-js-app-tools';
  const providerSpecifier = '@modern-js/app-tools';
  const pluginSpecifier = '@modern-js/plugin-bff';
  const pluginName = '@bleedingdev/modern-js-plugin-bff';
  const sdk = path.join(options.projectRoot, 'node_modules', canonicalSDK);
  const provider = path.join(sdk, 'node_modules', providerSpecifier);
  const plugin = path.join(sdk, 'node_modules', pluginSpecifier);
  const providerRequest = `npm:${providerName}@${version}`;
  await writeFixturePackage(sdk, {
    name: sdkName,
    version,
    dependencies: {
      [pluginSpecifier]: `npm:${pluginName}@${version}`,
      ...(authority === 'sdk' ? { [providerSpecifier]: providerRequest } : {}),
    },
  });
  await writeFixturePackage(provider, {
    name: providerName,
    version,
    dependencies: { [pluginSpecifier]: `npm:${pluginName}@${version}` },
  });
  await write(
    path.join(plugin, 'package.json'),
    JSON.stringify({
      name: pluginName,
      version,
      peerDependencies: { [providerSpecifier]: version },
    }),
  );
  await write(path.join(plugin, 'index.js'), 'export const plugin = true;\n');
  if (authority === 'app') {
    await write(
      path.join(options.projectRoot, 'package.json'),
      JSON.stringify({
        name: '@demo/shop',
        version: '1.0.0',
        devDependencies: { [providerSpecifier]: providerRequest },
      }),
    );
    const slot = path.join(
      options.projectRoot,
      'node_modules',
      providerSpecifier,
    );
    await fs.mkdir(path.dirname(slot), { recursive: true });
    await fs.symlink(provider, slot, 'dir');
  }
  options.frameworkPackages = [sdkName];
  options.frameworkPackageBindings = [
    { specifier: canonicalSDK, name: sdkName, version, directory: sdk },
  ];
  return {
    ...options,
    sdk,
    provider,
    plugin,
    version,
    providerName,
    providerSpecifier,
    providerRequest,
  };
}

async function transitiveFederationPeerFixture(
  edge: 'dependency' | 'optional' | 'peer' = 'dependency',
  order: 'alias-first' | 'consumer-first' = 'consumer-first',
) {
  const options = await publishedPeerFixture();
  const version = '2.9.1';
  const enhancedSpecifier = '@module-federation/enhanced';
  const toolsSpecifier = '@module-federation/runtime-tools';
  const consumerSpecifier =
    '@module-federation/inject-external-runtime-core-plugin';
  const enhancedRequest = `npm:@bleedingdev/mf-enhanced@${version}`;
  const toolsRequest = `npm:@bleedingdev/mf-runtime-tools@${version}`;
  const enhanced = path.join(options.sdk, 'node_modules', enhancedSpecifier);
  const tools = path.join(enhanced, 'node_modules', toolsSpecifier);
  const consumer = path.join(enhanced, 'node_modules', consumerSpecifier);
  const sdkFile = path.join(options.sdk, 'package.json');
  const sdk = JSON.parse(await fs.readFile(sdkFile, 'utf8'));
  if (edge === 'peer') {
    const ownerName = '@fixture/federation-owner';
    sdk.peerDependencies = { [ownerName]: '1.0.0' };
    await writeFixturePackage(
      path.join(options.sdk, 'node_modules', ownerName),
      {
        name: ownerName,
        version: '1.0.0',
        dependencies: { [enhancedSpecifier]: enhancedRequest },
      },
    );
  } else {
    const declarations =
      edge === 'optional'
        ? (sdk.optionalDependencies ??= {})
        : sdk.dependencies;
    declarations[enhancedSpecifier] = enhancedRequest;
  }
  sdk.optionalDependencies = {
    ...sdk.optionalDependencies,
    '@fixture/absent-optional': '1.0.0',
  };
  await write(sdkFile, JSON.stringify(sdk));
  const edges = [
    [toolsSpecifier, toolsRequest],
    [consumerSpecifier, version],
  ];
  await writeFixturePackage(enhanced, {
    name: '@bleedingdev/mf-enhanced',
    version,
    dependencies: Object.fromEntries(
      order === 'alias-first' ? edges : edges.reverse(),
    ),
  });
  await writeFixturePackage(tools, {
    name: '@bleedingdev/mf-runtime-tools',
    version,
    dependencies: { [enhancedSpecifier]: enhancedRequest },
  });
  await write(
    path.join(consumer, 'package.json'),
    JSON.stringify({
      name: consumerSpecifier,
      version,
      peerDependencies: { [toolsSpecifier]: version },
    }),
  );
  await write(path.join(consumer, 'index.js'), 'export const inject = true;\n');
  return {
    ...options,
    enhanced,
    tools,
    consumer,
    toolsSpecifier,
    toolsRequest,
  };
}

async function applicationFederationPeerFixture() {
  const options = await publishedPeerFixture();
  const version = '2.9.1';
  const modernSpecifier = '@module-federation/modern-js-v3';
  const pluginSpecifier = '@module-federation/rsbuild-plugin';
  const enhancedSpecifier = '@module-federation/enhanced';
  const toolsSpecifier = '@module-federation/runtime-tools';
  const modern = path.join(
    options.projectRoot,
    'node_modules',
    modernSpecifier,
  );
  const plugin = path.join(modern, 'node_modules', pluginSpecifier);
  const enhanced = path.join(plugin, 'node_modules', enhancedSpecifier);
  const tools = path.join(enhanced, 'node_modules', toolsSpecifier);
  const compiler = path.join(
    options.projectRoot,
    'node_modules',
    options.profile.compiler.name,
  );
  const rspack = path.join(compiler, 'node_modules', '@rspack/core');
  await write(
    path.join(options.projectRoot, 'package.json'),
    JSON.stringify({
      name: '@demo/shop',
      version: '1.0.0',
      dependencies: {
        [modernSpecifier]: `npm:@bleedingdev/mf-modern-js-v3@${version}`,
      },
    }),
  );
  await writeFixturePackage(modern, {
    name: '@bleedingdev/mf-modern-js-v3',
    version,
    dependencies: {
      [pluginSpecifier]: `npm:@bleedingdev/mf-rsbuild-plugin@${version}`,
    },
  });
  await writeFixturePackage(plugin, {
    name: '@bleedingdev/mf-rsbuild-plugin',
    version,
    dependencies: {
      [enhancedSpecifier]: `npm:@bleedingdev/mf-enhanced@${version}`,
    },
  });
  await writeFixturePackage(enhanced, {
    name: '@bleedingdev/mf-enhanced',
    version,
    dependencies: {
      [toolsSpecifier]: `npm:@bleedingdev/mf-runtime-tools@${version}`,
      [modernSpecifier]: `npm:@bleedingdev/mf-modern-js-v3@${version}`,
    },
  });
  await writeFixturePackage(tools, {
    name: '@bleedingdev/mf-runtime-tools',
    version,
  });
  const file = path.join(compiler, 'package.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  manifest.dependencies = { '@rspack/core': '2.2.8' };
  await write(file, JSON.stringify(manifest));
  await write(
    path.join(rspack, 'package.json'),
    JSON.stringify({
      name: '@rspack/core',
      version: '2.2.8',
      peerDependencies: { [toolsSpecifier]: '^0.24.1 || ^2.0.0' },
    }),
  );
  await write(path.join(rspack, 'index.js'), 'export const rspack = true;\n');
  const slot = path.join(rspack, 'node_modules', toolsSpecifier);
  await fs.mkdir(path.dirname(slot), { recursive: true });
  await fs.symlink(tools, slot, 'dir');
  return { ...options, modern, enhanced, tools, rspack, toolsSpecifier };
}

async function unselectedNativeAdapterFixture(renderer: 'solid' | 'octane') {
  const options =
    renderer === 'solid' ? await fixture() : await rendererFixture('octane');
  const selectedAdapterName = `@modern-js/renderer-${renderer}`;
  const unselectedRenderer = renderer === 'solid' ? 'octane' : 'solid';
  const unselectedAdapterName = `@modern-js/renderer-${unselectedRenderer}`;
  const frameworkName = '@modern-js/ultramodern-app-tools';
  const frameworkDirectory = path.join(
    options.projectRoot,
    'node_modules',
    frameworkName,
  );
  const unselectedAdapterDirectory = path.join(
    frameworkDirectory,
    'node_modules',
    unselectedAdapterName,
  );
  const unselectedTuple =
    unselectedRenderer === 'solid'
      ? {
          compiler: { name: '@solidjs/compiler', version: '2.0.0-rc.13' },
          hydration: { name: '@solidjs/web', version: '2.0.0-rc.13' },
          router: {
            name: '@tanstack/solid-router',
            version: '2.0.0-rc.8',
            coreName: '@tanstack/router-core',
            coreVersion: '1.171.22',
          },
        }
      : {
          compiler: { name: '@octanejs/rspack-plugin', version: '0.1.55' },
          hydration: { name: 'octane', version: '0.7.1' },
          router: {
            name: '@octanejs/tanstack-router',
            version: '0.1.60',
            coreName: '@tanstack/router-core',
            coreVersion: '1.171.15',
          },
        };
  await writeFixturePackage(frameworkDirectory, {
    name: frameworkName,
    version: '3.8.3',
    dependencies: {
      [selectedAdapterName]: '3.8.3',
      [unselectedAdapterName]: '3.8.3',
    },
  });
  await writeFixturePackage(
    path.join(options.projectRoot, 'node_modules', selectedAdapterName),
    {
      name: selectedAdapterName,
      version: '3.8.3',
      dependencies: Object.fromEntries(
        [
          options.profile.compiler,
          options.profile.hydration,
          options.profile.router,
        ].map(item => [item.name, item.version]),
      ),
    },
  );
  await writeFixturePackage(unselectedAdapterDirectory, {
    name: unselectedAdapterName,
    version: '3.8.3',
    dependencies: Object.fromEntries(
      [
        unselectedTuple.compiler,
        unselectedTuple.hydration,
        unselectedTuple.router,
      ].map(item => [item.name, item.version]),
    ),
  });
  for (const item of [unselectedTuple.compiler, unselectedTuple.hydration]) {
    await writeFixturePackage(
      path.join(unselectedAdapterDirectory, 'node_modules', item.name),
      item,
    );
  }
  const unselectedRouterDirectory = path.join(
    unselectedAdapterDirectory,
    'node_modules',
    unselectedTuple.router.name,
  );
  await writeFixturePackage(unselectedRouterDirectory, {
    name: unselectedTuple.router.name,
    version: unselectedTuple.router.version,
    dependencies: {
      [unselectedTuple.router.coreName]: unselectedTuple.router.coreVersion,
    },
  });
  const unselectedCoreDirectory = path.join(
    unselectedRouterDirectory,
    'node_modules',
    unselectedTuple.router.coreName,
  );
  await writeFixturePackage(unselectedCoreDirectory, {
    name: unselectedTuple.router.coreName,
    version: unselectedTuple.router.coreVersion,
  });
  const selectedCoreDirectory = path.join(
    options.projectRoot,
    'node_modules',
    options.profile.router.name,
    'node_modules',
    options.profile.router.coreName,
  );
  await writeFixturePackage(selectedCoreDirectory, {
    name: options.profile.router.coreName,
    version: options.profile.router.coreVersion,
  });
  return {
    ...options,
    profile: {
      ...options.profile,
      dependencies: {
        ...options.profile.dependencies,
        [selectedAdapterName]: '3.8.3',
      },
    },
    frameworkPackages: [selectedAdapterName, frameworkName],
    selectedCoreDirectory,
    unselectedCoreDirectory,
    unselectedCoreVersion: unselectedTuple.router.coreVersion,
  };
}

function ownedRouterBindings(
  options: Pick<RendererBuildIdentityOptions, 'renderer' | 'profile'>,
) {
  const provider = {
    framework:
      options.renderer === 'react'
        ? ('react-router' as const)
        : options.renderer,
    ...options.profile.router,
  };
  const binding = () => ({
    owner:
      options.renderer === 'react'
        ? '@fixture/runtime-router'
        : `@fixture/${options.renderer}-native-router`,
    evidence:
      options.renderer === 'react'
        ? ('owned-default' as const)
        : ('file-routes' as const),
    defaultProvider: { ...provider },
    providers: [{ ...provider }] satisfies [typeof provider],
  });
  return { main: binding(), admin: binding() };
}

async function providerRegistryFixture() {
  const options = await rendererFixture('react');
  const owned = ownedRouterBindings(options);
  const provider = {
    framework: 'tanstack' as const,
    name: '@tanstack/react-router',
    version: '1.171.29',
    coreName: '@tanstack/router-core',
    coreVersion: '1.171.29',
  };
  const registry = (binding: (typeof owned)['main']) => ({
    ...binding,
    evidence: 'provider-registry' as const,
    providers: [binding.defaultProvider, { ...provider }],
  });
  const routerBindings = {
    main: registry(owned.main),
    admin: registry(owned.admin),
  };
  const providerDirectory = path.join(
    options.projectRoot,
    'node_modules',
    provider.name,
  );
  const coreDirectory = path.join(
    providerDirectory,
    'node_modules',
    provider.coreName,
  );
  const ambientCoreDirectory = path.join(
    options.projectRoot,
    'node_modules',
    provider.coreName,
  );
  await writeFixturePackage(providerDirectory, {
    name: provider.name,
    version: provider.version,
    dependencies: { [provider.coreName]: provider.coreVersion },
  });
  await writeFixturePackage(coreDirectory, {
    name: provider.coreName,
    version: provider.coreVersion,
  });
  await writeFixturePackage(ambientCoreDirectory, {
    name: provider.coreName,
    version: '1.170.0',
  });
  return {
    ...options,
    routerBindings,
    providerDirectory,
    coreDirectory,
    ambientCoreDirectory,
  };
}

const tupleRoles = ['compiler', 'hydration', 'router', 'core'] as const;

const nativeFrameworkRoles = ['adapter', 'runtime', 'router'] as const;
type ObservedFrameworkRole =
  | (typeof nativeFrameworkRoles)[number]
  | 'core'
  | 'builder';

async function observedFrameworkFixture(role: ObservedFrameworkRole) {
  const options = await fixture();
  const packageIdentity =
    role === 'runtime'
      ? options.profile.hydration
      : role === 'router'
        ? options.profile.router
        : { name: `@fixture/sdk-${role}`, version: '1.0.0' };
  const specifier = `@fixture/framework-${role}`;
  const directory = path.join(
    options.projectRoot,
    'node_modules',
    packageIdentity.name,
  );
  if (role !== 'runtime' && role !== 'router') {
    await writeFixturePackage(directory, {
      ...packageIdentity,
      ...(role === 'adapter'
        ? {
            dependencies: {
              [options.profile.hydration.name]:
                options.profile.hydration.version,
            },
          }
        : {}),
    });
  }
  const binding = {
    specifier,
    name: packageIdentity.name,
    version: packageIdentity.version,
    directory,
  } satisfies RendererFrameworkPackageBinding;
  return {
    ...options,
    profile:
      role === 'adapter'
        ? {
            ...options.profile,
            dependencies: {
              ...options.profile.dependencies,
              [specifier]: packageIdentity.version,
            },
          }
        : options.profile,
    frameworkPackages: [packageIdentity.name],
    frameworkPackageBindings: [binding],
    binding,
    observedDirectory: directory,
    canonicalDirectory: path.join(
      options.projectRoot,
      'node_modules',
      specifier,
    ),
  };
}

async function relocateObservedFramework(
  options: Awaited<ReturnType<typeof observedFrameworkFixture>>,
  directory: string,
) {
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(options.observedDirectory, 'package.json'),
      'utf8',
    ),
  );
  await fs.mkdir(path.dirname(directory), { recursive: true });
  await fs.rename(options.observedDirectory, directory);
  // The controlled public module keeps its actual declared dependencies when
  // relocated into a package store or ancestor module directory.
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const alias = path.join(directory, 'node_modules', name);
    await fs.mkdir(path.dirname(alias), { recursive: true });
    await fs.symlink(
      path.join(options.projectRoot, 'node_modules', name),
      alias,
      'dir',
    );
  }
  options.observedDirectory = directory;
  options.binding.directory = directory;
}

async function uriProfileFixture(role: (typeof tupleRoles)[number]) {
  const options = await fixture();
  const nativePackage =
    role === 'core'
      ? {
          name: options.profile.router.coreName,
          version: options.profile.router.coreVersion,
        }
      : options.profile[role];
  const modules = path.join(options.projectRoot, 'node_modules');
  const packageDirectory =
    role === 'core'
      ? path.join(
          modules,
          options.profile.router.name,
          'node_modules',
          nativePackage.name,
        )
      : path.join(modules, nativePackage.name);
  if (role === 'core') {
    await writeFixturePackage(packageDirectory, nativePackage);
  }
  options.profile = {
    ...options.profile,
    dependencies: {
      ...options.profile.dependencies,
      [nativePackage.name]: `https://artifacts.example.invalid/${encodeURIComponent(nativePackage.name)}/9.9.9.tgz?digest=first`,
    },
  };
  return { ...options, nativePackage, packageDirectory };
}

async function serdeFixture() {
  const options = await fixture();
  const nativeDirectory = path.join(
    options.projectRoot,
    'node_modules',
    '@fixture',
    'native-adapter',
  );
  const neutralDirectory = path.join(
    options.projectRoot,
    'node_modules',
    '@fixture',
    'neutral-core',
  );
  const nativeSerde = path.join(nativeDirectory, 'node_modules', 'seroval');
  const nativePlugins = path.join(
    nativeDirectory,
    'node_modules',
    'seroval-plugins',
  );
  const neutralSerde = path.join(
    options.projectRoot,
    'node_modules',
    'seroval',
  );
  for (const [directory, manifest] of [
    [
      nativeDirectory,
      {
        name: '@fixture/native-adapter',
        version: '1.0.0',
        dependencies: {
          '@fixture/neutral-core': '1.0.0',
          seroval: '1.6.8',
          'seroval-plugins': '1.6.8',
        },
      },
    ],
    [
      neutralDirectory,
      {
        name: '@fixture/neutral-core',
        version: '1.0.0',
        dependencies: { seroval: '1.6.2' },
      },
    ],
    [nativeSerde, { name: 'seroval', version: '1.6.8' }],
    [
      nativePlugins,
      {
        name: 'seroval-plugins',
        version: '1.6.8',
        peerDependencies: { seroval: '^1.6.8' },
      },
    ],
    [neutralSerde, { name: 'seroval', version: '1.6.2' }],
  ] as const) {
    await write(path.join(directory, 'package.json'), JSON.stringify(manifest));
    await write(
      path.join(directory, 'index.js'),
      `export const packageIdentity = ${JSON.stringify(manifest.name + '@' + manifest.version)};`,
    );
  }
  return {
    ...options,
    profile: {
      ...options.profile,
      dependencies: {
        ...options.profile.dependencies,
        '@fixture/native-adapter': '1.0.0',
        seroval: '1.6.8',
        'seroval-plugins': '1.6.8',
      },
    },
    frameworkPackages: ['@fixture/native-adapter', '@fixture/neutral-core'],
    nativeDirectory,
    neutralDirectory,
    nativeSerde,
    nativePlugins,
    neutralSerde,
  };
}

describe('renderer source and compiler build identity', () => {
  test('binds the same final marker to real per-entry identities and actual package name', async () => {
    const options = await fixture();
    const result = await resolveRendererBuildIdentities(options);
    expect(result.identities.main).toEqual({
      renderer: 'solid',
      appId: '@demo/shop',
      entryName: 'main',
      protocolVersion: 1,
      buildId: result.buildMarker,
    });
    expect(result.identities.admin.entryName).toBe('admin');
    expect(result.identities.admin.buildId).toBe(result.buildMarker);
    expect(result.buildMarker).toMatch(/^[a-f0-9]{64}$/);
    expect(
      (
        await resolveRendererBuildIdentities({
          ...options,
          entryNames: ['admin', 'main'],
        })
      ).buildMarker,
    ).toBe(result.buildMarker);
    expect(Object.isFrozen(result.identities.main)).toBe(true);
  });

  test.each([
    'src/App.tsx',
    'src/style.css',
    'modern.config.ts',
  ])('changes identity when authored %s changes', async file => {
    const options = await fixture();
    const before = await resolveRendererBuildIdentities(options);
    await fs.appendFile(
      path.join(options.projectRoot, file),
      '\n/* changed owning source */\n',
    );
    const after = await resolveRendererBuildIdentities(options);
    expect(after.inputDigest).not.toBe(before.inputDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test('includes explicitly observed shared source outside the app root', async () => {
    const options = await fixture(true);
    const inputFiles = [path.join(options.workspace, 'shared', 'price.ts')];
    const before = await resolveRendererBuildIdentities({
      ...options,
      inputDirectories: [],
      inputFiles,
    });
    await fs.writeFile(
      path.join(options.workspace, 'shared', 'price.ts'),
      'export const price = 15;\n',
    );
    const after = await resolveRendererBuildIdentities({
      ...options,
      inputDirectories: [],
      inputFiles,
    });
    expect(after.inputDigest).not.toBe(before.inputDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
    expect(before.promotable).toBe(true);
    expect(after.sourceRevision).toBe('workspace');
    expect(after.cacheAllowed).toBe(false);
  });

  test('excludes unrelated workspace source from the application input digest', async () => {
    const options = await fixture(true);
    const before = await resolveRendererBuildIdentities({
      ...options,
      inputDirectories: [],
    });
    await fs.writeFile(
      path.join(options.workspace, 'shared', 'price.ts'),
      'export const price = 999;\n',
    );
    await write(
      path.join(options.workspace, 'unrelated', 'new.ts'),
      'export const unrelated = true;\n',
    );
    const after = await resolveRendererBuildIdentities({
      ...options,
      inputDirectories: [],
    });
    expect(after.inputDigest).toBe(before.inputDigest);
  });

  test('ignores owning generated projections and configured output directories', async () => {
    const options = await fixture();
    const excludedDirectories = [
      path.join(options.projectRoot, '.generated-native'),
    ];
    const before = await resolveRendererBuildIdentities({
      ...options,
      excludedDirectories,
    });
    await write(
      path.join(options.projectRoot, '.ultramodern', 'workspace.json'),
      '{"projection":"new"}',
    );
    await write(
      path.join(options.projectRoot, 'dist', 'entry.js'),
      'compiled output',
    );
    await write(
      path.join(options.projectRoot, '.generated-native', 'main.ts'),
      'generated native entry',
    );
    const after = await resolveRendererBuildIdentities({
      ...options,
      excludedDirectories,
    });
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.buildMarker).toBe(before.buildMarker);
  });

  test('binds actual compiler dependency bytes rather than trusting version labels', async () => {
    const options = await fixture();
    const before = await resolveRendererBuildIdentities(options);
    await fs.appendFile(
      path.join(
        options.projectRoot,
        'node_modules',
        '@babel/parser',
        'index.js',
      ),
      '\nexport const modifiedCompiler = true;\n',
    );
    const after = await resolveRendererBuildIdentities(options);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test.each([
    ['npm:oxfmt@0.68.0', 'oxfmt', '0.68.0'],
    ['NPM:oxfmt@v0.68.0', 'oxfmt', '0.68.0'],
    ['npm:oxfmt', 'oxfmt', '0.68.0'],
    ['npm:oxfmt@', 'oxfmt', '0.68.0'],
    ['npm:@fixture/parser@^1.2.0', '@fixture/parser', '1.3.0'],
    ['npm:@fixture/parser@ latest ', '@fixture/parser', '1.3.0'],
    ['npm:@fixture/_parser@=1.3.0', '@fixture/_parser', '1.3.0'],
    ['npm:@fixture/parser.tgz@1.3.0', '@fixture/parser.tgz', '1.3.0'],
  ])('binds actual npm alias target bytes for %s', async (specifier, name, version) => {
    const options = await fixture();
    const parser = path.join(
      options.projectRoot,
      'node_modules',
      '@babel',
      'parser',
    );
    const alias = path.join(parser, 'node_modules', 'compiler-current');
    await write(
      path.join(parser, 'package.json'),
      JSON.stringify({
        name: '@babel/parser',
        version: '8.0.6',
        dependencies: { 'compiler-current': specifier },
      }),
    );
    await write(
      path.join(alias, 'package.json'),
      JSON.stringify({ name, version }),
    );
    await write(
      path.join(alias, 'index.js'),
      'export const implementation = "A";',
    );
    const before = await resolveRendererBuildIdentities(options);
    await write(
      path.join(alias, 'index.js'),
      'export const implementation = "B";',
    );
    const after = await resolveRendererBuildIdentities(options);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test.each([
    ['npm:oxfmt@0.68.0', 'other-package', '0.68.0'],
    ['npm:oxfmt@0.68.0', 'oxfmt', '0.69.0'],
    ['npm:@fixture/parser@^1.2.0', '@fixture/parser', '2.0.0'],
    ['0.68.0', 'oxfmt', '0.68.0'],
  ])('rejects undeclared or mismatched alias targets for %s', async (specifier, name, version) => {
    const options = await fixture();
    const parser = path.join(
      options.projectRoot,
      'node_modules',
      '@babel',
      'parser',
    );
    const alias = path.join(parser, 'node_modules', 'compiler-current');
    await write(
      path.join(parser, 'package.json'),
      JSON.stringify({
        name: '@babel/parser',
        version: '8.0.6',
        dependencies: { 'compiler-current': specifier },
      }),
    );
    await write(
      path.join(alias, 'package.json'),
      JSON.stringify({ name, version }),
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'compiler/profile mismatch',
    );
  });

  test.each([
    'npm:',
    'npm:@scope',
    'npm:foo/bar',
    'npm:foo@npm:bar',
    'npm:foo@file:../bar',
    'npm:compiler.tgz@1.0.0',
    'npm:_private@1.0.0',
    'npm:@scope/.private@1.0.0',
  ])('rejects malformed npm alias %s without accepting a renamed package', async specifier => {
    const options = await fixture();
    const parser = path.join(
      options.projectRoot,
      'node_modules',
      '@babel',
      'parser',
    );
    await write(
      path.join(parser, 'package.json'),
      JSON.stringify({
        name: '@babel/parser',
        version: '8.0.6',
        dependencies: { 'compiler-current': specifier },
      }),
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'Invalid renderer compiler npm alias',
    );
  });

  test.each([
    'sdk',
    'app',
  ] as const)('certifies a published canonical peer through its %s exact physical npm alias', async authority => {
    const options = await publishedPeerFixture(authority);
    const before = await resolveRendererBuildIdentities(options);
    await fs.appendFile(
      path.join(options.provider, 'index.js'),
      'export const changedCompiler = true;\n',
    );
    const after = await resolveRendererBuildIdentities(options);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.frameworkCohortDigest).not.toBe(before.frameworkCohortDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test('uses the effective optional alias instead of its shadowed dependency declaration', async () => {
    const options = await publishedPeerFixture();
    const file = path.join(options.sdk, 'package.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    manifest.dependencies[options.providerSpecifier] =
      'npm:@fixture/shadowed-owner@1.0.0';
    manifest.optionalDependencies = {
      [options.providerSpecifier]: options.providerRequest,
    };
    await write(file, JSON.stringify(manifest));
    await expect(
      resolveRendererBuildIdentities(options),
    ).resolves.toMatchObject({
      cacheAllowed: false,
    });
  });

  test.each([
    'catalog:ultramodern',
    'catalog:',
  ])('certifies an exact published peer through its declared %s and binds the YAML bytes', async catalog => {
    const options = await publishedPeerFixture('app');
    const manifest = path.join(options.projectRoot, 'package.json');
    const app = JSON.parse(await fs.readFile(manifest, 'utf8'));
    app.dependencies = { [options.providerSpecifier]: catalog };
    delete app.devDependencies;
    await write(manifest, JSON.stringify(app));
    const file = path.join(options.workspace, 'pnpm-workspace.yaml');
    const text = `${catalog === 'catalog:' ? 'catalog:' : 'catalogs:\n  ultramodern:'}\n${catalog === 'catalog:' ? '  ' : '    '}'${options.providerSpecifier}': '${options.providerRequest}'\n`;
    await write(file, text);
    const before = await resolveRendererBuildIdentities(options);
    await fs.appendFile(file, '# catalog authority bytes\n');
    const after = await resolveRendererBuildIdentities(options);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
  });

  test.each([
    'missing-workspace',
    'missing-catalog',
    'missing-key',
    'range',
    'wrong-name',
    'wrong-version',
    'different-physical-owner',
    'malformed',
    'nearer-workspace',
  ])('rejects %s catalog authority for a renamed peer', async scenario => {
    const options = await publishedPeerFixture('app');
    const manifest = path.join(options.projectRoot, 'package.json');
    const app = JSON.parse(await fs.readFile(manifest, 'utf8'));
    app.dependencies = { [options.providerSpecifier]: 'catalog:ultramodern' };
    delete app.devDependencies;
    await write(manifest, JSON.stringify(app));
    let request = options.providerRequest;
    if (scenario === 'range') request = `npm:${options.providerName}@^3.9.0`;
    if (scenario === 'wrong-name')
      request = `npm:@fixture/wrong@${options.version}`;
    if (scenario === 'wrong-version')
      request = `npm:${options.providerName}@3.9.1`;
    const file = path.join(options.workspace, 'pnpm-workspace.yaml');
    if (scenario !== 'missing-workspace')
      await write(
        file,
        scenario === 'malformed'
          ? 'catalogs: ['
          : `catalogs:\n  ${scenario === 'missing-catalog' ? 'other' : 'ultramodern'}:\n    '${scenario === 'missing-key' ? 'unrelated' : options.providerSpecifier}': '${request}'\n`,
      );
    if (scenario === 'nearer-workspace')
      await write(
        path.join(options.projectRoot, 'pnpm-workspace.yaml'),
        'packages: []\n',
      );
    if (scenario === 'different-physical-owner') {
      const alternate = path.join(
        options.workspace,
        'alternate-catalog-provider',
      );
      await writeFixturePackage(alternate, {
        name: options.providerName,
        version: options.version,
      });
      const slot = path.join(
        options.projectRoot,
        'node_modules',
        options.providerSpecifier,
      );
      await fs.unlink(slot);
      await fs.symlink(alternate, slot, 'dir');
    }
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow();
  });

  test('rejects an application-only MF authority manifest changed during implementation hashing', async () => {
    const options = await applicationFederationPeerFixture();
    const file = path.join(options.enhanced, 'package.json');
    const original = await fs.readFile(file, 'utf8');
    const read = fs.readFile.bind(fs);
    let changed = false;
    const spy = rs.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      if (
        !changed &&
        String(args[0]) === path.join(options.enhanced, 'index.js')
      ) {
        changed = true;
        await fs.writeFile(file, `${original}\n`);
      }
      return Reflect.apply(read, fs, args);
    });
    try {
      await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
        'authority manifest changed',
      );
      expect(changed).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test.each([
    'change',
    'closer-creation',
  ])('rejects catalog %s during an awaited compiler package read', async scenario => {
    const options = await publishedPeerFixture('app');
    const manifest = path.join(options.projectRoot, 'package.json');
    const app = JSON.parse(await fs.readFile(manifest, 'utf8'));
    app.dependencies = { [options.providerSpecifier]: 'catalog:ultramodern' };
    delete app.devDependencies;
    await write(manifest, JSON.stringify(app));
    const file = path.join(options.workspace, 'pnpm-workspace.yaml');
    const text = `catalogs:\n  ultramodern:\n    '${options.providerSpecifier}': '${options.providerRequest}'\n`;
    await write(file, text);
    const read = fs.readFile.bind(fs);
    let changed = false;
    const spy = rs.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      if (
        !changed &&
        String(args[0]) === path.join(options.provider, 'index.js')
      ) {
        changed = true;
        await write(
          scenario === 'change'
            ? file
            : path.join(options.projectRoot, 'pnpm-workspace.yaml'),
          `${text}# changed during compiler read\n`,
        );
      }
      return Reflect.apply(read, fs, args);
    });
    try {
      await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
        'catalog changed',
      );
      expect(changed).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test('certifies peer aliases declared by an additional selected physical framework owner', async () => {
    const options = await publishedPeerFixture();
    const file = path.join(options.sdk, 'package.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    delete manifest.dependencies[options.providerSpecifier];
    await write(file, JSON.stringify(manifest));
    const observedOwner = path.join(options.workspace, 'selected-sdk-copy');
    await writeFixturePackage(observedOwner, {
      name: manifest.name,
      version: manifest.version,
      dependencies: { [options.providerSpecifier]: options.providerRequest },
    });
    const slot = path.join(
      observedOwner,
      'node_modules',
      options.providerSpecifier,
    );
    await fs.mkdir(path.dirname(slot), { recursive: true });
    await fs.symlink(options.provider, slot, 'dir');
    options.frameworkPackageBindings = [
      { ...options.frameworkPackageBindings![0], directory: observedOwner },
    ];
    await expect(
      resolveRendererBuildIdentities(options),
    ).resolves.toMatchObject({
      cacheAllowed: false,
    });
  });

  test.each([
    'undeclared',
    'wrong-name',
    'wrong-version',
    'wrong-peer-version',
    'alias-range',
    'peer-range',
    'ambiguous',
    'different-physical-owner',
    'sdk-dev-only',
  ])('rejects %s authority for a renamed published canonical peer', async scenario => {
    const options = await publishedPeerFixture();
    const sdkManifestFile = path.join(options.sdk, 'package.json');
    const sdkManifest = JSON.parse(await fs.readFile(sdkManifestFile, 'utf8'));
    const pluginManifestFile = path.join(options.plugin, 'package.json');
    const pluginManifest = JSON.parse(
      await fs.readFile(pluginManifestFile, 'utf8'),
    );
    if (scenario === 'undeclared' || scenario === 'sdk-dev-only') {
      delete sdkManifest.dependencies[options.providerSpecifier];
      if (scenario === 'sdk-dev-only')
        sdkManifest.devDependencies = {
          [options.providerSpecifier]: options.providerRequest,
        };
    } else if (scenario === 'wrong-name' || scenario === 'wrong-version') {
      await writeFixturePackage(options.provider, {
        name:
          scenario === 'wrong-name'
            ? '@fixture/undeclared-provider'
            : options.providerName,
        version: scenario === 'wrong-version' ? '3.9.1' : options.version,
      });
    } else if (scenario === 'wrong-peer-version' || scenario === 'peer-range') {
      pluginManifest.peerDependencies[options.providerSpecifier] =
        scenario === 'wrong-peer-version' ? '3.9.1' : '^3.9.1';
    } else if (scenario === 'alias-range') {
      sdkManifest.dependencies[options.providerSpecifier] =
        `npm:${options.providerName}@^${options.version}`;
    } else if (scenario === 'ambiguous') {
      await write(
        path.join(options.projectRoot, 'package.json'),
        JSON.stringify({
          name: '@demo/shop',
          version: '1.0.0',
          devDependencies: {
            [options.providerSpecifier]: `npm:@fixture/competing-provider@${options.version}`,
          },
        }),
      );
      await writeFixturePackage(
        path.join(
          options.projectRoot,
          'node_modules',
          options.providerSpecifier,
        ),
        { name: '@fixture/competing-provider', version: options.version },
      );
    } else {
      await writeFixturePackage(
        path.join(options.plugin, 'node_modules', options.providerSpecifier),
        { name: options.providerName, version: options.version },
      );
    }
    await write(sdkManifestFile, JSON.stringify(sdkManifest));
    await write(pluginManifestFile, JSON.stringify(pluginManifest));
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'compiler/profile mismatch',
    );
  });

  test.each(
    (['dependency', 'optional', 'peer'] as const).flatMap(edge =>
      (['alias-first', 'consumer-first'] as const).map(order => ({
        edge,
        order,
      })),
    ),
  )('certifies a transitive MF peer cycle through $edge edges with $order declarations', async ({
    edge,
    order,
  }) => {
    const options = await transitiveFederationPeerFixture(edge, order);
    const before = await resolveRendererBuildIdentities(options);
    await fs.appendFile(
      path.join(options.tools, 'index.js'),
      'export const modifiedRuntimeTools = true;\n',
    );
    const after = await resolveRendererBuildIdentities(options);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.frameworkCohortDigest).not.toBe(before.frameworkCohortDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test('certifies the selected Rspack peer range through the application MF dependency graph', async () => {
    const options = await applicationFederationPeerFixture();
    const before = await resolveRendererBuildIdentities(options);
    const file = path.join(options.enhanced, 'package.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    manifest.description = 'Changed application compiler authority';
    await write(file, JSON.stringify(manifest));
    const after = await resolveRendererBuildIdentities(options);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
    await fs.appendFile(
      path.join(options.enhanced, 'index.js'),
      'export const changedApplicationCompiler = true;\n',
    );
    const compilerChanged = await resolveRendererBuildIdentities(options);
    expect(compilerChanged.compilerDigest).not.toBe(after.compilerDigest);
    await fs.appendFile(
      path.join(options.tools, 'index.js'),
      'export const changed = true;\n',
    );
    const providerChanged = await resolveRendererBuildIdentities(options);
    expect(providerChanged.compilerDigest).not.toBe(
      compilerChanged.compilerDigest,
    );
  });

  test.each([
    '^3.0.0',
    'latest',
    'catalog:mf',
  ])('rejects the incompatible or non-semver renamed Rspack peer %s', async specification => {
    const options = await applicationFederationPeerFixture();
    const file = path.join(options.rspack, 'package.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    manifest.peerDependencies[options.toolsSpecifier] = specification;
    await write(file, JSON.stringify(manifest));
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'compiler/profile mismatch',
    );
  });

  test.each([
    'dev-only',
    'unreachable',
  ])('rejects %s application graph authority for a renamed Rspack peer', async scenario => {
    const options = await applicationFederationPeerFixture();
    const file = path.join(options.projectRoot, 'package.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    if (scenario === 'dev-only')
      manifest.devDependencies = manifest.dependencies;
    delete manifest.dependencies;
    await write(file, JSON.stringify(manifest));
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'requires one exact declared npm alias target',
    );
  });

  test.each([
    'dev-only',
    'unreachable',
    'conflicting',
    'split-owner',
  ])('rejects %s transitive authority for a renamed MF peer', async scenario => {
    const options = await transitiveFederationPeerFixture();
    const file = path.join(options.enhanced, 'package.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    if (scenario === 'dev-only' || scenario === 'unreachable') {
      delete manifest.dependencies[options.toolsSpecifier];
      if (scenario === 'dev-only')
        manifest.devDependencies = {
          [options.toolsSpecifier]: options.toolsRequest,
        };
      else {
        const unrelated = path.join(
          options.projectRoot,
          'node_modules/@fixture/unreachable',
        );
        await writeFixturePackage(unrelated, {
          name: '@fixture/unreachable',
          version: '1.0.0',
          dependencies: { [options.toolsSpecifier]: options.toolsRequest },
        });
        const slot = path.join(
          unrelated,
          'node_modules',
          options.toolsSpecifier,
        );
        await fs.mkdir(path.dirname(slot), { recursive: true });
        await fs.symlink(options.tools, slot, 'dir');
      }
      await write(file, JSON.stringify(manifest));
    } else if (scenario === 'conflicting') {
      const otherOwner = '@fixture/other-owner';
      manifest.dependencies[otherOwner] = '1.0.0';
      await write(file, JSON.stringify(manifest));
      const owner = path.join(options.enhanced, 'node_modules', otherOwner);
      await writeFixturePackage(owner, {
        name: otherOwner,
        version: '1.0.0',
        dependencies: {
          [options.toolsSpecifier]: 'npm:@fixture/other-runtime-tools@2.9.1',
        },
      });
      await writeFixturePackage(
        path.join(owner, 'node_modules', options.toolsSpecifier),
        { name: '@fixture/other-runtime-tools', version: '2.9.1' },
      );
    } else {
      await writeFixturePackage(
        path.join(options.consumer, 'node_modules', options.toolsSpecifier),
        { name: '@bleedingdev/mf-runtime-tools', version: '2.9.1' },
      );
    }
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'compiler/profile mismatch',
    );
  });

  test('does not let an npm alias in the native hydration graph bypass its runtime pin', async () => {
    const options = await fixture();
    const tooling = path.join(
      options.projectRoot,
      'node_modules',
      '@solidjs',
      'web',
    );
    const alias = path.join(tooling, 'node_modules', 'solid-current');
    await write(
      path.join(tooling, 'package.json'),
      JSON.stringify({
        name: '@solidjs/web',
        version: '2.0.0-rc.13',
        dependencies: { 'solid-current': 'npm:solid-js@^2.0.0-rc.13' },
      }),
    );
    await write(
      path.join(alias, 'package.json'),
      JSON.stringify({ name: 'solid-js', version: '2.0.0-rc.14' }),
    );
    await expect(
      resolveRendererBuildIdentities({
        ...options,
      }),
    ).rejects.toThrow('expected solid-js@2.0.0-rc.13');
  });

  test('allows the exact neutral codec boundary beside native serde and binds its actual bytes', async () => {
    const options = await serdeFixture();
    const before = await resolveRendererBuildIdentities(options);
    await write(
      path.join(options.neutralSerde, 'index.js'),
      'export const neutralCodec = "changed bytes";',
    );
    const after = await resolveRendererBuildIdentities(options);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.frameworkCohortDigest).not.toBe(before.frameworkCohortDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test.each([
    'adapter',
    'router-core',
    'plugins-peer',
  ])('rejects mismatched serde in the native %s graph', async owner => {
    const options = await serdeFixture();
    let wrongSerde = options.nativeSerde;
    if (owner === 'router-core') {
      const core = path.join(
        options.projectRoot,
        'node_modules',
        '@tanstack',
        'router-core',
      );
      await write(
        path.join(core, 'package.json'),
        JSON.stringify({
          name: '@tanstack/router-core',
          version: '1.171.22',
          dependencies: { seroval: '^1.6.2' },
        }),
      );
      wrongSerde = path.join(core, 'node_modules', 'seroval');
    } else if (owner === 'plugins-peer') {
      wrongSerde = path.join(options.nativePlugins, 'node_modules', 'seroval');
    }
    await write(
      path.join(wrongSerde, 'package.json'),
      JSON.stringify({ name: 'seroval', version: '1.6.2' }),
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'expected seroval@1.6.8',
    );
  });

  test('does not treat a different physical copy of a declared neutral package as an exempt native boundary', async () => {
    const options = await serdeFixture();
    const copy = path.join(
      options.nativeDirectory,
      'node_modules',
      '@fixture',
      'neutral-core',
    );
    await write(
      path.join(copy, 'package.json'),
      await fs.readFile(
        path.join(options.neutralDirectory, 'package.json'),
        'utf8',
      ),
    );
    await write(
      path.join(copy, 'node_modules', 'seroval', 'package.json'),
      JSON.stringify({ name: 'seroval', version: '1.6.2' }),
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'expected seroval@1.6.8',
    );
  });

  test('recognizes an alias edge to the exact neutral boundary without changing its native role', async () => {
    const options = await serdeFixture();
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(options.nativeDirectory, 'package.json'),
        'utf8',
      ),
    );
    delete manifest.dependencies['@fixture/neutral-core'];
    manifest.dependencies['neutral-current'] =
      'npm:@fixture/neutral-core@1.0.0';
    await write(
      path.join(options.nativeDirectory, 'package.json'),
      JSON.stringify(manifest),
    );
    await fs.symlink(
      options.neutralDirectory,
      path.join(options.nativeDirectory, 'node_modules', 'neutral-current'),
      'dir',
    );
    await expect(
      resolveRendererBuildIdentities(options),
    ).resolves.toMatchObject({ cacheAllowed: false });
  });

  test('reenters native pin validation for a native hydration alias inside the neutral graph', async () => {
    const options = await serdeFixture();
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(options.neutralDirectory, 'package.json'),
        'utf8',
      ),
    );
    manifest.dependencies['native-current'] = 'npm:@solidjs/web@2.0.0-rc.13';
    await write(
      path.join(options.neutralDirectory, 'package.json'),
      JSON.stringify(manifest),
    );
    const native = path.join(
      options.neutralDirectory,
      'node_modules',
      'native-current',
    );
    await write(
      path.join(native, 'package.json'),
      JSON.stringify({
        name: '@solidjs/web',
        version: '2.0.0-rc.13',
        dependencies: { 'solid-js': '2.0.0-rc.14' },
      }),
    );
    await write(
      path.join(native, 'node_modules', 'solid-js', 'package.json'),
      JSON.stringify({ name: 'solid-js', version: '2.0.0-rc.14' }),
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'expected solid-js@2.0.0-rc.13',
    );
  });

  test('upgrades a shared physical dependency visited first in a neutral graph when a native alias reaches it', async () => {
    const options = await serdeFixture();
    const shared = path.join(
      options.projectRoot,
      'node_modules',
      '@fixture',
      'shared',
    );
    await write(
      path.join(shared, 'package.json'),
      JSON.stringify({
        name: '@fixture/shared',
        version: '1.0.0',
        dependencies: { seroval: '1.6.2' },
      }),
    );
    const neutral = JSON.parse(
      await fs.readFile(
        path.join(options.neutralDirectory, 'package.json'),
        'utf8',
      ),
    );
    neutral.dependencies['@fixture/shared'] = '1.0.0';
    await write(
      path.join(options.neutralDirectory, 'package.json'),
      JSON.stringify(neutral),
    );
    const native = JSON.parse(
      await fs.readFile(
        path.join(options.nativeDirectory, 'package.json'),
        'utf8',
      ),
    );
    native.dependencies['z-native-shared'] = 'npm:@fixture/shared@1.0.0';
    await write(
      path.join(options.nativeDirectory, 'package.json'),
      JSON.stringify(native),
    );
    await fs.symlink(
      shared,
      path.join(options.nativeDirectory, 'node_modules', 'z-native-shared'),
      'dir',
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'expected seroval@1.6.8',
    );
  });

  test('requires all supplemental profile pins in the actual native graph rather than an unrelated ambient package', async () => {
    const options = await serdeFixture();
    const native = JSON.parse(
      await fs.readFile(
        path.join(options.nativeDirectory, 'package.json'),
        'utf8',
      ),
    );
    delete native.dependencies.seroval;
    delete native.dependencies['seroval-plugins'];
    await write(
      path.join(options.nativeDirectory, 'package.json'),
      JSON.stringify(native),
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'requires seroval@1.6.8 in its selected native',
    );
  });

  test('binds compiler dependency edges when equal-version physical copies have different bytes', async () => {
    const options = await fixture();
    const compiler = path.join(
      options.projectRoot,
      'node_modules',
      '@solidjs',
      'compiler',
    );
    const hydration = path.join(
      options.projectRoot,
      'node_modules',
      '@solidjs',
      'web',
    );
    const hydrationManifest = JSON.parse(
      await fs.readFile(path.join(hydration, 'package.json'), 'utf8'),
    );
    hydrationManifest.dependencies['@babel/parser'] = '8.0.6';
    await write(
      path.join(hydration, 'package.json'),
      JSON.stringify(hydrationManifest),
    );
    const copies = [compiler, hydration].map(directory =>
      path.join(directory, 'node_modules', '@babel', 'parser'),
    );
    for (const copy of copies)
      await write(
        path.join(copy, 'package.json'),
        JSON.stringify({ name: '@babel/parser', version: '8.0.6' }),
      );
    await write(
      path.join(copies[0], 'index.js'),
      'export const implementation = "A";',
    );
    await write(
      path.join(copies[1], 'index.js'),
      'export const implementation = "B";',
    );
    const before = await resolveRendererBuildIdentities(options);
    await write(
      path.join(copies[0], 'index.js'),
      'export const implementation = "B";',
    );
    await write(
      path.join(copies[1], 'index.js'),
      'export const implementation = "A";',
    );
    const after = await resolveRendererBuildIdentities(options);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
  });

  test('binds selected framework bootstrap cohort bytes in the compiler identity', async () => {
    const options = await fixture();
    const framework = path.join(
      options.projectRoot,
      'node_modules',
      '@modern-js',
      'renderer-solid',
    );
    await write(
      path.join(framework, 'package.json'),
      JSON.stringify({
        name: '@modern-js/renderer-solid',
        version: '3.8.3',
        dependencies: { '@solidjs/web': '2.0.0-rc.13' },
      }),
    );
    await write(
      path.join(framework, 'index.js'),
      'export const bootstrap = "candidate A";',
    );
    const frameworkPackages = ['@modern-js/renderer-solid'];
    const before = await resolveRendererBuildIdentities({
      ...options,
      frameworkPackages,
    });
    await write(
      path.join(framework, 'index.js'),
      'export const bootstrap = "candidate B";',
    );
    const after = await resolveRendererBuildIdentities({
      ...options,
      frameworkPackages,
    });
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
    expect(after.frameworkCohortDigest).not.toBe(before.frameworkCohortDigest);
    expect(after.frameworkCohortDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  test('binds different dependency closures behind equal-byte equal-version package copies', async () => {
    const options = await fixture();
    const compiler = path.join(
      options.projectRoot,
      'node_modules',
      '@solidjs',
      'compiler',
    );
    const hydration = path.join(
      options.projectRoot,
      'node_modules',
      '@solidjs',
      'web',
    );
    const hydrationManifest = JSON.parse(
      await fs.readFile(path.join(hydration, 'package.json'), 'utf8'),
    );
    hydrationManifest.dependencies['@babel/parser'] = '8.0.6';
    await write(
      path.join(hydration, 'package.json'),
      JSON.stringify(hydrationManifest),
    );
    const copies = [compiler, hydration].map(directory =>
      path.join(directory, 'node_modules', '@babel', 'parser'),
    );
    for (const copy of copies) {
      await write(
        path.join(copy, 'package.json'),
        JSON.stringify({
          name: '@babel/parser',
          version: '8.0.6',
          dependencies: { '@fixture/helper': '1.0.0' },
        }),
      );
      await write(
        path.join(copy, 'index.js'),
        'export { implementation } from "@fixture/helper";',
      );
      await write(
        path.join(copy, 'node_modules', '@fixture', 'helper', 'package.json'),
        JSON.stringify({ name: '@fixture/helper', version: '1.0.0' }),
      );
    }
    const helpers = copies.map(copy =>
      path.join(copy, 'node_modules', '@fixture', 'helper', 'index.js'),
    );
    await write(helpers[0], 'export const implementation = "A";');
    await write(helpers[1], 'export const implementation = "B";');
    const before = await resolveRendererBuildIdentities(options);
    await write(helpers[0], 'export const implementation = "B";');
    await write(helpers[1], 'export const implementation = "A";');
    const after = await resolveRendererBuildIdentities(options);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
  });

  test('translates canonical pins only through explicit observed package facts', async () => {
    const options = await observedFrameworkFixture('adapter');
    await expect(
      resolveRendererBuildIdentities(options),
    ).resolves.toMatchObject({
      cacheAllowed: false,
    });
    await expect(
      resolveRendererBuildIdentities({
        ...options,
        frameworkPackageBindings: [],
      }),
    ).rejects.toThrow(
      `requires ${options.binding.specifier}@${options.binding.version}`,
    );
    await expect(
      resolveRendererBuildIdentities({
        ...options,
        profile: {
          ...options.profile,
          dependencies: {
            ...options.profile.dependencies,
            [options.binding.specifier]: '1.0.1',
          },
        },
      }),
    ).rejects.toThrow(`expected ${options.binding.name}@1.0.1`);
  });

  test.each(
    nativeFrameworkRoles.flatMap(role =>
      ['target-only', 'same-owner-alias', 'canonical-only'].map(form => ({
        role,
        form,
      })),
    ),
  )('accepts $form resolution for native observed $role roots', async ({
    role,
    form,
  }) => {
    const options = await observedFrameworkFixture(role);
    if (form === 'canonical-only') {
      await relocateObservedFramework(
        options,
        path.join(options.workspace, 'package-store', options.binding.name),
      );
    }
    if (form !== 'target-only') {
      await fs.mkdir(path.dirname(options.canonicalDirectory), {
        recursive: true,
      });
      await fs.symlink(
        options.observedDirectory,
        options.canonicalDirectory,
        'dir',
      );
    }
    const result = await resolveRendererBuildIdentities(options);
    expect(result.compilerDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.frameworkCohortDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.identities.main.renderer).toBe('solid');
  });

  test('uses an app-level target before an ancestor canonical package', async () => {
    const options = await observedFrameworkFixture('adapter');
    await writeFixturePackage(
      path.join(options.workspace, 'node_modules', options.binding.specifier),
      { name: '@fixture/ancestor-decoy', version: '9.9.9' },
    );
    await expect(
      resolveRendererBuildIdentities(options),
    ).resolves.toMatchObject({
      cacheAllowed: false,
    });
  });

  test.each([
    { target: 'same-level', field: 'name' },
    { target: 'same-level', field: 'version' },
    { target: 'ancestor', field: 'name' },
    { target: 'ancestor', field: 'version' },
  ])('rejects an invalid app canonical $field despite a valid $target target', async ({
    target,
    field,
  }) => {
    const options = await observedFrameworkFixture('adapter');
    if (target === 'ancestor') {
      await relocateObservedFramework(
        options,
        path.join(options.workspace, 'node_modules', options.binding.name),
      );
    }
    // The target really is admissible before the invalid local alias appears.
    await resolveRendererBuildIdentities(options);
    await writeFixturePackage(options.canonicalDirectory, {
      name:
        field === 'name'
          ? '@fixture/wrong-canonical-owner'
          : options.binding.name,
      version: field === 'version' ? '9.9.9' : options.binding.version,
    });
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      `Selected framework owner mismatch: ${options.binding.specifier}`,
    );
  });

  test.each(
    nativeFrameworkRoles,
  )('rejects split physical owners for native observed %s roots', async role => {
    const options = await observedFrameworkFixture(role);
    await writeFixturePackage(options.canonicalDirectory, {
      name: options.binding.name,
      version: options.binding.version,
    });
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'resolves a different physical owner from the application',
    );
  });

  test.each(
    nativeFrameworkRoles,
  )('rejects a different captured registrar owner for native observed %s roots', async role => {
    const options = await observedFrameworkFixture(role);
    const registrarDirectory = path.join(
      options.workspace,
      'registrar',
      'node_modules',
      options.binding.name,
    );
    await writeFixturePackage(registrarDirectory, {
      name: options.binding.name,
      version: options.binding.version,
    });
    options.binding.directory = registrarDirectory;
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'resolves a different physical owner from the application',
    );
  });

  test.each([
    'name',
    'version',
  ] as const)('rejects a changed observed framework manifest %s', async field => {
    const options = await observedFrameworkFixture('adapter');
    const manifestFile = path.join(options.observedDirectory, 'package.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    manifest[field] =
      field === 'name' ? '@fixture/changed-public-owner' : '9.9.9';
    await write(manifestFile, JSON.stringify(manifest));
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      `Selected public framework module ${options.binding.specifier} changed its owning manifest before identity resolution.`,
    );
  });

  test.each([
    { role: 'core', copy: 'canonical' },
    { role: 'core', copy: 'target' },
    { role: 'core', copy: 'observed' },
    { role: 'builder', copy: 'canonical' },
    { role: 'builder', copy: 'target' },
    { role: 'builder', copy: 'observed' },
  ] as const)('binds the $copy physical owner of neutral observed $role roots', async ({
    role,
    copy,
  }) => {
    const options = await observedFrameworkFixture(role);
    const targetDirectory = options.observedDirectory;
    await relocateObservedFramework(
      options,
      path.join(
        options.workspace,
        'registrar',
        'node_modules',
        options.binding.name,
      ),
    );
    await writeFixturePackage(targetDirectory, {
      name: options.binding.name,
      version: options.binding.version,
    });
    await write(
      path.join(targetDirectory, 'index.js'),
      'export const owningCopy = "app target package";',
    );
    await writeFixturePackage(options.canonicalDirectory, {
      name: options.binding.name,
      version: options.binding.version,
    });
    await write(
      path.join(options.canonicalDirectory, 'index.js'),
      'export const owningCopy = "app neutral package";',
    );
    const before = await resolveRendererBuildIdentities(options);
    await fs.appendFile(
      path.join(
        copy === 'canonical'
          ? options.canonicalDirectory
          : copy === 'target'
            ? targetDirectory
            : options.observedDirectory,
        'index.js',
      ),
      '\nexport const changedPhysicalBytes = true;\n',
    );
    const after = await resolveRendererBuildIdentities(options);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.profileDigest).toBe(before.profileDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.frameworkCohortDigest).not.toBe(before.frameworkCohortDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test('binds the observed canonical specifier to the framework digest', async () => {
    const options = await observedFrameworkFixture('core');
    const before = await resolveRendererBuildIdentities(options);
    const after = await resolveRendererBuildIdentities({
      ...options,
      frameworkPackageBindings: [
        {
          ...options.binding,
          specifier: '@fixture/another-public-core-module',
        },
      ],
    });
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.profileDigest).toBe(before.profileDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.frameworkCohortDigest).not.toBe(before.frameworkCohortDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test('rejects observed package facts outside the selected framework graph', async () => {
    const options = await observedFrameworkFixture('adapter');
    await expect(
      resolveRendererBuildIdentities({
        ...options,
        frameworkPackages: [],
      }),
    ).rejects.toThrow(
      `The observed framework owner ${options.binding.name} is not part of the selected framework package graph.`,
    );
  });

  test('preserves foundational runtime pins through observed framework aliases', async () => {
    const options = await observedFrameworkFixture('adapter');
    await fs.mkdir(path.dirname(options.canonicalDirectory), {
      recursive: true,
    });
    await fs.symlink(
      options.observedDirectory,
      options.canonicalDirectory,
      'dir',
    );
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(options.observedDirectory, 'package.json'),
        'utf8',
      ),
    );
    manifest.dependencies['foundational-current'] = 'npm:solid-js@2.0.0-rc.14';
    await write(
      path.join(options.observedDirectory, 'package.json'),
      JSON.stringify(manifest),
    );
    await writeFixturePackage(
      path.join(
        options.observedDirectory,
        'node_modules',
        'foundational-current',
      ),
      { name: 'solid-js', version: '2.0.0-rc.14' },
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'expected solid-js@2.0.0-rc.13',
    );
  });

  test('uses captured observed package facts during pending caller mutation', async () => {
    const options = await observedFrameworkFixture('adapter');
    const before = await resolveRendererBuildIdentities(options);
    const pending = resolveRendererBuildIdentities(options);
    expect(Object.isFrozen(options.binding)).toBe(false);
    expect(Object.isFrozen(options.frameworkPackages)).toBe(false);
    options.binding.directory = path.join(options.workspace, 'not-observed');
    options.binding.version = '9.9.9';
    options.frameworkPackages.splice(0);
    const after = await pending;
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.profileDigest).toBe(before.profileDigest);
    expect(after.compilerDigest).toBe(before.compilerDigest);
    expect(after.frameworkCohortDigest).toBe(before.frameworkCohortDigest);
    expect(after.buildMarker).toBe(before.buildMarker);
  });

  test.each([
    'duplicate-name',
    'duplicate-specifier',
    'relative-directory',
    'nonexact-version',
  ])('rejects malformed observed framework facts: %s', async invalidCase => {
    const options = await observedFrameworkFixture('adapter');
    const second = { ...options.binding };
    let frameworkPackageBindings = [options.binding];
    if (invalidCase === 'duplicate-name') {
      second.specifier = '@fixture/another-public-module';
      frameworkPackageBindings = [options.binding, second];
    } else if (invalidCase === 'duplicate-specifier') {
      second.name = '@fixture/another-package-owner';
      frameworkPackageBindings = [options.binding, second];
    } else if (invalidCase === 'relative-directory') {
      second.directory = './node_modules/@fixture/sdk-adapter';
      frameworkPackageBindings = [second];
    } else {
      second.version = '^1.0.0';
      frameworkPackageBindings = [second];
    }
    await expect(
      resolveRendererBuildIdentities({
        ...options,
        frameworkPackageBindings,
        frameworkPackages: [
          ...new Set(frameworkPackageBindings.map(binding => binding.name)),
        ],
      }),
    ).rejects.toThrow(
      'Selected framework module observations must have unique',
    );
  });

  test.each([
    'missing-entry',
    'extra-entry',
    'unexpected-field',
    'default-mismatch',
    'duplicate-framework',
    'noncanonical-owner',
  ])('validates router bindings against the exact generated entry set: %s', async invalidCase => {
    const options = await rendererFixture('react');
    const bindings = ownedRouterBindings(options);
    const routerBindings = (() => {
      switch (invalidCase) {
        case 'missing-entry':
          return { main: bindings.main };
        case 'extra-entry':
          return { ...bindings, other: bindings.main };
        case 'unexpected-field':
          return {
            ...bindings,
            main: { ...bindings.main, unownedExtension: true },
          };
        case 'default-mismatch':
          return {
            ...bindings,
            main: {
              ...bindings.main,
              defaultProvider: {
                ...bindings.main.defaultProvider,
                version: '7.18.3',
              },
            },
          };
        case 'duplicate-framework':
          return {
            ...bindings,
            main: {
              ...bindings.main,
              evidence: 'provider-registry' as const,
              providers: [
                bindings.main.defaultProvider,
                { ...bindings.main.defaultProvider },
              ],
            },
          };
        case 'noncanonical-owner':
          return {
            ...bindings,
            main: { ...bindings.main, owner: ' @fixture/runtime-router' },
          };
        default:
          throw new Error(`Unknown fixture case: ${invalidCase}`);
      }
    })();
    await expect(
      resolveRendererBuildIdentities({ ...options, routerBindings }),
    ).rejects.toThrow('Invalid renderer router bindings');
  });

  test('rejects a missing router binding map before resolving package identities', async () => {
    const options = await fixture();
    Reflect.deleteProperty(options, 'routerBindings');
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'Invalid renderer router bindings',
    );
  });

  test('snapshots and recursively freezes returned router bindings without freezing input', async () => {
    const options = await rendererFixture('react');
    const routerBindings = ownedRouterBindings(options);
    const result = await resolveRendererBuildIdentities({
      ...options,
      routerBindings,
    });
    const snapshot = result.routerBindings;
    expect(snapshot).toEqual(routerBindings);
    if (!snapshot) throw new Error('Expected returned router bindings.');
    expect(snapshot).not.toBe(routerBindings);
    expect(snapshot.main).not.toBe(routerBindings.main);
    expect(snapshot.main.defaultProvider).not.toBe(
      routerBindings.main.defaultProvider,
    );
    expect(snapshot.main.providers).not.toBe(routerBindings.main.providers);
    for (const value of [
      snapshot,
      snapshot.main,
      snapshot.main.defaultProvider,
      snapshot.main.providers,
      ...snapshot.main.providers,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Object.isFrozen(routerBindings)).toBe(false);
    expect(Object.isFrozen(routerBindings.main.defaultProvider)).toBe(false);
    routerBindings.main.owner = '@fixture/replaced-owner';
    routerBindings.main.defaultProvider.version = '99.0.0';
    routerBindings.main.providers[0].coreVersion = '99.0.0';
    routerBindings.main.providers.push({
      ...routerBindings.main.defaultProvider,
    });
    Reflect.deleteProperty(routerBindings, 'admin');
    expect(snapshot.main.owner).toBe('@fixture/runtime-router');
    expect(snapshot.main.defaultProvider.version).toBe('7.18.4');
    expect(snapshot.main.providers[0].coreVersion).toBe('7.18.4');
    expect(snapshot.main.providers).toHaveLength(1);
    expect(snapshot).toHaveProperty('admin');
    expect(Reflect.set(snapshot.main, 'owner', '@fixture/replaced-owner')).toBe(
      false,
    );
  });

  test.each(
    tupleRoles,
  )('admits known %s HTTPS specs independently of archive filename versions', async role => {
    const options = await uriProfileFixture(role);
    const result = await resolveRendererBuildIdentities(options);
    expect(result.identities.main.renderer).toBe('solid');
    expect(result.compilerDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.buildMarker).toMatch(/^[a-f0-9]{64}$/);
    expect(result.routerBindings).toEqual(options.routerBindings);
  });

  test.each(
    tupleRoles,
  )('enforces the actual installed %s version behind an HTTPS spec', async role => {
    const options = await uriProfileFixture(role);
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(options.packageDirectory, 'package.json'),
        'utf8',
      ),
    );
    // Matching the URI's filename is insufficient: the authored tuple owns
    // the admitted installed version.
    manifest.version = '9.9.9';
    await write(
      path.join(options.packageDirectory, 'package.json'),
      JSON.stringify(manifest),
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      `expected ${options.nativePackage.name}@${options.nativePackage.version}`,
    );
  });

  test.each(
    tupleRoles,
  )('binds a changed %s HTTPS spec to metadata while retaining package byte identity', async role => {
    const options = await uriProfileFixture(role);
    const before = await resolveRendererBuildIdentities(options);
    const after = await resolveRendererBuildIdentities({
      ...options,
      profile: {
        ...options.profile,
        dependencies: {
          ...options.profile.dependencies,
          [options.nativePackage.name]:
            `https://artifacts.example.invalid/${encodeURIComponent(options.nativePackage.name)}/unversioned.tgz?digest=second`,
        },
      },
    });
    expect(after.routerBindings).toEqual(before.routerBindings);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.compilerDigest).toBe(before.compilerDigest);
    expect(after.frameworkCohortDigest).toBe(before.frameworkCohortDigest);
    expect(after.profileDigest).not.toBe(before.profileDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test.each([
    'solid-js',
    'seroval',
    '@fixture/framework-bootstrap',
  ])('rejects supplemental HTTPS specs without an explicit tuple for %s', async name => {
    const options = await fixture();
    if (name !== 'solid-js') {
      await writeFixturePackage(
        path.join(options.projectRoot, 'node_modules', name),
        { name, version: name === 'seroval' ? '1.6.8' : '1.0.0' },
      );
    }
    await expect(
      resolveRendererBuildIdentities({
        ...options,
        frameworkPackages:
          name === '@fixture/framework-bootstrap' ? [name] : [],
        profile: {
          ...options.profile,
          dependencies: {
            ...options.profile.dependencies,
            [name]: 'https://artifacts.example.invalid/runtime-1.6.8.tgz',
          },
        },
      }),
    ).rejects.toThrow(`Renderer profile requires an exact version for ${name}`);
  });

  test.each([
    'protocolVersion',
    'renderer',
    'nested-dependency',
  ])('uses the captured full renderer profile during pending %s mutation', async changedField => {
    const options = await fixture();
    const before = await resolveRendererBuildIdentities(options);
    const pending = resolveRendererBuildIdentities(options);
    expect(Object.isFrozen(options.profile)).toBe(false);
    expect(Object.isFrozen(options.profile.dependencies)).toBe(false);
    if (changedField === 'nested-dependency') {
      const dependencies = options.profile.dependencies;
      if (!dependencies) throw new Error('Expected fixture dependency pins.');
      expect(Reflect.set(dependencies, 'solid-js', '2.0.0-rc.14')).toBe(true);
    } else {
      expect(
        Reflect.set(
          options.profile,
          changedField,
          changedField === 'renderer' ? 'octane' : 2,
        ),
      ).toBe(true);
    }
    const after = await pending;
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.profileDigest).toBe(before.profileDigest);
    expect(after.compilerDigest).toBe(before.compilerDigest);
    expect(after.frameworkCohortDigest).toBe(before.frameworkCohortDigest);
    expect(after.buildMarker).toBe(before.buildMarker);
    expect(after.identities).toEqual(before.identities);
    expect(after.identities.main.renderer).toBe('solid');
    expect(after.identities.main.protocolVersion).toBe(1);
  });

  test('uses the validated router binding snapshot throughout asynchronous package resolution', async () => {
    const options = await providerRegistryFixture();
    const before = await resolveRendererBuildIdentities(options);
    const pending = resolveRendererBuildIdentities(options);
    // Validation and snapshotting run before the first filesystem await.
    // The caller can then replace its registry while package reads are pending.
    for (const binding of Object.values(options.routerBindings)) {
      binding.providers.splice(1);
    }
    const after = await pending;
    expect(after.routerBindings).toEqual(before.routerBindings);
    expect(after.routerBindings?.main.providers).toHaveLength(2);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.profileDigest).toBe(before.profileDigest);
    expect(after.compilerDigest).toBe(before.compilerDigest);
    expect(after.buildMarker).toBe(before.buildMarker);
  });

  test.each([
    'owner',
    'evidence',
  ])('binds router %s metadata to the marker without changing compiler bytes', async field => {
    const options = await rendererFixture('react');
    const routerBindings = ownedRouterBindings(options);
    const before = await resolveRendererBuildIdentities({
      ...options,
      routerBindings,
    });
    const main =
      field === 'owner'
        ? { ...routerBindings.main, owner: '@fixture/file-router-owner' }
        : { ...routerBindings.main, evidence: 'file-routes' as const };
    const after = await resolveRendererBuildIdentities({
      ...options,
      routerBindings: { ...routerBindings, main },
    });
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.compilerDigest).toBe(before.compilerDigest);
    expect(after.profileDigest).not.toBe(before.profileDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test('canonicalizes entry order while preserving the full router binding map', async () => {
    const options = await providerRegistryFixture();
    const before = await resolveRendererBuildIdentities(options);
    const reordered = await resolveRendererBuildIdentities({
      ...options,
      entryNames: ['admin', 'main'],
      routerBindings: {
        admin: options.routerBindings.admin,
        main: options.routerBindings.main,
      },
    });
    expect(reordered.routerBindings).toEqual(options.routerBindings);
    expect(reordered.profileDigest).toBe(before.profileDigest);
    expect(reordered.compilerDigest).toBe(before.compilerDigest);
    expect(reordered.buildMarker).toBe(before.buildMarker);
    expect(reordered.routerBindings?.main.evidence).toBe('provider-registry');
    expect(reordered.routerBindings?.main.providers).toHaveLength(2);
  });

  test.each([
    'provider',
    'core',
  ])('hashes the registered optional TanStack %s bytes from its owning package', async packageRole => {
    const options = await providerRegistryFixture();
    const before = await resolveRendererBuildIdentities(options);
    await fs.appendFile(
      path.join(options.ambientCoreDirectory, 'index.js'),
      '\nexport const unselectedAmbientChange = true;\n',
    );
    const ambientChanged = await resolveRendererBuildIdentities(options);
    expect(ambientChanged.compilerDigest).toBe(before.compilerDigest);
    const directory =
      packageRole === 'provider'
        ? options.providerDirectory
        : options.coreDirectory;
    await fs.appendFile(
      path.join(directory, 'index.js'),
      '\nexport const owningProviderChange = true;\n',
    );
    const after = await resolveRendererBuildIdentities(options);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.profileDigest).toBe(before.profileDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test.each([
    { packageRole: 'provider', field: 'name' },
    { packageRole: 'provider', field: 'version' },
    { packageRole: 'core', field: 'name' },
    { packageRole: 'core', field: 'version' },
  ])('rejects an optional provider actual $packageRole $field tuple mismatch', async mismatch => {
    const options = await providerRegistryFixture();
    const provider = options.routerBindings.main.providers[1];
    const expectedName =
      mismatch.packageRole === 'provider' ? provider.name : provider.coreName;
    const expectedVersion =
      mismatch.packageRole === 'provider'
        ? provider.version
        : provider.coreVersion;
    const directory =
      mismatch.packageRole === 'provider'
        ? options.providerDirectory
        : options.coreDirectory;
    // The correctly labelled ambient core must not override the provider's
    // actual resolved core owner.
    await writeFixturePackage(options.ambientCoreDirectory, {
      name: provider.coreName,
      version: provider.coreVersion,
    });
    const manifest = JSON.parse(
      await fs.readFile(path.join(directory, 'package.json'), 'utf8'),
    );
    manifest[mismatch.field] =
      mismatch.field === 'name'
        ? '@fixture/renamed-router-package'
        : '1.171.30';
    await write(path.join(directory, 'package.json'), JSON.stringify(manifest));
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      `expected ${expectedName}@${expectedVersion}`,
    );
  });

  test('requires every registered provider to be installed even when its default is React', async () => {
    const options = await providerRegistryFixture();
    // This root belongs to this newly created controlled fixture.
    await fs.rm(options.providerDirectory, { recursive: true, force: true });
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'requires installed @tanstack/react-router@1.171.29',
    );
  });

  test('accepts a selected React self-core router without any TanStack package', async () => {
    const options = await rendererFixture('react');
    const result = await resolveRendererBuildIdentities({
      ...options,
      frameworkPackages: ['react-router-dom'],
    });
    expect(result.identities.main.renderer).toBe('react');
    expect(result.compilerDigest).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      fs.stat(path.join(options.projectRoot, 'node_modules', '@tanstack')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.each([
    'solid',
    'react',
  ] as const)('rejects an actual selected %s router package with a competing exact version', async renderer => {
    const options =
      renderer === 'solid' ? await fixture() : await rendererFixture(renderer);
    const router = path.join(
      options.projectRoot,
      'node_modules',
      options.profile.router.name,
    );
    const manifest = JSON.parse(
      await fs.readFile(path.join(router, 'package.json'), 'utf8'),
    );
    manifest.version = renderer === 'solid' ? '2.0.0-rc.9' : '7.18.3';
    await write(path.join(router, 'package.json'), JSON.stringify(manifest));
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      `expected ${options.profile.router.name}@${options.profile.router.version}`,
    );
  });

  test('binds the selected nested router core bytes instead of an unselected ambient core', async () => {
    const options = await fixture();
    const selectedCore = path.join(
      options.projectRoot,
      'node_modules',
      options.profile.router.name,
      'node_modules',
      options.profile.router.coreName,
    );
    await writeFixturePackage(selectedCore, {
      name: options.profile.router.coreName,
      version: options.profile.router.coreVersion,
    });
    const before = await resolveRendererBuildIdentities(options);
    await fs.appendFile(
      path.join(
        options.projectRoot,
        'node_modules',
        options.profile.router.coreName,
        'index.js',
      ),
      '\nexport const unrelatedAmbientCore = true;\n',
    );
    const ambientChanged = await resolveRendererBuildIdentities(options);
    expect(ambientChanged.compilerDigest).toBe(before.compilerDigest);
    expect(ambientChanged.buildMarker).toBe(before.buildMarker);
    await fs.appendFile(
      path.join(selectedCore, 'index.js'),
      '\nexport const selectedCoreChange = true;\n',
    );
    const selectedChanged = await resolveRendererBuildIdentities(options);
    expect(selectedChanged.inputDigest).toBe(before.inputDigest);
    expect(selectedChanged.compilerDigest).not.toBe(before.compilerDigest);
    expect(selectedChanged.buildMarker).not.toBe(before.buildMarker);
  });

  // Matching package versions still have distinct physical byte identities.
  // This graph test does not certify shared application router contexts.
  test.each([
    'router',
    'core',
  ])('binds equal-version physical compiler-tooling %s copies independently', async changedPackage => {
    const options = await fixture();
    const compiler = path.join(
      options.projectRoot,
      'node_modules',
      options.profile.compiler.name,
    );
    const compilerManifest = JSON.parse(
      await fs.readFile(path.join(compiler, 'package.json'), 'utf8'),
    );
    compilerManifest.dependencies['tooling-router'] =
      'npm:@tanstack/solid-router@2.0.0-rc.8';
    await write(
      path.join(compiler, 'package.json'),
      JSON.stringify(compilerManifest),
    );
    const toolingRouter = path.join(compiler, 'node_modules', 'tooling-router');
    const toolingCore = path.join(
      toolingRouter,
      'node_modules',
      'tooling-core',
    );
    await writeFixturePackage(toolingRouter, {
      name: '@tanstack/solid-router',
      version: '2.0.0-rc.8',
      dependencies: { 'tooling-core': 'npm:@tanstack/router-core@1.171.22' },
    });
    await writeFixturePackage(toolingCore, {
      name: '@tanstack/router-core',
      version: '1.171.22',
    });
    const before = await resolveRendererBuildIdentities(options);
    const changedDirectory =
      changedPackage === 'router' ? toolingRouter : toolingCore;
    await fs.appendFile(
      path.join(changedDirectory, 'index.js'),
      '\nexport const toolingBytesChanged = true;\n',
    );
    const after = await resolveRendererBuildIdentities(options);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
    const manifest = JSON.parse(
      await fs.readFile(path.join(changedDirectory, 'package.json'), 'utf8'),
    );
    const expectedVersion =
      changedPackage === 'router'
        ? options.profile.router.version
        : options.profile.router.coreVersion;
    manifest.version = changedPackage === 'router' ? '2.0.0-rc.9' : '1.171.23';
    await write(
      path.join(changedDirectory, 'package.json'),
      JSON.stringify(manifest),
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      `expected ${manifest.name}@${expectedVersion}`,
    );
  });

  test.each([
    'router',
    'core',
  ])('rejects a conflicting contextual %s alias under the compiler owner', async packageRole => {
    const options = await fixture();
    const name =
      packageRole === 'router'
        ? options.profile.router.name
        : options.profile.router.coreName;
    const version =
      packageRole === 'router'
        ? options.profile.router.version
        : options.profile.router.coreVersion;
    const compiler = path.join(
      options.projectRoot,
      'node_modules',
      options.profile.compiler.name,
    );
    const manifest = JSON.parse(
      await fs.readFile(path.join(compiler, 'package.json'), 'utf8'),
    );
    manifest.dependencies['tooling-copy'] = `npm:${name}@1.170.0`;
    await write(path.join(compiler, 'package.json'), JSON.stringify(manifest));
    await writeFixturePackage(
      path.join(compiler, 'node_modules', 'tooling-copy'),
      { name, version: '1.170.0' },
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      `expected ${name}@${version}`,
    );
  });

  test.each([
    {
      renderer: 'react',
      name: 'react',
      version: '19.3.0',
      wrong: '19.2.0',
    },
    {
      renderer: 'octane',
      name: 'octane',
      version: '0.7.1',
      wrong: '0.7.0',
    },
  ] as const)('rejects a conflicting foundational $renderer runtime reached through a nested tooling router copy', async runtime => {
    const options = await rendererFixture(runtime.renderer);
    const compiler = path.join(
      options.projectRoot,
      'node_modules',
      options.profile.compiler.name,
    );
    await writeFixturePackage(compiler, {
      name: options.profile.compiler.name,
      version: options.profile.compiler.version,
      dependencies: {
        'tooling-router': `npm:${options.profile.router.name}@${options.profile.router.version}`,
      },
    });
    const toolingRouter = path.join(compiler, 'node_modules', 'tooling-router');
    await writeFixturePackage(toolingRouter, {
      name: options.profile.router.name,
      version: options.profile.router.version,
      dependencies: { [runtime.name]: runtime.wrong },
    });
    await writeFixturePackage(
      path.join(toolingRouter, 'node_modules', runtime.name),
      { name: runtime.name, version: runtime.wrong },
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      `expected ${runtime.name}@${runtime.version}`,
    );
  });

  test('binds a distinct unselected router core reached through a declared neutral tooling boundary', async () => {
    const options = await fixture();
    const tooling = path.join(
      options.projectRoot,
      'node_modules',
      '@fixture',
      'framework-tooling',
    );
    await write(
      path.join(tooling, 'package.json'),
      JSON.stringify({
        name: '@fixture/framework-tooling',
        version: '1.0.0',
        dependencies: { '@fixture/other-router': '1.0.0' },
      }),
    );
    await write(path.join(tooling, 'index.js'), 'export const tooling = true;');
    const otherRouter = path.join(
      tooling,
      'node_modules',
      '@fixture',
      'other-router',
    );
    await write(
      path.join(otherRouter, 'package.json'),
      JSON.stringify({
        name: '@fixture/other-router',
        version: '1.0.0',
        dependencies: { '@tanstack/router-core': '1.171.15' },
      }),
    );
    await write(
      path.join(otherRouter, 'index.js'),
      'export const other = true;',
    );
    await write(
      path.join(
        otherRouter,
        'node_modules',
        '@tanstack',
        'router-core',
        'package.json',
      ),
      JSON.stringify({ name: '@tanstack/router-core', version: '1.171.15' }),
    );
    await write(
      path.join(
        otherRouter,
        'node_modules',
        '@tanstack',
        'router-core',
        'index.js',
      ),
      'export const unselectedCore = true;',
    );
    const identityOptions = {
      ...options,
      frameworkPackages: ['@fixture/framework-tooling'],
    };
    const before = await resolveRendererBuildIdentities(identityOptions);
    await fs.appendFile(
      path.join(
        otherRouter,
        'node_modules',
        '@tanstack',
        'router-core',
        'index.js',
      ),
      '\nexport const unselectedBytesChanged = true;\n',
    );
    const after = await resolveRendererBuildIdentities(identityOptions);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.profileDigest).toBe(before.profileDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.frameworkCohortDigest).not.toBe(before.frameworkCohortDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test.each([
    'solid',
    'octane',
  ] as const)('binds neutral framework unselected adapter core bytes beside selected %s ownership', async renderer => {
    const options = await unselectedNativeAdapterFixture(renderer);
    expect(options.unselectedCoreVersion).not.toBe(
      options.profile.router.coreVersion,
    );
    const before = await resolveRendererBuildIdentities(options);
    await fs.appendFile(
      path.join(options.unselectedCoreDirectory, 'index.js'),
      '\nexport const changedUnselectedCoreBytes = true;\n',
    );
    const after = await resolveRendererBuildIdentities(options);
    expect(after.identities.main.renderer).toBe(renderer);
    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.profileDigest).toBe(before.profileDigest);
    expect(after.compilerDigest).not.toBe(before.compilerDigest);
    expect(after.frameworkCohortDigest).not.toBe(before.frameworkCohortDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
  });

  test.each([
    'solid',
    'octane',
  ] as const)('rejects the selected %s own core mismatch beside neutral unselected adapter copies', async renderer => {
    const options = await unselectedNativeAdapterFixture(renderer);
    await resolveRendererBuildIdentities(options);
    await writeFixturePackage(options.selectedCoreDirectory, {
      name: options.profile.router.coreName,
      version: options.unselectedCoreVersion,
    });
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      `expected ${options.profile.router.coreName}@${options.profile.router.coreVersion}`,
    );
  });

  test('gives different development and production compiler modes different identities', async () => {
    const options = await fixture();
    const production = await resolveRendererBuildIdentities(options);
    const development = await resolveRendererBuildIdentities({
      ...options,
      mode: 'development',
    });
    expect(development.buildMarker).not.toBe(production.buildMarker);
  });

  test('binds resolved semantic configuration independently from source files', async () => {
    const options = await fixture();
    const before = await resolveRendererBuildIdentities(options);
    const after = await resolveRendererBuildIdentities({
      ...options,
      configuration: { server: { ssr: false }, renderer: 'solid' },
    });
    expect(after.profileDigest).not.toBe(before.profileDigest);
    expect(after.buildMarker).not.toBe(before.buildMarker);
    expect(
      (
        await resolveRendererBuildIdentities({
          ...options,
          configuration: { renderer: 'solid', server: { ssr: true } },
        })
      ).buildMarker,
    ).toBe(before.buildMarker);
  });

  test('rejects exact compiler/profile mismatches before emitting any generated entry', async () => {
    const options = await fixture();
    await expect(
      resolveRendererBuildIdentities({ ...options, renderer: 'octane' }),
    ).rejects.toThrow('Renderer/profile identity mismatch');
    await expect(
      resolveRendererBuildIdentities({
        ...options,
        profile: {
          ...options.profile,
          compiler: { ...options.profile.compiler, version: '2.0.0-rc.14' },
        },
      }),
    ).rejects.toThrow('compiler/profile mismatch');
    await expect(
      fs.stat(path.join(options.projectRoot, '.modern')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('verifies router core from the selected router closure instead of a competing app copy', async () => {
    const options = await fixture();
    const router = path.join(
      options.projectRoot,
      'node_modules',
      '@tanstack',
      'solid-router',
    );
    await write(
      path.join(
        router,
        'node_modules',
        '@tanstack',
        'router-core',
        'package.json',
      ),
      JSON.stringify({ name: '@tanstack/router-core', version: '1.171.15' }),
    );
    await write(
      path.join(router, 'node_modules', '@tanstack', 'router-core', 'index.js'),
      'export const other = true;',
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'expected @tanstack/router-core@1.171.22',
    );
  });

  test('rejects a conflicting pinned runtime inside the selected hydration dependency closure', async () => {
    const options = await fixture();
    const hydration = path.join(
      options.projectRoot,
      'node_modules',
      '@solidjs',
      'web',
    );
    await write(
      path.join(hydration, 'node_modules', 'solid-js', 'package.json'),
      JSON.stringify({ name: 'solid-js', version: '2.0.0-rc.14' }),
    );
    await write(
      path.join(hydration, 'node_modules', 'solid-js', 'index.js'),
      'export const conflicting = true;',
    );
    await expect(resolveRendererBuildIdentities(options)).rejects.toThrow(
      'expected solid-js@2.0.0-rc.13',
    );
  });

  test('uses authoritative delivery appId and replaces its provisional generation marker', async () => {
    const options = await fixture(true);
    const result = await resolveRendererBuildIdentities({
      ...options,
      deliveryUnit: {
        appId: 'shop',
        unitId: 'demo/shop',
        buildMarker: 'generation-marker',
        sourceRevision: 'workspace',
      },
    });
    expect(result.identities.main.appId).toBe('shop');
    expect(result.buildMarker).not.toBe('generation-marker');
    expect(result.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(result.cacheAllowed).toBe(true);
    expect(result.promotable).toBe(true);
    const regeneratedProjection = await resolveRendererBuildIdentities({
      ...options,
      deliveryUnit: {
        appId: 'shop',
        unitId: 'demo/shop',
        buildMarker: 'regenerated-projection-marker',
        sourceRevision: 'workspace',
      },
    });
    expect(regeneratedProjection.buildMarker).toBe(result.buildMarker);
  });

  test('does not label dirty bytes with configured clean HEAD or enable development document caching', async () => {
    const options = await fixture(true);
    const before = await resolveRendererBuildIdentities(options);
    await fs.appendFile(
      path.join(options.projectRoot, 'src', 'App.tsx'),
      '\n/* dirty */',
    );
    const dirty = await resolveRendererBuildIdentities({
      ...options,
      deliveryUnit: {
        appId: 'shop',
        unitId: 'demo/shop',
        buildMarker: 'generation-marker',
        sourceRevision: before.sourceRevision,
      },
    });
    expect(dirty.sourceRevision).toBe('workspace');
    expect(dirty.promotable).toBe(false);
    expect(dirty.cacheAllowed).toBe(false);
    const development = await resolveRendererBuildIdentities({
      ...options,
      mode: 'development',
    });
    expect(development.cacheAllowed).toBe(false);
  });

  test('fails closed for missing actual package identity, duplicate entries, source exclusions and executable config', async () => {
    const options = await fixture();
    await expect(
      resolveRendererBuildIdentities({
        ...options,
        packageName: '@wrong/shop',
      }),
    ).rejects.toThrow('package name conflicts');
    await expect(
      resolveRendererBuildIdentities({
        ...options,
        entryNames: ['main', 'main'],
      }),
    ).rejects.toThrow('unique nonempty');
    await expect(
      resolveRendererBuildIdentities({
        ...options,
        excludedDirectories: [options.projectRoot],
      }),
    ).rejects.toThrow('cannot exclude');
    await expect(
      resolveRendererBuildIdentities({
        ...options,
        configuration: { hook: () => {} } as never,
      }),
    ).rejects.toThrow('finite JSON');
  });
});
