import { I18nLink, Link } from '@modern-js/plugin-i18n/runtime';

export default function LinkProbePage() {
  return (
    <div id="link-probe">
      <I18nLink to="/terms-of-service" data-testid="i18n-terms">
        terms
      </I18nLink>
      <Link to="/#work-with-me" data-testid="hash-cta">
        work with me
      </Link>
      <Link
        to="/products/$slug"
        params={{ slug: 'bota' }}
        data-testid="typed-product"
      >
        product bota
      </Link>
      <Link to="/terms-of-service" data-testid="nav-terms">
        terms of service
      </Link>
    </div>
  );
}
