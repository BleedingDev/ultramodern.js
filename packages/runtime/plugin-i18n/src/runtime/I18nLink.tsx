import type React from 'react';
import { useModernI18n } from './context';
import { useI18nRouterAdapter } from './routerAdapter';
import { buildLocalizedUrl } from './utils';

export interface I18nLinkProps {
  to: string;
  children: React.ReactNode;
  [key: string]: any;
}

/**
 * I18nLink component that automatically adds language prefix to navigation links.
 * This component should be used within a :lang dynamic route context.
 *
 * @example
 * ```tsx
 * // When current language is 'en' and to="/about"
 * // The actual link will be "/en/about"
 * <I18nLink to="/about">About</I18nLink>
 *
 * // When current language is 'zh' and to="/"
 * // The actual link will be "/zh"
 * <I18nLink to="/">Home</I18nLink>
 * ```
 */
export const I18nLink: React.FC<I18nLinkProps> = ({
  to,
  children,
  ...props
}) => {
  const { Link, params, hasRouter } = useI18nRouterAdapter();
  const { language, supportedLanguages, localisedUrls } = useModernI18n();

  // Get the current language from context (which reflects the actual current language)
  // URL params might be stale after language changes, so we prioritize the context language
  const currentLang = language;

  // Build the localized URL by adding language prefix
  const localizedTo = buildLocalizedUrl(
    to,
    currentLang,
    supportedLanguages,
    localisedUrls,
  );

  // In development mode, warn if used outside of :lang route context
  if (process.env.NODE_ENV === 'development' && hasRouter && !params.lang) {
    console.warn(
      'I18nLink is being used outside of a :lang dynamic route context. ' +
        'This may cause unexpected behavior. Please ensure I18nLink is used within a route that has a :lang parameter.',
    );
  }

  if (!hasRouter || !Link) {
    return (
      <a href={localizedTo} {...props}>
        {children}
      </a>
    );
  }

  return (
    <Link to={localizedTo} {...props}>
      {children}
    </Link>
  );
};

export default I18nLink;
