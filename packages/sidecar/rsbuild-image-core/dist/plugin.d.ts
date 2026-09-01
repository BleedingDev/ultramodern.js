import type { RsbuildPlugin } from '@rsbuild/core';
import type { IPXOptions } from 'ipx';
import type { LoaderOptions } from './loader';
import type { ImageSerializableContext } from './shared';
export interface ExtendedIPXOptions extends Partial<IPXOptions> {
    assetPrefix?: string;
}
export interface PluginImageOptions extends ImageSerializableContext, LoaderOptions {
    /**
     * Enable the builtin IPX middleware.
     * It will mount a new route `/_rsbuild/ipx` to the development server.
     * The IPX middleware will be used to process images on the fly.
     *
     * Only take effects to the **development server**,
     * you need to setup a image according to your CDN in production.
     */
    ipx?: ExtendedIPXOptions;
}
export declare const pluginImage: (options?: PluginImageOptions) => RsbuildPlugin;
export default pluginImage;
