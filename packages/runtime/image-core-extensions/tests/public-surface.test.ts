import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import * as root from '../src/index.ts';
import loader, { raw } from '../src/loader.ts';
import imageLoader, * as imageLoaderModule from '../src/shared/image-loader.ts';

const packageRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(
  readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
) as {
  exports: Record<string, unknown>;
  main: string;
  module: string;
  typesVersions: Record<string, Record<string, string[]>>;
};

function collectDistTargets(value: unknown, targets: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith('./dist/')) targets.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectDistTargets(entry, targets);
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value))
      collectDistTargets(entry, targets);
  }
}

describe('@modern-js/image-core-extensions public package surface', () => {
  it('preserves every public @rsbuild-image/core subpath', () => {
    expect(Object.keys(manifest.exports).sort()).toEqual([
      '.',
      './image-loader',
      './loader',
      './shared',
      './types',
    ]);
    expect(Object.keys(manifest.typesVersions['*']).sort()).toEqual([
      '.',
      'image-loader',
      'loader',
      'shared',
      'types',
    ]);
  });

  it('preserves the exact root runtime names', () => {
    expect(Object.keys(root).sort()).toEqual([
      'DEFAULT_IPX_BASENAME',
      'PACKAGE_NAME',
      'applyImageLoader',
      'ipxImageLoader',
      'pluginImage',
    ]);
  });

  it('emits every public distribution target declared by the manifest', () => {
    const targets = new Set<string>([manifest.main, manifest.module]);
    collectDistTargets(manifest.exports, targets);
    collectDistTargets(manifest.typesVersions, targets);

    for (const target of targets) {
      const outputPath = path.join(packageRoot, target);
      expect(statSync(outputPath).size, target).toBeGreaterThan(0);
    }
  });

  it('preserves loader and image-loader entry behavior', () => {
    expect(typeof loader).toBe('function');
    expect(raw).toBe(true);
    expect(imageLoader).toBe(imageLoaderModule.ipxImageLoader);
    expect(Object.keys(imageLoaderModule).sort()).toEqual([
      'applyImageLoader',
      'default',
      'ipxImageLoader',
    ]);
  });

  it.each([
    'src/shared/index.ts',
    'src/shared/image-loader.ts',
  ])('keeps browser entry %s free of Node-only imports', async entry => {
    const result = await build({
      bundle: true,
      entryPoints: [path.join(packageRoot, entry)],
      format: 'esm',
      logLevel: 'silent',
      metafile: true,
      platform: 'browser',
      write: false,
    });

    expect(result.outputFiles).toHaveLength(1);
    expect(result.outputFiles[0].text).not.toMatch(/(?:node:|createRequire)/);
    expect(
      Object.values(result.metafile.outputs).flatMap(output => output.imports),
    ).toEqual([]);
  });
});
