import type React from 'react';
import { Link } from './Link';

export interface I18nLinkProps {
  to: string;
  children: React.ReactNode;
  [key: string]: any;
}

let warnedDeprecation = false;

/**
 * @deprecated Use {@link Link} from `@modern-js/plugin-i18n/runtime` instead.
 * `Link` accepts the same language-agnostic `to` values and additionally
 * supports `#hash`/`?query` targets, typed canonical routes, `params`
 * interpolation and language-invariant active state.
 */
export const I18nLink: React.FC<I18nLinkProps> = ({
  to,
  children,
  ...props
}) => {
  if (process.env.NODE_ENV === 'development' && !warnedDeprecation) {
    warnedDeprecation = true;
    console.warn(
      '[plugin-i18n] I18nLink is deprecated. Import { Link } from ' +
        "'@modern-js/plugin-i18n/runtime' instead — it accepts the same " +
        'language-agnostic `to` values.',
    );
  }

  return (
    <Link to={to} {...props}>
      {children}
    </Link>
  );
};

export default I18nLink;
