import { createHash } from 'node:crypto';
import { builtinModules, createRequire } from 'node:module';

import {
  type BackendFederationCommonJsEvaluator,
  type BackendFederationEntryIntegrity,
  BackendFederationRemoteEntryError,
} from './index';

const nodeRequire = createRequire(import.meta.url);
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map(name => `node:${name}`),
]);

const toBytes = (value: string | Uint8Array) =>
  typeof value === 'string' ? new TextEncoder().encode(value) : value;

export function createBackendFederationEntryIntegrity(
  value: string | Uint8Array,
): BackendFederationEntryIntegrity {
  const bytes = toBytes(value);
  return {
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export const evaluateNodeBackendFederationCommonJs: BackendFederationCommonJsEvaluator =
  (source, { remote }) => {
    const module = { exports: {} as Record<string, unknown> };
    const exports = module.exports;
    const requireBuiltin = (specifier: string) => {
      if (!nodeBuiltins.has(specifier)) {
        throw new BackendFederationRemoteEntryError(
          'unsupported_entry',
          `[Module Federation] Backend remote ${remote.name} attempted to require non-builtin module ${specifier}. Bundle package dependencies into the remote entry.`,
        );
      }
      return nodeRequire(specifier);
    };
    const evaluate = new Function(
      'module',
      'exports',
      'globalThis',
      'require',
      source,
    );
    evaluate(module, exports, globalThis, requireBuiltin);
    return module.exports;
  };
