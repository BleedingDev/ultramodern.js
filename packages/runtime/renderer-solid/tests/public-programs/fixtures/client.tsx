import type { RendererIdentity } from '@bleedingdev/modern-js-renderer-core/identity';
import {
  type ApplicationMountElement,
  type ApplicationMountOptions,
  hydrateApplication,
  mountApplication,
  readSolidDocumentBootstrap,
  type SolidDocumentBootstrap,
} from '@bleedingdev/modern-js-renderer-solid/client';
import type { JSX } from '@solidjs/web';
import { createSignal } from 'solid-js';

export function clientPublicProgram(
  element: ApplicationMountElement,
  document: Document,
  identity: RendererIdentity,
  hot: NonNullable<ApplicationMountOptions['hot']>,
): { dispose: () => void; bootstrap: SolidDocumentBootstrap } {
  function Counter(): JSX.Element {
    const [count, setCount] = createSignal(0);
    return (
      <button type="button" onClick={() => setCount(count() + 1)}>
        {count()}
      </button>
    );
  }
  const options: ApplicationMountOptions = {
    renderId: 'public-sdk-root',
    hot,
  };
  const disposeMounted: () => void = mountApplication(
    Counter,
    element,
    options,
  );
  disposeMounted();
  const bootstrap: SolidDocumentBootstrap = readSolidDocumentBootstrap(
    document,
    identity,
  );
  const dispose: () => void = hydrateApplication(Counter, element, {
    ...options,
    renderId: bootstrap.documentId,
  });
  return { dispose, bootstrap };
}
