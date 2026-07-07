// @effect-diagnostics asyncFunction:off globalFetch:off strictBooleanExpressions:off

import type { ModuleFederationRuntimePlugin } from '@module-federation/runtime';

import type {
  BackendFederationEntryExports,
  BackendFederationLoadEntryPlugin,
  BackendFederationRemote,
  BackendFederationRuntimeOptions,
} from './types';
import { isRecord, normalizeExpose } from './utils';

function decodeDataUrl(url: string) {
  const commaIndex = url.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('[BFF][Effect] Invalid backend federation data URL entry.');
  }
  return decodeURIComponent(url.slice(commaIndex + 1));
}

async function readCommonJsEntrySource(remote: BackendFederationRemote) {
  if (remote.entry.startsWith('data:')) {
    return decodeDataUrl(remote.entry);
  }

  if (
    remote.entry.startsWith('http://') ||
    remote.entry.startsWith('https://')
  ) {
    const response = await fetch(remote.entry);
    if (!response.ok) {
      throw new Error(
        `[BFF][Effect] Failed to load backend federation remote ${remote.name}: ${response.status}`,
      );
    }
    return response.text();
  }

  throw new Error(
    `[BFF][Effect] Backend federation remote ${remote.name} cannot load CommonJS entry ${remote.entry}.`,
  );
}

function evaluateCommonJsEntry(
  remote: BackendFederationRemote,
  source: string,
) {
  const module = { exports: {} as Record<string, unknown> };
  const exports = module.exports;
  const evaluate = new Function('module', 'exports', 'globalThis', source);
  evaluate(module, exports, globalThis);

  const entry = module.exports.default ?? module.exports;
  if (!isRecord(entry)) {
    throw new Error(
      `[BFF][Effect] Backend federation remote ${remote.name} entry must load object module.`,
    );
  }
  return entry as unknown as BackendFederationEntryExports;
}

async function importModuleEntry(remote: BackendFederationRemote) {
  const entry = await import(/* webpackIgnore: true */ remote.entry);
  return (entry.default ?? entry) as BackendFederationEntryExports;
}

async function resolvePluginEntry(
  remote: BackendFederationRemote,
  plugins: ModuleFederationRuntimePlugin[] | undefined,
) {
  for (const plugin of plugins ?? []) {
    const loadEntry = (plugin as BackendFederationLoadEntryPlugin).loadEntry;
    if (typeof loadEntry !== 'function') {
      continue;
    }
    const entry = await loadEntry({ remoteInfo: remote });
    if (entry) {
      return entry;
    }
  }
}

async function loadBackendFederationEntry(
  remote: BackendFederationRemote,
  plugins: ModuleFederationRuntimePlugin[] | undefined,
) {
  const pluginEntry = await resolvePluginEntry(remote, plugins);
  if (pluginEntry) {
    return pluginEntry;
  }

  if (remote.entryGlobalName) {
    const globalEntry = (globalThis as Record<string, unknown>)[
      remote.entryGlobalName
    ];
    if (isRecord(globalEntry)) {
      return globalEntry as unknown as BackendFederationEntryExports;
    }
  }

  if (remote.type === 'module' || remote.entry.startsWith('file:')) {
    return importModuleEntry(remote);
  }

  return evaluateCommonJsEntry(remote, await readCommonJsEntrySource(remote));
}

export async function loadBackendFederationExpose(
  remote: BackendFederationRemote,
  expose: string,
  options: BackendFederationRuntimeOptions,
) {
  const entry = await loadBackendFederationEntry(remote, options.plugins);
  if (typeof entry.init === 'function') {
    await entry.init({ hostName: options.hostName });
  }
  if (typeof entry.get !== 'function') {
    throw new Error(
      `[BFF][Effect] Backend federation remote ${remote.name} entry must expose get().`,
    );
  }
  const factory = await entry.get(expose);
  if (typeof factory !== 'function') {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${remote.name}/${normalizeExpose(
        expose,
      )} must load factory function.`,
    );
  }
  return factory();
}
