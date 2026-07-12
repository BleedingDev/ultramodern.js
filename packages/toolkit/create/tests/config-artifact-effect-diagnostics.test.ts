import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveEffectTsgoCompiler } from '../../../solutions/app-tools/src/config/public';
import { addUltramodernVertical } from '../src/ultramodern-workspace';
import { createWorkspace, listFiles } from './helpers/workspace-kit';

const packageRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(packageRoot, '../../..');
const repositoryPackageModules = path.join(
  repositoryRoot,
  'node_modules/.pnpm/node_modules',
);
const packageExportProbe = `import {
  getBuildConfigEnvironment,
  resolveEffectTsgoCompiler,
  withBuildConfigEnvironment,
} from '@modern-js/app-tools/config';

export const generatedCompilerPath: string = resolveEffectTsgoCompiler({
  from: import.meta.url,
});
export const generatedDeployTarget: string | undefined =
  getBuildConfigEnvironment('MODERNJS_DEPLOY');
export const generatedRspackSetup = withBuildConfigEnvironment(
  'ZE_FAIL_BUILD',
  'true',
  config => config,
);
`;

function generatedConfigFiles(workspaceDir: string): string[] {
  return listFiles(workspaceDir).filter(relativePath =>
    /(?:^|\/)(?:modern|module-federation|backend-federation)\.config\.ts$/u.test(
      relativePath,
    ),
  );
}

function effectTsgoCompilerPath(): string {
  return resolveEffectTsgoCompiler({ from: import.meta.url });
}

function linkRepositoryPackageModules(workspaceDir: string) {
  assert.ok(
    fs.existsSync(repositoryPackageModules),
    'pnpm repository package links must exist before running diagnostics',
  );
  // pnpm's hidden hoisted store does not reliably link every workspace
  // package (app-tools is absent under some hoisting configurations), so
  // compose an overlay: every hoisted entry plus explicit workspace links.
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
  const overlayModules = path.join(workspaceDir, 'node_modules');
  fs.mkdirSync(overlayModules);
  for (const entry of fs.readdirSync(repositoryPackageModules)) {
    const source = path.join(repositoryPackageModules, entry);
    if (entry.startsWith('@')) {
      const scopeDir = path.join(overlayModules, entry);
      fs.mkdirSync(scopeDir);
      for (const scoped of fs.readdirSync(source)) {
        fs.symlinkSync(
          path.join(source, scoped),
          path.join(scopeDir, scoped),
          symlinkType,
        );
      }
    } else {
      fs.symlinkSync(source, path.join(overlayModules, entry), symlinkType);
    }
  }
  const workspaceAppTools = path.join(
    repositoryRoot,
    'packages/solutions/app-tools',
  );
  const overlayAppTools = path.join(overlayModules, '@modern-js/app-tools');
  if (!fs.existsSync(overlayAppTools)) {
    fs.symlinkSync(workspaceAppTools, overlayAppTools, symlinkType);
  }
  assert.equal(
    fs.realpathSync(overlayAppTools),
    workspaceAppTools,
    'diagnostics must resolve the workspace app-tools package',
  );
}

function writeConfigDiagnosticProject(workspaceDir: string): string {
  const packageExportProbePath =
    'config-artifact-effect-diagnostics-package-exports.ts';
  const projectPath = 'tsconfig.config-artifact-effect-diagnostics.json';

  fs.writeFileSync(
    path.join(workspaceDir, packageExportProbePath),
    packageExportProbe,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(workspaceDir, projectPath),
    `${JSON.stringify(
      {
        extends: './tsconfig.base.json',
        compilerOptions: {
          types: ['node'],
        },
        files: [packageExportProbePath],
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  return projectPath;
}

test('generated config artifacts pass Effect TS-Go diagnostics without suppressions', () => {
  const { tempRoot, workspaceDir } = createWorkspace(
    'config-artifact-effect-diagnostics',
    { tempPrefix: 'um-config-effect-diagnostics-' },
  );

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    const configFiles = generatedConfigFiles(workspaceDir);

    assert.ok(configFiles.length > 0, 'expected generated config artifacts');
    const configSources: string[] = [];
    for (const relativePath of configFiles) {
      const source = fs.readFileSync(
        path.join(workspaceDir, relativePath),
        'utf-8',
      );
      configSources.push(source);
      assert.doesNotMatch(
        source,
        /@effect-diagnostics|process\.env|node:child_process/u,
        `${relativePath} must use the framework-owned config API`,
      );
    }
    const combinedConfigSource = configSources.join('\n');
    for (const packageExport of [
      'getBuildConfigEnvironment',
      'resolveEffectTsgoCompiler',
      'withBuildConfigEnvironment',
    ]) {
      assert.match(
        combinedConfigSource,
        new RegExp(`\\b${packageExport}\\b`, 'u'),
        `generated config must exercise ${packageExport}`,
      );
    }
    linkRepositoryPackageModules(workspaceDir);

    const result = spawnSync(
      effectTsgoCompilerPath(),
      [
        '--project',
        writeConfigDiagnosticProject(workspaceDir),
        '--noEmit',
        '--pretty',
        'false',
      ],
      {
        cwd: workspaceDir,
        encoding: 'utf-8',
      },
    );

    assert.equal(
      result.status,
      0,
      `${result.error?.stack ?? ''}\n${result.stdout}\n${result.stderr}`,
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});
