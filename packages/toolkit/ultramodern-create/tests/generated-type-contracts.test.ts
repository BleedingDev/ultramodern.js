import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

test('generated apps preserve checker and runtime type contracts', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-generated-type-contracts-'),
  );
  const workspaceDir = path.join(tempRoot, 'workspace');
  const pluginI18nPackage = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../runtime/plugin-i18n/package.json'),
      'utf-8',
    ),
  );
  const consumerExport = {
    types: './dist/types/runtime/context.d.ts',
    node: { module: './dist/esm/runtime/context.mjs' },
    default: './dist/esm/runtime/context.mjs',
  };

  assert.deepEqual(
    pluginI18nPackage.exports['./runtime/consumer'],
    consumerExport,
  );
  assert.deepEqual(
    pluginI18nPackage.exports['./runtime/no-react-i18next/consumer'],
    consumerExport,
  );

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'generated-type-contracts-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    for (const appDirectory of ['apps/shell-super-app', 'verticals/catalog']) {
      const modernConfig = fs.readFileSync(
        path.join(workspaceDir, appDirectory, 'modern.config.ts'),
        'utf-8',
      );
      assert.match(modernConfig, /disableTsChecker: false/u);
      assert.match(
        modernConfig,
        /ultramodernReleaseEnvelopePlugin,\s*\} from '@modern-js\/app-tools';/u,
      );
      assert.match(
        modernConfig,
        /plugins:\s*\[\s*appTools\(\),\s*ultramodernReleaseEnvelopePlugin\(\),/u,
      );
      assert.match(
        modernConfig,
        /tsChecker:\s*\{\s*typescript:\s*\{\s*build: false,/u,
      );
      const moduleFederationConfig = fs.readFileSync(
        path.join(workspaceDir, appDirectory, 'module-federation.config.ts'),
        'utf-8',
      );
      assert.match(
        moduleFederationConfig,
        /'@modern-js\/plugin-i18n\/runtime\/no-react-i18next\/consumer':\s*\{\s*requiredVersion: pluginI18nVersion,\s*singleton: true,/u,
      );

      const runtimeConfig = fs.readFileSync(
        path.join(workspaceDir, appDirectory, 'src/modern.runtime.ts'),
        'utf-8',
      );
      assert.match(
        runtimeConfig,
        /import type \{ I18nInstance \} from '@modern-js\/plugin-i18n\/runtime';/u,
      );
      assert.match(
        runtimeConfig,
        /i18nInstance: i18nInstance as I18nInstance,/u,
      );
    }

    for (const relativePath of [
      'src/federation-entry.tsx',
      'src/components/catalog-widget.tsx',
    ]) {
      const exposedSource = fs.readFileSync(
        path.join(workspaceDir, 'verticals/catalog', relativePath),
        'utf-8',
      );
      assert.match(
        exposedSource,
        /from '@modern-js\/plugin-i18n\/runtime\/consumer';/u,
      );
      assert.match(exposedSource, /import type \{ JSX \} from 'react';/u);
      assert.match(
        exposedSource,
        /export default function \w+\(\s*props: Record<string, never>\s*\): JSX\.Element\s*\{\s*void props;/u,
      );
      assert.doesNotMatch(
        exposedSource,
        /from '@modern-js\/plugin-i18n\/runtime';/u,
      );
    }

    const fragmentPage = fs.readFileSync(
      path.join(
        workspaceDir,
        'verticals/catalog/src/routes/[lang]/_mf/fragment/widget/page.tsx',
      ),
      'utf-8',
    );
    assert.match(
      fragmentPage,
      /useDistributedSsrFragmentProps<ComponentProps<typeof Widget>>/u,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
