import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from '@rstest/core';
import { loadUltramodernConfigMetadata } from '../../src/native-composition/config-metadata';

it('loads a TypeScript config whose imports read import.meta in the worker', async () => {
  // Inside the package, so the config resolves the package by self-reference.
  const appDirectory = fs.mkdtempSync(
    path.join(__dirname, '..', '.config-metadata-worker-'),
  );
  try {
    fs.mkdirSync(path.join(appDirectory, 'src'));
    fs.writeFileSync(
      path.join(appDirectory, 'package.json'),
      JSON.stringify({ name: 'shell', type: 'module' }),
    );
    fs.writeFileSync(
      path.join(appDirectory, 'src', 'App.tsx'),
      'export default () => null;',
    );
    // Effect's ConfigProvider spreads `import.meta?.env` the same way.
    fs.writeFileSync(
      path.join(appDirectory, 'environment.ts'),
      'export const environment: Record<string, unknown> = { ...(import.meta as { env?: object })?.env };\n',
    );
    fs.writeFileSync(
      path.join(appDirectory, 'modern.config.ts'),
      [
        "import { defineConfig } from '@modern-js/ultramodern-app-tools';",
        "import { environment } from './environment';",
        'export default defineConfig({',
        "  renderer: 'react',",
        '  source: { globalVars: { ENVIRONMENT_KEYS: Object.keys(environment).length } },',
        '});',
        '',
      ].join('\n'),
    );

    const metadata = await loadUltramodernConfigMetadata({
      appDirectory,
      env: 'production',
      command: 'build',
    });

    expect(metadata.renderer).toBe('react');
    expect(metadata.entries).toHaveLength(1);
  } finally {
    fs.rmSync(appDirectory, { recursive: true, force: true });
  }
});
