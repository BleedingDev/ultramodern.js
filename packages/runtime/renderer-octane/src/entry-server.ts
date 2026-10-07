import type { LocalisedUrlsOption } from '@modern-js/i18n-runtime-extensions/paths';
import {
  collectDataHeaders,
  dataMetadataToDocumentPolicy,
  mergeDataResponseIntoResponse,
  mergeDataResponseMetadata,
} from '@modern-js/renderer-core/data';
import {
  createNativeServerEntry as createServerEntry,
  type NativeI18nInstance,
  type NativeServerEntry,
  type NativeServerEntryOptions,
} from '@modern-js/renderer-core/entry-server';
import { createNativeRouter } from '@modern-js/renderer-core/router';
import type { ServerRenderNode } from 'octane/server';
import { localizedRouterRoot, octaneRouterFactory } from './entry-application';
import { validateOctaneModuleManifest } from './manifest';
import {
  createOctaneRequestHandler,
  createOctaneRouterInjection,
  createSsrStreamResponse,
  OctaneRouterServer,
} from './router-server';
import { renderOctaneApplication, renderOctaneCSRDocument } from './server';

export type OctaneServerEntryOptions = NativeServerEntryOptions<
  NativeI18nInstance,
  LocalisedUrlsOption
>;

const LocalizedRouterServer = localizedRouterRoot(OctaneRouterServer);

/** The native transport handlers of a generated Octane server entry. */
export function createNativeServerEntry(
  options: OctaneServerEntryOptions,
): NativeServerEntry {
  return createServerEntry(options, {
    document: (document, nativeManifest, identity) => ({
      ...document,
      nativeHydrationBuildId: validateOctaneModuleManifest(
        nativeManifest,
        identity,
      ).nativeHydrationBuildId,
    }),
    run: (_session, callback) => callback(),
    respond: (_session, response) => response,
    createRouter: (application, routerOptions) =>
      createNativeRouter(application, routerOptions, octaneRouterFactory),
    renderCSR: ({ session }, document) =>
      renderOctaneCSRDocument({ session, document }),
    renderComponent: ({ session }, component, document) =>
      renderOctaneApplication({
        session,
        App: component as ServerRenderNode,
        document,
      }),
    async renderRoutes({
      request,
      context: { session },
      router,
      outcomes,
      document,
      forbiddenValues,
      i18n,
    }) {
      const response = await createOctaneRequestHandler({
        request,
        session,
        createRouter: () => router,
        serialization: { forbiddenValues },
      })(async ({ router, responseHeaders }) => {
        const metadata = mergeDataResponseMetadata(outcomes, {
          status: router.state.statusCode ?? 200,
        });
        session.resolveResponse(
          dataMetadataToDocumentPolicy({
            ...metadata,
            headers: [
              ...collectDataHeaders(responseHeaders),
              ...metadata.headers,
            ],
          }),
        );
        const rendered = await renderOctaneApplication({
          session,
          ...(i18n
            ? {
                App: LocalizedRouterServer as ServerRenderNode,
                props: { router, i18n },
              }
            : {
                App: OctaneRouterServer as ServerRenderNode,
                props: { router },
              }),
          document,
          injection: createOctaneRouterInjection(router, session),
        });
        return createSsrStreamResponse(router, rendered);
      });
      return session.committedPolicy
        ? response
        : mergeDataResponseIntoResponse(
            response,
            mergeDataResponseMetadata(outcomes, { status: response.status }),
          );
    },
  });
}
