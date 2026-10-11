import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { decodeOctaneSSRDocument } from './fixtures.mjs';
import { createSSRMarkerProxy } from './marker-proxy.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function retire(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

async function waitForBlocked(proxy, count = 1) {
  const deadline = Date.now() + 2000;
  while (proxy.proof.blockedEntries < count) {
    assert.ok(Date.now() < deadline, 'the browser requested its entry');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function documentWith(entry) {
  return `<html><body><div id="root"></div>${entry}</body></html>`;
}

async function withAbsoluteProxy({ source, options = {}, entry }, inspect) {
  const bytes = Buffer.from(
    '/* native absolute entry */\nexport const value = "✓";\n',
  );
  const requests = [];
  let target;
  const upstream = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/' || request.url === '/reload') {
      response
        .writeHead(200, { 'content-type': 'text/html' })
        .end(documentWith(entry(source(target))));
    } else {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(bytes);
    }
  });
  let proxy;
  try {
    target = await listen(upstream);
    const originalSource = source(target);
    proxy = createSSRMarkerProxy({
      target,
      absoluteEntries: 'redirect',
      allowedEntrySources: [originalSource],
      ...(typeof options === 'function' ? options(originalSource) : options),
    });
    const url = await listen(proxy);
    await inspect({ proxy, url, target, bytes, requests, originalSource });
  } finally {
    if (proxy) await retire(proxy);
    await retire(upstream);
  }
}

const absoluteEntry = source =>
  `<script type="module" async src="${source}"></script>`;

const nativeEntry = '<script type="module" async src="/entry.js"></script>';
const nativeHTML = `<html><body><div id="root"></div>${nativeEntry}</body></html>`;

test('native async entry bytes wait for the SSR marker without changing tags', async () => {
  const bytes = Buffer.from('/* native entry */\nexport const value = "✓";\n');
  let entryRequests = 0;
  const upstream = createServer((request, response) => {
    if (request.url === '/entry.js') {
      entryRequests++;
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(bytes);
    } else {
      response.writeHead(200, { 'content-type': 'text/html' }).end(nativeHTML);
    }
  });
  let proxy;
  try {
    const target = await listen(upstream);
    proxy = createSSRMarkerProxy({
      target,
      widgetSelector: '[data-testid="native-remote"]',
      counterSelector:
        '[data-testid="native-remote"] [data-testid="native-count"]',
    });
    const url = await listen(proxy);
    const document = await (await fetch(url)).text();
    assert.ok(document.includes(nativeEntry), 'the async tag is unchanged');
    assert.ok(
      document.includes(
        `window.__ssrRemoteWidget = document.querySelector(${JSON.stringify('[data-testid="native-remote"]')});`,
      ),
    );
    assert.ok(
      document.includes(
        `window.__ssrRemoteCounter = document.querySelector(${JSON.stringify('[data-testid="native-remote"] [data-testid="native-count"]')});`,
      ),
    );
    assert.ok(
      document.indexOf(nativeEntry) <
        document.indexOf('window.__ssrRemoteWidget'),
    );
    const entry = fetch(`${url}/entry.js`);
    await waitForBlocked(proxy);
    assert.equal(
      entryRequests,
      0,
      'no native script bytes arrive before capture',
    );
    assert.equal(proxy.proof.deliveredEntries.length, 0);
    assert.equal((await fetch(url + proxy.proof.markerPath)).status, 204);
    const response = await entry;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/javascript');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(entryRequests, 1);
    assert.equal(proxy.proof.deliveredEntries[0].markerCaptured, true);
  } finally {
    if (proxy) await retire(proxy);
    await retire(upstream);
  }
});

test('cancellation retires a pending entry without forwarding native bytes', async () => {
  const cancellation = new AbortController();
  let entryRequests = 0;
  const upstream = createServer((request, response) => {
    if (request.url === '/entry.js') entryRequests++;
    response.writeHead(200, { 'content-type': 'text/html' }).end(nativeHTML);
  });
  let proxy;
  try {
    const target = await listen(upstream);
    proxy = createSSRMarkerProxy({ target, signal: cancellation.signal });
    const url = await listen(proxy);
    await (await fetch(url)).text();
    const entry = fetch(`${url}/entry.js`);
    await waitForBlocked(proxy);
    cancellation.abort(new Error('Proof retired'));
    const response = await entry;
    assert.equal(response.status, 500);
    assert.match(await response.text(), /Proof retired/u);
    assert.equal(entryRequests, 0);
    assert.equal(proxy.proof.deliveredEntries.length, 0);
  } finally {
    if (proxy) await retire(proxy);
    await retire(upstream);
  }
});

test('an admitted absolute entry redirects only after capture and retains its native URL and bytes', async () => {
  const nativeTag = source =>
    `<script data-src="/other.js" nonce='native nonce' crossorigin="anonymous" async type = "module" src = "${source.replaceAll('&', '&amp;')}" data-after='yes'></script>`;
  await withAbsoluteProxy(
    {
      source: target => `${target}/native/entry.js?build=7&stamp=owned#chunk`,
      entry: nativeTag,
    },
    async ({ proxy, url, bytes, requests, originalSource }) => {
      const document = await (await fetch(url)).text();
      const barrier = /\ssrc = "([^"]+)"/u.exec(document)[1];
      assert.ok(barrier.startsWith(proxy.proof.markerPath));
      assert.ok(
        document.includes(
          nativeTag(originalSource).replace(
            originalSource.replaceAll('&', '&amp;'),
            barrier,
          ),
        ),
        'only the native src value changes',
      );
      assert.deepEqual(proxy.proof.entryScripts, [
        nativeTag(originalSource).replace('</script>', ''),
      ]);
      const pending = fetch(url + barrier, { redirect: 'manual' });
      await waitForBlocked(proxy);
      assert.deepEqual(requests, ['/']);
      assert.deepEqual(proxy.proof.redirectedEntries, []);
      assert.equal((await fetch(url + proxy.proof.markerPath)).status, 204);
      const redirect = await pending;
      assert.equal(redirect.status, 307);
      assert.equal(redirect.headers.get('location'), originalSource);
      assert.equal(await redirect.text(), '');
      assert.deepEqual(proxy.proof.deliveredEntries, []);
      const response = await fetch(url + barrier);
      assert.equal(response.status, 200);
      assert.equal(response.url, originalSource.replace(/#.*$/u, ''));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.deepEqual(requests, ['/', '/native/entry.js?build=7&stamp=owned']);
      assert.deepEqual(proxy.proof.redirectedEntries, [
        { url: originalSource, markerCaptured: true },
        { url: originalSource, markerCaptured: true },
      ]);
    },
  );
});

test('single-quoted and unquoted absolute src values retain every other attribute', async () => {
  for (const quote of ["'", '']) {
    const nativeTag = source =>
      `<script defer type='module' async="" src=${quote}${source}${quote} data-native="yes"></script>`;
    await withAbsoluteProxy(
      { source: target => `${target}/entry.js`, entry: nativeTag },
      async ({ proxy, url, originalSource }) => {
        const document = await (await fetch(url)).text();
        const rewritten = document.match(/<script defer[^>]*>/u)[0];
        const original = nativeTag(originalSource).replace('</script>', '');
        assert.equal(
          rewritten.replace(
            /src=(?:'([^']+)'|([^\s>]+))/u,
            `src=${quote}${originalSource}${quote}`,
          ),
          original,
        );
        assert.deepEqual(proxy.proof.entryScripts, [original]);
      },
    );
  }
});

test('each admitted absolute module gets its own barrier while classic scripts remain unchanged', async () => {
  await withAbsoluteProxy(
    {
      source: target => `${target}/entry.js`,
      entry: source =>
        `${absoluteEntry(source)}<script src="${source}/classic.js" defer></script>${absoluteEntry(`${source}?second=1`)}`,
      options: source => ({
        allowedEntrySources: new Set([source, `${source}?second=1`]),
      }),
    },
    async ({ proxy, url, requests, originalSource }) => {
      const document = await (await fetch(url)).text();
      const barriers = [
        ...document.matchAll(/type="module" async src="([^"]+)"/gu),
      ].map(match => match[1]);
      assert.equal(barriers.length, 2);
      assert.notEqual(barriers[0], barriers[1]);
      assert.ok(
        document.includes(
          `<script src="${originalSource}/classic.js" defer></script>`,
        ),
      );
      const pending = barriers.map(path =>
        fetch(url + path, { redirect: 'manual' }),
      );
      await waitForBlocked(proxy, 2);
      assert.deepEqual(requests, ['/']);
      await fetch(url + proxy.proof.markerPath);
      const responses = await Promise.all(pending);
      assert.deepEqual(
        responses.map(response => response.headers.get('location')),
        [originalSource, `${originalSource}?second=1`],
      );
      for (const response of responses) {
        assert.equal(response.status, 307);
        assert.equal(await response.text(), '');
      }
      assert.equal(proxy.proof.redirectedEntries.length, 2);
      assert.deepEqual(proxy.proof.entryScripts, [
        absoluteEntry(originalSource).replace('</script>', ''),
        absoluteEntry(`${originalSource}?second=1`).replace('</script>', ''),
      ]);
    },
  );
});

test('redirect mode passes later native HTML through unchanged so a full-page reload remains observable', async () => {
  await withAbsoluteProxy(
    { source: target => `${target}/entry.js`, entry: absoluteEntry },
    async ({ proxy, url, originalSource }) => {
      const first = await (await fetch(url)).text();
      assert.ok(first.includes(proxy.proof.markerPath));
      const reload = await (await fetch(`${url}/reload`)).text();
      assert.equal(reload, documentWith(absoluteEntry(originalSource)));
      assert.equal(proxy.proof.additionalDocuments, 1);
      assert.equal(
        proxy.proof.entryScripts[0],
        absoluteEntry(originalSource).replace('</script>', ''),
      );
    },
  );
});

test('default relative mode still rejects a second document', async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(nativeHTML);
  });
  let proxy;
  try {
    proxy = createSSRMarkerProxy({ target: await listen(upstream) });
    const url = await listen(proxy);
    assert.equal((await fetch(url)).status, 200);
    const second = await fetch(url);
    assert.equal(second.status, 500);
    assert.match(await second.text(), /one document per marker proxy/u);
    assert.equal(proxy.proof.additionalDocuments, 0);
  } finally {
    if (proxy) await retire(proxy);
    await retire(upstream);
  }
});

test('default relative mode still rejects absolute module entries', async () => {
  await withAbsoluteProxy(
    {
      source: target => `${target}/entry.js`,
      entry: absoluteEntry,
      options: { absoluteEntries: undefined, allowedEntrySources: undefined },
    },
    async ({ proxy, url, requests }) => {
      const response = await fetch(url);
      assert.equal(response.status, 500);
      assert.match(
        await response.text(),
        /native entries pass through the proxy/u,
      );
      assert.deepEqual(proxy.proof.entryScripts, []);
      assert.deepEqual(requests, ['/']);
    },
  );
});

test('redirect mode preserves the current barrier for relative entries', async () => {
  await withAbsoluteProxy(
    {
      source: () => '/entry.js',
      entry: absoluteEntry,
      options: { allowedEntrySources: [] },
    },
    async ({ proxy, url, bytes, requests }) => {
      const document = await (await fetch(url)).text();
      assert.ok(document.includes(nativeEntry));
      const pending = fetch(`${url}/entry.js`);
      await waitForBlocked(proxy);
      assert.deepEqual(requests, ['/']);
      await fetch(url + proxy.proof.markerPath);
      const response = await pending;
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.equal(proxy.proof.deliveredEntries[0].markerCaptured, true);
      assert.deepEqual(proxy.proof.redirectedEntries, []);
    },
  );
});

test('absolute entries reject foreign origins, wrong ports, unlisted paths, and protocol-relative sources', async () => {
  const sources = [
    () => 'http://example.com:12345/entry.js',
    target => `http://localhost:${new URL(target).port}/entry.js`,
    target => `${target.replace(/:\d+$/u, ':1')}/entry.js`,
    target => `${target}/unlisted.js`,
    target => `${target.replace('http:', '')}/entry.js`,
    target => `${target}/entry.js?unlisted=1`,
    target => `${target}/entry.js#unlisted`,
  ];
  for (const source of sources) {
    await withAbsoluteProxy(
      {
        source: target => `${target}/entry.js`,
        entry: admitted => absoluteEntry(source(new URL(admitted).origin)),
      },
      async ({ proxy, url, requests }) => {
        const response = await fetch(url);
        assert.equal(response.status, 500);
        assert.equal(proxy.proof.blockedEntries, 0);
        assert.deepEqual(proxy.proof.entryScripts, []);
        assert.deepEqual(proxy.proof.redirectedEntries, []);
        assert.deepEqual(requests, ['/']);
      },
    );
  }
});

test('absolute mode requires an explicit loopback port and an exact same-origin source list', () => {
  for (const target of [
    'http://example.com:12345',
    'http://127.0.0.1',
    'http://localhost',
    'http://user@127.0.0.1:12345',
    'ftp://127.0.0.1:12345',
  ]) {
    assert.throws(
      () =>
        createSSRMarkerProxy({
          target,
          absoluteEntries: 'redirect',
          allowedEntrySources: [],
        }),
      /explicit owned loopback origin and port/u,
    );
  }
  const target = 'http://127.0.0.1:12345';
  assert.throws(
    () => createSSRMarkerProxy({ target, absoluteEntries: 'redirect' }),
    /exact allowed source list/u,
  );
  for (const source of [
    'http://127.0.0.1:12346/entry.js',
    'http://localhost:12345/entry.js',
    'https://127.0.0.1:12345/entry.js',
    'http://user@127.0.0.1:12345/entry.js',
    'file:///entry.js',
  ]) {
    assert.throws(
      () =>
        createSSRMarkerProxy({
          target,
          absoluteEntries: 'redirect',
          allowedEntrySources: new Set([source]),
        }),
      /exact owned target origin/u,
    );
  }
});

test('a missing marker times out an absolute barrier without issuing a redirect or native request', async () => {
  await withAbsoluteProxy(
    {
      source: target => `${target}/entry.js`,
      entry: absoluteEntry,
      options: { markerTimeout: 30 },
    },
    async ({ proxy, url, requests }) => {
      const document = await (await fetch(url)).text();
      const barrier = /\ssrc="([^"]+)"/u.exec(document)[1];
      const response = await fetch(url + barrier, { redirect: 'manual' });
      assert.equal(response.status, 500);
      assert.match(await response.text(), /SSR marker did not capture/u);
      assert.deepEqual(proxy.proof.redirectedEntries, []);
      assert.deepEqual(requests, ['/']);
    },
  );
});

test('cancellation retires an absolute barrier without a redirect or native bytes', async () => {
  const cancellation = new AbortController();
  await withAbsoluteProxy(
    {
      source: target => `${target}/entry.js`,
      entry: absoluteEntry,
      options: { signal: cancellation.signal },
    },
    async ({ proxy, url, requests }) => {
      const document = await (await fetch(url)).text();
      const barrier = /\ssrc="([^"]+)"/u.exec(document)[1];
      const pending = fetch(url + barrier, { redirect: 'manual' });
      await waitForBlocked(proxy);
      cancellation.abort(new Error('Proof retired'));
      const response = await pending;
      assert.equal(response.status, 500);
      assert.match(await response.text(), /Proof retired/u);
      assert.deepEqual(proxy.proof.redirectedEntries, []);
      assert.deepEqual(requests, ['/']);
    },
  );
});

test('closing the proxy retires pending absolute barriers', async () => {
  await withAbsoluteProxy(
    { source: target => `${target}/entry.js`, entry: absoluteEntry },
    async ({ proxy, url, requests }) => {
      const document = await (await fetch(url)).text();
      const barrier = /\ssrc="([^"]+)"/u.exec(document)[1];
      const pending = fetch(url + barrier, { redirect: 'manual' }).catch(
        error => error,
      );
      await waitForBlocked(proxy);
      await retire(proxy);
      assert.ok((await pending) instanceof Error);
      assert.deepEqual(proxy.proof.redirectedEntries, []);
      assert.deepEqual(requests, ['/']);
    },
  );
});

test('only a matching completed native carrier counts as remote SSR markup', () => {
  const markup = '<div data-testid="native-remote">server widget</div>';
  const carrier = `<div hidden data-oct-s="s1"><script type="application/json" data-octane-stream>${JSON.stringify(markup)}</script></div>`;
  const pending = decodeOctaneSSRDocument(carrier);
  assert.equal(pending.markup.includes('data-testid="native-remote"'), false);
  const unrelated = decodeOctaneSSRDocument(
    `${carrier}<script data-octane-stream>$OCTRC("s2")</script>`,
  );
  assert.equal(unrelated.markup.includes('data-testid="native-remote"'), false);
  const complete = decodeOctaneSSRDocument(
    `${carrier}<script data-octane-stream>$OCTRC("s1")</script>`,
  );
  assert.equal(complete.markup.includes('data-testid="native-remote"'), true);
  assert.equal(complete.segments[0].completed, true);
});
