import {
  type DocumentBootstrap,
  readDocumentBootstrap,
} from '@modern-js/renderer-core/document';
import {
  type RendererIdentity,
  readRendererIdentity,
} from '@modern-js/renderer-core/identity';

export interface OctaneDocumentBootstrap extends DocumentBootstrap {
  /** Actual native client compilation hash, separate from application identity. */
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
  readRendererIdentity(identity, identity);
  if (identity.renderer !== 'octane') {
    throw new Error(
      'An Octane application requires an Octane renderer identity.',
    );
  }
}

/** Read the server's bootstrap and require this exact native client build. */
export function readOctaneDocumentBootstrap(
  document: Document,
  expectedIdentity: RendererIdentity,
  expectedNativeHydrationBuildId?: string,
): OctaneDocumentBootstrap {
  assertOctaneIdentity(expectedIdentity);
  const { identity, documentId, hydrating, nativeHydrationBuildId } =
    readDocumentBootstrap(document, expectedIdentity, [
      'nativeHydrationBuildId',
    ]);
  assertNativeHydrationBuildId(nativeHydrationBuildId);
  if (
    expectedNativeHydrationBuildId !== undefined &&
    nativeHydrationBuildId !== expectedNativeHydrationBuildId
  ) {
    throw new Error(
      'Octane hydration bytes belong to a different native client compilation.',
    );
  }
  return Object.freeze({
    identity,
    documentId,
    hydrating,
    nativeHydrationBuildId,
  });
}
