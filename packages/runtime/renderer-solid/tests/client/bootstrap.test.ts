import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { readSolidDocumentBootstrap } from '../../src/client';

// The shared reader's validation is covered in renderer-core's document tests.
const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'store',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'solid-build-1',
};

function documentWith(payload: unknown): Document {
  const document = globalThis.document.implementation.createHTMLDocument();
  const script = document.createElement('script');
  script.id = '__ULTRAMODERN_RENDERER__';
  script.type = 'application/json';
  script.textContent = JSON.stringify(payload);
  document.body.appendChild(script);
  return document;
}

describe('native Solid document identity', () => {
  test('reads the bootstrap from a real document', () => {
    expect(
      readSolidDocumentBootstrap(
        documentWith({ identity, documentId: 'main-1:', hydrating: true }),
        identity,
      ),
    ).toEqual({ identity, documentId: 'main-1:', hydrating: true });
  });

  test('requires a Solid renderer identity', () => {
    const octane = { ...identity, renderer: 'octane' };
    expect(() =>
      readSolidDocumentBootstrap(
        documentWith({
          identity: octane,
          documentId: 'main:',
          hydrating: true,
        }),
        octane,
      ),
    ).toThrow('Solid renderer identity');
  });
});
