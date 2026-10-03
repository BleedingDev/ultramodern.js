import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

type PackageManifest = {
  exports: Record<string, unknown>;
  name: string;
};

const packageRoot = path.resolve(__dirname, '..');
const requireFromTest = createRequire(import.meta.url);
const packageManifest = JSON.parse(
  readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
) as PackageManifest;
const publicSubpaths = [
  '.',
  './cloudflare',
  './cloudflare-builder',
  './renderer-generated-outputs',
] as const;
const publicSpecifiers = publicSubpaths.map(subpath =>
  subpath === '.'
    ? packageManifest.name
    : `${packageManifest.name}/${subpath.slice(2)}`,
);

const temporaryRoots: string[] = [];

function expectSuccessfulProcess(
  result: ReturnType<typeof spawnSync>,
  label: string,
) {
  expect(
    result.status,
    `${label}\nstdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}`,
  ).toBe(0);
}

function packPackage() {
  const archiveDirectory = mkdtempSync(
    path.join(tmpdir(), 'app-tools-extensions-pack-'),
  );
  temporaryRoots.push(archiveDirectory);
  const result = spawnSync(
    'pnpm',
    ['pack', '--pack-destination', archiveDirectory],
    {
      cwd: packageRoot,
      encoding: 'utf8',
    },
  );
  expectSuccessfulProcess(result, 'pnpm pack');

  const archiveName = readdirSync(archiveDirectory).find(name =>
    name.endsWith('.tgz'),
  );
  expect(archiveName).toBeDefined();
  return path.join(archiveDirectory, archiveName as string);
}

function createPackedConsumerFixture() {
  const fixtureRoot = mkdtempSync(
    path.join(tmpdir(), 'app-tools-extensions-consumer-'),
  );
  temporaryRoots.push(fixtureRoot);

  const packageLinkParent = path.join(fixtureRoot, 'node_modules/@modern-js');
  mkdirSync(packageLinkParent, { recursive: true });
  const archivePath = packPackage();
  const extract = spawnSync(
    'tar',
    ['-xzf', archivePath, '-C', packageLinkParent],
    { encoding: 'utf8' },
  );
  expectSuccessfulProcess(extract, 'extract packed package');

  const packedPackageRoot = path.join(
    packageLinkParent,
    'app-tools-extensions',
  );
  renameSync(path.join(packageLinkParent, 'package'), packedPackageRoot);
  symlinkSync(
    path.join(packageRoot, 'node_modules'),
    path.join(packedPackageRoot, 'node_modules'),
    'dir',
  );
  return fixtureRoot;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('@modern-js/app-tools-extensions package acceptance', () => {
  test('consumes one packed package through CJS and ESM public entrypoints', () => {
    const fixtureRoot = createPackedConsumerFixture();
    const specifiers = JSON.stringify(publicSpecifiers);
    const rootSpecifier = JSON.stringify(packageManifest.name);

    const cjsResult = spawnSync(
      process.execPath,
      [
        '--eval',
        `
          const specifiers = ${specifiers};
          const rootSpecifier = ${rootSpecifier};
          for (const specifier of specifiers) {
            const resolved = require.resolve(specifier);
            const resolvedPath = resolved
              .split(require('node:path').sep)
              .join('/');
            if (
              !resolvedPath.includes('/dist/cjs/') ||
              resolvedPath.includes('/src/')
            ) {
              throw new Error(\`CJS resolved outside packed output: \${specifier} -> \${resolved}\`);
            }
            const loaded = require(specifier);
            if (specifier === rootSpecifier && typeof loaded.CssExtractRuntimePlugin !== 'function') {
              throw new Error('CJS root does not export CssExtractRuntimePlugin.');
            }
          }
        `,
      ],
      {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
      },
    );
    expectSuccessfulProcess(cjsResult, 'CJS packed package consumer');

    const esmResult = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          const specifiers = ${specifiers};
          const rootSpecifier = ${rootSpecifier};
          for (const specifier of specifiers) {
            const resolved = import.meta.resolve(specifier);
            if (!resolved.includes('/dist/esm-node/') || resolved.includes('/src/')) {
              throw new Error(\`ESM resolved outside packed output: \${specifier} -> \${resolved}\`);
            }
            const loaded = await import(specifier);
            if (specifier === rootSpecifier && typeof loaded.CssExtractRuntimePlugin !== 'function') {
              throw new Error('ESM root does not export CssExtractRuntimePlugin.');
            }
          }
        `,
      ],
      {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
      },
    );
    expectSuccessfulProcess(esmResult, 'ESM packed package consumer');
  });

  test('typechecks a packed public consumer with TypeScript diagnostics', () => {
    const fixtureRoot = createPackedConsumerFixture();
    writeFileSync(
      path.join(fixtureRoot, 'index.ts'),
      `
        import * as Root from '${packageManifest.name}';
        import * as Cloudflare from '${packageManifest.name}/cloudflare';
        import { CssExtractRuntimePlugin } from '${packageManifest.name}';
        import {
          createCloudflareBuilderPlugin,
          type CloudflareBuilderPlugin,
        } from '${packageManifest.name}/cloudflare-builder';
        import type {
          RendererGeneratedOutputDestination,
        } from '${packageManifest.name}/renderer-generated-outputs';

        const plugin: CloudflareBuilderPlugin = createCloudflareBuilderPlugin();
        const destination: RendererGeneratedOutputDestination = {
          path: { lexical: '/app/types', canonical: '/app/types' },
          kind: 'directory',
          scope: 'subtree',
        };
        type RootKeys = keyof typeof Root;
        type CloudflareKeys = keyof typeof Cloudflare;
        declare const rootKey: RootKeys;
        declare const cloudflareKey: CloudflareKeys;
        void new CssExtractRuntimePlugin();
        void plugin;
        void destination;
        void rootKey;
        void cloudflareKey;
      `,
    );

    const nodeTypesManifestPath = requireFromTest.resolve(
      '@types/node/package.json',
    );
    writeFileSync(
      path.join(fixtureRoot, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            lib: ['DOM', 'ESNext'],
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            skipLibCheck: false,
            strict: true,
            target: 'ES2024',
            typeRoots: [path.dirname(path.dirname(nodeTypesManifestPath))],
            types: ['node'],
          },
          include: ['index.ts'],
        },
        null,
        2,
      )}\n`,
    );

    const compilerManifestPath = requireFromTest.resolve(
      'typescript/package.json',
    );
    const compilerManifest = JSON.parse(
      readFileSync(compilerManifestPath, 'utf8'),
    ) as { version: string; bin: { tsc: string } };
    expect(compilerManifest.version).toBe('7.0.2');
    const compilerPath = path.resolve(
      path.dirname(compilerManifestPath),
      compilerManifest.bin.tsc,
    );
    const result = spawnSync(
      process.execPath,
      [compilerPath, '--project', path.join(fixtureRoot, 'tsconfig.json')],
      { encoding: 'utf8' },
    );
    expectSuccessfulProcess(result, 'TypeScript packed package consumer');
  });
});
