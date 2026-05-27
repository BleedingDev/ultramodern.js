import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useLoaderData } from '@modern-js/runtime/router';
import type { ProductData } from './page.data';

export default function ProductPage() {
  const { i18nInstance, language } = useModernI18n();
  const product = useLoaderData() as ProductData;

  return (
    <section>
      <h1 id="product-heading">{i18nInstance.t('product')}</h1>
      <p id="product-language">{language}</p>
      <p id="loader-language">{product.language}</p>
      <p id="product-slug">{product.slug}</p>
      <p id="product-name">{product.name}</p>
    </section>
  );
}
