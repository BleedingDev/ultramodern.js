import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function ProductsPage() {
  const { i18nInstance, language } = useModernI18n();

  return (
    <section>
      <h1 id="products-heading">{i18nInstance.t('products')}</h1>
      <p id="products-language">{language}</p>
    </section>
  );
}
