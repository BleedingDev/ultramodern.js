import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type { Renderer } from '@modern-js/renderer-core';
import type { LocalisedUrlsOption } from '@modern-js/runtime-extensions/localised-urls';

export const NATIVE_I18N_PLUGIN = '@modern-js/ultramodern-native-i18n';

/**
 * The native counterpart of `@modern-js/plugin-i18n`'s `localeDetection`.
 * Native renderers always serve path-prefixed URLs (`/en/about`); the router
 * matches canonical paths through an i18n location rewrite.
 */
export interface NativeI18nLocaleDetection {
  languages: string[];
  /** @default the first language */
  fallbackLanguage?: string;
  /**
   * Redirect an unprefixed page URL to its localized URL. Native renderers
   * resolve the language from the path, so only `true` is supported.
   * @default true
   */
  localePathRedirect?: true;
  /**
   * Detect the redirect language from the query string, cookie and
   * `Accept-Language`. When false, unprefixed URLs use the fallback.
   * @default true
   */
  i18nextDetector?: boolean;
  detection?: {
    order?: ('querystring' | 'cookie' | 'header')[];
    lookupQuerystring?: string;
    lookupCookie?: string;
    lookupHeader?: string;
  };
  /** Canonical paths served without a language prefix or redirect. */
  ignoreRedirectRoutes?: string[];
  localisedUrls?: LocalisedUrlsOption;
}

export interface NativeI18nBackendOptions {
  /** @default true */
  enabled?: boolean;
  /**
   * Directory of `<language>/<namespace>.json` files, relative to the app.
   * @default the first of `locales`, `config/public/locales`, `public/locales`
   */
  localesDirectory?: string;
}

export interface NativeI18nPluginOptions {
  localeDetection: NativeI18nLocaleDetection;
  backend?: NativeI18nBackendOptions;
  /**
   * JSON-serializable i18next `init` options (for example `defaultNS`,
   * `interpolation`, `returnNull`). `lng`, `fallbackLng`, `supportedLngs`,
   * `resources` and `ns` are owned by the plugin.
   */
  initOptions?: Record<string, unknown>;
}

export interface NativeI18nConfig {
  languages: string[];
  fallbackLanguage: string;
  detect: boolean;
  detection: NonNullable<NativeI18nLocaleDetection['detection']>;
  ignoreRedirectRoutes: string[];
  localisedUrls?: LocalisedUrlsOption;
  backend: { enabled: boolean; localesDirectory?: string };
  initOptions: Record<string, unknown>;
}

/** Translation files discovered for one native entry. */
export interface NativeI18nEntry extends NativeI18nConfig {
  basePath: string;
  namespaces: string[];
  /** language -> namespace -> absolute JSON file */
  resources: Record<string, Record<string, string>>;
}

const nativeI18nOptions = Symbol.for('ultramodern.native-i18n-options');

type NativeI18nPlugin = CliPlugin<AppTools> & {
  [nativeI18nOptions]?: NativeI18nConfig;
};

const OWNED_INIT_OPTIONS = [
  'lng',
  'fallbackLng',
  'supportedLngs',
  'resources',
  'ns',
  'partialBundledLanguages',
];

function resolveOptions(options: NativeI18nPluginOptions): NativeI18nConfig {
  const detection = options?.localeDetection;
  if (!detection || typeof detection !== 'object')
    throw new Error('i18nPlugin() requires localeDetection.languages');
  const languages = detection.languages;
  if (
    !Array.isArray(languages) ||
    languages.length === 0 ||
    languages.some(
      language =>
        typeof language !== 'string' || !/^[A-Za-z0-9-]+$/u.test(language),
    ) ||
    new Set(languages.map(language => language.toLowerCase())).size !==
      languages.length
  )
    throw new Error(
      'i18nPlugin() localeDetection.languages must list unique language codes',
    );
  const fallbackLanguage = detection.fallbackLanguage ?? languages[0];
  if (!languages.includes(fallbackLanguage))
    throw new Error(
      `i18nPlugin() fallbackLanguage ${fallbackLanguage} is not one of localeDetection.languages`,
    );
  if (
    detection.localePathRedirect !== undefined &&
    detection.localePathRedirect !== true
  )
    throw new Error(
      'Native renderers resolve the language from the URL path; i18nPlugin() supports only localePathRedirect: true',
    );
  if (
    detection.ignoreRedirectRoutes !== undefined &&
    (!Array.isArray(detection.ignoreRedirectRoutes) ||
      detection.ignoreRedirectRoutes.some(route => typeof route !== 'string'))
  )
    throw new Error(
      'i18nPlugin() ignoreRedirectRoutes must be a list of canonical paths for native renderers',
    );
  const initOptions = options.initOptions ?? {};
  const owned = OWNED_INIT_OPTIONS.filter(name =>
    Object.hasOwn(initOptions, name),
  );
  if (owned.length)
    throw new Error(
      `i18nPlugin() owns these i18next options; configure them through localeDetection/backend instead: ${owned.join(', ')}`,
    );
  try {
    JSON.stringify(initOptions);
  } catch {
    throw new Error('i18nPlugin() initOptions must be JSON-serializable');
  }
  return {
    languages: [...languages],
    fallbackLanguage,
    detect: detection.i18nextDetector !== false,
    detection: { ...detection.detection },
    ignoreRedirectRoutes: [...(detection.ignoreRedirectRoutes ?? [])],
    ...(detection.localisedUrls === undefined
      ? {}
      : { localisedUrls: detection.localisedUrls }),
    backend: {
      enabled: options.backend?.enabled !== false,
      ...(options.backend?.localesDirectory
        ? { localesDirectory: options.backend.localesDirectory }
        : {}),
    },
    initOptions,
  };
}

/**
 * Localized routing and translations for the native Solid and Octane
 * renderers, with the same option shape as `@modern-js/plugin-i18n`:
 *
 * ```ts
 * import { defineConfig, i18nPlugin } from '@modern-js/ultramodern-app-tools';
 * export default defineConfig({
 *   renderer: 'solid',
 *   server: { ssr: true },
 *   plugins: [i18nPlugin({ localeDetection: { languages: ['en', 'cs'], fallbackLanguage: 'en' } })],
 * });
 * ```
 *
 * Translations are read from `locales/<language>/<namespace>.json` and
 * bundled per language. Components use `useI18n`, `LocalizedLink` and
 * `I18nProvider` from `@modern-js/renderer-<renderer>/i18n`; the app installs
 * `i18next` and `@modern-js/i18n-runtime-extensions` next to its renderer.
 */
export function i18nPlugin(
  options: NativeI18nPluginOptions,
): CliPlugin<AppTools> {
  const config = resolveOptions(options);
  const plugin: NativeI18nPlugin = {
    name: NATIVE_I18N_PLUGIN,
    setup(api) {
      const renderer = (api.getConfig() as { renderer?: Renderer }).renderer;
      if (renderer === undefined || renderer === 'react')
        throw new Error(
          "i18nPlugin() from @modern-js/ultramodern-app-tools serves the native Solid and Octane renderers; with renderer: 'react' use i18nPlugin() from @modern-js/plugin-i18n",
        );
      const { appDirectory } = api.getAppContext();
      const require = createRequire(path.join(appDirectory, 'package.json'));
      try {
        require.resolve('i18next');
      } catch {
        throw new Error(
          'i18nPlugin() requires the application to install i18next',
        );
      }
    },
  };
  Object.defineProperty(plugin, nativeI18nOptions, {
    value: Object.freeze(config),
    enumerable: false,
  });
  return plugin;
}

/** The single native i18n configuration among the consumer plugins. */
export function findNativeI18nConfig(
  plugins: readonly CliPlugin<AppTools>[],
): NativeI18nConfig | undefined {
  const found: NativeI18nConfig[] = [];
  const visit = (plugin: CliPlugin<AppTools>) => {
    const config = (plugin as NativeI18nPlugin)[nativeI18nOptions];
    if (config) found.push(config);
    for (const child of plugin.usePlugins ?? []) visit(child);
  };
  for (const plugin of plugins) visit(plugin);
  if (found.length > 1)
    throw new Error('Register i18nPlugin() once per application');
  return found[0];
}

const DEFAULT_LOCALES_DIRECTORIES = [
  'locales',
  'config/public/locales',
  'public/locales',
];

/** Discover `<language>/<namespace>.json` translation files for an entry. */
export function resolveNativeI18nEntry(
  config: NativeI18nConfig,
  appDirectory: string,
  basePath: string,
): NativeI18nEntry {
  const resources: Record<string, Record<string, string>> = {};
  const namespaces = new Set<string>();
  if (config.backend.enabled) {
    const candidates = config.backend.localesDirectory
      ? [config.backend.localesDirectory]
      : DEFAULT_LOCALES_DIRECTORIES;
    const directory = candidates
      .map(candidate => path.resolve(appDirectory, candidate))
      .find(candidate =>
        fs.statSync(candidate, { throwIfNoEntry: false })?.isDirectory(),
      );
    if (!directory)
      throw new Error(
        `i18nPlugin() found no translations; add ${candidates[0]}/<language>/<namespace>.json or set backend.enabled: false`,
      );
    for (const language of config.languages) {
      const languageDirectory = path.join(directory, language);
      if (
        !fs
          .statSync(languageDirectory, { throwIfNoEntry: false })
          ?.isDirectory()
      )
        continue;
      for (const file of fs.readdirSync(languageDirectory).sort()) {
        if (!file.endsWith('.json')) continue;
        const namespace = file.slice(0, -'.json'.length);
        resources[language] ??= {};
        resources[language][namespace] = path.join(languageDirectory, file);
        namespaces.add(namespace);
      }
    }
    if (!resources[config.fallbackLanguage])
      throw new Error(
        `i18nPlugin() found no translations for the fallback language in ${path.join(directory, config.fallbackLanguage)}`,
      );
  }
  return {
    ...config,
    basePath,
    namespaces: [...namespaces].sort(),
    resources,
  };
}

/**
 * Generated per-entry i18n modules: per-request i18next instances (never a
 * module singleton), lazily imported translation bundles, the router rewrite
 * and the SSR language/resources handoff.
 */
export function emitNativeI18nModules(
  entry: NativeI18nEntry,
  renderer: Exclude<Renderer, 'react'>,
): Record<string, string> {
  const rendererI18n = `@modern-js/renderer-${renderer}/i18n`;
  const routing = {
    languages: entry.languages,
    fallbackLanguage: entry.fallbackLanguage,
    basePath: entry.basePath,
    detect: entry.detect,
    detection: entry.detection,
    ignoreRedirectRoutes: entry.ignoreRedirectRoutes,
    ...(entry.localisedUrls === undefined
      ? {}
      : { localisedUrls: entry.localisedUrls }),
  };
  const defaultNamespace =
    typeof entry.initOptions.defaultNS === 'string'
      ? entry.initOptions.defaultNS
      : entry.namespaces.includes('translation')
        ? 'translation'
        : (entry.namespaces[0] ?? 'translation');
  const loaders = Object.entries(entry.resources)
    .map(
      ([language, namespaces]) =>
        `  ${JSON.stringify(language)}: {\n${Object.entries(namespaces)
          .map(
            ([namespace, file]) =>
              `    ${JSON.stringify(namespace)}: () => import(${JSON.stringify(file)}),`,
          )
          .join('\n')}\n  },`,
    )
    .join('\n');
  const resourcesModule = `// Each language's bundles load on demand.
export const resourceLoaders = {
${loaders}
};
`;
  const resourcesDeclaration = `export declare const resourceLoaders: Record<string, Record<string, () => Promise<unknown>>>;
`;
  const lookupCookie = entry.detection.lookupCookie ?? 'i18next';
  const i18nModule = `import { createInstance, type BackendModule, type i18n as I18nInstance, type InitOptions } from 'i18next';
import {
  createI18nSsrHandoffInlineData,
  createI18nUrlRewrite,
  type I18nInstanceLike,
  type I18nSsrHandoffResources,
  languageFromPathname,
  readI18nSsrHandoff,
  type ResolveRequestLanguageOptions,
} from ${JSON.stringify(rendererI18n)};
import { resourceLoaders } from './i18n-resources.js';

export type { I18nInstance };
export const i18nRouting: ResolveRequestLanguageOptions = ${JSON.stringify(routing, null, 2)};
const namespaces: string[] = ${JSON.stringify(entry.namespaces)};
const initOptions: InitOptions = ${JSON.stringify(entry.initOptions)};

function unwrapResource(module: unknown): unknown {
  return typeof module === 'object' && module !== null && 'default' in module ? module.default : module;
}

const backend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const load = resourceLoaders[language]?.[namespace];
    if (!load) {
      callback(null, {});
      return;
    }
    load().then(
      module => callback(null, unwrapResource(module) as Record<string, unknown>),
      error => callback(error as Error, false),
    );
  },
};

/** A new, fully isolated instance for one request or one browser document. */
export async function createI18n(language: string, resources?: I18nSsrHandoffResources): Promise<I18nInstance> {
  const instance = createInstance();
  instance.use(backend);
  await instance.init({
    ...initOptions,
    lng: language,
    fallbackLng: i18nRouting.fallbackLanguage,
    supportedLngs: i18nRouting.languages,
    ns: namespaces,
    defaultNS: ${JSON.stringify(defaultNamespace)},
    partialBundledLanguages: true,
    resources: resources ? { [language]: resources } : {},
    interpolation: { escapeValue: false, ...initOptions.interpolation },
  });
  return instance;
}

export function i18nProviderInstance(instance: I18nInstance): I18nInstanceLike {
  return instance as unknown as I18nInstanceLike;
}

/** Router-core rewrite: the router matches canonical paths, URLs carry the language. */
export function i18nRouterRewrite(getLanguage: () => string) {
  return createI18nUrlRewrite({
    languages: i18nRouting.languages,
    getLanguage,
    localisedUrls: i18nRouting.localisedUrls,
  });
}

/** The server language and its loaded bundles, read before hydration. */
export function i18nHandoff(instance: I18nInstance, includeResources = true) {
  const language = instance.language;
  return createI18nSsrHandoffInlineData({
    language,
    ...(includeResources
      ? { resources: Object.fromEntries(namespaces.map(namespace => [namespace, instance.getResourceBundle(language, namespace) ?? {}])) }
      : {}),
  });
}

export function clientI18nHandoff(): { language: string; resources?: I18nSsrHandoffResources } {
  const handoff = readI18nSsrHandoff();
  if (handoff && i18nRouting.languages.includes(handoff.language)) return handoff;
  return {
    language: languageFromPathname(window.location.pathname, i18nRouting.languages, i18nRouting.basePath) ?? i18nRouting.fallbackLanguage,
  };
}

interface LanguageRouter {
  subscribe(event: 'onBeforeLoad', listener: (event: { toLocation: { publicHref: string } }) => void): () => void;
}

/** History navigation to another language prefix switches the instance; switches persist. */
export function syncI18nWithRouter(router: LanguageRouter, instance: I18nInstance): void {
  router.subscribe('onBeforeLoad', ({ toLocation }) => {
    const pathname = new URL(toLocation.publicHref, window.location.origin).pathname;
    const language = languageFromPathname(pathname, i18nRouting.languages, i18nRouting.basePath);
    if (language && language !== instance.language) void instance.changeLanguage(language);
  });
  instance.on('languageChanged', language => {
    document.documentElement.lang = language;
    document.cookie = ${JSON.stringify(`${lookupCookie}=`)} + encodeURIComponent(language) + '; path=/; max-age=31536000; samesite=lax';
  });
}
`;
  return {
    'i18n.ts': i18nModule,
    'i18n-resources.js': resourcesModule,
    'i18n-resources.d.ts': resourcesDeclaration,
  };
}
