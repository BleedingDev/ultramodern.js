import { serializePublicData } from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { readSolidDocumentBootstrap } from '../../src/client';

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
  script.textContent = serializePublicData(payload);
  document.body.appendChild(script);
  return document;
}

describe('native Solid document identity', () => {
  test.each([
    true,
    false,
  ])('reads the exact SSR/CSR bootstrap %s', hydrating => {
    expect(
      readSolidDocumentBootstrap(
        documentWith({ identity, documentId: 'main-1:', hydrating }),
        identity,
      ),
    ).toEqual({ identity, documentId: 'main-1:', hydrating });
  });

  test('rejects stale build identity before native router/root creation', () => {
    expect(() =>
      readSolidDocumentBootstrap(
        documentWith({
          identity: { ...identity, buildId: 'stale' },
          documentId: 'main:',
          hydrating: true,
        }),
        identity,
      ),
    ).toThrow('conflicts with the application build');
  });

  test.each([
    { identity, documentId: '', hydrating: true },
    { identity, documentId: 'main:' },
    { identity: null, documentId: 'main:', hydrating: true },
    [],
    null,
  ])('rejects an invalid current bootstrap', payload => {
    expect(() =>
      readSolidDocumentBootstrap(documentWith(payload), identity),
    ).toThrow('invalid renderer identity');
  });

  test('rejects missing and executable identity scripts', () => {
    const document = globalThis.document.implementation.createHTMLDocument();
    expect(() => readSolidDocumentBootstrap(document, identity)).toThrow(
      'missing',
    );
    const script = document.createElement('script');
    script.id = '__ULTRAMODERN_RENDERER__';
    script.type = 'module';
    document.body.appendChild(script);
    expect(() => readSolidDocumentBootstrap(document, identity)).toThrow(
      'missing',
    );
  });
});
