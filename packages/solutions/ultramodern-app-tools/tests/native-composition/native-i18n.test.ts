import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppTools, CLIPluginAPI } from '@modern-js/app-tools';
import { rspack } from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import {
  emitNativeI18nModule,
  findNativeI18nConfig,
  i18nPlugin,
  resolveNativeI18nEntry,
} from '../../src/native-composition/native-i18n';

const localeDetection = { languages: ['en', 'cs'], fallbackLanguage: 'en' };

function appWithLocales(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-i18n-'));
  for (const [language, title] of [
    ['en', 'Hello'],
    ['cs', 'Ahoj'],
  ]) {
    fs.mkdirSync(path.join(directory, 'locales', language), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(directory, 'locales', language, 'translation.json'),
      JSON.stringify({ title }),
    );
  }
  fs.writeFileSync(
    path.join(directory, 'locales', 'en', 'common.json'),
    JSON.stringify({ ok: 'OK' }),
  );
  return directory;
}

async function evaluate(
  source: string,
  modules: Record<string, unknown>,
): Promise<Record<string, any>> {
  const { code } = await rspack.experiments.swc.transform(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const exports: Record<string, any> = {};
  new Function('require', 'exports', code)((name: string) => {
    if (name in modules) return modules[name];
    throw new Error(`Unexpected generated import: ${name}`);
  }, exports);
  return exports;
}

describe('native i18nPlugin()', () => {
  it('validates the React-shaped options it accepts', () => {
    expect(() => i18nPlugin({} as never)).toThrow('localeDetection.languages');
    expect(() =>
      i18nPlugin({ localeDetection: { languages: ['en', 'EN'] } }),
    ).toThrow('unique language codes');
    expect(() =>
      i18nPlugin({
        localeDetection: { languages: ['en'], fallbackLanguage: 'cs' },
      }),
    ).toThrow('fallbackLanguage cs');
    expect(() =>
      i18nPlugin({
        localeDetection: {
          ...localeDetection,
          localePathRedirect: false as never,
        },
      }),
    ).toThrow('only localePathRedirect: true');
    expect(() =>
      i18nPlugin({ localeDetection, initOptions: { lng: 'cs' } }),
    ).toThrow('owns these i18next options');
    for (const [initOptions, path] of [
      [{ format: () => '' }, 'initOptions.format'],
      [{ missing: undefined }, 'initOptions.missing'],
      [
        { interpolation: { limit: Number.POSITIVE_INFINITY } },
        'initOptions.interpolation.limit',
      ],
      [{ list: [1, Symbol('x')] }, 'initOptions.list.1'],
      [{ when: new Date(0) }, 'initOptions.when'],
      // biome-ignore lint/suspicious/noSparseArray: the hole is the case under test.
      [{ list: [1, , 3] }, 'initOptions.list.1'],
      [
        Object.defineProperty({}, 'lazy', {
          enumerable: true,
          get: () => 'value',
        }),
        'initOptions.lazy',
      ],
      [{ nested: { [Symbol('x')]: 1 } }, 'initOptions.nested[symbol]'],
      [
        Object.defineProperty({}, 'hidden', { enumerable: false, value: 1 }),
        'initOptions.hidden',
      ],
      [
        { list: Object.assign([1, 2], { extra: true }) },
        'initOptions.list.extra',
      ],
      [
        JSON.parse('{"__proto__": {"polluted": true}}'),
        'initOptions.__proto__',
      ],
    ] as const)
      expect(() =>
        i18nPlugin({ localeDetection, initOptions: initOptions as never }),
      ).toThrow(`${path} is not`);
    expect(() =>
      i18nPlugin({
        localeDetection,
        initOptions: { returnNull: false, nested: { list: [1, 'a', null] } },
      }),
    ).not.toThrow();
  });

  it('is found once among nested consumer plugins', () => {
    const plugin = i18nPlugin({ localeDetection });
    expect(plugin.name).toBe('@modern-js/ultramodern-native-i18n');
    const config = findNativeI18nConfig([
      { name: 'fixture:wrapper', usePlugins: [plugin] },
    ]);
    expect(config).toMatchObject({
      languages: ['en', 'cs'],
      fallbackLanguage: 'en',
      detect: true,
      backend: { enabled: true },
    });
    expect(findNativeI18nConfig([{ name: 'fixture:other' }])).toBeUndefined();
    expect(() =>
      findNativeI18nConfig([plugin, i18nPlugin({ localeDetection })]),
    ).toThrow('once per application');
  });

  it('points React applications at @modern-js/plugin-i18n', () => {
    const plugin = i18nPlugin({ localeDetection });
    const api = {
      getConfig: () => ({ renderer: 'react' }),
      getAppContext: () => ({ appDirectory: os.tmpdir() }),
    } as unknown as CLIPluginAPI<AppTools>;
    expect(() => plugin.setup?.(api)).toThrow(
      "with renderer: 'react' use i18nPlugin() from @modern-js/plugin-i18n",
    );
  });
});

describe('native i18n entry modules', () => {
  it('discovers per-language namespaces and requires fallback translations', () => {
    const appDirectory = appWithLocales();
    try {
      const config = findNativeI18nConfig([i18nPlugin({ localeDetection })])!;
      const entry = resolveNativeI18nEntry(config, appDirectory, '/');
      expect(Object.keys(entry.resources.en)).toEqual([
        'common',
        'translation',
      ]);
      expect(Object.keys(entry.resources.cs)).toEqual(['translation']);
      expect(entry.resources.en.common).toBe(
        path.join(appDirectory, 'locales/en/common.json'),
      );
      fs.rmSync(path.join(appDirectory, 'locales/en'), { recursive: true });
      expect(() => resolveNativeI18nEntry(config, appDirectory, '/')).toThrow(
        'no translations for the fallback language',
      );
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  it('emits routing data and lazy bundle loaders for createNativeI18n()', async () => {
    const appDirectory = appWithLocales();
    try {
      const config = findNativeI18nConfig([
        i18nPlugin({
          localeDetection: {
            ...localeDetection,
            detection: { lookupCookie: 'language' },
          },
          initOptions: { defaultNS: 'common' },
        }),
      ])!;
      const entry = resolveNativeI18nEntry(config, appDirectory, '/shop');
      const source = emitNativeI18nModule(entry);
      const calls: [Record<string, unknown>, any][] = [];
      const module = await evaluate(source, {
        '@modern-js/i18n-runtime-extensions/native': {
          createNativeI18n: (
            options: Record<string, unknown>,
            loaders: any,
          ) => {
            calls.push([options, loaders]);
            return 'native-i18n';
          },
        },
      });
      expect(module.i18n).toBe('native-i18n');
      const [options, loaders] = calls[0];
      expect(options).toEqual({
        languages: ['en', 'cs'],
        fallbackLanguage: 'en',
        basePath: '/shop',
        detect: true,
        detection: { lookupCookie: 'language' },
        ignoreRedirectRoutes: [],
        initOptions: { defaultNS: 'common' },
      });
      expect(Object.keys(loaders.en)).toEqual(['common', 'translation']);
      expect(Object.keys(loaders.cs)).toEqual(['translation']);
      // Each language's bundles load on demand.
      expect(source).toContain(
        `"translation": () => import(${JSON.stringify(path.join(appDirectory, 'locales/cs/translation.json'))}),`,
      );
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });
});
