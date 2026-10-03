export type Renderer = 'react' | 'solid' | 'octane';

/** Immutable identity for one application entry and its hydration bytes. */
export interface RendererIdentity {
  renderer: Renderer;
  appId: string;
  entryName: string;
  protocolVersion: 1;
  buildId: string;
}

export function resolveRenderer(value: unknown = 'react'): Renderer {
  if (value === 'react' || value === 'solid' || value === 'octane')
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
