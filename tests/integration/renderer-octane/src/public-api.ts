// Type-only use of the public client, server and manifest entries. The build
// never loads this file; the fixture typecheck checks it against the packed
// declarations, which the routes alone do not reach.
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import {
  createRequestSession,
  type RequestSession,
} from '@modern-js/renderer-core/session';
import {
  hydrateOctaneApplication,
  mountOctaneApplication,
  type OctaneApplicationHandle,
  type OctaneApplicationOptions,
  readOctaneDocumentBootstrap,
} from '@modern-js/renderer-octane/client';
import {
  type OctaneModuleManifest,
  octaneModuleManifestFileName,
  validateOctaneModuleManifest,
} from '@modern-js/renderer-octane/manifest';
import {
  type RenderOctaneApplicationOptions,
  renderOctaneApplication,
  renderOctaneCSRDocument,
} from '@modern-js/renderer-octane/server';
import type { ComponentBody } from 'octane';
import { createElement } from 'octane/server';

const identity: RendererIdentity = {
  renderer: 'octane',
  appId: 'public-api',
  entryName: 'index',
  protocolVersion: 1,
  buildId: 'public-api-build',
};

const View: ComponentBody<{ label: string }> = _props => null;

export function startClient(
  container: HTMLElement,
  nativeHydrationBuildId: string,
): Promise<OctaneApplicationHandle> {
  const options: OctaneApplicationOptions = {
    container,
    identity,
    nativeHydrationBuildId,
    load: async () => ({ default: View, props: { label: 'Public API' } }),
  };
  if (!document.getElementById('__ULTRAMODERN_RENDERER__'))
    return mountOctaneApplication(options);
  const bootstrap = readOctaneDocumentBootstrap(
    document,
    identity,
    nativeHydrationBuildId,
  );
  return hydrateOctaneApplication({
    ...options,
    documentIdentity: bootstrap.identity,
    documentNativeHydrationBuildId: bootstrap.nativeHydrationBuildId,
    documentId: bootstrap.documentId,
  });
}

export function renderServer(
  request: Request,
  csr: boolean,
): Promise<Response> {
  const session: RequestSession<{ label: string }> = createRequestSession({
    request,
    identity,
    platform: { kind: 'node', bindings: { label: 'Public API' } },
  });
  const document = {
    documentId: 'public-api-document',
    nativeHydrationBuildId: 'public-api-client',
    rootId: 'root',
  };
  if (csr) return renderOctaneCSRDocument({ session, document });
  const options: RenderOctaneApplicationOptions<{ label: string }> = {
    session,
    document,
    App: createElement((_props: { label: string }) => null, {
      label: session.platform.bindings.label,
    }),
    resolveResponse: () => ({
      kind: 'document',
      status: 200,
      headers: [['content-type', 'text/html; charset=utf-8']],
      cache: { mode: 'no-store' },
    }),
  };
  return renderOctaneApplication(options);
}

export function readManifest(value: unknown): {
  manifest: OctaneModuleManifest;
  filename: string;
} {
  return {
    manifest: validateOctaneModuleManifest(value, identity),
    filename: octaneModuleManifestFileName(identity.entryName),
  };
}
