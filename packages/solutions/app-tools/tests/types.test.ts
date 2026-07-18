import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// The static `template/src/modern-app-env.d.ts` file was replaced by the
// ultramodern workspace generator; assert against the generated contents
// the scaffolder actually writes to `src/modern-app-env.d.ts`.
import { createAppEnvDts } from '../../../toolkit/create/src/ultramodern-workspace/app-files';
import { shellApp } from '../../../toolkit/create/src/ultramodern-workspace/descriptors';
import * as buildConfigApi from '../src/config/public';

const repoRoot = join(__dirname, '../../../..');

describe('app-tools types', () => {
  it('keeps app environment types independent from tool configuration types', () => {
    const appToolsTypes = readFileSync(
      join(repoRoot, 'packages/solutions/app-tools/lib/types.d.ts'),
      'utf-8',
    );
    const appEnvTemplate = createAppEnvDts(shellApp);

    expect(appToolsTypes).not.toContain('@rsbuild/core/types');
    expect(appToolsTypes).not.toContain('../dist/types/index.d.ts');
    expect(appToolsTypes).toContain("declare module '*.svg'");
    expect(appEnvTemplate).toContain(
      '/// <reference types="@modern-js/app-tools/types" />',
    );
    expect(appEnvTemplate).toContain(
      'declare const ULTRAMODERN_SITE_URL: string;',
    );
    expect(appEnvTemplate).not.toContain('@rsbuild/core/types');
    expect(appEnvTemplate).not.toContain("declare module '*.svg'");
    expect(appEnvTemplate).not.toContain("declare module '*.css'");
  });

  it('exposes public root types through standard export conditions', () => {
    const appToolsPackage = JSON.parse(
      readFileSync(
        join(repoRoot, 'packages/solutions/app-tools/package.json'),
        'utf-8',
      ),
    ) as {
      exports: Record<
        string,
        {
          default?: string;
          import?: string;
          node?: unknown;
          require?: string;
          types?: string;
        }
      >;
    };

    expect(appToolsPackage.exports['.']).toMatchObject({
      types: './dist/types/index.d.ts',
      import: './dist/esm-node/index.mjs',
      require: './dist/cjs/index.js',
      default: './dist/cjs/index.js',
    });
    expect(appToolsPackage.exports['.']?.node).toBeUndefined();
  });

  it('declares the config export and exposes its source API', () => {
    const packageRoot = join(repoRoot, 'packages/solutions/app-tools');
    const appToolsPackage = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf-8'),
    ) as {
      exports: Record<
        string,
        { import: string; require: string; types: string }
      >;
    };
    const configExport = appToolsPackage.exports['./config'];

    expect(configExport).toEqual({
      types: './dist/types/config/public.d.ts',
      import: './dist/esm-node/config/public.mjs',
      require: './dist/cjs/config/public.js',
      default: './dist/cjs/config/public.js',
    });
    expect(Object.keys(buildConfigApi).sort()).toEqual([
      'getBuildConfigEnvironment',
      'resolveEffectTsgoCompiler',
      'withBuildConfigEnvironment',
    ]);
  });
});
