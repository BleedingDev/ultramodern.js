import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createDeliveryUnitRecord } from '../src/ultramodern-workspace/delivery-unit';
import { createNeutralOwnership } from '../src/ultramodern-workspace/descriptors';
import { createUltramodernBuildModule } from '../src/ultramodern-workspace/module-federation/reexport-module';
import type { WorkspaceApp } from '../src/ultramodern-workspace/types';
import { runStableTypeScript } from './helpers/stable-typescript';

const app: WorkspaceApp = {
  api: {
    consumedBy: ['shell-super-app', 'catalog'],
    prefix: '/catalog-api',
    stem: 'catalog',
  },
  directory: 'verticals/catalog',
  displayName: 'Catalog Vertical',
  domain: 'catalog',
  exposes: {
    './Widget': 'src/components/catalog-widget.tsx',
  },
  id: 'catalog',
  kind: 'vertical',
  mfName: 'verticalCatalog',
  ownership: createNeutralOwnership('catalog'),
  packageSuffix: 'catalog',
  port: 3021,
  portEnv: 'VERTICAL_CATALOG_PORT',
};

test('generated build module applies one compiled identity to UI, API, and delivery-unit records', () => {
  const source = createUltramodernBuildModule('acme', app);
  const generationRecord = createDeliveryUnitRecord('acme', app);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-build-module-'));

  try {
    const sourcePath = path.join(tempRoot, 'ultramodern-build.ts');
    const outputRoot = path.join(tempRoot, 'dist');
    fs.writeFileSync(sourcePath, source);
    const compiled = runStableTypeScript(
      [
        sourcePath,
        '--ignoreConfig',
        '--module',
        'commonjs',
        '--outDir',
        outputRoot,
        '--pretty',
        'false',
        '--skipLibCheck',
        '--target',
        'es2022',
      ],
      tempRoot,
    );
    assert.equal(compiled.status, 0, compiled.output);

    const execute = (globals: Record<string, string>) => {
      const module = { exports: {} as Record<string, any> };
      vm.runInNewContext(
        fs.readFileSync(path.join(outputRoot, 'ultramodern-build.js'), 'utf8'),
        { ...globals, exports: module.exports, module },
      );
      return module.exports.ultramodernBuildArtifact;
    };

    const fallback = execute({});
    assert.equal(
      fallback.deliveryUnit.buildMarker,
      generationRecord.buildMarker,
    );
    assert.equal(fallback.deliveryUnit.sourceRevision, 'workspace');

    const compiledIdentity = execute({
      ULTRAMODERN_BUILD_MARKER: 'compiled-marker',
      ULTRAMODERN_SOURCE_REVISION: 'compiled-revision',
    });
    for (const identity of [
      compiledIdentity.deliveryUnit,
      compiledIdentity.surfaces.api,
      compiledIdentity.surfaces.ui,
    ]) {
      assert.equal(identity.build, 'compiled-marker');
      assert.equal(identity.buildMarker, 'compiled-marker');
      assert.equal(identity.sourceRevision, 'compiled-revision');
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
