import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createAppEnvDts } from '../../../toolkit/ultramodern-create/src/ultramodern-workspace/app-files';
import { shellApp } from '../../../toolkit/ultramodern-create/src/ultramodern-workspace/descriptors';

const repoRoot = join(__dirname, '../../../..');
const compilerManifestPath = createRequire(import.meta.url).resolve(
  'typescript/package.json',
);
const compilerManifest = JSON.parse(
  readFileSync(compilerManifestPath, 'utf-8'),
);
const compilerLauncher = join(
  dirname(compilerManifestPath),
  compilerManifest.bin.tsc,
);

describe('app-tools types', () => {
  it('typechecks generated app environment globals and asset modules under strict settings', () => {
    expect(compilerManifest).toMatchObject({
      name: 'typescript',
      version: '7.0.2',
    });
    const fixture = mkdtempSync(
      join(__dirname, '.tmp-app-tools-types-contract-'),
    );
    try {
      writeFileSync(
        join(fixture, 'modern-app-env.d.ts'),
        createAppEnvDts(shellApp, [], 'tractor-store'),
      );
      writeFileSync(join(fixture, 'icon.svg'), '<svg></svg>');
      writeFileSync(join(fixture, 'styles.module.css'), '.root {}');
      writeFileSync(
        join(fixture, 'consumer.ts'),
        [
          `/// <reference path="${join(repoRoot, 'packages/solutions/app-tools/lib/types.d.ts')}" />`,
          "import icon from './icon.svg';",
          "import styles from './styles.module.css';",
          'const siteUrl: string = ULTRAMODERN_SITE_URL;',
          'const iconUrl: string = icon;',
          'const className: string = styles.root;',
          'void siteUrl;',
          'void iconUrl;',
          'void className;',
        ].join('\n'),
      );
      writeFileSync(
        join(fixture, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            module: 'Preserve',
            moduleResolution: 'Bundler',
            noEmit: true,
            noUnusedLocals: true,
            strict: true,
            target: 'ESNext',
          },
          include: ['consumer.ts', 'modern-app-env.d.ts'],
        }),
      );

      expect(() =>
        execFileSync(
          process.execPath,
          [compilerLauncher, '-p', 'tsconfig.json'],
          {
            cwd: fixture,
            stdio: 'pipe',
          },
        ),
      ).not.toThrow();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
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
      node: {
        import: './dist/esm-node/index.mjs',
        require: './dist/cjs/index.js',
      },
      default: './dist/cjs/index.js',
    });
  });

  it('retires the fork config export from native app-tools', () => {
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

    expect(configExport).toBeUndefined();
  });
});
