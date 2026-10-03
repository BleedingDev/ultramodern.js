import { parsePublicData } from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { assertRendererIdentity } from '@modern-js/renderer-core/identity';
import type { JSX } from '@solidjs/web';
import { hydrate, render } from '@solidjs/web';
import { runWithOwner } from 'solid-js';

type NativeMountOptions = NonNullable<Parameters<typeof hydrate>[2]>;
export type ApplicationMountElement = Parameters<typeof hydrate>[1];

export interface SolidDocumentBootstrap {
  identity: RendererIdentity;
  documentId: string;
  hydrating: boolean;
}

/** Read the server's exact identity before creating a native router or owner. */
export function readSolidDocumentBootstrap(
  document: Document,
  expectedIdentity: RendererIdentity,
): SolidDocumentBootstrap {
  const element = document.getElementById('__ULTRAMODERN_RENDERER__');
  if (!element || element.getAttribute('type') !== 'application/json') {
    throw new Error('The Solid document is missing its renderer identity');
  }
  const payload = parsePublicData(element.textContent ?? '');
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new Error('The Solid document has an invalid renderer identity');
  }
  const bootstrap = payload as SolidDocumentBootstrap;
  if (
    bootstrap.identity === null ||
    typeof bootstrap.identity !== 'object' ||
    typeof bootstrap.documentId !== 'string' ||
    bootstrap.documentId.length === 0 ||
    typeof bootstrap.hydrating !== 'boolean'
  ) {
    throw new Error('The Solid document has an invalid renderer identity');
  }
  assertRendererIdentity(bootstrap.identity, expectedIdentity);
  if (bootstrap.identity.renderer !== 'solid') {
    throw new Error('The Solid document requires a Solid renderer identity');
  }
  return bootstrap;
}

/** The generated entry passes its bundler's native HMR disposal callback. */
export interface ApplicationMountOptions {
  renderId?: NativeMountOptions['renderId'];
  onError?: NativeMountOptions['onError'];
  hot?: { dispose(callback: () => void): void };
}

interface ApplicationRoot {
  dispose: (() => void) | undefined;
  disposed: boolean;
}

const applications = new WeakMap<ApplicationMountElement, ApplicationRoot>();

function createApplication(
  view: () => JSX.Element,
  element: ApplicationMountElement,
  options: ApplicationMountOptions,
  hydrating: boolean,
): () => void {
  if (applications.has(element)) {
    throw new Error('A Solid application already owns this mount element');
  }

  const application: ApplicationRoot = { dispose: undefined, disposed: false };
  applications.set(element, application);

  const dispose = () => {
    if (application.disposed) return;
    application.disposed = true;
    try {
      application.dispose?.();
    } finally {
      if (applications.get(element) === application) {
        applications.delete(element);
      }
    }
  };

  try {
    const nativeOptions = {
      renderId: options.renderId,
      onError: options.onError,
    };
    // Each application gets an independent native owner. Do not inherit a
    // caller's component owner, including when mounting during a transition.
    application.dispose = runWithOwner(null, () =>
      hydrating
        ? hydrate(view, element, nativeOptions)
        : render(view, element, undefined, nativeOptions),
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
