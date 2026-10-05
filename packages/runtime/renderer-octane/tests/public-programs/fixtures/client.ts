import {
  hydrateOctaneApplication,
  mountOctaneApplication,
  OCTANE_BOOTSTRAP_ID,
  type OctaneApplicationHandle,
  type OctaneApplicationModule,
  type OctaneApplicationOptions,
  type OctaneDocumentBootstrap,
  type OctaneHydrationOptions,
  readOctaneDocumentBootstrap,
} from '@bleedingdev/modern-js-renderer-octane/client';
import type { ComponentBody, Root } from 'octane';

export async function clientPublicProgram(
  container: HTMLElement,
  nativeHydrationBuildId: string,
): Promise<{
  handle: OctaneApplicationHandle;
  bootstrap: OctaneDocumentBootstrap;
  bootstrapId: string;
}> {
  const NativeApplication: ComponentBody<{ label: string }> = _props => null;
  const createApplication = (): OctaneApplicationModule => ({
    default: NativeApplication,
    props: { label: 'Native Octane application' },
    dispose() {},
  });
  const options: OctaneApplicationOptions = {
    container,
    identity: {
      renderer: 'octane',
      appId: 'public-sdk',
      entryName: 'main',
      protocolVersion: 1,
      buildId: 'source-profile-build',
    },
    nativeHydrationBuildId,
    signal: new AbortController().signal,
    load: async () => createApplication(),
    options: { identifierPrefix: 'public-sdk-' },
  };
  const mounted: OctaneApplicationHandle =
    await mountOctaneApplication(options);
  const root: Root = mounted.root;
  root.render(NativeApplication, { label: 'Native root compatibility' });
  mounted.update(createApplication());
  mounted.dispose();

  const bootstrap: OctaneDocumentBootstrap = readOctaneDocumentBootstrap(
    container.ownerDocument,
    options.identity,
    nativeHydrationBuildId,
  );
  const hydration: OctaneHydrationOptions = {
    ...options,
    documentIdentity: bootstrap.identity,
    documentNativeHydrationBuildId: bootstrap.nativeHydrationBuildId,
    documentId: bootstrap.documentId,
  };
  const handle: OctaneApplicationHandle =
    await hydrateOctaneApplication(hydration);
  return { handle, bootstrap, bootstrapId: OCTANE_BOOTSTRAP_ID };
}
