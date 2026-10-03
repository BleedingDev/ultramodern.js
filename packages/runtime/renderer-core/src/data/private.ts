import { assertPublicData, DataProtocolError } from './codec';

export interface RequestDataPolicy {
  assertRoot(value: unknown): void;
  assertValue(value: unknown): void;
}

/** Capture aliases before callbacks, and retain them as request context changes. */
export function createRequestDataPolicy(
  roots: readonly unknown[],
): RequestDataPolicy {
  const references = new WeakSet<object>();
  const refresh = (): void => {
    const seen = new WeakSet<object>();
    let count = 0;
    const visit = (value: unknown, depth: number): void => {
      if (
        value === null ||
        (typeof value !== 'object' && typeof value !== 'function')
      )
        return;
      if (seen.has(value)) return;
      if (++count > 20_000 || depth > 100) {
        throw new DataProtocolError(
          'Private request context exceeds its size or depth limit',
        );
      }
      seen.add(value);
      references.add(value);
      // Context may hold opaque hosts or callables; owned data properties still
      // carry private identities, while accessors remain completely untouched.
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.get && !descriptor.set)
          visit(descriptor.value, depth + 1);
      }
      if (value instanceof Map) {
        for (const [key, entry] of Map.prototype.entries.call(value)) {
          visit(key, depth + 1);
          visit(entry, depth + 1);
        }
      } else if (value instanceof Set) {
        for (const entry of Set.prototype.values.call(value))
          visit(entry, depth + 1);
      }
    };
    for (const root of roots) visit(root, 0);
  };
  refresh();
  return {
    assertRoot(value) {
      refresh();
      if (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        references.has(value)
      ) {
        throw new DataProtocolError(
          'Request-private context cannot be transferred as public data',
        );
      }
    },
    assertValue(value) {
      refresh();
      assertPublicData(value, { privateReferences: references });
    },
  };
}
