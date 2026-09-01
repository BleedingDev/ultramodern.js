declare module '*?image' {
  const imageModule: import('./shared').ImageModule;
  export default imageModule;
}

declare module '@rsbuild-image/core/types' {
  global {
    var __INTERNAL_RSBUILD_IMAGE_OPTIONS__:
      | import('./shared').ImageSerializableContext
      | undefined;
    var __RSBUILD_IMAGE_IPX_ASSET_PREFIX__: string | undefined;
    var IS_TEST: boolean;
  }
}
