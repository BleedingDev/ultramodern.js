import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeGeneratedRendererIdentity } from '../../src/ultramodern-workspace/renderer-initial-identity';
import { getRendererGenerationProfile } from '../../src/ultramodern-workspace/renderer-profile';
import type { WorkspaceApp } from '../../src/ultramodern-workspace/types';
import { runStableTypeScript } from './stable-typescript';

export function createReactBuildFixtureApp(
  scope: string,
  app: WorkspaceApp,
): WorkspaceApp {
  if (app.surfaceProfile === 'api-only') {
    return initializeGeneratedRendererIdentity(scope, {
      ...app,
      renderer: 'none',
    });
  }
  const profile = getRendererGenerationProfile('react');
  const provider = {
    ...profile.profile.router,
    framework: 'react-router' as const,
  };
  return initializeGeneratedRendererIdentity(scope, {
    ...app,
    renderer: 'react',
    routerBindings: {
      index: {
        owner: '@modern-js/plugin-router',
        evidence: 'owned-default',
        defaultProvider: provider,
        providers: [provider],
      },
    },
  });
}

export function linkBuiltBackendFederationContracts(
  nodeModulesDirectory: string,
) {
  const packageRoot = path.resolve(
    __dirname,
    '../../../backend-federation-contracts',
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  );
  assert.equal(manifest.name, '@modern-js/backend-federation-contracts');
  const entry = manifest.exports['.'];
  for (const target of [
    entry.types,
    entry.node.import,
    entry.node.require,
    entry.import,
  ]) {
    assert.ok(
      fs.existsSync(path.resolve(packageRoot, target)),
      `Build @modern-js/backend-federation-contracts before fixtures: missing ${target}`,
    );
  }
  const link = path.join(
    nodeModulesDirectory,
    '@modern-js/backend-federation-contracts',
  );
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(
    packageRoot,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

export function linkBuiltRuntimeExtensions(
  nodeModulesDirectory: string,
  subpath: 'workspace-events',
) {
  const packageRoot = path.resolve(
    __dirname,
    '../../../../runtime/runtime-extensions',
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  );
  const entry = manifest.exports[`./${subpath}`];
  for (const target of [entry.types, entry.node.import, entry.node.require]) {
    assert.ok(
      fs.existsSync(path.resolve(packageRoot, target)),
      `Build @modern-js/runtime-extensions before fixtures: missing ${target}`,
    );
  }
  const link = path.join(nodeModulesDirectory, '@modern-js/runtime-extensions');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(packageRoot, link, 'dir');
}

export function evaluateBuildModule(
  source: string,
  artifactJson: string,
  globals: Record<string, string> = {},
) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-build-module-'));
  try {
    const sourcePath = path.join(tempRoot, 'ultramodern-build.ts');
    const outputRoot = path.join(tempRoot, 'dist');
    fs.writeFileSync(sourcePath, source);
    fs.writeFileSync(
      path.join(tempRoot, 'ultramodern-build.json'),
      artifactJson,
    );
    fs.writeFileSync(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );
    linkBuiltBackendFederationContracts(path.join(tempRoot, 'node_modules'));
    fs.writeFileSync(
      path.join(tempRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          resolveJsonModule: true,
          outDir: outputRoot,
          strict: true,
          target: 'ES2022',
        },
        include: ['*.ts'],
      }),
    );
    const compiled = runStableTypeScript(
      ['-p', tempRoot, '--pretty', 'false'],
      tempRoot,
    );
    assert.equal(compiled.status, 0, compiled.output);

    const outputUrl = pathToFileURL(
      path.join(outputRoot, 'ultramodern-build.js'),
    ).href;
    const evaluated = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `Object.assign(globalThis, ${JSON.stringify(globals)});
process.stdout.write(JSON.stringify(await import(${JSON.stringify(outputUrl)})));`,
      ],
      {
        cwd: tempRoot,
        encoding: 'utf8',
      },
    );
    if (evaluated.error) throw evaluated.error;
    assert.equal(evaluated.status, 0, evaluated.stderr);
    return JSON.parse(evaluated.stdout) as Record<string, any>;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
