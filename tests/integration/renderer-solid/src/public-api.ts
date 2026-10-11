// Type-only use of the public client, server and manifest entries. The build
// never loads this file; the fixture typecheck checks it against the packed
// declarations, which the routes alone do not reach.
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import {
  createRequestSession,
  type RequestSession,
} from '@modern-js/renderer-core/session';
import {
  type ApplicationMountOptions,
  hydrateApplication,
  mountApplication,
  readSolidDocumentBootstrap,
  type SolidDocumentBootstrap,
} from '@modern-js/renderer-solid/client';
import {
  type SolidModuleManifest,
  solidModuleManifestFilename,
  validateSolidModuleManifest,
} from '@modern-js/renderer-solid/manifest';
import {
  renderCSRDocument,
  renderDocumentApplication,
  runApplicationRequest,
  type SolidDocumentRenderOptions,
} from '@modern-js/renderer-solid/server';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'public-api',
  entryName: 'index',
  protocolVersion: 1,
  buildId: 'public-api-build',
};

export function startClient(
  element: HTMLElement,
  hot: ApplicationMountOptions['hot'],
): () => void {
  const bootstrap: SolidDocumentBootstrap = readSolidDocumentBootstrap(
    document,
    identity,
  );
  const start = bootstrap.hydrating ? hydrateApplication : mountApplication;
  return start(() => 'Public API view', element, {
    renderId: bootstrap.documentId,
    hot,
  });
}

export function renderServer(
  request: Request,
  csr: boolean,
): Promise<Response> {
  const session: RequestSession<{ tenant: string }> = createRequestSession({
    request,
    identity,
    platform: { kind: 'node', bindings: { tenant: 'public' } },
  });
  const options: SolidDocumentRenderOptions<{ tenant: string }> = {
    session,
    view: () => session.platform.bindings.tenant,
    document: { rootId: 'root', lang: 'en', renderId: 'public-api:' },
  };
  return runApplicationRequest(session, () =>
    csr ? renderCSRDocument(options) : renderDocumentApplication(options),
  );
}

export function readManifest(value: unknown): {
  manifest: SolidModuleManifest;
  filename: string;
} {
  return {
    manifest: validateSolidModuleManifest(value, identity),
    filename: solidModuleManifestFilename(identity.entryName),
  };
}
