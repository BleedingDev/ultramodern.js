import type {
  NativeEntryI18n,
  NativeI18nResources,
} from '@modern-js/renderer-core/entry-server';
import type { LocalisedUrlsOption } from '@modern-js/runtime-extensions/localised-urls';
import i18next, {
  type BackendModule,
  type i18n as I18nInstance,
  type InitOptions,
} from 'i18next';
import { createLatestLanguageSyncBinding } from './language-sync/controller';
import {
  createRequestLanguageRedirect,
  languageFromPathname,
  type ResolveRequestLanguageOptions,
  resolveRequestLanguage,
} from './requestLanguage';
import {
  createI18nSsrHandoffInlineData,
  readI18nSsrHandoff,
} from './ssrLanguageHandoff';
import { createI18nUrlRewrite } from './urlRewrite';

export type { I18nInstance };

export interface NativeI18nOptions extends ResolveRequestLanguageOptions {
  /**
   * JSON-serializable i18next `init` options. `lng`, `fallbackLng`,
   * `supportedLngs`, `resources` and `ns` are owned by the native entry.
   */
  initOptions?: InitOptions;
}

/** language -> namespace -> lazily imported translation bundle. */
export type NativeI18nLoaders = Readonly<
  Record<string, Readonly<Record<string, () => Promise<unknown>>>>
>;

export type NativeI18n = NativeEntryI18n<I18nInstance, LocalisedUrlsOption>;

function unwrapResource(module: unknown): Record<string, unknown> {
  const resource =
    typeof module === 'object' && module !== null && 'default' in module
      ? module.default
      : module;
  return resource as Record<string, unknown>;
}

/**
 * The localized routing and per-request i18next instances of a native
 * Solid or Octane entry. Each language's bundles load on demand; an instance
 * is never a module singleton.
 */
export function createNativeI18n(
  options: NativeI18nOptions,
  loaders: NativeI18nLoaders,
): NativeI18n {
  const { initOptions = {}, ...routing } = options;
  const namespaces = [
    ...new Set(Object.values(loaders).flatMap(Object.keys)),
  ].sort();
  const defaultNamespace =
    typeof initOptions.defaultNS === 'string'
      ? initOptions.defaultNS
      : namespaces.includes('translation')
        ? 'translation'
        : (namespaces[0] ?? 'translation');
  const cookie = routing.detection?.lookupCookie ?? 'i18next';
  const backend: BackendModule = {
    type: 'backend',
    init() {},
    read(language, namespace, callback) {
      const load = loaders[language]?.[namespace];
      if (!load) {
        callback(null, {});
        return;
      }
      load().then(
        module => callback(null, unwrapResource(module)),
        error => callback(error as Error, false),
      );
    },
  };
  const currentLanguage = () =>
    languageFromPathname(
      window.location.pathname,
      routing.languages,
      routing.basePath,
    );

  return {
    languages: routing.languages,
    ...(routing.localisedUrls === undefined
      ? {}
      : { localisedUrls: routing.localisedUrls }),
    resolveRequest: request => resolveRequestLanguage(request, routing),
    redirect: createRequestLanguageRedirect,
    async create(language, resources) {
      // The default export resolves under both i18next module formats.
      const instance = i18next.createInstance();
      instance.use(backend);
      await instance.init({
        ...initOptions,
        lng: language,
        fallbackLng: routing.fallbackLanguage,
        supportedLngs: [...routing.languages],
        ns: namespaces,
        defaultNS: defaultNamespace,
        partialBundledLanguages: true,
        resources: resources ? { [language]: resources } : {},
        interpolation: { escapeValue: false, ...initOptions.interpolation },
      });
      return instance;
    },
    rewrite: getLanguage =>
      createI18nUrlRewrite({
        languages: routing.languages,
        getLanguage,
        localisedUrls: routing.localisedUrls,
      }),
    handoff(language, instance) {
      return createI18nSsrHandoffInlineData({
        language,
        ...(instance
          ? {
              resources: Object.fromEntries(
                namespaces.map(namespace => [
                  namespace,
                  (instance.getResourceBundle(language, namespace) ??
                    {}) as Record<string, unknown>,
                ]),
              ) satisfies NativeI18nResources,
            }
          : {}),
      });
    },
    clientHandoff() {
      const handoff = readI18nSsrHandoff();
      if (handoff && routing.languages.includes(handoff.language))
        return handoff;
      return { language: currentLanguage() ?? routing.fallbackLanguage };
    },
    syncWithRouter(router, instance) {
      // Navigation to another language prefix switches the instance. A
      // masked location (LocalizedLink to another language) publishes its
      // language on the mask; the unmasked location stays canonical. Switches
      // run through the shared sync policy: the latest URL language wins and
      // rejected loads retry. When retries run out the router has already
      // committed the URL, so a reload lets the server render that language.
      const sync = createLatestLanguageSyncBinding<I18nInstance>();
      sync.updateCallbacks({
        changeLanguage: (target, language) => target.changeLanguage(language),
        commitLanguage() {},
        readLanguage: target => target.language,
        reportFailure: () => window.location.reload(),
      });
      sync.activate(instance);
      (router as LanguageRouter).subscribe('onBeforeLoad', ({ toLocation }) => {
        const publicHref =
          toLocation.maskedLocation?.publicHref ?? toLocation.publicHref;
        const pathname = new URL(publicHref, window.location.origin).pathname;
        const language = languageFromPathname(
          pathname,
          routing.languages,
          routing.basePath,
        );
        if (language) sync.request(language);
      });
      // Switches persist.
      instance.on('languageChanged', language => {
        document.documentElement.lang = language;
        // biome-ignore lint/suspicious/noDocumentCookie: the server's language detector reads this cookie; CookieStore is not in every browser.
        document.cookie = `${cookie}=${encodeURIComponent(language)}; path=/; max-age=31536000; samesite=lax`;
      });
    },
  };
}

interface LanguageRouter {
  subscribe(
    event: 'onBeforeLoad',
    listener: (event: {
      toLocation: {
        publicHref: string;
        maskedLocation?: { publicHref: string };
      };
    }) => void,
  ): () => void;
}
