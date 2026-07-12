import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type CommandRecord = {
  argv: string[];
  cwd: string;
  env: {
    MODERNJS_DEPLOY?: string;
  };
};

type PackageJson = {
  name?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  exports?: unknown;
};

const materializeScriptPath = path.resolve(
  __dirname,
  '../templates/workspace-scripts/materialize-zerops-runtime.mjs',
);

function writeText(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeJson(filePath: string, value: unknown) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function writeExecutable(filePath: string, source: string) {
  writeText(filePath, `#!/usr/bin/env node\n${source}`);
  fs.chmodSync(filePath, 0o755);
  writeText(
    `${filePath}.cmd`,
    `@echo off\r\n"${process.execPath}" "${filePath}" %*\r\n`,
  );
}

test('Zerops runtime materializer executes deploy, assembles runtime output, and vendors workspace deps', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-zerops-materialize-'),
  );

  try {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const fakeBinDir = path.join(tempRoot, 'bin');
    const recordDir = path.join(tempRoot, 'records');
    const appOutputDir = path.join(workspaceRoot, 'verticals/catalog/.output');
    const modernVersion = '3.2.0-ultramodern.108';

    fs.mkdirSync(fakeBinDir, { recursive: true });
    fs.mkdirSync(recordDir, { recursive: true });

    writeJson(path.join(workspaceRoot, 'package.json'), {
      name: 'zerops-fixture',
      private: true,
      packageManager: 'pnpm@9.15.0',
    });
    const workspaceRealPath = fs.realpathSync(workspaceRoot);
    writeText(path.join(workspaceRoot, 'README.md'), 'original source\n');
    writeJson(path.join(workspaceRoot, '.modernjs/ultramodern.json'), {
      packageSource: {
        modernPackageVersion: modernVersion,
        aliasScope: 'bleedingdev',
        aliasPackageNamePrefix: 'modern-js-',
      },
    });

    writeJson(path.join(workspaceRoot, 'verticals/catalog/package.json'), {
      name: '@acme/catalog',
      private: true,
      scripts: {
        deploy: 'modern deploy',
      },
    });
    writeText(
      path.join(appOutputDir, 'index.js'),
      "console.log('catalog runtime');\n",
    );
    writeText(path.join(appOutputDir, 'public/asset.txt'), 'static asset\n');
    writeJson(path.join(appOutputDir, 'package.json'), {
      dependencies: {
        '@acme/shared': 'workspace:*',
        '@bleedingdev/modern-js-runtime': modernVersion,
        'left-pad': '1.0.0',
      },
      optionalDependencies: {
        '@acme/optional': 'workspace:*',
        '@bleedingdev/modern-js-plugin-bff': modernVersion,
      },
    });

    writeJson(path.join(workspaceRoot, 'packages/shared/package.json'), {
      name: '@acme/shared',
      version: '0.0.0',
      exports: {
        '.': './src/index.ts',
        './nested': {
          import: './src/nested.ts',
        },
      },
    });
    writeText(
      path.join(workspaceRoot, 'packages/shared/src/index.ts'),
      [
        "import type { SharedType } from './types';",
        'type LocalValue = string;',
        'interface HiddenShape { value: string }',
        "export const sharedValue: string = 'from-shared';",
        "export const tuple = ['shared'] as const;",
        '',
      ].join('\n'),
    );
    writeText(
      path.join(workspaceRoot, 'packages/shared/src/nested.ts'),
      "export const nestedValue: string = 'nested';\n",
    );
    writeText(
      path.join(workspaceRoot, 'packages/shared/node_modules/ignored.txt'),
      'should not copy\n',
    );
    writeJson(path.join(workspaceRoot, 'apps/optional/package.json'), {
      name: '@acme/optional',
      version: '0.0.0',
      exports: './src/optional.ts',
    });
    writeText(
      path.join(workspaceRoot, 'apps/optional/src/optional.ts'),
      "export const optionalValue: string = 'optional';\n",
    );

    writeExecutable(
      path.join(fakeBinDir, 'pnpm'),
      `
const fs = require('node:fs');
const path = require('node:path');
const recordDir = process.env.UM_ZEROPS_RECORD_DIR;
fs.writeFileSync(
	path.join(recordDir, 'pnpm.json'),
	JSON.stringify({
		argv: process.argv.slice(2),
		cwd: process.cwd(),
		env: {
			MODERNJS_DEPLOY: process.env.MODERNJS_DEPLOY,
		},
	}, null, 2),
);
fs.writeFileSync(path.join(process.cwd(), 'README.md'), 'mutated by deploy\\n');
fs.writeFileSync(path.join(process.cwd(), 'deploy-generated.txt'), 'remove me\\n');
`,
    );
    writeExecutable(
      path.join(fakeBinDir, 'npm'),
      `
const fs = require('node:fs');
const path = require('node:path');
const recordDir = process.env.UM_ZEROPS_RECORD_DIR;
const packageJson = JSON.parse(
	fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'),
);
fs.writeFileSync(
	path.join(recordDir, 'npm.json'),
	JSON.stringify({
		argv: process.argv.slice(2),
		cwd: process.cwd(),
		env: {
			MODERNJS_DEPLOY: process.env.MODERNJS_DEPLOY,
		},
	}, null, 2),
);
fs.writeFileSync(
	path.join(recordDir, 'npm-install-package.json'),
	JSON.stringify(packageJson, null, 2),
);
const nodeModules = path.join(process.cwd(), 'node_modules');
fs.mkdirSync(path.join(nodeModules, 'left-pad'), { recursive: true });
fs.writeFileSync(
	path.join(nodeModules, 'left-pad/package.json'),
	JSON.stringify({ name: 'left-pad', version: '1.0.0' }, null, 2),
);
fs.mkdirSync(path.join(nodeModules, '@modern-js/runtime'), { recursive: true });
fs.writeFileSync(
	path.join(nodeModules, '@modern-js/runtime/package.json'),
	JSON.stringify({ name: '@modern-js/runtime', version: '${modernVersion}' }, null, 2),
);
`,
    );

    const output = execFileSync(
      process.execPath,
      [
        materializeScriptPath,
        '--app',
        'catalog',
        '--package',
        '@acme/catalog',
        '--package-dir',
        'verticals/catalog',
      ],
      {
        cwd: tempRoot,
        env: {
          ...process.env,
          PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
          ULTRAMODERN_WORKSPACE_ROOT: workspaceRoot,
          UM_ZEROPS_RECORD_DIR: recordDir,
        },
        stdio: 'pipe',
        timeout: 20_000,
      },
    ).toString();

    assert.match(
      output,
      /materialized catalog runtime at \.zerops\/runtime\/catalog/u,
    );
    assert.equal(
      fs.readFileSync(path.join(workspaceRoot, 'README.md'), 'utf-8'),
      'original source\n',
    );
    assert.equal(
      fs.existsSync(path.join(workspaceRoot, 'deploy-generated.txt')),
      false,
    );

    const pnpmRecord = readJson<CommandRecord>(
      path.join(recordDir, 'pnpm.json'),
    );
    assert.deepEqual(pnpmRecord.argv, [
      '--filter',
      '@acme/catalog',
      'run',
      'deploy',
      '--skip-build',
    ]);
    assert.equal(pnpmRecord.cwd, workspaceRealPath);
    assert.equal(pnpmRecord.env.MODERNJS_DEPLOY, 'node');

    const npmRecord = readJson<CommandRecord>(path.join(recordDir, 'npm.json'));
    assert.deepEqual(npmRecord.argv, [
      'install',
      '--omit=dev',
      '--no-audit',
      '--fund=false',
      '--legacy-peer-deps',
    ]);
    assert.match(npmRecord.cwd, /ultramodern-zerops-catalog-/u);
    assert.equal(npmRecord.env.MODERNJS_DEPLOY, 'node');

    const runtimeRoot = path.join(workspaceRoot, '.zerops/runtime/catalog');
    assert.equal(
      fs.readFileSync(path.join(runtimeRoot, 'index.js'), 'utf-8'),
      "console.log('catalog runtime');\n",
    );
    assert.equal(
      fs.readFileSync(path.join(runtimeRoot, 'public/asset.txt'), 'utf-8'),
      'static asset\n',
    );

    const runtimePackage = readJson<PackageJson>(
      path.join(runtimeRoot, 'package.json'),
    );
    assert.equal(runtimePackage.private, true);
    assert.equal(runtimePackage.name, 'catalog-zerops-runtime');
    assert.equal(runtimePackage.scripts?.serve, 'node index.js');
    assert.equal(
      runtimePackage.dependencies?.['@bleedingdev/modern-js-runtime'],
      modernVersion,
    );
    assert.equal(
      runtimePackage.dependencies?.['@modern-js/runtime'],
      `npm:@bleedingdev/modern-js-runtime@${modernVersion}`,
    );
    assert.equal(
      runtimePackage.optionalDependencies?.['@modern-js/plugin-bff'],
      `npm:@bleedingdev/modern-js-plugin-bff@${modernVersion}`,
    );

    const installPackage = readJson<PackageJson>(
      path.join(recordDir, 'npm-install-package.json'),
    );
    assert.equal(installPackage.dependencies?.['@acme/shared'], undefined);
    assert.equal(
      installPackage.optionalDependencies?.['@acme/optional'],
      undefined,
    );
    assert.equal(installPackage.dependencies?.['left-pad'], '1.0.0');
    assert.equal(
      installPackage.dependencies?.['@modern-js/runtime'],
      `npm:@bleedingdev/modern-js-runtime@${modernVersion}`,
    );

    assert.equal(
      readJson<PackageJson>(
        path.join(runtimeRoot, 'node_modules/left-pad/package.json'),
      ).name,
      'left-pad',
    );
    const copiedSharedPackage = readJson<PackageJson>(
      path.join(runtimeRoot, 'node_modules/@acme/shared/package.json'),
    );
    assert.deepEqual(copiedSharedPackage.exports, {
      '.': './src/index.js',
      './nested': {
        import: './src/nested.js',
      },
    });
    assert.equal(
      fs.existsSync(
        path.join(runtimeRoot, 'node_modules/@acme/shared/node_modules'),
      ),
      false,
    );
    const sharedJs = fs.readFileSync(
      path.join(runtimeRoot, 'node_modules/@acme/shared/src/index.js'),
      'utf-8',
    );
    assert.doesNotMatch(sharedJs, /import type|type LocalValue|interface/u);
    assert.match(sharedJs, /export const sharedValue = 'from-shared';/u);
    assert.match(sharedJs, /export const tuple = \['shared'\];/u);
    assert.equal(
      readJson<PackageJson>(
        path.join(runtimeRoot, 'node_modules/@acme/optional/package.json'),
      ).exports,
      './src/optional.js',
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});
