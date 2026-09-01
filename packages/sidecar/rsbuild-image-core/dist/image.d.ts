import type { AvifOptions, FormatEnum, GifOptions, HeifOptions, Jp2Options, JpegOptions, JxlOptions, OutputOptions, PngOptions, ResizeOptions, Sharp, TiffOptions, WebpOptions } from 'sharp';
export type SharpModule = typeof import('sharp');
export declare const loadSharp: () => Promise<typeof import("sharp")>;
/**
 * @param type - The type of the image.
 * @param orientation - The orientation of the image.
 *   1. Normal orientation
 *   2. Flipped horizontally
 *   3. Rotated 180 degrees
 *   4. Flipped vertically
 *   5. Rotated 90 degrees clockwise and flipped horizontally
 *   6. Rotated 90 degrees clockwise
 *   7. Rotated 90 degrees clockwise and flipped vertically
 *   8. Rotated 90 degrees counterclockwise
 * @returns Whether the image is rotated.
 */
export declare function isRotatedOrientation(type: string, orientation?: number): boolean;
export declare class Image {
    private buffer;
    private sharp;
    _debugName?: string;
    private constructor();
    static create(buf: Uint8Array): Promise<Image>;
    private _size?;
    size(): {
        width: number;
        height: number;
    };
    resize(options: ResizeOptions): Sharp;
    thumbnail(options: ResizeOptions): void;
    format(format: keyof FormatEnum, options?: OutputOptions | JpegOptions | PngOptions | WebpOptions | AvifOptions | HeifOptions | JxlOptions | GifOptions | Jp2Options | TiffOptions): this;
    toBuffer(): Promise<Buffer<ArrayBufferLike>>;
    clone(): Image;
}
