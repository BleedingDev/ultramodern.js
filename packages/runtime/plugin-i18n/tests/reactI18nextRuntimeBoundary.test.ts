import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@rstest/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(__dirname, '../src/runtime');

const readRuntimeSource = (file: string) =>
  readFileSync(resolve(runtimeRoot, file), 'utf8').replace(/\r\n/gu, '\n');

describe('react-i18next runtime boundary', () => {
  test('keeps the disabled runtime entry free of the optional adapter edge', () => {
    const noReactEntry = readRuntimeSource('no-react-i18next.tsx');
    const core = readRuntimeSource('core.tsx');

    expect(noReactEntry).not.toContain('./i18n/react-i18next');
    expect(core).not.toContain('./i18n/react-i18next');
    expect(core).not.toContain("import('react-i18next')");
  });

  test('keeps the runtime plugin factory entry synchronous for federation', () => {
    const core = readRuntimeSource('core.tsx');
    const pluginSetup = readRuntimeSource('pluginSetup.ts');

    expect(core).not.toContain("from './i18n/backend/middleware'");
    expect(core).not.toContain("from './i18n/utils'");
    expect(pluginSetup).not.toContain("from './i18n/backend/middleware'");
    expect(pluginSetup).not.toContain("from './i18n/utils'");
    expect(pluginSetup).toContain("import('./i18n/backend/middleware')");
    expect(pluginSetup).toContain("import('./i18n/utils')");
  });

  test('keeps the Modern i18n context stable across federated runtime copies', () => {
    const context = readRuntimeSource('context.tsx');

    expect(context).toContain(
      "Symbol.for(\n  '@modern-js/plugin-i18n/runtime/ModernI18nContext'",
    );
    expect(context).toContain('globalStore[modernI18nContextKey] ??=');
  });

  test('keeps the default runtime entry wired to react-i18next integration', () => {
    const defaultEntry = readRuntimeSource('index.tsx');

    expect(defaultEntry).toContain('./i18n/react-i18next');
  });
});
