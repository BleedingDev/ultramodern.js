import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useLocation } from '@modern-js/plugin-tanstack/runtime';
import type { ReactNode } from 'react';
import BoundaryOverlay from './boundary-overlay';
import { Footer, Header, MiniCart } from './vertical-components';
import { ultramodernLocalisedUrls } from './ultramodern-route-metadata';

const supportedLanguages = ['en', 'cs'] as const;
type SupportedLanguage = (typeof supportedLanguages)[number];

interface ShellFrameProps {
  boundary?: 'checkout' | 'decide' | 'explore';
  children: ReactNode;
  showCart?: boolean;
}

const localisedUrls = ultramodernLocalisedUrls as Record<string, Record<SupportedLanguage, string>>;

const isSupportedLanguage = (value: string): value is SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage);

const normalisePath = (pathname: string) => {
  const normalised = pathname.replace(/\/+$/u, '').replaceAll(/\/+/gu, '/');
  return normalised.length > 0 ? normalised : '/';
};

const stripLanguagePrefix = (pathname: string) => {
  const segments = normalisePath(pathname).split('/').filter(Boolean);
  if (segments.length > 0 && isSupportedLanguage(segments[0] ?? '')) {
    segments.shift();
  }
  return `/${segments.join('/')}`;
};

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const paramName = (segment: string) => segment.slice(1).replace(/\?$/u, '');

const matchPattern = (pathname: string, pattern: string) => {
  const names: string[] = [];
  const source = normalisePath(pattern)
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(':')) {
        names.push(paramName(segment));
        return segment.endsWith('?') ? '(?:/([^/]+))?' : '/([^/]+)';
      }
      return `/${escapeRegExp(segment)}`;
    })
    .join('');
  const match = new RegExp(`^${source || '/'}$`, 'u').exec(normalisePath(pathname));

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
    .map((segment) => {
      if (!segment.startsWith(':')) {
        return segment;
      }
      const value = params[paramName(segment)];
      return value !== undefined && value.length > 0 ? encodeURIComponent(value) : '';
    })
    .filter(Boolean)
    .join('/');

  return `/${path}`;
};

const resolveLocalisedPath = (pathname: string, targetLanguage: SupportedLanguage) => {
  const pathWithoutLanguage = stripLanguagePrefix(pathname);

  for (const entry of Object.values(localisedUrls)) {
    const targetPattern = entry[targetLanguage];
    if (targetPattern === undefined || targetPattern.length === 0) {
      continue;
    }

    for (const language of supportedLanguages) {
      const sourcePattern = entry[language];
      if (sourcePattern === undefined || sourcePattern.length === 0) {
        continue;
      }
      const params = matchPattern(pathWithoutLanguage, sourcePattern);
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

const locationSuffix = (location: { hash?: unknown; search?: unknown; searchStr?: unknown }) => {
  let locationSearch = '';
  if (typeof location.searchStr === 'string') {
    locationSearch = location.searchStr;
  } else if (typeof location.search === 'string') {
    locationSearch = location.search;
  }
  const locationHash = typeof location.hash === 'string' ? location.hash : '';

  return `${locationSearch}${locationHash}`;
};

export default function ShellFrame({ children, showCart = true }: ShellFrameProps) {
  const { language, t } = useModernI18n();
  const location = useLocation();
  const suffix = locationSuffix(location);

  return (
    <main className="shell:min-h-screen shell:bg-white shell:py-4 shell:font-[Raleway,Helvetica,Arial,sans-serif] shell:text-stone-950">
      <div className="shell:mx-auto shell:max-w-[calc(1000px+var(--outer-space)*2)] shell:overflow-hidden shell:pb-[30px]">
        <div className="shell:flex shell:min-h-[135px] shell:flex-col shell:items-start shell:gap-4 shell:border-b shell:border-[#eeebe2] shell:bg-white shell:px-[var(--outer-space)] shell:py-3 shell:shadow-[0_0_20px_10px_rgba(235,91,89,0.12)] shell:mix-blend-darken shell:min-[1000px]:flex-row shell:min-[1000px]:flex-wrap shell:min-[1000px]:items-center shell:min-[1000px]:justify-between shell:min-[1000px]:max-[1099px]:px-0">
          <Header />
          <div className="shell:flex shell:min-w-0 shell:flex-wrap shell:items-center shell:gap-4 shell:md:ml-auto">
            <label className="shell:sr-only" htmlFor="ultramodern-language">
              {t('shell.language.switcher')}
            </label>
            <select
              aria-label={t('shell.language.switcher')}
              className="shell:h-11 shell:w-11 shell:cursor-pointer shell:appearance-none shell:border-0 shell:bg-transparent shell:p-0 shell:text-center shell:text-[2rem] shell:font-black shell:leading-none shell:text-stone-950 shell:shadow-none shell:[appearance:base-select] shell:[text-align-last:center] shell:focus-visible:outline shell:focus-visible:outline-2 shell:focus-visible:outline-offset-4 shell:focus-visible:outline-[#ff5a55] shell:[&::-ms-expand]:hidden shell:[&::picker-icon]:hidden shell:[&_option]:text-xl"
              id="ultramodern-language"
              name="language"
              onChange={(event) => {
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
            {showCart ? <MiniCart /> : null}
          </div>
        </div>
      </div>
      <BoundaryOverlay />
      {children}
      <Footer />
    </main>
  );
}
