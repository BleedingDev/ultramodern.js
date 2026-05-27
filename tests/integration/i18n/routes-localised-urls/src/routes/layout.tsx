import { I18nLink, useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { Outlet } from '@modern-js/runtime/router';

export default function Layout() {
  const { changeLanguage, language } = useModernI18n();

  return (
    <main>
      <nav>
        <span id="active-language">{language}</span>
        <button id="en-button" onClick={() => changeLanguage('en')}>
          en
        </button>
        <button id="cs-button" onClick={() => changeLanguage('cs')}>
          cs
        </button>
        <I18nLink id="about-link" to="/about">
          about
        </I18nLink>
        <I18nLink id="products-link" to="/products">
          products
        </I18nLink>
        <I18nLink id="featured-product-link" to="/products/red-shoe">
          featured product
        </I18nLink>
      </nav>
      <Outlet />
    </main>
  );
}
