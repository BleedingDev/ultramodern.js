import { joinURL, parseURL, stringifyParsedURL } from 'ufo';
import { DEFAULT_IPX_BASENAME } from './constants';
import type { ImageLoader, ImageLoaderArgs } from './types/image';

export interface ApplyLoaderOptions extends ImageLoaderArgs {
  loader: ImageLoader;
}

export function applyImageLoader(options: ApplyLoaderOptions): string {
  const { loader, src, quality, width } = options;
  return loader({ src, quality, width });
}

let ipxImageLoaderBasename = DEFAULT_IPX_BASENAME;
if (typeof __RSBUILD_IMAGE_IPX_ASSET_PREFIX__ === 'string') {
  ipxImageLoaderBasename = __RSBUILD_IMAGE_IPX_ASSET_PREFIX__;
}

export const ipxImageLoader: ImageLoader = ({ src, width, quality }) => {
  const params = `f_auto,w_${width},q_${quality}`;
  const parsedSrc = parseURL(src);
  parsedSrc.pathname = joinURL(
    ipxImageLoaderBasename,
    params,
    parsedSrc.pathname,
  );
  return stringifyParsedURL(parsedSrc);
};

export default ipxImageLoader;
