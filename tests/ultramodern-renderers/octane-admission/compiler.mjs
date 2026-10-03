import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inferRspackEnvironment } from '@octanejs/rspack-plugin';
import { createRsbuild } from '@rsbuild/core';
import { createJiti } from './node_modules/@rsbuild/core/compiled/jiti/lib/jiti.mjs';

const root = process.cwd();
const workspace = process.argv[2];
assert.ok(workspace, 'Pass the actual UltraModern owning worktree path.');
// This admission lane probes owning source; packed acceptance uses shipped exports.
const jiti = createJiti(import.meta.url, {
  tryNative: false,
  alias: {
    '@modern-js/renderer-octane/manifest': path.join(
      workspace,
      'packages/runtime/renderer-octane/src/manifest.ts',
    ),
  },
});
const { createOctaneCompilerPlugin } = await jiti.import(
  path.join(
    workspace,
    'packages/solutions/ultramodern-app-tools/src/renderers/octane/compiler/index.ts',
  ),
);
const { validateOctaneModuleManifest, octaneModuleManifestFileName } =
  await jiti.import(
    path.join(workspace, 'packages/runtime/renderer-octane/src/manifest.ts'),
  );
const identities = Object.fromEntries(
  ['client', 'router-client', 'signals-client', 'svg-url'].map(entryName => [
    entryName,
    {
      renderer: 'octane',
      appId: 'native-admission',
      entryName,
      protocolVersion: 1,
      buildId: 'admission-source-profile-identity',
    },
  ]),
);
const output = path.join(root, 'dist/compiler-profile');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let moduleIdentifiers = [];
const host = await createRsbuild({
  cwd: root,
  rsbuildConfig: {
    plugins: [
      createOctaneCompilerPlugin({ rendererIdentities: () => identities }),
      {
        name: 'admission:compiled-closure',
        setup(api) {
          api.onAfterBuild(({ stats }) => {
            const compilations = stats.stats
              ? stats.stats.map(item => item.compilation)
              : [stats.compilation];
            moduleIdentifiers = compilations.flatMap(compilation =>
              [...compilation.modules].map(module => module.identifier()),
            );
          });
        },
      },
    ],
    source: {
      entry: {
        client: './src/client.ts',
        'router-client': './src/router-client.ts',
        'signals-client': './src/signals-client.ts',
        'svg-url': './src/Svg.tsx',
      },
    },
    output: {
      distPath: { root: 'dist/compiler-profile' },
      dataUriLimit: { svg: 0 },
    },
    tools: { rspack: { optimization: { minimize: false } } },
  },
});
await host.build();
assert.equal(
  moduleIdentifiers.some(id =>
    /node_modules[/\\](?:react|react-dom)(?:[/\\]|$)/u.test(id),
  ),
  false,
);
const nativeBuild = JSON.parse(
  fs.readFileSync(path.join(output, 'octane-client-build.json'), 'utf8'),
);
const manifests = Object.keys(identities).map(entryName => {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(output, octaneModuleManifestFileName(entryName)),
      'utf8',
    ),
  );
  const manifest = validateOctaneModuleManifest(
    raw,
    identities[entryName],
    nativeBuild.buildId,
  );
  for (const source of manifest.sourceModules) {
    assert.equal(
      digest(
        fs.readFileSync(path.resolve(root, source.resource.split('?')[0])),
      ),
      source.sourceSha256,
    );
  }
  for (const asset of manifest.assets) {
    assert.equal(
      digest(fs.readFileSync(path.join(output, asset.file))),
      asset.sha256,
    );
  }
  assert.throws(() =>
    validateOctaneModuleManifest(raw, {
      ...identities[entryName],
      buildId: 'stale',
    }),
  );
  assert.throws(() =>
    validateOctaneModuleManifest(
      raw,
      identities[entryName],
      'stale-native-client',
    ),
  );
  assert.throws(() =>
    validateOctaneModuleManifest({ ...raw, assets: [] }, identities[entryName]),
  );
  return manifest;
});
assert.ok(
  manifests.some(manifest =>
    manifest.sourceModules.some(source =>
      /tanstack-router.*\.tsrx/u.test(source.resource),
    ),
  ),
);
assert.ok(
  fs
    .readdirSync(path.join(output, 'static/svg'))
    .some(file => file.endsWith('.svg')),
);

const negative = fs.mkdtempSync(path.join(root, 'compiler-negative-'));
const rejectedTargets = [];
try {
  fs.writeFileSync(
    path.join(negative, 'svg.ts'),
    `import value from ${JSON.stringify(path.join(root, 'src/logo.svg?component'))}; console.log(value);`,
  );
  for (const target of ['web', 'node']) {
    let diagnostic = '';
    let compilationEnvironment;
    const rejected = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        plugins: [
          createOctaneCompilerPlugin({
            rendererIdentities: () => ({ client: identities.client }),
          }),
        ],
        source: { entry: { client: path.join(negative, 'svg.ts') } },
        output: {
          target,
          distPath: { root: path.join(negative, target) },
        },
        tools: {
          rspack: {
            plugins: [
              {
                apply(compiler) {
                  compiler.hooks.done.tap(
                    'admission:rejected-compiler-diagnostic',
                    stats => {
                      compilationEnvironment = inferRspackEnvironment(
                        compiler.options.target,
                      );
                      diagnostic = stats
                        .toJson({ all: false, errors: true })
                        .errors.map(error => error.message)
                        .join('\n');
                    },
                  );
                },
              },
            ],
          },
        },
      },
    });
    await assert.rejects(rejected.build());
    assert.equal(
      compilationEnvironment,
      target === 'node' ? 'server' : 'client',
    );
    assert.match(diagnostic, /unsupported-renderer-capability.*SVG/u);
    rejectedTargets.push(target);
  }
} finally {
  fs.rmSync(negative, { recursive: true, force: true });
}
const evidence = {
  actualNativeCompiler: true,
  sourceAndAssetDigests: true,
  nativeBuildIdentity: nativeBuild.buildId,
  distinctSharedBuildIdentity: identities.client.buildId,
  rawNativeRouterCompiled: true,
  svgUrl: true,
  svgComponentRejected: true,
  svgComponentRejectedTargets: rejectedTargets,
  staleSharedAndNativeIdentityRejected: true,
  reactRuntimeModules: false,
  sourceModules: manifests.map(manifest => ({
    entryName: manifest.rendererIdentity.entryName,
    count: manifest.sourceModules.length,
  })),
};
fs.writeFileSync(
  'compiler-evidence.json',
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify(evidence));
