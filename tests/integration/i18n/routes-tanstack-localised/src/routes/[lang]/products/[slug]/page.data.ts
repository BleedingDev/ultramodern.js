import i18next from '../../../../i18n';

export type ProductData = {
  language: string;
  path: string;
  productLabel: string;
  slug: string;
};

export const loader = ({
  params,
  request,
}: {
  params: Record<string, string>;
  request: Request;
}) => {
  const language = params.lang || 'en';
  const slug = params.slug || '';

  return {
    language,
    path: new URL(request.url).pathname,
    productLabel: i18next.t('products', { lng: language }),
    slug,
  };
};
