import { escapeInlineDataJSON } from '@modern-js/renderer-core/data';
import {
  assertRendererIdentity,
  identityCacheKey,
  type RendererIdentity,
} from '@modern-js/renderer-core/identity';

export const OCTANE_BOOTSTRAP_ID = '__ULTRAMODERN_RENDERER__';

export interface OctaneDocumentBootstrap {
  readonly identity: Readonly<RendererIdentity>;
  readonly documentId: string;
  readonly hydrating: boolean;
  readonly nativeHydrationBuildId: string;
}

export function assertNativeHydrationBuildId(
  value: unknown,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      'An Octane document requires its native client compilation identity.',
    );
  }
}

export function assertOctaneIdentity(identity: RendererIdentity): void {
  identityCacheKey(identity);
  if (identity.renderer !== 'octane') {
    throw new Error(
      'An Octane application requires an Octane renderer identity.',
    );
  }
  if (
    Object.keys(identity).some(
      key =>
        ![
          'renderer',
          'appId',
          'entryName',
          'protocolVersion',
          'buildId',
        ].includes(key),
    )
  ) {
    throw new Error('An Octane renderer identity contains an unknown field.');
  }
}

export function encodeOctaneDocumentBootstrap(input: OctaneDocumentBootstrap) {
  assertOctaneIdentity(input.identity);
  assertNativeHydrationBuildId(input.nativeHydrationBuildId);
  if (
    typeof input.documentId !== 'string' ||
    input.documentId.trim().length === 0
  ) {
    throw new Error('Octane hydration requires a nonempty document identity.');
  }
  if (typeof input.hydrating !== 'boolean') {
    throw new Error(
      'An Octane document must identify whether its root requires hydration.',
    );
  }
  return escapeInlineDataJSON(
    JSON.stringify({
      identity: input.identity,
      documentId: input.documentId,
      hydrating: input.hydrating,
      nativeHydrationBuildId: input.nativeHydrationBuildId,
    }),
  );
}

export function readOctaneDocumentBootstrap(
  document: Document,
  expectedIdentity?: RendererIdentity,
  expectedNativeHydrationBuildId?: string,
): OctaneDocumentBootstrap {
  const elements = document.querySelectorAll(`[id="${OCTANE_BOOTSTRAP_ID}"]`);
  if (elements.length !== 1) {
    throw new Error(
      'An Octane document requires exactly one hydration identity payload.',
    );
  }
  const element = elements.item(0);
  if (
    !element ||
    element.tagName !== 'SCRIPT' ||
    element.getAttribute('type') !== 'application/json'
  ) {
    throw new Error(
      'The Octane document is missing its hydration identity payload.',
    );
  }
  const payload: unknown = JSON.parse(element.textContent ?? '');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The Octane hydration identity payload is malformed.');
  }
  if (
    Object.keys(payload).some(
      key =>
        ![
          'identity',
          'documentId',
          'hydrating',
          'nativeHydrationBuildId',
        ].includes(key),
    )
  ) {
    throw new Error(
      'The Octane hydration identity payload contains an unknown field.',
    );
  }
  const { identity, documentId, hydrating, nativeHydrationBuildId } =
    payload as Record<string, unknown>;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error('The Octane hydration renderer identity is malformed.');
  }
  const rendererIdentity = identity as RendererIdentity;
  assertOctaneIdentity(rendererIdentity);
  if (expectedIdentity)
    assertRendererIdentity(rendererIdentity, expectedIdentity);
  if (typeof documentId !== 'string' || documentId.trim().length === 0) {
    throw new Error('Octane hydration requires a nonempty document identity.');
  }
  if (typeof hydrating !== 'boolean') {
    throw new Error(
      'An Octane document must identify whether its root requires hydration.',
    );
  }
  assertNativeHydrationBuildId(nativeHydrationBuildId);
  if (expectedNativeHydrationBuildId !== undefined) {
    assertNativeHydrationBuildId(expectedNativeHydrationBuildId);
    if (nativeHydrationBuildId !== expectedNativeHydrationBuildId) {
      throw new Error(
        'Octane hydration bytes belong to a different native client compilation.',
      );
    }
  }
  return Object.freeze({
    identity: Object.freeze({ ...rendererIdentity }),
    documentId,
    hydrating,
    nativeHydrationBuildId,
  });
}
