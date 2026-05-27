export interface ProductData {
  language: string;
  slug: string;
  name: string;
}

const products: Record<string, string> = {
  'red-shoe': 'Red Shoe',
  'blue-hat': 'Blue Hat',
};

export const loader = async ({ params }: any): Promise<ProductData> => {
  const slug = params.slug || 'missing-slug';

  return {
    language: params.lang || 'en',
    slug,
    name: products[slug] || `Unknown product: ${slug}`,
  };
};
