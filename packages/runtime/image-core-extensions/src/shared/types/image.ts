import type { CSSProperties, SyntheticEvent } from 'react';

export interface ImageSize {
  width: number;
  height: number;
}

export interface ImageResource extends ImageSize {
  url: string;
}

export interface ImageModule extends ImageResource {
  thumbnail?: ImageResource;
}

export interface ImageLoaderArgs
  extends Pick<ImageProps, 'src' | 'quality' | 'width'> {
  src: string;
  quality: number;
  width: number;
}

export type ImageLoader = (args: ImageLoaderArgs) => string;

export interface ImageContext {
  loader?: ImageLoader;
  quality?: number;
  loading?: 'lazy' | 'eager';
  densities?: number[];
  placeholder?: 'blur' | (string & {}) | false;
  suppressSrcWarn?: boolean;
}

export interface ImageSerializableContext extends Omit<ImageContext, 'loader'> {
  loader?: string;
}

export interface ImageOptions extends Omit<ImageContext, 'loading'> {
  src: string | ImageModule;
  width?: number;
  height?: number;
  unoptimized?: boolean;
}

export interface ImageProps extends ImageOptions, ImageContext {
  fill?: boolean;
  priority?: boolean;
  alt?: string;
  sizes?: string;
  style?: CSSProperties;
  overrideSrc?: string;
  onLoadingComplete?: (img: HTMLImageElement) => void;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
}
