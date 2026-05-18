import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from '@rstest/core';

const root = process.cwd();
const readText = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), 'utf-8');
const readJson = <T>(relativePath: string): T =>
  JSON.parse(readText(relativePath)) as T;

describe('generated UltraModern contract', () => {
  test('keeps localized route metadata and Rstest wiring', () => {
    expect(fs.existsSync(path.join(root, 'src/routes/[lang]/page.tsx'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(root, 'src/routes/page.tsx'))).toBe(false);

    const page = readText('src/routes/[lang]/page.tsx');
    expect(page).toContain('rel="canonical"');
    expect(page).toContain('rel="alternate"');
    expect(page).toContain('hrefLang="x-default"');
    expect(page).toContain('localizedPath(');

    const config = readText('rstest.config.mts');
    expect(config).toContain("withModernConfig()");
    expect(config).toContain("testEnvironment: 'happy-dom'");
  });

  test('retains package-source metadata for generated Modern.js packages', () => {
    const packageJson = readJson<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      modernjs?: {
        packageSource?: {
          config?: string;
        };
        preset?: string;
      };
    }>('package.json');
    const packageSource = readJson<{
      modernPackages?: {
        packages?: string[];
        specifier?: string;
      };
      strategy?: string;
    }>('.modernjs/ultramodern-package-source.json');

    expect(packageJson.modernjs?.preset).toBe('presetUltramodern');
    expect(packageJson.modernjs?.packageSource?.config).toBe(
      './.modernjs/ultramodern-package-source.json',
    );
    expect(packageSource.strategy).toMatch(/^(workspace|install)$/u);
    expect(packageSource.modernPackages?.packages).toContain(
      '@modern-js/runtime',
    );
    expect(packageSource.modernPackages?.packages).toContain(
      '@modern-js/app-tools',
    );
    expect(packageSource.modernPackages?.packages).toContain(
      '@modern-js/adapter-rstest',
    );
    expect(packageSource.modernPackages?.specifier).toBeTruthy();
    expect(
      packageJson.devDependencies?.['@modern-js/adapter-rstest'],
    ).toBeTruthy();
  });
});
