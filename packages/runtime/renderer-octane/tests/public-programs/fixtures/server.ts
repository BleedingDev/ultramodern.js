import {
  type OctaneDocumentOptions,
  type OctaneDocumentResponseOptions,
  type RenderOctaneApplicationOptions,
  renderOctaneApplication,
  renderOctaneCSRDocument,
} from '@bleedingdev/modern-js-renderer-octane/server';
import { createElement, type ServerRenderNode } from 'octane/server';

interface ServerBindings {
  requestLabel: string;
}

export function serverPublicProgram(
  session: OctaneDocumentResponseOptions<ServerBindings>['session'],
): Promise<Response> {
  const document: OctaneDocumentOptions = {
    documentId: 'public-sdk-document',
    nativeHydrationBuildId: 'native-client-compilation',
    rootId: 'public-sdk-root',
    lang: 'en',
    nonce: 'public-sdk-nonce',
  };
  const App: ServerRenderNode = createElement(
    (_props: { label: string }) => null,
    { label: session.platform.bindings.requestLabel },
  );
  const input: RenderOctaneApplicationOptions<ServerBindings> = {
    session,
    document,
    App,
    resolveResponse: current => ({
      kind: 'document',
      status: 200,
      headers: [
        ['content-type', 'text/html; charset=utf-8'],
        ['x-request-label', current.platform.bindings.requestLabel],
      ],
      cache: { mode: 'no-store' },
    }),
  };
  return renderOctaneApplication(input);
}

export function csrDocumentPublicProgram(
  session: OctaneDocumentResponseOptions<ServerBindings>['session'],
): Promise<Response> {
  const input: OctaneDocumentResponseOptions<ServerBindings> = {
    session,
    document: {
      documentId: 'public-sdk-csr-document',
      nativeHydrationBuildId: 'native-client-compilation',
    },
    responsePolicy: {
      kind: 'document',
      status: 200,
      headers: [['content-type', 'text/html; charset=utf-8']],
      cache: { mode: 'private' },
    },
  };
  return renderOctaneCSRDocument(input);
}
