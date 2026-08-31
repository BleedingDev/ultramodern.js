import fs from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
);

const collectExportTargets = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [value];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  return Object.values(value).flatMap(collectExportTargets);
};

describe('published package surface', () => {
  test('resolves public runtime conditions exclusively from dist', () => {
    expect(packageJson.exports['./effect-client']).toMatchObject({
      import: './dist/esm/runtime/effect-client/index.mjs',
      default: './dist/esm/runtime/effect-client/index.mjs',
    });
    expect(packageJson.exports['./effect-client-runtime']).toMatchObject({
      import: './dist/esm/runtime/effect-client/runtime.mjs',
      default: './dist/esm/runtime/effect-client/runtime.mjs',
    });
    expect(packageJson.exports['./data-platform']).toMatchObject({
      import: './dist/esm/runtime/data-platform/index.mjs',
      default: './dist/esm/runtime/data-platform/index.mjs',
    });

    for (const [subpath, conditions] of Object.entries(packageJson.exports)) {
      if (subpath === './package.json') {
        continue;
      }
      for (const target of collectExportTargets(conditions)) {
        expect(target, `${subpath} must not expose package source`).toMatch(
          /^\.\/dist\//,
        );
        expect(
          fs.existsSync(path.resolve(packageRoot, target)),
          `${subpath} target ${target} must exist in the published output`,
        ).toBe(true);
      }
    }
  });

  test('requires the fork Node baseline', () => {
    expect(packageJson.engines).toEqual({ node: '>=26.7.0' });
  });

  test('maps the package root to its CLI declarations', () => {
    expect(packageJson.typesVersions['*']['.']).toEqual([
      './dist/types/cli.d.ts',
    ]);
  });

  test('keeps build-only tooling out of runtime dependencies', () => {
    expect({
      builderDependency: packageJson.dependencies['@modern-js/builder'],
      builderDevDependency: packageJson.devDependencies['@modern-js/builder'],
      esbuildDependency: packageJson.dependencies.esbuild,
      esbuildDevDependency: packageJson.devDependencies.esbuild,
    }).toEqual({
      builderDependency: undefined,
      builderDevDependency: 'workspace:*',
      esbuildDependency: undefined,
      esbuildDevDependency: '^0.28.1',
    });
  });

  test('declares the emitted CLI type dependency as an optional peer', () => {
    const cliDeclaration = fs.readFileSync(
      path.join(packageRoot, 'dist/types/cli.d.ts'),
      'utf8',
    );

    expect(cliDeclaration).toContain("from '@modern-js/app-tools'");
    expect({
      dependency: packageJson.dependencies['@modern-js/app-tools'],
      devDependency: packageJson.devDependencies['@modern-js/app-tools'],
      optional:
        packageJson.peerDependenciesMeta['@modern-js/app-tools']?.optional,
      peerDependency: packageJson.peerDependencies['@modern-js/app-tools'],
    }).toEqual({
      dependency: undefined,
      devDependency: 'workspace:*',
      optional: true,
      peerDependency: 'workspace:^3.8.3',
    });
  });
});
