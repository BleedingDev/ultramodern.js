import {
  type DocumentBootstrap,
  readDocumentBootstrap,
} from '@modern-js/renderer-core/document';
import type { NativeFederationBinding } from '@modern-js/renderer-core/federation';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import type { JSX } from '@solidjs/web';
import { hydrate, render } from '@solidjs/web';
import { runWithOwner } from 'solid-js';
import { createFederationScope, provideFederation } from './federation-context';

type NativeMountOptions = NonNullable<Parameters<typeof hydrate>[2]>;
export type ApplicationMountElement = Parameters<typeof hydrate>[1];

export type SolidDocumentBootstrap = DocumentBootstrap;

/** Read the server's exact identity before creating a native router or owner. */
export function readSolidDocumentBootstrap(
  document: Document,
  expectedIdentity: RendererIdentity,
): SolidDocumentBootstrap {
  if (expectedIdentity.renderer !== 'solid') {
    throw new Error('The Solid document requires a Solid renderer identity');
  }
  const { identity, documentId, hydrating } = readDocumentBootstrap(
    document,
    expectedIdentity,
  );
  return { identity, documentId, hydrating };
}

/** The generated entry passes its bundler's native HMR disposal callback. */
export interface ApplicationMountOptions {
  renderId?: NativeMountOptions['renderId'];
  onError?: NativeMountOptions['onError'];
  hot?: { dispose(callback: () => void): void };
  /** This browser compilation's native Module Federation runtime. */
  federation?: NativeFederationBinding;
}

const applications = new WeakSet<ApplicationMountElement>();

function createApplication(
  view: () => JSX.Element,
  element: ApplicationMountElement,
  options: ApplicationMountOptions,
  hydrating: boolean,
): () => void {
  if (applications.has(element)) {
    throw new Error('A Solid application already owns this mount element');
  }

  let nativeDispose: (() => void) | undefined;
  let disposed = false;
  applications.add(element);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      nativeDispose?.();
    } finally {
      applications.delete(element);
    }
  };

  try {
    const nativeOptions = {
      renderId: options.renderId,
      onError: options.onError,
    };
    // Its federated components load through this application's own host.
    const root = provideFederation(
      createFederationScope(options.federation),
      view,
    );
    // Each application gets an independent native owner. Do not inherit a
    // caller's component owner, including when mounting during a transition.
    nativeDispose = runWithOwner(null, () =>
      hydrating
        ? hydrate(root, element, nativeOptions)
        : render(root, element, undefined, nativeOptions),
    );
    options.hot?.dispose(dispose);
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}

export function mountApplication(
  view: () => JSX.Element,
  element: ApplicationMountElement,
  options: ApplicationMountOptions = {},
): () => void {
  return createApplication(view, element, options, false);
}

export function hydrateApplication(
  view: () => JSX.Element,
  element: ApplicationMountElement,
  options: ApplicationMountOptions = {},
): () => void {
  return createApplication(view, element, options, true);
}
