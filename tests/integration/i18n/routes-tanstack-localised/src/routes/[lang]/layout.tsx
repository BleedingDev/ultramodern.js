import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { Link, Outlet } from '@modern-js/plugin-tanstack/runtime';

export default function LanguageLayout() {
  const { language, changeLanguage } = useModernI18n();

  return (
    <div id="localised-layout">
      <div id="current-language">{language}</div>
      <nav>
        <Link
          to={'/$lang/products/$slug' as any}
          params={{ lang: 'en', slug: 'shoe' } as any}
          data-testid="tanstack-en-product"
        >
          en product
        </Link>
        <Link
          to={'/$lang/produkty/$slug' as any}
          params={{ lang: 'cs', slug: 'bota' } as any}
          data-testid="tanstack-cs-product"
        >
          cs product
        </Link>
        <Link
          to={'/$lang/volitelne/{-$slug}' as any}
          params={{ lang: 'cs', slug: 'lehke' } as any}
          data-testid="tanstack-cs-optional"
        >
          cs optional
        </Link>
        <Link
          to={'/$lang/odkaz-probe' as any}
          params={{ lang: 'cs' } as any}
          data-testid="tanstack-cs-link-probe"
        >
          i18n link probe
        </Link>
        <button
          type="button"
          data-testid="switch-cs"
          onClick={() => {
            void changeLanguage('cs');
          }}
        >
          cs
        </button>
        <button
          type="button"
          data-testid="switch-en"
          onClick={() => {
            void changeLanguage('en');
          }}
        >
          en
        </button>
      </nav>
      <Outlet />
    </div>
  );
}
