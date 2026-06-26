import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function ProductsPage() {
  const { language, t } = useModernI18n();

  return (
    <section>
      <h1 id="products-heading">{t('products')}</h1>
      <p id="products-language">{language}</p>
    </section>
  );
}
