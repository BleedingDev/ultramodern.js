import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { createVerticalDescriptor } from '../src/ultramodern-workspace/descriptors';
import {
  createUltramodernBuildArtifactJson,
  createUltramodernBuildModule,
} from '../src/ultramodern-workspace/module-federation/reexport-module';
import {
  createAppTsConfig,
  createTsConfigBase,
} from '../src/ultramodern-workspace/tsconfigs';
import { linkBuiltRuntimeExtensions } from './helpers/build-module';

const require = createRequire(import.meta.url);
const app = createVerticalDescriptor('catalog', 3101);
const scope = 'delivery-proof';
const markers = [
  'ultramodernDeliveryUnit',
  'ultramodernApiMarker',
  'ultramodernUiMarker',
] as const;

function write(root: string, file: string, source: string) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
}

function createFixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-build-module-delivery-')),
  );
  try {
    write(root, 'tsconfig.base.json', JSON.stringify(createTsConfigBase()));
    write(
      root,
      `${app.directory}/tsconfig.json`,
      JSON.stringify(createAppTsConfig(app)),
    );
    write(
      root,
      `${app.directory}/shared/ultramodern-build.ts`,
      createUltramodernBuildModule(scope, app),
    );
    write(
      root,
      `${app.directory}/shared/ultramodern-build.json`,
      createUltramodernBuildArtifactJson(scope, app),
    );
    linkBuiltRuntimeExtensions(
      path.join(root, 'node_modules'),
      'build-identity',
    );
    fs.mkdirSync(path.join(root, 'node_modules/@types'), { recursive: true });
    fs.symlinkSync(
      path.dirname(require.resolve('@types/node/package.json')),
      path.join(root, 'node_modules/@types/node'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    return root;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test('native BFF compilation preserves JSON identity in executable CommonJS and still rejects type errors', async () => {
  // Follow the installed BFF build provider's dependency edges to its public compiler.
  const buildPluginRequire = createRequire(
    require.resolve('@modern-js/plugin-bff-build-extensions'),
  );
  const nativeBffRequire = createRequire(
    buildPluginRequire.resolve('@modern-js/plugin-bff'),
  );
  const { compile } = nativeBffRequire('@modern-js/server-utils');
  const root = createFixture();
  const appRoot = path.join(root, app.directory);
  try {
    write(
      root,
      `${app.directory}/api/index.ts`,
      `export { ${markers.join(', ')} } from '../shared/ultramodern-build.ts';\n`,
    );
    const artifactPath = path.join(appRoot, 'shared/ultramodern-build.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const compileTo = (distDir: string) =>
      compile(
        appRoot,
        {},
        {
          sourceDirs: [path.join(appRoot, 'api'), path.join(appRoot, 'shared')],
          distDir,
          tsconfigPath: path.join(appRoot, 'tsconfig.json'),
          moduleType: 'commonjs',
          throwErrorInsteadOfExit: true,
        },
      );
    const firstDist = path.join(root, 'first-dist');
    await compileTo(firstDist);
    const first = require(path.join(firstDist, 'api/index.js'));
    assert.deepEqual(first.ultramodernDeliveryUnit, artifact.deliveryUnit);
    assert.deepEqual(first.ultramodernApiMarker, artifact.surfaces.api);
    assert.deepEqual(first.ultramodernUiMarker, artifact.surfaces.ui);
    assert.equal(
      fs.readFileSync(
        path.join(firstDist, 'shared/ultramodern-build.json'),
        'utf8',
      ),
      fs.readFileSync(artifactPath, 'utf8'),
    );
    const emitted = fs.readFileSync(
      path.join(firstDist, 'shared/ultramodern-build.js'),
      'utf8',
    );
    assert.match(emitted, /require\(["']\.\/ultramodern-build\.json["']\)/u);
    assert.doesNotMatch(emitted, /node:module|createRequire|\bimport\s/u);

    artifact.deliveryUnit.version = '9.8.7';
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    const nextDist = path.join(root, 'next-dist');
    await compileTo(nextDist);
    assert.equal(
      require(path.join(nextDist, 'api/index.js')).ultramodernDeliveryUnit
        .version,
      '9.8.7',
    );
    assert.equal(
      fs.readdirSync(appRoot).some(file => file.startsWith('.tsgo.')),
      false,
    );

    write(
      root,
      `${app.directory}/shared/invalid.ts`,
      'export const invalid: string = 1;\n',
    );
    await assert.rejects(compileTo(path.join(root, 'invalid-dist')), /TS2322/u);
    assert.equal(
      fs.readdirSync(appRoot).some(file => file.startsWith('.tsgo.')),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('browser and workerd bundles preserve native JSON identity and compiler marker readers', async () => {
  const root = createFixture();
  let worker: Miniflare | undefined;
  try {
    const entry = `${app.directory}/worker-entry.ts`;
    write(
      root,
      entry,
      `import { ${markers.join(', ')} } from './shared/ultramodern-build.ts';\nexport default { fetch() { return Response.json({ ${markers.join(', ')} }); } };\n`,
    );
    const artifact = JSON.parse(
      fs.readFileSync(
        path.join(root, app.directory, 'shared/ultramodern-build.json'),
        'utf8',
      ),
    );
    for (const compiled of [false, true]) {
      const source = buildSync({
        entryPoints: [path.join(root, entry)],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        write: false,
        ...(compiled
          ? {
              define: {
                ULTRAMODERN_BUILD_MARKER: JSON.stringify('compiled-marker'),
                ULTRAMODERN_SOURCE_REVISION:
                  JSON.stringify('compiled-revision'),
              },
            }
          : {}),
      }).outputFiles[0]!.text;
      assert.doesNotMatch(source, /node:module|createRequire/u);
      worker = new Miniflare(
        convertV4MiniflareOptions({
          modules: true,
          script: source,
          compatibilityDate: '2026-07-30',
        }),
      );
      const response = await worker.dispatchFetch('http://localhost/');
      assert.equal(response.status, 200);
      const result = (await response.json()) as Record<
        string,
        Record<string, unknown>
      >;
      if (!compiled) {
        assert.deepEqual(result.ultramodernDeliveryUnit, artifact.deliveryUnit);
        assert.deepEqual(result.ultramodernApiMarker, artifact.surfaces.api);
        assert.deepEqual(result.ultramodernUiMarker, artifact.surfaces.ui);
      } else {
        for (const marker of markers) {
          assert.equal(result[marker].unitId, artifact.deliveryUnit.unitId);
          assert.equal(result[marker].buildMarker, 'compiled-marker');
          assert.equal(result[marker].sourceRevision, 'compiled-revision');
        }
      }
      await worker.dispose();
      worker = undefined;
    }
  } finally {
    await worker?.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
