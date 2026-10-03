import type { renderToStream } from '@solidjs/web';
import type { AnyRouter } from '@tanstack/router-core';
import { makeSsrSerovalPlugin } from '@tanstack/router-core/ssr/server';
import clientAssetsManifest from './clientAssetsManifest';

export type SolidRenderOptions = NonNullable<
  Parameters<typeof renderToStream>[1]
>;

/** Native Solid options shared by the stream and string renderers. */
export function getSolidRenderOptions(
  router: AnyRouter,
  manifest?: SolidRenderOptions['manifest'],
): SolidRenderOptions {
  return {
    nonce: router.options.ssr?.nonce,
    plugins: router.options.serializationAdapters?.map(adapter =>
      makeSsrSerovalPlugin(adapter),
    ),
    manifest: manifest ?? clientAssetsManifest,
  };
}
