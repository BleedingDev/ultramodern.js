import {
  applyImageLoader,
  DEFAULT_IPX_BASENAME,
  ipxImageLoader,
  PACKAGE_NAME,
} from '../src/shared/index.ts';

describe('@modern-js/image-core-extensions/shared', () => {
  it('preserves the @rsbuild-image/core public constants', () => {
    expect(PACKAGE_NAME).toBe('@rsbuild-image/core');
    expect(DEFAULT_IPX_BASENAME).toBe('/_rsbuild/ipx');
  });

  it('applies a custom loader with the public argument contract', () => {
    expect(
      applyImageLoader({
        loader: ({ quality, src, width }) =>
          `/custom/${width}/${quality}${src}`,
        quality: 72,
        src: '/tractor.png',
        width: 640,
      }),
    ).toBe('/custom/640/72/tractor.png');
  });

  it('builds the compatible IPX URL without Node-only imports', () => {
    expect(
      ipxImageLoader({
        quality: 80,
        src: '/images/tractor.png?theme=dark',
        width: 1280,
      }),
    ).toBe('/_rsbuild/ipx/f_auto,w_1280,q_80/images/tractor.png?theme=dark');
  });
});
