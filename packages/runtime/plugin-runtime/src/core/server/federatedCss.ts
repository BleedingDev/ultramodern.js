import { attributesToString } from './utils';

const escapeHtmlAttribute = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

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
    const href = escapeHtmlAttribute(asset);
    if (
      asset === '' ||
      seen.has(asset) ||
      options.template.includes(asset) ||
      options.template.includes(href)
    ) {
      continue;
    }

    seen.add(asset);
    links.push(`<link${attributes} href="${href}" rel="stylesheet" />`);
  }

  return links.join('');
};
