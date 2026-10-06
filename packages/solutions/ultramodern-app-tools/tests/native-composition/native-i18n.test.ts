import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppTools, CLIPluginAPI } from '@modern-js/app-tools';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { rspack } from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import {
  emitNativeI18nModules,
  findNativeI18nConfig,
  i18nPlugin,
  resolveNativeI18nEntry,
} from '../../src/native-composition/native-i18n';
import { emitNativeRouteModule } from '../../src/native-composition/native-routes';

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
      expect(entry.namespaces).toEqual(['common', 'translation']);
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

  it('creates an isolated i18next instance per call and hands its bundles off', async () => {
    const appDirectory = appWithLocales();
    try {
      const config = findNativeI18nConfig([i18nPlugin({ localeDetection })])!;
      const entry = resolveNativeI18nEntry(config, appDirectory, '/');
      const files = emitNativeI18nModules(entry, 'solid');
      expect(Object.keys(files).sort()).toEqual([
        'i18n-resources.d.ts',
        'i18n-resources.js',
        'i18n.ts',
      ]);
      expect(files['i18n-resources.js']).toContain(
        `() => import(${JSON.stringify(path.join(appDirectory, 'locales/cs/translation.json'))})`,
      );
      const loads: string[] = [];
      const instances: any[] = [];
      const i18next = {
        createInstance() {
          const store: Record<string, Record<string, unknown>> = {};
          let backend: any;
          const instance = {
            language: '',
            use(module: unknown) {
              backend = module;
              return instance;
            },
            async init(options: any) {
              instance.language = options.lng;
              instance.options = options;
              for (const [language, bundles] of Object.entries<any>(
                options.resources,
              ))
                for (const [ns, bundle] of Object.entries(bundles))
                  store[`${language}/${ns}`] = bundle as Record<
                    string,
                    unknown
                  >;
              for (const ns of options.ns)
                if (!store[`${options.lng}/${ns}`])
                  store[`${options.lng}/${ns}`] = await new Promise(
                    (resolve, reject) =>
                      backend.read(
                        options.lng,
                        ns,
                        (error: unknown, data: any) =>
                          error ? reject(error) : resolve(data),
                      ),
                  );
            },
            getResourceBundle: (language: string, ns: string) =>
              store[`${language}/${ns}`],
            options: undefined as any,
          };
          instances.push(instance);
          return instance;
        },
      };
      const renderer = {
        createI18nUrlRewrite: (options: any) => ({ options }),
        createI18nSsrHandoffInlineData: (payload: unknown) => ({
          id: 'handoff',
          payload,
        }),
        languageFromPathname: () => undefined,
        readI18nSsrHandoff: () => undefined,
      };
      const resources = {
        resourceLoaders: {
          cs: {
            translation: async () => {
              loads.push('cs/translation');
              return { default: { title: 'Ahoj' } };
            },
          },
        },
      };
      const module = await evaluate(files['i18n.ts'], {
        i18next,
        '@modern-js/renderer-solid/i18n': renderer,
        './i18n-resources.js': resources,
      });
      const first = await module.createI18n('cs');
      const second = await module.createI18n('cs', {
        translation: { title: 'Ahoj' },
      });
      expect(first).not.toBe(second);
      expect(instances).toHaveLength(2);
      // The handed-off bundle is used directly; only the first instance loads.
      expect(loads).toEqual(['cs/translation']);
      expect(first.options).toMatchObject({
        lng: 'cs',
        fallbackLng: 'en',
        supportedLngs: ['en', 'cs'],
        ns: ['common', 'translation'],
        defaultNS: 'translation',
        partialBundledLanguages: true,
        interpolation: { escapeValue: false },
      });
      expect(module.i18nHandoff(first)).toEqual({
        id: 'handoff',
        payload: {
          language: 'cs',
          resources: { common: {}, translation: { title: 'Ahoj' } },
        },
      });
      let language = 'en';
      const rewrite = module.i18nRouterRewrite(() => language);
      language = 'cs';
      expect(rewrite.options.languages).toEqual(['en', 'cs']);
      expect(rewrite.options.getLanguage()).toBe('cs');
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    'solid',
    'octane',
  ] as const)('passes the i18n rewrite to the %s application router only when enabled', async renderer => {
    const routerOptions: Record<string, unknown>[] = [];
    const runtime = {
      createFileSystemRouteTree: () => ({}),
      createApplicationRouter(options: Record<string, unknown>) {
        routerOptions.push(options);
        return { options };
      },
      createMemoryHistory: () => ({}),
    };
    const identity: RendererIdentity = {
      renderer,
      appId: 'i18n',
      entryName: 'main',
      protocolVersion: 1,
      buildId: 'digest',
    };
    const rewrite = { input: () => undefined, output: () => undefined };
    for (const i18n of [true, false]) {
      const source = emitNativeRouteModule({
        renderer,
        routes: [{ id: 'layout', isRoot: true, children: [] }],
        mode: 'client',
        basePath: '/',
        i18n,
      });
      const module = await evaluate(source, {
        [`@modern-js/renderer-${renderer}/router`]: runtime,
        '@modern-js/renderer-core/data': {},
      });
      module.createNativeRouter({ identity, rewrite });
    }
    expect(routerOptions[0].rewrite).toBe(rewrite);
    expect(routerOptions[1]).not.toHaveProperty('rewrite');
  });
});
