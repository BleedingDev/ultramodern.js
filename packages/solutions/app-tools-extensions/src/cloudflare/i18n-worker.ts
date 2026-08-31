import type { CloudflareAppContext } from './types';
import { isRecord } from './utils';

const I18N_SERVER_PLUGIN_NAME = 'plugin-i18n/server';
const DEFAULT_I18NEXT_DETECTION_OPTIONS = {
  order: [
    'querystring',
    'cookie',
    'localStorage',
    'header',
    'navigator',
    'htmlTag',
    'path',
    'subdomain',
  ],
  lookupQuerystring: 'lng',
  lookupCookie: 'i18next',
  lookupHeader: 'accept-language',
} as const;
const SERVER_SIDE_I18N_DETECTORS = new Set(['querystring', 'cookie', 'header']);

type ServerPluginConfig = NonNullable<
  CloudflareAppContext['serverPlugins']
>[number];

type WorkerI18nDetection = {
  order: string[];
  lookupQuerystring: string;
  lookupCookie: string;
  lookupHeader: string;
};

type WorkerI18nEntry = {
  i18nextDetector: boolean;
  languages: string[];
  fallbackLanguage: string;
  detection: WorkerI18nDetection;
  ignoreRedirectRoutes: string[];
  staticRoutePrefixes: string[];
  localisedUrls?: Record<string, Record<string, string>>;
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

const getI18nServerPlugin = (
  appContext: CloudflareAppContext,
): ServerPluginConfig | undefined =>
  appContext.serverPlugins?.find(plugin =>
    plugin.name.includes(I18N_SERVER_PLUGIN_NAME),
  );

const removeLocaleDetectionByEntry = (config: Record<string, unknown>) => {
  const { localeDetectionByEntry: _localeDetectionByEntry, ...rest } = config;
  return rest;
};

const getEntryLocaleDetection = (
  entryName: string,
  localeDetection: Record<string, unknown>,
) => {
  const byEntry = isRecord(localeDetection.localeDetectionByEntry)
    ? localeDetection.localeDetectionByEntry
    : undefined;
  const entryConfig = byEntry?.[entryName];
  const globalConfig = removeLocaleDetectionByEntry(localeDetection);

  return isRecord(entryConfig)
    ? { ...globalConfig, ...entryConfig }
    : globalConfig;
};

const normalizeI18nDetection = (detection: unknown): WorkerI18nDetection => {
  const configured = isRecord(detection) ? detection : {};
  const rawOrder = Array.isArray(configured.order)
    ? configured.order
    : DEFAULT_I18NEXT_DETECTION_OPTIONS.order;
  const order = rawOrder.filter(
    (entry): entry is string =>
      typeof entry === 'string' && SERVER_SIDE_I18N_DETECTORS.has(entry),
  );

  return {
    order: order.length > 0 ? order : ['querystring', 'cookie', 'header'],
    lookupQuerystring:
      typeof configured.lookupQuerystring === 'string' &&
      configured.lookupQuerystring
        ? configured.lookupQuerystring
        : DEFAULT_I18NEXT_DETECTION_OPTIONS.lookupQuerystring,
    lookupCookie:
      typeof configured.lookupCookie === 'string' && configured.lookupCookie
        ? configured.lookupCookie
        : DEFAULT_I18NEXT_DETECTION_OPTIONS.lookupCookie,
    lookupHeader:
      typeof configured.lookupHeader === 'string' && configured.lookupHeader
        ? configured.lookupHeader
        : DEFAULT_I18NEXT_DETECTION_OPTIONS.lookupHeader,
  };
};

const normalizeLocalisedUrls = (
  localisedUrls: unknown,
): Record<string, Record<string, string>> | undefined => {
  if (!isRecord(localisedUrls) || Object.keys(localisedUrls).length === 0) {
    return undefined;
  }

  const normalized: Record<string, Record<string, string>> = {};
  for (const [canonicalPath, languageMap] of Object.entries(localisedUrls)) {
    if (!isRecord(languageMap)) {
      continue;
    }

    const normalizedLanguageMap = Object.fromEntries(
      Object.entries(languageMap).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1].length > 0,
      ),
    );

    if (Object.keys(normalizedLanguageMap).length > 0) {
      normalized[canonicalPath] = normalizedLanguageMap;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeWorkerI18nEntry = (
  entryName: string,
  localeDetection: Record<string, unknown>,
  staticRoutePrefixes: string[],
): WorkerI18nEntry | undefined => {
  const entryConfig = getEntryLocaleDetection(entryName, localeDetection);
  const languages = toStringArray(entryConfig.languages);

  if (entryConfig.localePathRedirect !== true || languages.length === 0) {
    return undefined;
  }

  const fallbackLanguage =
    typeof entryConfig.fallbackLanguage === 'string' &&
    entryConfig.fallbackLanguage
      ? entryConfig.fallbackLanguage
      : 'en';
  const ignoreRedirectRoutes = Array.isArray(entryConfig.ignoreRedirectRoutes)
    ? toStringArray(entryConfig.ignoreRedirectRoutes)
    : [];
  const localisedUrls = normalizeLocalisedUrls(entryConfig.localisedUrls);

  return {
    i18nextDetector: entryConfig.i18nextDetector !== false,
    languages,
    fallbackLanguage,
    detection: normalizeI18nDetection(entryConfig.detection),
    ignoreRedirectRoutes,
    staticRoutePrefixes,
    ...(localisedUrls ? { localisedUrls } : {}),
  };
};

export const createI18nWorkerManifest = (
  routeSpec: { routes: Array<Record<string, unknown>> },
  appContext: CloudflareAppContext,
) => {
  const i18nServerPlugin = getI18nServerPlugin(appContext);
  const localeDetection = i18nServerPlugin?.options?.localeDetection;

  if (!isRecord(localeDetection)) {
    return undefined;
  }

  const staticRoutePrefixes = toStringArray(
    i18nServerPlugin?.options?.staticRoutePrefixes,
  );
  const entries: Record<string, WorkerI18nEntry> = {};

  for (const route of routeSpec.routes) {
    if (typeof route.entryName !== 'string' || entries[route.entryName]) {
      continue;
    }

    const entry = normalizeWorkerI18nEntry(
      route.entryName,
      localeDetection,
      staticRoutePrefixes,
    );

    if (entry) {
      entries[route.entryName] = entry;
    }
  }

  return Object.keys(entries).length > 0 ? { entries } : undefined;
};
