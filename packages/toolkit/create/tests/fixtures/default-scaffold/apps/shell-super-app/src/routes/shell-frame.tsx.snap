import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useLocation } from '@modern-js/plugin-tanstack/runtime';
import type { ReactNode } from 'react';
import { Header, StatusBadge } from './vertical-components';
import { ultramodernLocalisedUrls } from './ultramodern-route-metadata';

const supportedLanguages = ['en', 'cs'] as const;
type SupportedLanguage = (typeof supportedLanguages)[number];

interface ShellFrameProps {
  children: ReactNode;
}

const localisedUrls = ultramodernLocalisedUrls as Record<
  string,
  Record<SupportedLanguage, string>
>;

const isSupportedLanguage = (value: string): value is SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage);

const normalisePath = (pathname: string) => {
  const normalised = pathname.replaceAll(/\/+/gu, '/').replace(/\/+$/u, '');
  return normalised.length > 0 ? normalised : '/';
};

const stripLanguagePrefix = (pathname: string) => {
  const segments = normalisePath(pathname).split('/').filter(Boolean);
  if (segments.length > 0 && isSupportedLanguage(segments[0] ?? '')) {
    segments.shift();
  }
  return `/${segments.join('/')}`;
};

const escapeRegExp = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const paramName = (segment: string) => segment.slice(1).replace(/\?$/u, '');

const matchPattern = (pathname: string, pattern: string) => {
  const names: string[] = [];
  const source = normalisePath(pattern)
    .split('/')
    .filter(Boolean)
    .map(segment => {
      if (segment.startsWith(':')) {
        names.push(paramName(segment));
        return segment.endsWith('?') ? '(?:/([^/]+))?' : '/([^/]+)';
      }
      return `/${escapeRegExp(segment)}`;
    })
    .join('');
  const match = new RegExp(`^${source || '/'}$`, 'u').exec(
    normalisePath(pathname),
  );

  if (match === null) {
    return;
  }

  const params: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    params[name] = decodeURIComponent(match[index + 1] ?? '');
  }
  return params;
};

const buildPath = (pattern: string, params: Record<string, string>) => {
  const path = normalisePath(pattern)
    .split('/')
    .filter(Boolean)
    .map(segment => {
      if (!segment.startsWith(':')) {
        return segment;
      }
      const value = params[paramName(segment)];
      return value !== undefined && value.length > 0
        ? encodeURIComponent(value)
        : '';
    })
    .filter(Boolean)
    .join('/');

  return `/${path}`;
};

const resolveLocalisedPath = (
  pathname: string,
  targetLanguage: SupportedLanguage,
) => {
  const pathWithoutLanguage = stripLanguagePrefix(pathname);

  for (const entry of Object.values(localisedUrls)) {
    const targetPattern = entry[targetLanguage];
    if (targetPattern === undefined) {
      continue;
    }

    for (const language of supportedLanguages) {
      const sourcePattern = entry[language];
      const params =
        sourcePattern === undefined
          ? undefined
          : matchPattern(pathWithoutLanguage, sourcePattern);
      if (params !== undefined) {
        return buildPath(targetPattern, params);
      }
    }
  }

  return pathWithoutLanguage;
};

const localizedPath = (pathname: string, language: SupportedLanguage) => {
  const pathWithoutLanguage = resolveLocalisedPath(pathname, language);
  return pathWithoutLanguage === '/' ? `/${language}` : `/${language}${pathWithoutLanguage}`;
};

const locationSuffix = (location: {
  hash?: unknown;
  search?: unknown;
  searchStr?: unknown;
}) => {
  let locationSearch = '';
  if (typeof location.searchStr === 'string') {
    locationSearch = location.searchStr;
  } else if (typeof location.search === 'string') {
    locationSearch = location.search;
  }
  const locationHash = typeof location.hash === 'string' ? location.hash : '';

  return `${locationSearch}${locationHash}`;
};

export default function ShellFrame({ children }: ShellFrameProps) {
  const { i18nInstance, language } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);
  const location = useLocation();
  const suffix = locationSuffix(location);

  return (
    <main className="shell:min-h-screen shell:bg-um-canvas shell:px-4 shell:py-5 shell:text-um-foreground shell:sm:px-6 shell:lg:px-12">
      <div className="shell:mx-auto shell:flex shell:min-h-20 shell:max-w-7xl shell:flex-col shell:items-start shell:gap-3 shell:bg-white/90 shell:px-4 shell:py-3 shell:shadow-xl shell:shadow-stone-900/10 shell:sm:px-6 shell:md:flex-row shell:md:flex-wrap shell:md:items-center shell:md:justify-between">
        <Header />
        <div className="shell:flex shell:min-w-0 shell:flex-wrap shell:items-center shell:gap-2 shell:md:ml-auto">
          <label className="shell:sr-only" htmlFor="ultramodern-language">
            {t('shell.language.switcher')}
          </label>
          <select
            aria-label={t('shell.language.switcher')}
            className="shell:h-10 shell:w-10 shell:cursor-pointer shell:appearance-none shell:border-0 shell:bg-transparent shell:p-0 shell:text-center shell:text-3xl shell:font-black shell:leading-none shell:text-stone-950 shell:shadow-none shell:[appearance:none] shell:[text-align-last:center] shell:focus-visible:rounded-md shell:focus-visible:outline-3 shell:focus-visible:outline-offset-2 shell:focus-visible:outline-emerald-700/40 shell:[&::-ms-expand]:hidden shell:[&::picker-icon]:hidden shell:[&_option]:text-xl"
            id="ultramodern-language"
            name="language"
            onChange={event => {
              const nextLanguage = event.currentTarget.value;
              if (isSupportedLanguage(nextLanguage)) {
                window.location.assign(
                  `${localizedPath(location.pathname, nextLanguage)}${suffix}`,
                );
              }
            }}
            value={language}
          >
            <option aria-label={t('shell.language.en')} value="en">
              🇬🇧
            </option>
            <option aria-label={t('shell.language.cs')} value="cs">
              🇨🇿
            </option>
          </select>
          <StatusBadge />
        </div>
      </div>
      {children}
    </main>
  );
}
