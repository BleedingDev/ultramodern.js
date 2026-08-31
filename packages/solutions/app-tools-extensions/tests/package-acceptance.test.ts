import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

type ExportConditions = {
  types: string;
  'modern:source': string;
  node?: {
    import: string;
    require: string;
  };
  import?: string;
  require?: string;
  default?: string;
};

type PackageManifest = {
  exports: Record<string, ExportConditions>;
  name: string;
  version: string;
};

type PackReport = {
  files: Array<{ path: string }>;
  name: string;
  version: string;
};

const packageRoot = path.resolve(__dirname, '..');
const requireFromTest = createRequire(import.meta.url);
const packageManifest = JSON.parse(
  readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
) as PackageManifest;
const publicSubpaths = ['.', './cloudflare', './cloudflare-builder'] as const;
const publicSpecifiers = publicSubpaths.map(subpath =>
  subpath === '.'
    ? packageManifest.name
    : `${packageManifest.name}/${subpath.slice(2)}`,
);
const templateFiles = [
  'cloudflare-entry.001-bootstrap-security.mjs',
  'cloudflare-entry.002-assets-routes.mjs',
  'cloudflare-entry.003-i18n-locales.mjs',
  'cloudflare-entry.004-rendering-css.mjs',
  'cloudflare-entry.005-worker-dispatch.mjs',
  'cloudflare-entry.006-fetch-handler.mjs',
  'cloudflare-worker-fs-promises.mjs',
  'cloudflare-worker-loadable-server.mjs',
  'cloudflare-worker-mf-ssr-runtime-plugin.mjs',
  'cloudflare-worker-path.mjs',
] as const;

function createConsumerFixture() {
  const fixtureRoot = mkdtempSync(
    path.join(tmpdir(), 'app-tools-extensions-consumer-'),
  );
  const packageLinkParent = path.join(fixtureRoot, 'node_modules/@modern-js');
  mkdirSync(packageLinkParent, { recursive: true });
  symlinkSync(
    packageRoot,
    path.join(packageLinkParent, 'app-tools-extensions'),
    'dir',
  );
  return fixtureRoot;
}

function expectSuccessfulProcess(
  result: ReturnType<typeof spawnSync>,
  label: string,
) {
  expect(
    result.status,
    `${label}\nstdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}`,
  ).toBe(0);
}

describe('@modern-js/app-tools-extensions package acceptance', () => {
  test('dry-run pack contains every selected build artifact and copied template', () => {
    const result = spawnSync('pnpm', ['pack', '--dry-run', '--json'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expectSuccessfulProcess(result, 'pnpm pack --dry-run');

    const report = JSON.parse(result.stdout as string) as PackReport;
    expect(report.name).toBe(packageManifest.name);
    expect(report.version).toBe(packageManifest.version);
    const packedPaths = new Set(report.files.map(file => file.path));
    expect([...packedPaths].some(file => file.startsWith('dist/'))).toBe(true);
    expect([...packedPaths].some(file => file.startsWith('src/'))).toBe(true);
    expect([...packedPaths].some(file => file.startsWith('tests/'))).toBe(
      false,
    );
    expect(packedPaths).not.toContain('rslib.config.mts');
    expect(packedPaths).not.toContain('rstest.config.mts');
    expect([...packedPaths].some(file => /^tsconfig.*\.json$/.test(file))).toBe(
      false,
    );

    for (const subpath of publicSubpaths) {
      const conditions = packageManifest.exports[subpath];
      expect(conditions).toBeDefined();
      const selectedArtifacts = new Set([
        conditions.types,
        conditions.node?.import,
        conditions.node?.require,
        conditions.import,
        conditions.require,
        conditions.default,
      ]);
      selectedArtifacts.delete(undefined);

      for (const target of selectedArtifacts) {
        const relativeTarget = (target as string).replace(/^\.\//, '');
        expect(relativeTarget.startsWith('dist/')).toBe(true);
        expect(existsSync(path.join(packageRoot, relativeTarget))).toBe(true);
        expect(packedPaths).toContain(relativeTarget);
      }
    }

    for (const templateFile of templateFiles) {
      const sourceTemplate = readFileSync(
        path.join(packageRoot, 'src/templates', templateFile),
      );
      for (const outputFormat of ['cjs', 'esm', 'esm-node']) {
        const relativeTarget = `dist/${outputFormat}/templates/${templateFile}`;
        expect(packedPaths).toContain(relativeTarget);
        expect(readFileSync(path.join(packageRoot, relativeTarget))).toEqual(
          sourceTemplate,
        );
      }
    }
  });

  test('loads the root and Cloudflare public subpaths through CJS and ESM package resolution', () => {
    const fixtureRoot = createConsumerFixture();
    const specifiers = JSON.stringify(publicSpecifiers);

    try {
      const cjsResult = spawnSync(
        process.execPath,
        [
          '--eval',
          `
            const specifiers = ${specifiers};
            const rootSpecifier = ${JSON.stringify(packageManifest.name)};
            for (const specifier of specifiers) {
              const resolved = require.resolve(specifier);
              if (!resolved.includes('/dist/cjs/') || resolved.includes('/src/')) {
                throw new Error(\`CJS resolved outside built output: \${specifier} -> \${resolved}\`);
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
      expectSuccessfulProcess(cjsResult, 'CJS public package consumer');

      const esmResult = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `
            const specifiers = ${specifiers};
            const rootSpecifier = ${JSON.stringify(packageManifest.name)};
            for (const specifier of specifiers) {
              const resolved = import.meta.resolve(specifier);
              if (!resolved.includes('/dist/esm-node/') || resolved.includes('/src/')) {
                throw new Error(\`ESM resolved outside built output: \${specifier} -> \${resolved}\`);
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
      expectSuccessfulProcess(esmResult, 'ESM public package consumer');
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  test('resolves public declarations with TypeScript 7 without source aliases', () => {
    const fixtureRoot = createConsumerFixture();

    try {
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

          const plugin: CloudflareBuilderPlugin = createCloudflareBuilderPlugin();
          type RootKeys = keyof typeof Root;
          type CloudflareKeys = keyof typeof Cloudflare;
          declare const rootKey: RootKeys;
          declare const cloudflareKey: CloudflareKeys;
          void new CssExtractRuntimePlugin();
          void plugin;
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
        '@typescript/native-preview/package.json',
      );
      const compilerManifest = JSON.parse(
        readFileSync(compilerManifestPath, 'utf8'),
      ) as { bin: { tsgo: string } };
      const compilerPath = path.resolve(
        path.dirname(compilerManifestPath),
        compilerManifest.bin.tsgo,
      );
      const result = spawnSync(
        compilerPath,
        [
          '--project',
          path.join(fixtureRoot, 'tsconfig.json'),
          '--listFilesOnly',
        ],
        { encoding: 'utf8' },
      );
      expectSuccessfulProcess(result, 'TypeScript public package consumer');
      const resolvedFiles = (result.stdout as string).split(/\r?\n/);
      for (const typeTarget of [
        'dist/types/index.d.ts',
        'dist/types/cloudflare/index.d.ts',
        'dist/types/cloudflare-builder.d.ts',
      ]) {
        expect(
          resolvedFiles.some(file => file.endsWith(typeTarget)),
          `TypeScript did not resolve ${typeTarget}`,
        ).toBe(true);
      }
      expect(
        resolvedFiles.some(file =>
          file.startsWith(path.join(packageRoot, 'src') + path.sep),
        ),
      ).toBe(false);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});
