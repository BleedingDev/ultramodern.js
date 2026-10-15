import type {
  ServerGlobalVars,
  ServerGlobalVarsContext,
  ServerSourceConfigExtension,
} from '@modern-js/runtime-extensions/server-config';
import { applyOptionsChain } from '@modern-js/utils';

export type ServerGlobalVarsOptions = ServerSourceConfigExtension['globalVars'];

/** Each global name mapped to the JSON source text that replaces it. */
export type SerializedServerGlobalVars = Record<string, string>;

/**
 * Resolves `source.globalVars` for BFF server code and serializes every value
 * to the JSON text that replaces it. Dev source loading and build output use
 * this one function, so both see the same values. A value without an exact
 * JSON form (such as `undefined`, a function or a BigInt) is rejected.
 */
export const serializeServerGlobalVars = (
  options: ServerGlobalVarsOptions,
): SerializedServerGlobalVars => {
  const globalVars = applyOptionsChain<
    ServerGlobalVars,
    ServerGlobalVarsContext
  >({}, options, { env: 'server', target: 'node' });

  return Object.fromEntries(
    Object.entries(globalVars).map(([key, value]) => {
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(value);
      } catch (error) {
        throw new Error(
          `source.globalVars["${key}"] cannot be serialized exactly for BFF server code.`,
          { cause: error },
        );
      }
      if (serialized === undefined) {
        throw new Error(
          `source.globalVars["${key}"] cannot be serialized exactly for BFF server code.`,
        );
      }
      return [key, serialized];
    }),
  );
};
