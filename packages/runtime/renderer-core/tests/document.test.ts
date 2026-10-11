import { parsePublicData, serializePublicData } from '../src/data/codec';
import {
  collectDocumentAssets,
  prepareDocument,
  RENDERER_BOOTSTRAP_ID,
  readDocumentBootstrap,
  serializeDocumentAsset,
  serializeInlineData,
} from '../src/document';
import type { RendererIdentity } from '../src/identity';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'store',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'build-1',
};

/** The reader only needs the one id lookup a browser Document performs. */
function documentWith(
  text: string,
  element: { tagName?: string; type?: string; count?: number } = {},
): Pick<Document, 'querySelectorAll'> {
  const script = {
    tagName: element.tagName ?? 'SCRIPT',
    textContent: text,
    getAttribute: (name: string) =>
      name === 'type' ? (element.type ?? 'application/json') : null,
  };
  const count = element.count ?? 1;
  return {
    querySelectorAll: (selector: string) => {
      expect(selector).toBe(`[id="${RENDERER_BOOTSTRAP_ID}"]`);
      return {
        length: count,
        item: () => (count ? script : null),
      } as unknown as NodeListOf<Element>;
    },
  };
}

function bootstrapText(parts: { bootstrap: string }): string {
  return /<script[^>]*id="__ULTRAMODERN_RENDERER__"[^>]*>(.*?)<\/script>/su.exec(
    parts.bootstrap,
  )![1];
}

describe('native document metadata', () => {
  test('uses the actual compiler script kind and native adapter scheduling', () => {
    expect(
      serializeDocumentAsset(
        { kind: 'script', scriptType: 'classic', href: '/octane.js' },
        'n',
      ),
    ).toBe('<script defer src="/octane.js" nonce="n"></script>');
    expect(
      serializeDocumentAsset({ kind: 'script', href: '/solid.js' }, 'n', {
        async: true,
      }),
    ).toBe('<script type="module" async src="/solid.js" nonce="n"></script>');
    expect(
      serializeDocumentAsset(
        { kind: 'script', scriptType: 'classic', href: '/octane.js' },
        undefined,
        { async: true },
      ),
    ).toBe('<script async src="/octane.js"></script>');
    expect(
      serializeDocumentAsset(
        { kind: 'script', scriptType: 'classic', href: '/octane.js' },
        'n',
        { defer: false },
      ),
    ).toBe('<script src="/octane.js" nonce="n"></script>');
    expect(() =>
      serializeDocumentAsset(
        { kind: 'stylesheet', href: '/style.css' },
        undefined,
        { async: true },
      ),
    ).toThrow('only available');
    expect(() =>
      serializeDocumentAsset(
        { kind: 'stylesheet', href: '/style.css' },
        undefined,
        { defer: false },
      ),
    ).toThrow('only available');
    expect(() =>
      serializeDocumentAsset({ kind: 'script', href: '/entry.js' }, undefined, {
        async: true,
        defer: true,
      }),
    ).toThrow('both async and deferred');
    expect(() =>
      serializeDocumentAsset({
        kind: 'stylesheet',
        href: '/style.css',
        scriptType: 'classic',
      }),
    ).toThrow('Only a script');
    expect(() =>
      collectDocumentAssets([
        { kind: 'script', href: '/entry.js', scriptType: 'classic' },
        { kind: 'script', href: '/entry.js', scriptType: 'module' },
      ]),
    ).toThrow('Conflicting document asset');
  });
  test('preserves the adapter asset order, deduplicates equal claims and rejects conflicting integrity', () => {
    const assets = collectDocumentAssets([
      { kind: 'stylesheet', href: '/native.css' },
      { kind: 'modulepreload', href: '/entry.js', integrity: 'sha256-test' },
      { kind: 'stylesheet', href: '/native.css' },
      { kind: 'script', href: '/entry.js' },
    ]);
    expect(assets.map(asset => asset.kind)).toEqual([
      'stylesheet',
      'modulepreload',
      'script',
    ]);
    expect(() =>
      collectDocumentAssets([
        { kind: 'script', href: '/entry.js', integrity: 'sha256-a' },
        { kind: 'script', href: '/entry.js', integrity: 'sha256-b' },
      ]),
    ).toThrow('Conflicting document asset metadata');
  });

  test('frames URL, integrity and nonce as escaped double-quoted attributes', () => {
    expect(
      serializeDocumentAsset(
        {
          kind: 'script',
          href: '/entry.js?x=1&y="<tag>',
          integrity: 'sha256-"<&',
          crossOrigin: 'anonymous',
        },
        'nonce"<&',
      ),
    ).toBe(
      '<script type="module" src="/entry.js?x=1&amp;y=&quot;&lt;tag&gt;" integrity="sha256-&quot;&lt;&amp;" crossorigin="anonymous" nonce="nonce&quot;&lt;&amp;"></script>',
    );
    expect(
      serializeDocumentAsset({ kind: 'stylesheet', href: '/native.css' }, 'n'),
    ).toBe('<link rel="stylesheet" href="/native.css" nonce="n">');
    expect(
      serializeDocumentAsset({ kind: 'modulepreload', href: '/lazy.js' }),
    ).toBe('<link rel="modulepreload" href="/lazy.js">');
    expect(() =>
      serializeDocumentAsset({ kind: 'script', href: 'javascript:alert(1)' }),
    ).toThrow('HTTP URL');
    expect(() =>
      serializeDocumentAsset({ kind: 'script', href: '/entry\n.js' }),
    ).toThrow('whitespace');
    expect(() =>
      serializeDocumentAsset({ kind: 'script', href: '/entry.js' }, ''),
    ).toThrow('nonempty');
  });

  test('safely frames codec output before native imports, including every split of a closing script attack', () => {
    const value = {
      content: '</script><script>globalThis.compromised=true</script>',
      separators: '\u2028\u2029',
      ampersand: '&',
    };
    const payload = serializePublicData(value);
    const html = serializeInlineData({
      id: 'native-data',
      payload,
      nonce: 'test-nonce',
    });
    expect(
      html.startsWith(
        '<script type="application/json" id="native-data" nonce="test-nonce">',
      ),
    ).toBe(true);
    const serializedBody = html.slice(
      html.indexOf('>') + 1,
      -'</script>'.length,
    );
    expect(serializedBody).not.toContain('<');
    expect(serializedBody).not.toContain('&');
    expect(parsePublicData(serializedBody)).toEqual(value);
    for (let split = 0; split <= serializedBody.length; split += 1) {
      const chunks = [
        serializedBody.slice(0, split),
        serializedBody.slice(split),
      ];
      expect(chunks.join('')).not.toMatch(/<\/script/i);
    }
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  test('escapes plain JSON text and attributes at the HTML boundary', () => {
    const html = serializeInlineData({
      id: 'data" onload="bad',
      payload: JSON.stringify('</script>'),
      nonce: 'nonce" onload="bad',
    });
    expect(html).toContain('id="data&quot; onload=&quot;bad"');
    expect(html).toContain('nonce="nonce&quot; onload=&quot;bad"');
    expect(
      html.slice(html.indexOf('>') + 1, -'</script>'.length),
    ).not.toContain('<');
    expect(() =>
      serializeInlineData({ id: '', payload: serializePublicData(null) }),
    ).toThrow('nonempty id');
  });
});

describe('native document parts', () => {
  test('places assets, bootstrap and inline data with per-destination nonces', () => {
    const parts = prepareDocument(
      { identity, documentId: 'doc-1', hydrating: true, extra: 'x' },
      {
        rootId: 'app"root',
        lang: 'cs',
        nonce: { script: 'sn', style: 'cn' },
        assets: [
          { kind: 'stylesheet', href: '/app.css' },
          { kind: 'modulepreload', href: '/lazy.js' },
          { kind: 'script', href: '/runtime.js', scriptType: 'classic' },
          { kind: 'script', href: '/app.js' },
        ],
        inlineData: [{ id: 'handoff', payload: JSON.stringify('</script>') }],
      },
    );
    expect(parts.rootId).toBe('app&quot;root');
    expect(parts.lang).toBe('cs');
    expect(parts.headAssets).toBe(
      '<link rel="stylesheet" href="/app.css" nonce="cn"><link rel="modulepreload" href="/lazy.js" nonce="sn">',
    );
    // Hydration starts before the stream ends; classic chunks keep their order.
    expect(parts.entryScripts).toBe(
      '<script src="/runtime.js" nonce="sn"></script><script type="module" async src="/app.js" nonce="sn"></script>',
    );
    expect(JSON.parse(bootstrapText(parts))).toEqual({
      identity,
      documentId: 'doc-1',
      hydrating: true,
      extra: 'x',
    });
    expect(parts.bootstrap.indexOf(RENDERER_BOOTSTRAP_ID)).toBeLessThan(
      parts.bootstrap.indexOf('id="handoff"'),
    );
    expect(parts.bootstrap).toContain(
      '<script type="application/json" id="handoff" nonce="sn">"\\u003C/script\\u003E"</script>',
    );
  });

  test('escapes the bootstrap once', () => {
    const documentId = 'a</script><script>x\u2028y&z';
    const text = bootstrapText(
      prepareDocument({ identity, documentId, hydrating: false }),
    );
    expect(text).toContain(
      'a\\u003C/script\\u003E\\u003Cscript\\u003Ex\\u2028y\\u0026z',
    );
    // A doubly escaped payload would decode to literal "\u003C" text.
    expect(JSON.parse(text).documentId).toBe(documentId);
  });

  test('schedules client-rendered entry scripts normally', () => {
    expect(
      prepareDocument(
        { identity, documentId: 'csr', hydrating: false },
        {
          assets: [
            { kind: 'script', href: '/runtime.js', scriptType: 'classic' },
            { kind: 'script', href: '/app.js' },
          ],
        },
      ).entryScripts,
    ).toBe(
      '<script defer src="/runtime.js"></script><script type="module" src="/app.js"></script>',
    );
  });

  test.each([
    [{ rootId: '' }, 'nonempty rootId'],
    [{ lang: ' ' }, 'nonempty lang'],
    [{ rootId: RENDERER_BOOTSTRAP_ID }, 'bootstrap id'],
    [{ inlineData: [{ id: 'root', payload: '1' }] }, 'root or bootstrap id'],
    [
      {
        inlineData: [
          { id: 'handoff', payload: '1' },
          { id: 'handoff', payload: '2' },
        ],
      },
      'inline data id handoff is repeated',
    ],
    [
      { inlineData: [{ id: RENDERER_BOOTSTRAP_ID, payload: '1' }] },
      'root or bootstrap id',
    ],
  ])('rejects an ambiguous document %#', (options, message) => {
    expect(() =>
      prepareDocument({ identity, documentId: 'd', hydrating: true }, options),
    ).toThrow(message);
  });

  test('rejects an invalid bootstrap', () => {
    expect(() =>
      prepareDocument({ identity, documentId: ' ', hydrating: true }),
    ).toThrow('document id');
    expect(() =>
      prepareDocument({
        identity: { ...identity, buildId: '' },
        documentId: 'd',
        hydrating: true,
      }),
    ).toThrow('buildId');
  });
});

describe('native document bootstrap reader', () => {
  const payload = { identity, documentId: 'doc-1', hydrating: true };

  test.each([true, false])(
    'reads the exact bootstrap (hydrating %s)',
    hydrating => {
      const result = readDocumentBootstrap(
        documentWith(JSON.stringify({ ...payload, hydrating })),
        identity,
      );
      expect(result).toEqual({ ...payload, hydrating });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.identity)).toBe(true);
    },
  );

  test('returns only the renderer fields an adapter names', () => {
    const text = JSON.stringify({ ...payload, nativeHydrationBuildId: 'n' });
    expect(() => readDocumentBootstrap(documentWith(text), identity)).toThrow(
      'malformed',
    );
    expect(
      readDocumentBootstrap(documentWith(text), identity, [
        'nativeHydrationBuildId',
      ]).nativeHydrationBuildId,
    ).toBe('n');
  });

  test('rejects stale build identity before native router/root creation', () => {
    expect(() =>
      readDocumentBootstrap(
        documentWith(
          JSON.stringify({
            ...payload,
            identity: { ...identity, buildId: 'stale' },
          }),
        ),
        identity,
      ),
    ).toThrow('conflicts with the application build');
  });

  test.each([
    [[], 'malformed'],
    [null, 'malformed'],
    [{ ...payload, unexpected: true }, 'malformed'],
    [{ ...payload, identity: { ...identity, unexpected: true } }, 'identity'],
    [{ ...payload, identity: null }, 'identity'],
    [{ ...payload, documentId: '' }, 'document id'],
    [{ identity, documentId: 'doc-1' }, 'hydrates'],
    [{ ...payload, hydrating: 'true' }, 'hydrates'],
  ])('rejects an invalid bootstrap %#', (invalid, message) => {
    expect(() =>
      readDocumentBootstrap(documentWith(JSON.stringify(invalid)), identity),
    ).toThrow(message);
  });

  test('rejects broken JSON and missing, repeated or executable elements', () => {
    expect(() =>
      readDocumentBootstrap(documentWith('{broken-json'), identity),
    ).toThrow(SyntaxError);
    const text = JSON.stringify(payload);
    expect(() =>
      readDocumentBootstrap(documentWith(text, { count: 0 }), identity),
    ).toThrow('exactly one');
    expect(() =>
      readDocumentBootstrap(documentWith(text, { count: 2 }), identity),
    ).toThrow('exactly one');
    expect(() =>
      readDocumentBootstrap(documentWith(text, { type: 'module' }), identity),
    ).toThrow('missing');
    expect(() =>
      readDocumentBootstrap(documentWith(text, { tagName: 'DIV' }), identity),
    ).toThrow('missing');
  });
});
