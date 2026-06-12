import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { createBuilder } from '../src';
import { loadPostcssPlugin } from '../src/plugins/postcss';
import { matchRules, unwrapConfig } from './helper';

const fixturesDir = path.join(__dirname, 'fixtures');

const getPluginName = (plugin: unknown): string | undefined => {
  if (plugin && typeof plugin === 'object' && 'postcssPlugin' in plugin) {
    return (plugin as { postcssPlugin?: string }).postcssPlugin;
  }
  return undefined;
};

/** Collect the plugins array of every resolved postcss-loader entry. */
const collectPostcssPluginsArrays = (value: unknown): unknown[][] => {
  const result: unknown[][] = [];
  const seen = new WeakSet<object>();

  const visit = (current: unknown) => {
    if (!current || typeof current !== 'object') {
      return;
    }
    if (seen.has(current)) {
      return;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }

    const record = current as Record<string, any>;
    if (
      typeof record.loader === 'string' &&
      record.loader.includes('postcss-loader') &&
      Array.isArray(record.options?.postcssOptions?.plugins)
    ) {
      result.push(record.options.postcssOptions.plugins);
      return;
    }

    for (const item of Object.values(record)) {
      visit(item);
    }
  };

  visit(value);
  return result;
};

describe('plugin-postcss', () => {
  it('should apply user postcss.config plugins exactly once', async () => {
    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        output: {
          overrideBrowserslist: ['chrome >= 87'],
        },
      },
      cwd: path.join(fixturesDir, 'postcss-user-config'),
    });

    const config = await unwrapConfig(rsbuild);
    const pluginsArrays = collectPostcssPluginsArrays(
      matchRules({ config, testFile: 'a.css' }),
    );

    expect(pluginsArrays.length).toBeGreaterThan(0);

    for (const plugins of pluginsArrays) {
      const names = plugins.map(getPluginName);
      // the user plugin from postcss.config.cjs must not be duplicated
      expect(names.filter(name => name === 'test-marker-user-plugin')).toEqual([
        'test-marker-user-plugin',
      ]);
      // builder defaults are appended exactly once
      expect(names.filter(name => name === 'autoprefixer')).toEqual([
        'autoprefixer',
      ]);
      // user plugins run before the builder defaults
      expect(names.indexOf('test-marker-user-plugin')).toBeLessThan(
        names.indexOf('autoprefixer'),
      );
    }
  });

  it('should resolve postcss plugins from the app root when the builder cannot resolve them', () => {
    const appRoot = mkdtempSync(path.join(tmpdir(), 'builder-postcss-root-'));

    try {
      const pluginName = 'test-postcss-plugin-from-app-root';
      const pluginDir = path.join(appRoot, 'node_modules', pluginName);
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        path.join(appRoot, 'package.json'),
        JSON.stringify({ name: 'app-root', version: '1.0.0', private: true }),
      );
      writeFileSync(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({
          name: pluginName,
          version: '1.0.0',
          main: 'index.js',
        }),
      );
      writeFileSync(
        path.join(pluginDir, 'index.js'),
        `module.exports = { postcssPlugin: '${pluginName}' };\n`,
      );

      expect(loadPostcssPlugin(pluginName, appRoot)).toEqual({
        postcssPlugin: pluginName,
      });
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it('should throw when a postcss plugin cannot be resolved anywhere', () => {
    const appRoot = mkdtempSync(path.join(tmpdir(), 'builder-postcss-empty-'));

    try {
      expect(() =>
        loadPostcssPlugin('test-postcss-plugin-that-does-not-exist', appRoot),
      ).toThrow(/test-postcss-plugin-that-does-not-exist/);
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });
});
