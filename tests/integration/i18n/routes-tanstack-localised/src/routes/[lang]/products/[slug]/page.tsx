import { useMatches } from '@modern-js/plugin-tanstack/runtime';
import type { ProductData } from './page.data';

const useCurrentLoaderData = <T,>() => {
  const matches = useMatches() as Array<{ loaderData?: unknown }>;
  return matches[matches.length - 1]?.loaderData as T;
};

export default function ProductPage() {
  const data = useCurrentLoaderData<ProductData>();

  return (
    <main>
      <div id="product">
        product:{data.language}:{data.slug}:{data.productLabel}
      </div>
      <div id="product-path">path:{data.path}</div>
    </main>
  );
}
