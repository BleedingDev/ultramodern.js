import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import {
  createVerticalDescriptor,
  shellApp,
} from '../src/ultramodern-workspace/descriptors';
import {
  createModuleFederationRemotesConfig,
  createModuleFederationRemoteUrlHelpers,
} from '../src/ultramodern-workspace/module-federation';

function evaluateGeneratedRemoteManifestUrl(
  helpers: string,
  env: Record<string, string | undefined>,
) {
  const executableHelpers = transformSync(
    `${helpers}
module.exports = createRemoteManifestUrl({
  manifestEnv: 'VERTICAL_CATALOG_MF_MANIFEST',
  mfName: 'verticalCatalog',
  port: 4101,
  publicUrlEnv: 'VERTICAL_CATALOG_PUBLIC_URL',
  workerName: 'tractor-store-catalog',
});`,
    { format: 'cjs', loader: 'ts', target: 'node20' },
  ).code;
  const module = { exports: undefined as unknown };
  const config = createRequire(__filename)(
    '@modern-js/app-tools-extensions/config',
  );
  const names = new Set([
    ...Object.keys(env),
    'NODE_ENV',
    'MODERNJS_DEPLOY',
    'VERTICAL_CATALOG_MF_MANIFEST',
    'VERTICAL_CATALOG_PUBLIC_URL',
    'ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN',
    'ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS',
  ]);
  const previous = new Map([...names].map(name => [name, process.env[name]]));
  try {
    for (const name of names) {
      if (env[name] === undefined) delete process.env[name];
      else process.env[name] = env[name];
    }
    vm.runInNewContext(executableHelpers, {
      module,
      exports: module.exports,
      require(specifier: string) {
        assert.equal(specifier, '@modern-js/app-tools-extensions/config');
        return config;
      },
    });
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  return module.exports;
}

test('module federation remote refs fail closed when a configured vertical is missing', () => {
  const shellHost = {
    ...shellApp,
    verticalRefs: ['catalog'],
  };

  assert.throws(
    () => createModuleFederationRemotesConfig('tractor-store', shellHost, []),
    /Unknown remote vertical reference catalog for shell-super-app/,
  );
});

test('module federation remote refs treat blank Cloudflare workers subdomain as missing', () => {
  const catalog = createVerticalDescriptor('catalog', { port: 4101 });
  const shellHost = {
    ...shellApp,
    verticalRefs: [catalog.id],
  };
  const helpers = createModuleFederationRemoteUrlHelpers(shellHost, [catalog]);

  assert.throws(
    () =>
      evaluateGeneratedRemoteManifestUrl(helpers, {
        MODERNJS_DEPLOY: 'cloudflare',
        ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS: 'true',
        ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN: '   ',
      }),
    /Remote verticalCatalog:.*Cloudflare deploy requires VERTICAL_CATALOG_PUBLIC_URL/u,
  );
});

test('generated remotes use packaged address policy and preserve explicit refs', () => {
  const catalog = createVerticalDescriptor('catalog', { port: 4101 });
  const helpers = createModuleFederationRemoteUrlHelpers(
    { ...shellApp, verticalRefs: [catalog.id] },
    [catalog],
  );
  for (const configured of [
    'https://cdn.example/manifest.json',
    'verticalCatalog@https://cdn.example/manifest.json',
  ]) {
    assert.equal(
      evaluateGeneratedRemoteManifestUrl(helpers, {
        NODE_ENV: 'production',
        VERTICAL_CATALOG_MF_MANIFEST: `  ${configured}  `,
        VERTICAL_CATALOG_PUBLIC_URL: 'https://ignored.example',
      }),
      configured,
    );
  }
  assert.equal(
    evaluateGeneratedRemoteManifestUrl(helpers, {
      NODE_ENV: 'production',
      VERTICAL_CATALOG_PUBLIC_URL: ' https://cdn.example/// ',
    }),
    'verticalCatalog@https://cdn.example/mf-manifest.json',
  );
  assert.equal(
    evaluateGeneratedRemoteManifestUrl(helpers, {
      NODE_ENV: 'production',
      MODERNJS_DEPLOY: 'cloudflare',
      ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN: ' team ',
    }),
    'verticalCatalog@https://tractor-store-catalog.team.workers.dev/mf-manifest.json',
  );
  assert.equal(
    evaluateGeneratedRemoteManifestUrl(helpers, { NODE_ENV: 'development' }),
    'verticalCatalog@http://localhost:4101/mf-manifest.json',
  );
  assert.throws(
    () =>
      evaluateGeneratedRemoteManifestUrl(helpers, { NODE_ENV: 'production' }),
    /localhost fallback is disabled outside designated local environments/u,
  );
});

test('generated federation modules import i18n specifiers that really resolve', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-mf-i18n-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  // Resolve through plugin-i18n itself so its package export map decides,
  // exactly as a consumer bundler would.
  const resolveAsConsumer = createRequire(
    path.resolve(__dirname, '../../../runtime/plugin-i18n/consumer-probe.cjs'),
  );
  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'mf-i18n-resolve-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    const specifiers = new Set<string>();
    for (const relativePath of [
      'src/federation-entry.tsx',
      'src/components/catalog-widget.tsx',
    ]) {
      const source = fs.readFileSync(
        path.join(workspaceDir, 'verticals/catalog', relativePath),
        'utf-8',
      );
      for (const match of source.matchAll(
        /from '(@modern-js\/plugin-i18n[^']*)'/gu,
      )) {
        specifiers.add(match[1]);
      }
    }
    assert.ok(specifiers.size > 0, 'exposed modules must consume plugin-i18n');
    for (const specifier of specifiers) {
      assert.doesNotThrow(
        () => resolveAsConsumer.resolve(specifier),
        `${specifier} must resolve from the plugin-i18n export map`,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
