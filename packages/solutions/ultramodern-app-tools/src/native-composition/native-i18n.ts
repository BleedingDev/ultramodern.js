import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type { Renderer } from '@modern-js/renderer-core';
import {
  type LocalisedUrlsOption,
  validateLocalisedUrls,
} from '@modern-js/runtime-extensions/localised-urls';
import { resolveRendererAdapter } from './renderer-registration';

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

/**
 * The path of the first value JSON would drop or alter (a function, symbol,
 * `undefined`, non-finite number, array hole, accessor, symbol key,
 * non-enumerable property, non-plain object, cycle or shared reference, which
 * the emitted JSON would split into separate copies).
 */
function nonJsonPath(
  value: unknown,
  at: string,
  seen = new Set<object>(),
): string | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return undefined;
  // JSON writes -0 as 0.
  if (typeof value === 'number')
    return Number.isFinite(value) && !Object.is(value, -0) ? undefined : at;
  if (typeof value !== 'object') return at;
  if (seen.has(value)) return at;
  const prototype = Object.getPrototypeOf(value);
  // The emitted literal recreates objects with Object.prototype, so a
  // null-prototype object would change too.
  if (
    Array.isArray(value)
      ? prototype !== Array.prototype
      : prototype !== Object.prototype
  )
    return at;
  // JSON turns an array hole into null, so a sparse array is altered too.
  if (Array.isArray(value))
    for (let index = 0; index < value.length; index++)
      if (!(index in value)) return `${at}.${index}`;
  // JSON silently drops symbol-keyed and non-enumerable properties.
  if (Object.getOwnPropertySymbols(value).length) return `${at}[symbol]`;
  seen.add(value);
  // Read descriptors, never getters: an accessor could answer differently
  // when the module is emitted.
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (key === 'length' && Array.isArray(value)) continue;
    if (
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      // JSON keeps only an array's indexes, and an emitted object literal
      // would read `__proto__` as a prototype, not data.
      (Array.isArray(value) &&
        !(/^(?:0|[1-9]\d*)$/u.test(key) && Number(key) < value.length)) ||
      key === '__proto__'
    )
      return `${at}.${key}`;
    const path = nonJsonPath(descriptor.value, `${at}.${key}`, seen);
    if (path) return path;
  }
  return undefined;
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
  const invalid = nonJsonPath(initOptions, 'initOptions');
  if (invalid)
    throw new Error(
      `i18nPlugin() initOptions must be JSON-serializable; ${invalid} is not`,
    );
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
 * Localized routing and translations for native renderers whose adapter
 * ships an i18n runtime, with the same option shape as `@modern-js/plugin-i18n`:
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
 * `I18nProvider` from the adapter's i18n runtime module; the app installs
 * `i18next` and `@modern-js/i18n-runtime-extensions` next to its renderer.
 */
export function i18nPlugin(
  options: NativeI18nPluginOptions,
): CliPlugin<AppTools> {
  const config = resolveOptions(options);
  const plugin: NativeI18nPlugin = {
    name: NATIVE_I18N_PLUGIN,
    setup(api) {
      const adapter = resolveRendererAdapter(
        (api.getConfig() as { renderer?: Renderer }).renderer,
      );
      if (adapter.kind !== 'native' || !adapter.runtime.i18n)
        throw new Error(
          `i18nPlugin() from @modern-js/ultramodern-app-tools serves native renderers with an i18n runtime; with renderer: '${adapter.name}' use i18nPlugin() from @modern-js/plugin-i18n`,
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
  // Null prototypes: a language or namespace named `constructor` or
  // `__proto__` is a plain key, never an inherited Object member.
  const resources: Record<string, Record<string, string>> = Object.create(null);
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
        resources[language] ??= Object.create(null);
        resources[language][namespace] = path.join(languageDirectory, file);
      }
    }
    if (!Object.hasOwn(resources, config.fallbackLanguage))
      throw new Error(
        `i18nPlugin() found no translations for the fallback language in ${path.join(directory, config.fallbackLanguage)}`,
      );
  }
  return { ...config, basePath, resources };
}

interface LocalisableRouteNode {
  path?: string;
  children?: readonly LocalisableRouteNode[];
}

/**
 * Check a `localisedUrls` map against an entry's file-system routes with the
 * React i18n tooling's rules: every localisable route maps every language,
 * and no two routes claim the same physical path.
 */
export function validateNativeLocalisedUrls(
  entry: Pick<NativeI18nConfig, 'languages' | 'localisedUrls'>,
  routes: readonly LocalisableRouteNode[],
): void {
  const map = entry.localisedUrls;
  if (!map || typeof map !== 'object') return;
  const toLocalised = (
    route: LocalisableRouteNode,
  ): Parameters<typeof validateLocalisedUrls>[0][number] => ({
    type: 'nested',
    ...(route.path === undefined ? {} : { path: route.path }),
    children: (route.children ?? []).map(toLocalised),
  });
  validateLocalisedUrls(routes.map(toLocalised), [...entry.languages], map);
}

/**
 * The generated per-entry i18n module: localized routing data and each
 * language's lazily imported translation bundles. `createNativeI18n()` owns
 * per-request i18next instances, the router rewrite and the SSR handoff.
 */
export function emitNativeI18nModule(entry: NativeI18nEntry): string {
  const options = {
    languages: entry.languages,
    fallbackLanguage: entry.fallbackLanguage,
    basePath: entry.basePath,
    detect: entry.detect,
    detection: entry.detection,
    ignoreRedirectRoutes: entry.ignoreRedirectRoutes,
    ...(entry.localisedUrls === undefined
      ? {}
      : { localisedUrls: entry.localisedUrls }),
    initOptions: entry.initOptions,
  };
  // Computed keys: a literal `"__proto__": ...` would set the prototype.
  const loaders = Object.entries(entry.resources)
    .map(
      ([language, namespaces]) =>
        `  [${JSON.stringify(language)}]: {\n${Object.entries(namespaces)
          .map(
            ([namespace, file]) =>
              `    [${JSON.stringify(namespace)}]: () => import(${JSON.stringify(file)}),`,
          )
          .join('\n')}\n  },`,
    )
    .join('\n');
  return `import { createNativeI18n } from "@modern-js/i18n-runtime-extensions/native";
export const i18n = createNativeI18n(${JSON.stringify(options, null, 2)}, {
${loaders}
});
`;
}
