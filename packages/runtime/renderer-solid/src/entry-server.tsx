import type { LocalisedUrlsOption } from '@modern-js/i18n-runtime-extensions/paths';
import {
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
import {
  componentView,
  routerView,
  solidRouterFactory,
} from './entry-application';
import { validateSolidModuleManifest } from './manifest';
import { getApplicationStatus, resolveApplicationRedirect } from './router';
import { prepareRouterMatchTransfer } from './router-binding/index';
import {
  renderCSRDocument,
  renderDocumentApplication,
  respondApplicationResponse,
  runApplicationRequest,
} from './server';

export type SolidServerEntryOptions = NativeServerEntryOptions<
  NativeI18nInstance,
  LocalisedUrlsOption
>;

/** The native transport handlers of a generated Solid server entry. */
export function createNativeServerEntry(
  options: SolidServerEntryOptions,
): NativeServerEntry {
  return createServerEntry(options, {
    document: (document, nativeManifest, identity) => ({
      ...document,
      renderId: document.documentId,
      manifest: validateSolidModuleManifest(nativeManifest, identity).modules,
    }),
    run: (session, callback) => runApplicationRequest(session, callback),
    respond: respondApplicationResponse,
    createRouter: (application, routerOptions) =>
      createNativeRouter(application, routerOptions, solidRouterFactory),
    renderCSR: ({ session }, document) =>
      renderCSRDocument({ session, document }),
    renderComponent: ({ session }, component, document, i18n) =>
      renderDocumentApplication({
        session,
        view: componentView(component, i18n),
        document,
        federation: options.federation,
      }),
    async renderRoutes({
      context: { session },
      router,
      outcomes,
      document,
      forbiddenValues,
      i18n,
    }) {
      await router.load();
      prepareRouterMatchTransfer(router, session, forbiddenValues);
      const metadata = mergeDataResponseMetadata(outcomes, {
        status: getApplicationStatus(router),
      });
      const redirect = resolveApplicationRedirect(router);
      if (redirect)
        return respondApplicationResponse(
          session,
          mergeDataResponseIntoResponse(redirect, metadata),
        );
      session.resolveResponse(dataMetadataToDocumentPolicy(metadata));
      return renderDocumentApplication({
        session,
        view: routerView(router, i18n),
        document,
        federation: options.federation,
      });
    },
  });
}
