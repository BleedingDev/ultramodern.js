import { attributesToString } from './utils';

export const createFederatedCssLinks = (
  assets: string[] | undefined,
  options: {
    template: string;
    attributes?: Record<string, any>;
    existingAssets?: Iterable<string>;
  },
) => {
  if (assets === undefined || assets.length === 0) {
    return '';
  }

  const seen = new Set(options.existingAssets || []);
  const attributes = attributesToString(options.attributes || {});
  const links: string[] = [];

  for (const asset of assets) {
    if (asset === '' || seen.has(asset) || options.template.includes(asset)) {
      continue;
    }

    seen.add(asset);
    links.push(`<link${attributes} href="${asset}" rel="stylesheet" />`);
  }

  return links.join('');
};
