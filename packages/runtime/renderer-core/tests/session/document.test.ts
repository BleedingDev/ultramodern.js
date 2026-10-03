import {
  type InlineDataJSON,
  parsePublicData,
  serializePublicData,
} from '../../src/data/codec';
import {
  collectDocumentAssets,
  serializeDocumentAsset,
  serializeInlineData,
} from '../../src/session';

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

  test('escapes again at the final HTML boundary even when an unsafe string is incorrectly branded', () => {
    const html = serializeInlineData({
      id: 'data" onload="bad',
      payload: JSON.stringify('</script>') as InlineDataJSON,
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
