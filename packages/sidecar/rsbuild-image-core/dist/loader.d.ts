import type { Rspack } from '@rsbuild/core';
export interface LoaderOptions {
    /**
     * Whether to generate the thumbnail image from the original image.
     *
     * Will be exported as a optional field of an {@link ImageModule}
     * for rendering placeholder at runtime.
     */
    thumbnail?: boolean;
}
export default function loader(this: Rspack.LoaderContext, content: Buffer): void;
export declare const raw = true;
