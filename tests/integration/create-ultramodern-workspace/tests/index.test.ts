import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../');
const createBin = path.resolve(repoRoot, 'packages/toolkit/create/bin/run.js');

function runCreate(projectDir: string, args: string[]) {
  execFileSync(process.execPath, [createBin, projectDir, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
    stdio: 'pipe',
  });
}

function readText(root: string, relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8');
}

function readJson<T = any>(root: string, relativePath: string): T {
  return JSON.parse(readText(root, relativePath));
}

function expectNoHandlebarsArtifacts(content: string) {
  expect(/\{\{[#/]|(?:\{\{\w+)/.test(content)).toBe(false);
}

function expectPath(root: string, relativePath: string) {
  expect(fs.existsSync(path.join(root, relativePath))).toBe(true);
}

describe('create-ultramodern-workspace', () => {
  let tempRoot = '';

  beforeAll(() => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-create-ultramodern-workspace-'),
    );
  });

  afterAll(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('scaffolds the canonical UltraModern SuperApp workspace', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--ultramodern-workspace', '--lang', 'en']);

    for (const relativePath of [
      'package.json',
      'pnpm-workspace.yaml',
      'README.md',
      'scripts/validate-ultramodern-workspace.mjs',
      '.modernjs/ultramodern-workspace-template-manifest.json',
      'topology/reference-topology.json',
      'topology/ownership.json',
      'topology/local-overlays/development.json',
      'apps/shell-super-app/package.json',
      'apps/shell-super-app/modern.config.ts',
      'apps/shell-super-app/module-federation.config.ts',
      'apps/remotes/remote-commerce/package.json',
      'apps/remotes/remote-commerce/modern.config.ts',
      'apps/remotes/remote-commerce/module-federation.config.ts',
      'apps/remotes/remote-commerce/src/components/CommerceWidget.tsx',
      'apps/remotes/remote-identity/package.json',
      'apps/remotes/remote-identity/modern.config.ts',
      'apps/remotes/remote-identity/module-federation.config.ts',
      'apps/remotes/remote-identity/src/components/IdentityWidget.tsx',
      'apps/remotes/remote-design-system/package.json',
      'apps/remotes/remote-design-system/modern.config.ts',
      'apps/remotes/remote-design-system/module-federation.config.ts',
      'apps/remotes/remote-design-system/src/components/Button.tsx',
      'apps/remotes/remote-design-system/src/tokens.ts',
      'services/service-recommendations-effect/package.json',
      'services/service-recommendations-effect/modern.config.ts',
      'services/service-recommendations-effect/api/effect/index.ts',
      'services/service-recommendations-effect/shared/effect/api.ts',
      'packages/shared-contracts/src/index.ts',
      'packages/shared-design-tokens/src/index.ts',
      'packages/shared-effect-api/src/index.ts',
    ]) {
      expectPath(workspaceDir, relativePath);
      if (relativePath.endsWith('.ts') || relativePath.endsWith('.tsx')) {
        expectNoHandlebarsArtifacts(readText(workspaceDir, relativePath));
      }
    }

    const rootPackage = readJson(workspaceDir, 'package.json');
    expect(rootPackage.name).toBe('ultra-workspace');
    expect(rootPackage.workspaces).toEqual([
      'apps/*',
      'apps/remotes/*',
      'services/*',
      'packages/*',
    ]);
    expect(rootPackage.modernjs.preset).toBe('presetUltramodern');
    expect(rootPackage.scripts['ultramodern:check']).toBe(
      'node ./scripts/validate-ultramodern-workspace.mjs',
    );

    const appPackagePaths = [
      'apps/shell-super-app/package.json',
      'apps/remotes/remote-commerce/package.json',
      'apps/remotes/remote-identity/package.json',
      'apps/remotes/remote-design-system/package.json',
    ];

    for (const packagePath of appPackagePaths) {
      const packageJson = readJson(workspaceDir, packagePath);
      expect(packageJson.dependencies['@modern-js/plugin-tanstack']).toBe(
        'workspace:*',
      );
      expect(packageJson.dependencies['@tanstack/react-router']).toBe(
        '1.169.2',
      );
      expect(packageJson.dependencies['@module-federation/modern-js-v3']).toBe(
        '2.4.0',
      );
      expect(packageJson.modernjs.preset).toBe('presetUltramodern');
    }

    const shellConfig = readText(
      workspaceDir,
      'apps/shell-super-app/modern.config.ts',
    );
    expect(shellConfig).toContain('presetUltramodern(');
    expect(shellConfig).toContain('tanstackRouterPlugin()');
    expect(shellConfig).toContain('moduleFederationPlugin()');

    const shellMfConfig = readText(
      workspaceDir,
      'apps/shell-super-app/module-federation.config.ts',
    );
    expect(shellMfConfig).toContain("name: 'shellSuperApp'");
    expect(shellMfConfig).toContain(
      'remoteCommerce@http://localhost:3021/mf-manifest.json',
    );
    expect(shellMfConfig).toContain(
      'remoteIdentity@http://localhost:3022/mf-manifest.json',
    );
    expect(shellMfConfig).toContain(
      'remoteDesignSystem@http://localhost:3023/mf-manifest.json',
    );

    const commerceMfConfig = readText(
      workspaceDir,
      'apps/remotes/remote-commerce/module-federation.config.ts',
    );
    expect(commerceMfConfig).toContain("name: 'remoteCommerce'");
    expect(commerceMfConfig).toContain('"./Widget"');
    expect(commerceMfConfig).toContain('"./Route"');

    const designMfConfig = readText(
      workspaceDir,
      'apps/remotes/remote-design-system/module-federation.config.ts',
    );
    expect(designMfConfig).toContain("name: 'remoteDesignSystem'");
    expect(designMfConfig).toContain('"./Button"');
    expect(designMfConfig).toContain('"./tokens"');

    const servicePackage = readJson(
      workspaceDir,
      'services/service-recommendations-effect/package.json',
    );
    expect(servicePackage.devDependencies['@modern-js/plugin-bff']).toBe(
      'workspace:*',
    );
    expect(servicePackage.modernjs.role).toBe('effect-service');

    const serviceConfig = readText(
      workspaceDir,
      'services/service-recommendations-effect/modern.config.ts',
    );
    expect(serviceConfig).toContain("runtimeFramework: 'effect'");
    expect(serviceConfig).toContain('bffPlugin()');

    const serviceEntry = readText(
      workspaceDir,
      'services/service-recommendations-effect/api/effect/index.ts',
    );
    expect(serviceEntry).toContain('defineEffectBff');
    expect(serviceEntry).toContain('recommendationsEffectApi');

    const sharedEffectApi = readText(
      workspaceDir,
      'services/service-recommendations-effect/shared/effect/api.ts',
    );
    expect(sharedEffectApi).toContain('HttpApi.make');
    expect(sharedEffectApi).toContain('RecommendationsEffectApi');

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    expect(topology.sourceFixture).toBe(
      'scripts/mv-integration-pilot/__fixtures__/reference-topology.json',
    );
    expect(topology.preset).toBe('presetUltramodern');
    expect(topology.shell.remoteRefs).toEqual([
      'remote-commerce',
      'remote-identity',
      'remote-design-system',
    ]);
    expect(topology.remotes).toHaveLength(3);
    expect(
      topology.remotes.find(
        (remote: { id: string }) => remote.id === 'remote-design-system',
      ).kind,
    ).toBe('horizontal-design-system');
    expect(topology.effectServices[0].runtime).toBe('effect');
    expect(topology.sharedPackages).toHaveLength(3);

    const ownership = readJson(workspaceDir, 'topology/ownership.json');
    expect(
      ownership.owners.find(
        (owner: { id: string }) => owner.id === 'remote-commerce',
      ).ownership.team,
    ).toBe('commerce-experience');
    expect(
      ownership.owners.find(
        (owner: { id: string }) =>
          owner.id === 'service-recommendations-effect',
      ).package,
    ).toBe('@ultra-workspace/service-recommendations-effect');

    const manifest = readJson(
      workspaceDir,
      '.modernjs/ultramodern-workspace-template-manifest.json',
    );
    expect(manifest.template.id).toBe(
      'modernjs-ultramodern-superapp-workspace',
    );
    expect(manifest.template.compatibilityLane).toBe('ultramodern-mv');
    expect(manifest.validation.expectedCommands).toContain(
      'pnpm run ultramodern:check',
    );

    const validationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mjs'],
      {
        cwd: workspaceDir,
        stdio: 'pipe',
      },
    ).toString();
    expect(validationOutput).toContain(
      'UltraModern workspace scaffold validated',
    );
  });
});
