import { fileReader } from '@modern-js/runtime-utils/fileReader';
import type { ServerPluginHooks } from '@modern-js/server-core';

const cleanSSRCache = (distDir: string) => {
  Object.keys(require.cache).forEach(key => {
    if (key.startsWith(distDir)) {
      delete require.cache[key];
    }
  });
};

type FederationRuntimeGlobal = typeof globalThis & {
  __FEDERATION__?: {
    __INSTANCES__: {
      moduleCache: Map<string, { remoteInfo: { entryGlobalName?: string } }>;
    }[];
    __SHARE__: Record<string, unknown>;
    __GLOBAL_PLUGIN__: unknown[];
    moduleInfo: Record<string, unknown>;
    __MANIFEST_LOADING__: Record<string, unknown>;
    __PRELOADED_ASSETS__?: Set<string>;
  };
  __GLOBAL_LOADING_REMOTE_ENTRY__?: Record<string, unknown>;
};

/**
 * Module Federation SSR bundles keep their runtime on `globalThis`: the
 * containers they `init()`, the share scopes holding the singletons they
 * loaded (react, @modern-js/runtime, router plugins, ...) and the remote
 * entries they fetched. Clearing the require cache alone leaves that runtime
 * behind, so the re-required bundle joins the previous generation's container
 * and consumes its singletons while its unshared modules are fresh. React
 * contexts then split across generations and SSR renders a stale tree.
 * Reset the runtime together with the require cache, as Module Federation's
 * Node hot reload does, so the next request starts one consistent generation.
 */
const cleanFederationRuntime = () => {
  const runtime = globalThis as FederationRuntimeGlobal;
  const federation = runtime.__FEDERATION__;
  if (!federation) {
    return;
  }

  for (const instance of federation.__INSTANCES__) {
    instance.moduleCache.forEach(({ remoteInfo }) => {
      if (remoteInfo.entryGlobalName) {
        delete runtime[remoteInfo.entryGlobalName as keyof typeof runtime];
      }
    });
  }
  federation.__INSTANCES__ = [];
  federation.__SHARE__ = {};
  federation.__GLOBAL_PLUGIN__ = [];
  federation.moduleInfo = {};
  federation.__MANIFEST_LOADING__ = {};
  federation.__PRELOADED_ASSETS__?.clear();

  const remoteEntries = runtime.__GLOBAL_LOADING_REMOTE_ENTRY__ ?? {};
  for (const key of Object.keys(remoteEntries)) {
    delete remoteEntries[key];
  }
};

/**
 * Reset the dev server after the server bundle is rebuilt.
 *
 * Contract: the `onReset({ event: { type: 'repack' } })` handlers run in
 * registration order and are awaited before the previous generation is purged.
 * The caller holds new requests until this promise settles, so no request
 * re-requires the bundle while a handler is still running. As with every async
 * server hook, a rejecting handler skips the handlers after it; the generation
 * is still purged and the promise rejects with that error.
 */
export const onRepack = async (distDir: string, hooks: ServerPluginHooks) => {
  try {
    await hooks.onReset.call({
      event: {
        type: 'repack',
      },
    });
  } finally {
    cleanSSRCache(distDir);
    cleanFederationRuntime();
    fileReader.reset();
  }
};
