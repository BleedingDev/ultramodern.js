import assert from 'node:assert/strict';
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
  const executableHelpers = helpers.replace(
    /const createRemoteManifestUrl = \(options: \{[\s\S]*?\}\) => \{/u,
    'const createRemoteManifestUrl = (options) => {',
  );
  assert.notEqual(
    executableHelpers,
    helpers,
    'test must execute the generated createRemoteManifestUrl helper',
  );

  const evaluate = new Function(
    'process',
    `${executableHelpers}
return createRemoteManifestUrl({
  manifestEnv: 'VERTICAL_CATALOG_MF_MANIFEST',
  mfName: 'verticalCatalog',
  port: 4101,
  publicUrlEnv: 'VERTICAL_CATALOG_PUBLIC_URL',
  workerName: 'tractor-store-catalog',
});`,
  ) as (processLike: { env: Record<string, string | undefined> }) => string;

  return evaluate({ env });
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
    /Cloudflare deploy needs VERTICAL_CATALOG_PUBLIC_URL, VERTICAL_CATALOG_MF_MANIFEST, or ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN for remote verticalCatalog/u,
  );
});
