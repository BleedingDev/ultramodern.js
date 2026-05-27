import { useMatch } from '@modern-js/plugin-tanstack/runtime';
import type { ProductData } from './page.data';

const useProductLoaderData = () => {
  const canonicalMatch = useMatch({
    from: '/$lang/products/$slug',
    shouldThrow: false,
  });
  const localisedMatch = useMatch({
    from: '/$lang/produkty/$slug',
    shouldThrow: false,
  });

  return (canonicalMatch?.loaderData ||
    localisedMatch?.loaderData) as ProductData;
};

export default function ProductPage() {
  const data = useProductLoaderData();

  return (
    <main>
      <div id="product">
        product:{data.language}:{data.slug}:{data.productLabel}
      </div>
      <div id="product-path">path:{data.path}</div>
    </main>
  );
}
