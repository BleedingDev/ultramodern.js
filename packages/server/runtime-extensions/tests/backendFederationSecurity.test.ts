import { createHash } from 'node:crypto';
import {
  BackendFederationRemoteEntryError,
  type BackendFederationRemoteEntryVerification,
  loadBoundedBackendFederationResource,
  loadVerifiedBackendFederationEntry,
  redactBackendFederationUrl,
  resolveBackendFederationRemoteEntryVerification,
} from '../src/backend-federation-security';
import {
  createBackendFederationEntryIntegrity,
  evaluateNodeBackendFederationCommonJs,
} from '../src/backend-federation-security/node';

const entryUrl = 'https://catalog.example.test/backendRemoteEntry.cjs';
const remoteName = 'verticalCatalogBackend';
const unitId = 'catalog@21';
const buildMarker = 'catalog-build-123';

const source = `
globalThis.__verifiedBackendEntryEvaluations =
  (globalThis.__verifiedBackendEntryEvaluations ?? 0) + 1;
module.exports = {
  init() {},
  get(id) {
    if (id !== './effect-api') throw new Error('Unexpected expose ' + id);
    return async () => ({ runtime: { brand: 'verified-backend' } });
  },
};
`;

const verification = (
  overrides: Partial<BackendFederationRemoteEntryVerification> = {},
): BackendFederationRemoteEntryVerification => ({
  ...createBackendFederationEntryIntegrity(source),
  buildMarker,
  entryUrl,
  remoteName,
  unitId,
  ...overrides,
});

const evaluations = () =>
  (globalThis as Record<string, unknown>).__verifiedBackendEntryEvaluations;

const loadVerifiedNodeEntry = (
  options: Parameters<typeof loadVerifiedBackendFederationEntry>[0],
) =>
  loadVerifiedBackendFederationEntry({
    ...options,
    evaluateCommonJs: evaluateNodeBackendFederationCommonJs,
  });

describe('verified backend federation entry loading', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)
      .__verifiedBackendEntryEvaluations;
  });

  test('resolves the entry binding from a delivery-unit manifest', () => {
    expect(
      resolveBackendFederationRemoteEntryVerification({
        backendFederation: {
          containerEntry: entryUrl,
          name: remoteName,
          versionBoundary: {
            deliveryUnit: { buildMarker, unitId },
          },
        },
        entry: {
          ...createBackendFederationEntryIntegrity(source),
          url: entryUrl,
        },
      }),
    ).toEqual(verification());
  });

  test('rejects entry URL drift in integrity-bearing manifests', () => {
    expect(() =>
      resolveBackendFederationRemoteEntryVerification({
        backendFederation: {
          containerEntry:
            'https://attacker.example.test/backendRemoteEntry.cjs',
          name: remoteName,
        },
        entry: {
          ...createBackendFederationEntryIntegrity(source),
          url: entryUrl,
        },
      }),
    ).toThrow(
      expect.objectContaining<Partial<BackendFederationRemoteEntryError>>({
        code: 'identity_mismatch',
      }),
    );
  });

  test('rejects identity drift before acquiring or evaluating the entry', async () => {
    const fetchEntry = rs.fn(async () => new Response(source));

    await expect(
      loadVerifiedNodeEntry({
        expected: { buildMarker, remoteName, unitId: 'catalog@17' },
        fetch: fetchEntry,
        remote: { entry: entryUrl, name: remoteName },
        verification: verification(),
      }),
    ).rejects.toMatchObject({ code: 'identity_mismatch' });

    expect(fetchEntry).not.toHaveBeenCalled();
    expect(evaluations()).toBeUndefined();
  });

  test('cancels a streamed body that exceeds the verified byte length', async () => {
    let cancelled = false;
    let signal: AbortSignal | undefined;
    const fetchEntry = rs.fn(async (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
          start(controller) {
            controller.enqueue(new TextEncoder().encode('safe'));
            controller.enqueue(new TextEncoder().encode(' overflow'));
          },
        }),
        { headers: { 'content-length': '1' } },
      );
    });

    await expect(
      loadVerifiedNodeEntry({
        fetch: fetchEntry,
        remote: { entry: entryUrl, name: remoteName },
        verification: verification({ byteLength: 4 }),
      }),
    ).rejects.toMatchObject({ code: 'entry_too_large' });

    expect(cancelled).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(evaluations()).toBeUndefined();
  });

  test('rejects an equal-length digest mismatch before evaluation', async () => {
    const mutatedSource = source.replace(
      'verified-backend',
      'modified-backend',
    );
    expect(Buffer.byteLength(mutatedSource)).toBe(Buffer.byteLength(source));

    await expect(
      loadVerifiedNodeEntry({
        fetch: async () => new Response(mutatedSource),
        remote: { entry: entryUrl, name: remoteName },
        verification: verification(),
      }),
    ).rejects.toMatchObject({ code: 'integrity_mismatch' });

    expect(evaluations()).toBeUndefined();
  });

  test('redacts entry redirect query and fragment data before reporting', async () => {
    const requestedEntry = `${entryUrl}?token=request-secret#request-fragment`;

    await expect(
      loadVerifiedNodeEntry({
        fetch: async () => ({
          body: new Response(source).body,
          headers: new Headers(),
          ok: true,
          status: 200,
          url: `${entryUrl}?token=response-secret#response-fragment`,
        }),
        remote: { entry: requestedEntry, name: remoteName },
        verification: verification({ entryUrl: requestedEntry }),
      }),
    ).rejects.toMatchObject({
      code: 'redirect_mismatch',
      details: {
        expected: entryUrl,
        received: entryUrl,
      },
    });

    expect(evaluations()).toBeUndefined();
  });

  test('aborts a hanging body on timeout and never evaluates late bytes', async () => {
    let cancelled = false;
    let signal: AbortSignal | undefined;
    let release: (() => void) | undefined;
    const firstChunk = new TextEncoder().encode(source.slice(0, 20));
    const remainder = new TextEncoder().encode(source.slice(20));

    const pending = loadVerifiedNodeEntry({
      fetch: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
            start(controller) {
              controller.enqueue(firstChunk);
              release = () => {
                try {
                  controller.enqueue(remainder);
                  controller.close();
                } catch {
                  // A correctly cancelled stream rejects late producer output.
                }
              };
            },
          }),
        );
      },
      remote: { entry: entryUrl, name: remoteName },
      timeoutMs: 20,
      verification: verification(),
    });

    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
    expect(signal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    release?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(evaluations()).toBeUndefined();
  });

  test('honours caller cancellation before evaluation', async () => {
    const controller = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    const pending = loadVerifiedNodeEntry({
      fetch: async (_url, init) => {
        fetchSignal = init?.signal ?? undefined;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(streamController) {
              streamController.enqueue(
                new TextEncoder().encode(source.slice(0, 10)),
              );
            },
          }),
        );
      },
      remote: { entry: entryUrl, name: remoteName },
      signal: controller.signal,
      verification: verification(),
    });

    controller.abort(new Error('request closed'));
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchSignal?.aborted).toBe(true);
    expect(evaluations()).toBeUndefined();
  });

  test('evaluates the exact verified chunked bytes once', async () => {
    const bytes = new TextEncoder().encode(source);
    const fetchEntry = rs.fn(async () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 17));
              controller.enqueue(bytes.subarray(17, 91));
              controller.enqueue(bytes.subarray(91));
              controller.close();
            },
          }),
        ),
      ),
    );

    const entry = await loadVerifiedNodeEntry({
      expected: { buildMarker, remoteName, unitId },
      fetch: fetchEntry,
      remote: { entry: entryUrl, name: remoteName },
      verification: verification(),
    });
    const factory = await entry.get('./effect-api');

    expect(await factory()).toEqual({
      runtime: { brand: 'verified-backend' },
    });
    expect(fetchEntry).toHaveBeenCalledTimes(1);
    expect(evaluations()).toBe(1);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      verification().sha256,
    );
  });

  test('accepts a complete caller-pinned verification for an external remote', async () => {
    const entry = await loadVerifiedNodeEntry({
      expected: verification(),
      fetch: async () => new Response(source),
      remote: { entry: entryUrl, name: remoteName },
    });

    expect(typeof entry.get).toBe('function');
    expect(evaluations()).toBe(1);
  });

  test('revalidates refreshed metadata and bytes instead of reusing an old entry', async () => {
    const refreshedSource = source.replace(
      'verified-backend',
      'refreshed-backend',
    );
    let currentSource = source;
    const fetchEntry = rs.fn(async () => new Response(currentSource));

    await loadVerifiedNodeEntry({
      fetch: fetchEntry,
      remote: { entry: entryUrl, name: remoteName },
      verification: verification(),
    });
    currentSource = refreshedSource;
    await loadVerifiedNodeEntry({
      fetch: fetchEntry,
      remote: { entry: entryUrl, name: remoteName },
      verification: {
        ...verification(),
        ...createBackendFederationEntryIntegrity(refreshedSource),
      },
    });

    expect(fetchEntry).toHaveBeenCalledTimes(2);
    expect(evaluations()).toBe(2);
  });

  test('uses an explicit no-redirect fetch policy and redacts redirected URL secrets', async () => {
    let requestInit: RequestInit | undefined;

    await expect(
      loadBoundedBackendFederationResource(
        'https://catalog.example.test/manifest.json?token=request-secret#client-fragment',
        {
          fetch: async (_url, init) => {
            requestInit = init;
            return {
              body: null,
              headers: new Headers(),
              ok: true,
              status: 200,
              url: 'https://redirect.example.test/manifest.json?token=response-secret#redirect-fragment',
            };
          },
          kind: 'manifest',
        },
      ),
    ).rejects.toMatchObject({
      code: 'redirect_mismatch',
      details: {
        expected: 'https://catalog.example.test/manifest.json',
        received: 'https://redirect.example.test/manifest.json',
      },
    });

    expect(requestInit?.redirect).toBe('error');
    expect(
      redactBackendFederationUrl(
        'https://user:pass@catalog.example.test/entry.cjs?token=secret#fragment',
      ),
    ).toBe('https://catalog.example.test/entry.cjs');
  });

  test('streams manifest bytes into a bounded buffer and cancels overflow', async () => {
    let cancelled = false;

    await expect(
      loadBoundedBackendFederationResource(
        'https://catalog.example.test/manifest.json',
        {
          fetch: async () => ({
            body: new ReadableStream<Uint8Array>({
              cancel() {
                cancelled = true;
              },
              start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
                controller.enqueue(new Uint8Array([4, 5, 6]));
              },
            }),
            headers: new Headers(),
            ok: true,
            status: 200,
          }),
          kind: 'manifest',
          maxBytes: 5,
        },
      ),
    ).rejects.toMatchObject({ code: 'entry_too_large' });

    expect(cancelled).toBe(true);
  });

  test('permits Node builtins but rejects package requires in verified code', () => {
    const builtinEntry = evaluateNodeBackendFederationCommonJs(
      "const path = require('node:path'); module.exports = { get: () => () => path.basename('/safe/value') };",
      { remote: { entry: entryUrl, name: remoteName } },
    ) as { get(id: string): () => string };

    expect(builtinEntry.get('./effect-api')()).toBe('value');
    expect(() =>
      evaluateNodeBackendFederationCommonJs(
        "require('@attacker/package'); module.exports = { get() {} };",
        { remote: { entry: entryUrl, name: remoteName } },
      ),
    ).toThrow(
      expect.objectContaining<Partial<BackendFederationRemoteEntryError>>({
        code: 'unsupported_entry',
      }),
    );
  });
});
