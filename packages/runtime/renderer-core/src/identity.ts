export type Renderer = string;

/** Immutable identity for one application entry and its hydration bytes. */
export interface RendererIdentity {
  renderer: Renderer;
  appId: string;
  entryName: string;
  protocolVersion: 1;
  buildId: string;
}

export function resolveRenderer(value: unknown = 'react'): Renderer {
  if (
    typeof value === 'string' &&
    value.trim() === value &&
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value)
  )
    return value;
  throw new Error(`Unsupported UltraModern renderer: ${String(value)}`);
}

export function identityCacheKey(identity: RendererIdentity): string {
  resolveRenderer(identity.renderer);
  for (const key of ['appId', 'entryName', 'buildId'] as const) {
    if (
      typeof identity[key] !== 'string' ||
      identity[key].trim().length === 0
    ) {
      throw new Error(`Renderer identity requires a nonempty ${key}`);
    }
  }
  if (identity.protocolVersion !== 1) {
    throw new Error('Unsupported renderer data protocol version');
  }
  return JSON.stringify([
    identity.renderer,
    identity.appId,
    identity.entryName,
    identity.protocolVersion,
    identity.buildId,
  ]);
}

export function assertRendererIdentity(
  actual: RendererIdentity,
  expected: RendererIdentity,
): void {
  if (identityCacheKey(actual) !== identityCacheKey(expected)) {
    throw new Error('Renderer identity conflicts with the application build');
  }
}

/** Response header naming the built entry identity that rendered a document. */
export const RENDERER_IDENTITY_HEADER = 'x-ultramodern-renderer-identity';

/**
 * Serialize an entry identity as an ASCII-only header value (JSON with
 * non-ASCII code units escaped), so every host emits the same bytes.
 */
export function serializeRendererIdentityHeader(
  identity: RendererIdentity,
): string {
  identityCacheKey(identity);
  return JSON.stringify({
    renderer: identity.renderer,
    appId: identity.appId,
    entryName: identity.entryName,
    protocolVersion: identity.protocolVersion,
    buildId: identity.buildId,
  }).replace(/[\u007f-\u{10ffff}]/gu, character =>
    Array.from(
      { length: character.length },
      (_, index) =>
        `\\u${character.charCodeAt(index).toString(16).padStart(4, '0')}`,
    ).join(''),
  );
}
