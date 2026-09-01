import type { ImageLoader, ImageLoaderArgs } from './types/image';
export interface ApplyLoaderOptions extends ImageLoaderArgs {
    loader: ImageLoader;
}
export declare function applyImageLoader(options: ApplyLoaderOptions): string;
export declare const ipxImageLoader: ImageLoader;
export default ipxImageLoader;
