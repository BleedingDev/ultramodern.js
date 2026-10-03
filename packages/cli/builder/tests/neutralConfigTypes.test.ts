import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from '@rstest/core';

it('checks native builder configuration without React or SVGR compiler declarations', async () => {
  const fixture = await fs.mkdtemp(
    path.join(os.tmpdir(), 'modern-neutral-builder-types-'),
  );
  const builderDirectory = path.resolve(__dirname, '..');
  const repository = path.resolve(builderDirectory, '../../..');
  try {
    await fs.writeFile(
      path.join(fixture, 'optional-compiler.d.ts'),
      'export {};\n',
    );
    await fs.writeFile(
      path.join(fixture, 'configuration.ts'),
      `import type { BuilderConfig } from ${JSON.stringify(path.join(builderDirectory, 'src/types'))};
import type { Rspack } from '@rsbuild/core';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ReactCompiler = Assert<Equal<NonNullable<BuilderConfig['source']>['reactCompiler'], Rspack.SwcLoaderTransformConfig['reactCompiler']>>;
type SvgExport = Assert<Equal<NonNullable<BuilderConfig['output']>['svgDefaultExport'], 'component' | 'url' | undefined>>;
const native: BuilderConfig = { output: { disableSvgr: true, svgDefaultExport: 'url' }, source: { reactCompiler: false } };
const react: BuilderConfig = { source: { reactCompiler: { target: '18', compilationMode: 'annotation' } }, output: { svgDefaultExport: 'component' } };
const invalidCompiler: BuilderConfig = { source: {
  // @ts-expect-error The compiler remains strictly typed.
  reactCompiler: 'enabled',
} };
const invalidSvg: BuilderConfig = { output: {
  // @ts-expect-error SVG export policy is the same exact two-value contract.
  svgDefaultExport: 'jsx',
} };
export type Checked = [ReactCompiler, SvgExport];
export { native, react, invalidCompiler, invalidSvg };
`,
    );
    await fs.writeFile(
      path.join(fixture, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          strict: true,
          skipLibCheck: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          types: [],
          paths: {
            '@rsbuild/core': [
              path.join(builderDirectory, 'node_modules/@rsbuild/core'),
            ],
            '@rsbuild/plugin-react': ['./optional-compiler.d.ts'],
            '@rsbuild/plugin-svgr': ['./optional-compiler.d.ts'],
          },
        },
        files: ['./configuration.ts'],
      }),
    );
    const result = spawnSync(
      path.join(repository, 'node_modules/.bin/tsgo'),
      ['--project', path.join(fixture, 'tsconfig.json')],
      {
        cwd: fixture,
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
}, 40_000);
