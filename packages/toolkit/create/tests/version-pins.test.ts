import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';
import {
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  MODULE_FEDERATION_VERSION,
  NODE_FETCH_VERSION,
  PNPM_VERSION,
  TANSTACK_ROUTER_CORE_VERSION,
  TANSTACK_ROUTER_VERSION,
} from '../src/ultramodern-workspace/versions';

const templateWorkspaceDir = path.resolve(__dirname, '../template-workspace');
const pluginBffPackagePath = path.resolve(
  __dirname,
  '../../../cli/plugin-bff/package.json',
);

const readTemplate = (relativePath: string) =>
  fs.readFileSync(path.join(templateWorkspaceDir, relativePath), 'utf-8');

/**
 * versions.ts is the single source of truth for every pin baked into
 * generated workspaces. The static templates must consume those pins through
 * handlebars placeholders instead of re-hardcoding them, otherwise a version
 * bump silently leaves generated workspaces with conflicting pins (a
 * pnpm-workspace override wins over package.json dependencies).
 */
test('static templates read version pins from versions.ts placeholders', () => {
  const pnpmWorkspaceTemplate = readTemplate('pnpm-workspace.yaml.handlebars');
  assert.match(
    pnpmWorkspaceTemplate,
    /'@tanstack\/react-router': \{\{tanstackRouterVersion\}\}/,
    'pnpm-workspace override must use the tanstackRouterVersion placeholder',
  );
  assert.match(
    pnpmWorkspaceTemplate,
    /'@tanstack\/router-core': \{\{tanstackRouterCoreVersion\}\}/,
    'pnpm-workspace override must use the tanstackRouterCoreVersion placeholder',
  );
  assert.match(
    pnpmWorkspaceTemplate,
    /'@tanstack\/router-core@\{\{tanstackRouterCoreVersion\}\}': patches\/@tanstack__router-core@\{\{tanstackRouterCoreVersion\}\}\.patch/,
    'pnpm-workspace patchedDependency must use the tanstackRouterCoreVersion placeholder',
  );
  assert.match(
    pnpmWorkspaceTemplate,
    /'@module-federation\/modern-js-v3@\{\{moduleFederationVersion\}\}': patches\/@module-federation__modern-js-v3@\{\{moduleFederationVersion\}\}\.patch/,
    'pnpm-workspace patchedDependency must use the moduleFederationVersion placeholder',
  );
  assert.match(
    pnpmWorkspaceTemplate,
    /'@module-federation\/bridge-react@\{\{moduleFederationVersion\}\}': patches\/@module-federation__bridge-react@\{\{moduleFederationVersion\}\}\.patch/,
    'pnpm-workspace patchedDependency must use the moduleFederationVersion placeholder for the React bridge patch',
  );
  assert.match(
    pnpmWorkspaceTemplate,
    /'effect@\{\{effectVersion\}\}': patches\/effect-schema-error-type-id\.patch/,
    'pnpm-workspace patchedDependency must use the effectVersion placeholder for the strict declaration patch',
  );
  assert.doesNotMatch(
    pnpmWorkspaceTemplate,
    /'drizzle-orm@\{\{drizzleOrmVersion\}\}': patches\/drizzle-orm-ts7-strict-declarations\.patch/,
    'default pnpm-workspace template must not emit an unused Drizzle patch',
  );
  assert.match(
    pnpmWorkspaceTemplate,
    /node-fetch: '\{\{nodeFetchVersion\}\}'/,
    'pnpm-workspace override must use the nodeFetchVersion placeholder',
  );
  assert.match(
    pnpmWorkspaceTemplate,
    /effect: \{\{effectVersion\}\}/,
    'pnpm-workspace override must use the effectVersion placeholder',
  );
  assert.match(
    pnpmWorkspaceTemplate,
    /'@effect\/opentelemetry': \{\{effectVersion\}\}/,
    'pnpm-workspace override must use the effectVersion placeholder for @effect/opentelemetry',
  );
  assert.match(
    pnpmWorkspaceTemplate,
    /'@effect\/vitest': \{\{effectVitestVersion\}\}/,
    'pnpm-workspace override must use the effectVitestVersion placeholder',
  );
  for (const buildToolchainPackage of [
    '@rsbuild/core',
    '@rsbuild/plugin-react',
    '@rsbuild/plugin-type-check',
    '@module-federation/runtime',
    '@module-federation/runtime@{{moduleFederationVersion}}',
    '@typescript/native-preview',
    '@typescript/native-preview@7.0.0-dev.20260707.2',
    'wrangler',
    'wrangler@{{wranglerVersion}}',
    'miniflare@4.20260708.0',
    'workerd@1.20260708.1',
    '@cloudflare/workers-types@5.20260708.1',
    '@rspack/binding',
    '@rspack/binding-*',
    '@rspack/core',
    '@rspack/plugin-react-refresh',
    'ts-checker-rspack-plugin',
  ]) {
    assert.ok(
      pnpmWorkspaceTemplate.includes(`- '${buildToolchainPackage}'`),
      `pnpm minimumReleaseAgeExclude must include ${buildToolchainPackage}`,
    );
  }
  assert.doesNotMatch(
    pnpmWorkspaceTemplate,
    new RegExp(TANSTACK_ROUTER_VERSION.replace(/\./g, '\\.')),
    'pnpm-workspace template must not re-hardcode the TanStack Router pin',
  );
  assert.doesNotMatch(
    pnpmWorkspaceTemplate,
    new RegExp(TANSTACK_ROUTER_CORE_VERSION.replace(/\./g, '\\.')),
    'pnpm-workspace template must not re-hardcode the TanStack Router Core pin',
  );

  assert.match(
    readTemplate('AGENTS.md.handlebars'),
    /pnpm `\{\{pnpmVersion\}\}`/,
    'AGENTS.md must use the pnpmVersion placeholder',
  );
  assert.match(
    readTemplate('README.md.handlebars'),
    /pnpm `\{\{pnpmVersion\}\}`/,
    'README.md must use the pnpmVersion placeholder',
  );
});

test('generated workspace renders the pins from versions.ts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-version-pins-'));
  const workspaceDir = path.join(tempRoot, 'pins-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'pins-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: {
        strategy: 'install',
        modernPackageVersion: '3.2.0-ultramodern.108',
      },
    });

    const readGenerated = (relativePath: string) =>
      fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');

    const pnpmWorkspace = readGenerated('pnpm-workspace.yaml');
    assert.ok(
      pnpmWorkspace.includes(
        `'@tanstack/react-router': ${TANSTACK_ROUTER_VERSION}`,
      ),
      'generated pnpm-workspace override must match TANSTACK_ROUTER_VERSION',
    );
    assert.ok(
      pnpmWorkspace.includes(
        `'@tanstack/router-core': ${TANSTACK_ROUTER_CORE_VERSION}`,
      ),
      'generated pnpm-workspace override must match TANSTACK_ROUTER_CORE_VERSION',
    );
    assert.ok(
      pnpmWorkspace.includes(
        `'@tanstack/router-core@${TANSTACK_ROUTER_CORE_VERSION}': patches/@tanstack__router-core@${TANSTACK_ROUTER_CORE_VERSION}.patch`,
      ),
      'generated pnpm-workspace patchedDependency must match TANSTACK_ROUTER_CORE_VERSION',
    );
    assert.ok(
      pnpmWorkspace.includes(
        `'@module-federation/modern-js-v3@${MODULE_FEDERATION_VERSION}': patches/@module-federation__modern-js-v3@${MODULE_FEDERATION_VERSION}.patch`,
      ),
      'generated pnpm-workspace patchedDependency must match MODULE_FEDERATION_VERSION',
    );
    assert.ok(
      pnpmWorkspace.includes(
        `'@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}': patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
      ),
      'generated pnpm-workspace React bridge patchedDependency must match MODULE_FEDERATION_VERSION',
    );
    assert.ok(
      pnpmWorkspace.includes(
        `'effect@${EFFECT_VERSION}': patches/effect-schema-error-type-id.patch`,
      ),
      'generated pnpm-workspace patchedDependency must match EFFECT_VERSION',
    );
    assert.ok(
      !pnpmWorkspace.includes('drizzle-orm@'),
      'generated pnpm-workspace must not emit an unused Drizzle patch',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          `patches/@tanstack__router-core@${TANSTACK_ROUTER_CORE_VERSION}.patch`,
        ),
      ),
      'generated router-core patch file must match TANSTACK_ROUTER_CORE_VERSION',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          `patches/@module-federation__modern-js-v3@${MODULE_FEDERATION_VERSION}.patch`,
        ),
      ),
      'generated Module Federation Modern.js patch file must match MODULE_FEDERATION_VERSION',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
        ),
      ),
      'generated Module Federation React bridge patch file must match MODULE_FEDERATION_VERSION',
    );
    assert.ok(
      fs.existsSync(
        path.join(workspaceDir, 'patches/effect-schema-error-type-id.patch'),
      ),
      'generated Effect declaration patch file must be present',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          'patches/drizzle-orm-ts7-strict-declarations.patch',
        ),
      ),
      'generated Drizzle declaration patch file must be present',
    );
    assert.ok(
      pnpmWorkspace.includes(`node-fetch: '${NODE_FETCH_VERSION}'`),
      'generated pnpm-workspace override must match NODE_FETCH_VERSION',
    );
    assert.ok(
      pnpmWorkspace.includes(`'effect@${EFFECT_VERSION}'`),
      'generated pnpm-workspace policy exclusions must include effect',
    );
    assert.ok(
      pnpmWorkspace.includes(`'@effect/opentelemetry@${EFFECT_VERSION}'`),
      'generated pnpm-workspace policy exclusions must include @effect/opentelemetry',
    );
    assert.ok(
      pnpmWorkspace.includes(`effect: ${EFFECT_VERSION}`),
      'generated pnpm-workspace override must match EFFECT_VERSION',
    );
    assert.ok(
      pnpmWorkspace.includes(`'@effect/opentelemetry': ${EFFECT_VERSION}`),
      'generated pnpm-workspace override must align @effect/opentelemetry with EFFECT_VERSION',
    );
    assert.ok(
      pnpmWorkspace.includes(`'@effect/vitest': ${EFFECT_VITEST_VERSION}`),
      'generated pnpm-workspace override must match EFFECT_VITEST_VERSION',
    );
    assert.ok(
      pnpmWorkspace.includes(`'effect@${EFFECT_VERSION}'`),
      'generated pnpm-workspace trustPolicyExclude must include effect',
    );
    assert.ok(
      pnpmWorkspace.includes(`'@effect/opentelemetry@${EFFECT_VERSION}'`),
      'generated pnpm-workspace trustPolicyExclude must include @effect/opentelemetry',
    );
    for (const buildToolchainPackage of [
      '@rsbuild/core',
      '@rsbuild/plugin-react',
      '@rsbuild/plugin-type-check',
      '@module-federation/*',
      '@module-federation/bridge-react',
      '@module-federation/bridge-react-webpack-plugin',
      '@module-federation/cli',
      '@module-federation/dts-plugin',
      '@module-federation/enhanced',
      '@module-federation/error-codes',
      '@module-federation/inject-external-runtime-core-plugin',
      '@module-federation/managers',
      '@module-federation/manifest',
      '@module-federation/modern-js-v3',
      '@module-federation/node',
      '@module-federation/rsbuild-plugin',
      '@module-federation/rspack',
      '@module-federation/runtime',
      '@module-federation/runtime@2.7.0',
      '@module-federation/runtime-core',
      '@module-federation/runtime-tools',
      '@module-federation/sdk',
      '@module-federation/third-party-dts-extractor',
      '@module-federation/webpack-bundler-runtime',
      '@typescript/native-preview',
      '@typescript/native-preview@7.0.0-dev.20260707.2',
      'wrangler',
      'wrangler@4.109.0',
      'miniflare@4.20260708.0',
      'workerd@1.20260708.1',
      '@cloudflare/workers-types@5.20260708.1',
      '@rspack/binding',
      '@rspack/binding-*',
      '@rspack/core',
      '@rspack/plugin-react-refresh',
      'ts-checker-rspack-plugin',
    ]) {
      assert.ok(
        pnpmWorkspace.includes(`- '${buildToolchainPackage}'`),
        `generated minimumReleaseAgeExclude must include ${buildToolchainPackage}`,
      );
    }
    assert.ok(
      !pnpmWorkspace.includes('{{'),
      'generated pnpm-workspace.yaml must not leak placeholders',
    );

    for (const relativePath of ['AGENTS.md', 'README.md']) {
      const rendered = readGenerated(relativePath);
      assert.ok(
        rendered.includes(`pnpm \`${PNPM_VERSION}\``),
        `${relativePath} must render PNPM_VERSION from versions.ts`,
      );
    }

    const rootPackage = JSON.parse(readGenerated('package.json'));
    assert.equal(rootPackage.packageManager, `pnpm@${PNPM_VERSION}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('plugin-bff declares the same Effect cohort generated workspaces pin', () => {
  const pluginBffPackage = JSON.parse(
    fs.readFileSync(pluginBffPackagePath, 'utf-8'),
  );

  assert.equal(
    pluginBffPackage.dependencies.effect,
    EFFECT_VERSION,
    '@modern-js/plugin-bff must not force a different Effect version than generated pnpm overrides',
  );
  assert.equal(
    pluginBffPackage.dependencies['@effect/opentelemetry'],
    EFFECT_VERSION,
    '@modern-js/plugin-bff must keep @effect/opentelemetry on the generated Effect cohort',
  );
  assert.doesNotMatch(
    JSON.stringify(pluginBffPackage),
    /4\.0\.0-beta\.91/u,
    '@modern-js/plugin-bff must not retain stale beta.91 Effect pins',
  );
});
