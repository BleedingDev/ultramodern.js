import { createHash, webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

type RouteManifest = {
  routeAssets: Record<
    string,
    { referenceCssAssets?: string[]; assets?: string[] }
  >;
};
type FetchBinding = { fetch(request: Request): Promise<Response> };
type Bindings = { ASSETS: FetchBinding } & Record<string, FetchBinding>;
type Fragment = {
  remote: string;
  boundaryId: string;
  expose: string;
  path: string;
};
type ServiceBinding = {
  binding: string;
  prefix: string;
  fragments: Fragment[];
};
type FragmentResult = { status: 'ready' | 'degraded' };
type FragmentContext = {
  resolve(
    remote: string,
    expose: string,
    props: Record<string, unknown>,
  ): FragmentResult | Promise<FragmentResult>;
  getCurrentStylesheetHrefs(
    boundaryId?: string,
    expose?: string,
  ): string[] | undefined;
  getStylesheetHrefs(): Promise<string[]>;
};
type TemplateRuntime = {
  worker: { fetch(request: Request, env?: Bindings): Promise<Response> };
  createDistributedSsrFragmentContext(
    request: Request,
    env?: Bindings,
  ): FragmentContext | undefined;
  withRouteCssLinks(
    response: Response,
    routeInfo: typeof route,
    routeManifest: RouteManifest,
    request: Request,
    env?: Bindings,
    fragmentCss?: string[],
    fragments?: FragmentContext,
  ): Promise<Response>;
};

const route = {
  urlPath: '/',
  entryName: 'main',
  entryPath: 'html/main/index.html',
  isSSR: true,
  worker: 'worker/main.js',
};
const sentinel = '<meta data-modern-cloudflare-stylesheet-links>';
const routeLink = '<link rel="stylesheet" href="/static/main.css">';
const encoder = new TextEncoder();
let templateSource: string;

beforeAll(async () => {
  const directory = path.resolve(__dirname, '../../src/templates');
  const filenames = (await fs.readdir(directory))
    .filter(filename => /^cloudflare-entry\.\d{3}-.*\.mjs$/.test(filename))
    .sort();
  templateSource = (
    await Promise.all(
      filenames.map(filename =>
        fs.readFile(path.join(directory, filename), 'utf8'),
      ),
    )
  ).join('\n');
});

function emittedRuntime(
  fetchRemote: (input: string) => Promise<Response> = async input => {
    throw new Error(`Unexpected remote request: ${input}`);
  },
  options: {
    serviceBindings?: ServiceBinding[];
    workerModule?: Record<string, unknown>;
    moduleFederation?: {
      name: string;
      exposes: { path: string; css: string[] }[];
      routeCss?: string[];
    };
  } = {},
): TemplateRuntime {
  // Run every shipped fragment; the decorator itself is not replaced.
  const source = templateSource
    .replace('export const modernWorkerManifest', 'const modernWorkerManifest')
    .replace('export default {', 'const worker = {');
  return new Function(
    'p_workerManifest',
    'p_workerModuleLoaders',
    'fetch',
    'crypto',
    `${source}\nreturn { worker, withRouteCssLinks, createDistributedSsrFragmentContext };`,
  )(
    {
      routeSpec: { routes: [route] },
      resources: {
        routeManifest: 'routes-manifest.json',
        loadableStats: 'loadable-stats.json',
      },
      serviceBindings: options.serviceBindings,
      moduleFederation: options.moduleFederation,
    },
    { [route.worker]: async () => options.workerModule ?? {} },
    fetchRemote,
    webcrypto,
  ) as TemplateRuntime;
}

function decorate(
  response: Response,
  options: {
    runtime?: TemplateRuntime;
    assets?: string[];
    env?: Bindings;
    fragmentCss?: string[];
    fragments?: FragmentContext;
  } = {},
) {
  return (options.runtime ?? emittedRuntime()).withRouteCssLinks(
    response,
    route,
    {
      routeAssets: { main: { assets: options.assets ?? ['static/main.css'] } },
    },
    new Request('https://worker.example/'),
    options.env,
    options.fragmentCss,
    options.fragments,
  );
}

function htmlResponse(body: BodyInit | null) {
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function chunkedBody(chunks: Uint8Array[]) {
  let index = 0;
  let pulls = 0;
  const cancellations: unknown[] = [];
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else controller.close();
      },
      cancel(reason) {
        cancellations.push(reason);
      },
    },
    { highWaterMark: 0 },
  );
  return { body, cancellations, pulls: () => pulls };
}

function textChunks(chunks: string[]) {
  return chunkedBody(chunks.map(chunk => encoder.encode(chunk)));
}

function readerFor(response: Response) {
  if (!response.body) throw new Error('Expected a response body');
  return response.body.getReader();
}

function verifiedFragmentResponse(
  fragment: Fragment,
  stylesheetAssets: string[],
) {
  const html =
    `<section data-modern-boundary-id="${fragment.boundaryId}" ` +
    `data-modern-mf-expose="${fragment.expose}">verified fragment</section>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-modern-distributed-ssr-css': JSON.stringify(stylesheetAssets),
      'x-modern-distributed-ssr-provenance': encodeURIComponent(
        JSON.stringify({
          boundaryId: fragment.boundaryId,
          expose: fragment.expose,
          remote: fragment.remote,
          buildMarker: 'verified-build',
          sourceRevision: 'verified-revision',
          unitId: `fixture/${fragment.remote}`,
          digest: createHash('sha256').update(html).digest('hex'),
        }),
      ),
    },
  });
}

it('does not pull or lock the producer before consumption and forwards cancellation before the first read', async () => {
  const source = textChunks(['<html><head></head><body>held shell']);
  const response = await decorate(htmlResponse(source.body));
  expect(source.pulls()).toBe(0);
  expect(source.body.locked).toBe(false);
  expect(response.body?.locked).toBe(false);

  const reason = new Error('cancel before shell');
  await response.body?.cancel(reason);
  await response.body?.cancel(reason);
  expect(source.cancellations).toEqual([reason]);
  expect(source.pulls()).toBe(0);
  expect(source.body.locked).toBe(false);
});

it('delivers the shell while deferred work is held and preserves the remaining bytes', async () => {
  const release = Promise.withResolvers<void>();
  let deferredFinished = false;
  let pulls = 0;
  const shell = `<html><head>${sentinel}</head><body><main>shell</main>`;
  const tail = '<section>deferred 🌾</section></body></html>';
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(encoder.encode(shell));
          return;
        }
        await release.promise;
        deferredFinished = true;
        controller.enqueue(encoder.encode(tail));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const response = await decorate(htmlResponse(body));
  const reader = readerFor(response);
  try {
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value).toEqual(
      encoder.encode(shell.replace(sentinel, routeLink)),
    );
    expect(deferredFinished).toBe(false);
    expect(pulls).toBe(1);

    const pendingTail = reader.read();
    expect(deferredFinished).toBe(false);
    release.resolve();
    expect((await pendingTail).value).toEqual(encoder.encode(tail));
    expect(await reader.read()).toEqual({ value: undefined, done: true });
    expect(deferredFinished).toBe(true);
    expect(body.locked).toBe(false);
  } finally {
    release.resolve();
    await reader.cancel();
    reader.releaseLock();
  }
});

it('forwards cancellation after shell delivery to the producer exactly once', async () => {
  const deferredEntered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const cancellations: unknown[] = [];
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(encoder.encode('<html><head></head><body>shell'));
          return;
        }
        deferredEntered.resolve();
        await release.promise;
        if (cancelled) return;
        controller.enqueue(
          encoder.encode('<section>deferred content</section>'),
        );
      },
      cancel(reason) {
        cancellations.push(reason);
        cancelled = true;
        release.resolve();
      },
    },
    { highWaterMark: 0 },
  );
  const response = await decorate(htmlResponse(body));
  const reader = readerFor(response);
  try {
    expect((await reader.read()).value).toEqual(
      encoder.encode(`<html><head>${routeLink}</head><body>shell`),
    );
    expect(pulls).toBe(1);
    const pendingRead = reader.read();
    await deferredEntered.promise;
    const reason = { cause: 'consumer abandoned deferred rendering' };
    await reader.cancel(reason);
    await expect(pendingRead).resolves.toEqual({
      value: undefined,
      done: true,
    });
    reader.releaseLock();
    await response.body?.cancel(reason);
    expect(cancellations).toEqual([reason]);
    expect(body.locked).toBe(false);
  } finally {
    release.resolve();
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
});

it('retains the original producer error after a successful shell read', async () => {
  const failure = new Error('native deferred renderer failed');
  let pulls = 0;
  let cleanups = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(encoder.encode('<html><head></head><body>shell'));
        } else {
          cleanups += 1;
          controller.error(failure);
        }
      },
      cancel() {
        cleanups += 1;
      },
    },
    { highWaterMark: 0 },
  );
  const response = await decorate(htmlResponse(body));
  const reader = readerFor(response);
  expect((await reader.read()).value).toEqual(
    encoder.encode(`<html><head>${routeLink}</head><body>shell`),
  );
  await expect(reader.read()).rejects.toBe(failure);
  expect(cleanups).toBe(1);
  expect(body.locked).toBe(false);
  reader.releaseLock();
});

it('preserves response metadata and repeated cookies while removing transformed content length', async () => {
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'content-length': '44',
    'x-native-renderer': 'preserved',
    link: '</static/font.woff2>; rel=preload; as=font',
  });
  headers.append('set-cookie', 'session=one; Path=/; HttpOnly');
  headers.append('set-cookie', 'csrf=two; Path=/; SameSite=Lax');
  const response = await decorate(
    new Response('<html><head></head><body>shell</body></html>', {
      status: 203,
      statusText: 'Native rendered response',
      headers,
    }),
  );
  expect(response.status).toBe(203);
  expect(response.statusText).toBe('Native rendered response');
  expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
  expect(response.headers.get('x-native-renderer')).toBe('preserved');
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(response.headers.get('content-length')).toBeNull();
  expect(response.headers.get('link')).toBe(
    '</static/font.woff2>; rel=preload; as=font, </static/main.css>; rel=preload; as=style',
  );
  expect(await response.text()).toBe(
    `<html><head>${routeLink}</head><body>shell</body></html>`,
  );
});

it('preserves split UTF-8 and tags with quoted greater-than characters byte for byte', async () => {
  const chunks = [
    '<html><he',
    `ad>${sentinel}<link rel="style`,
    'sheet" href="/static/main.css" title="authored > route CSS">',
    '</he',
    'ad><body><section title="value > boundary">farm ',
    '🌾',
    '</section></body></html>',
  ];
  const utf8 = encoder.encode(chunks[5]);
  const source = chunkedBody([
    ...chunks.slice(0, 5).map(chunk => encoder.encode(chunk)),
    utf8.slice(0, 1),
    utf8.slice(1, 3),
    utf8.slice(3),
    encoder.encode(chunks[6]),
  ]);
  const response = await decorate(htmlResponse(source.body));
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    encoder.encode(chunks.join('').replace(sentinel, '')),
  );
  expect(source.cancellations).toEqual([]);
});

it('preserves split raw text and comments without interpreting fake links or remote markers', async () => {
  const fake =
    '<link rel="stylesheet" href="/static/main.css"><section data-modern-boundary-id="fake" data-modern-mf-expose="./Fake">';
  const chunks = [
    `<html><head>${sentinel}</head><body><scr`,
    `ipt>const html = '${fake}${sentinel}';</scr`,
    'ipt><sty',
    `le>.example::before{content:'${fake}';}</sty`,
    'le><!',
    `--${fake}`,
    '-',
    `-><title>${fake}</tit`,
    `le><textarea>${fake}</text`,
    'area><p>real content</p></body></html>',
  ];
  const source = textChunks(chunks);
  const response = await decorate(htmlResponse(source.body), {
    env: {
      ASSETS: {
        async fetch(request) {
          throw new Error(`Fake remote marker requested ${request.url}`);
        },
      },
    },
  });
  const input = chunks.join('');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    encoder.encode(input.replace(sentinel, routeLink)),
  );
});

it('keeps authored stylesheet integrity and crossorigin when its tag follows the sentinel', async () => {
  const authored =
    '<link rel="stylesheet" href="https://worker.example/static/main.css" integrity="sha384-authored" crossorigin="anonymous">';
  const source = textChunks([
    `<html><head>${sentinel}`,
    authored.slice(0, 44),
    authored.slice(44),
    '</head><body>',
    '<link rel="stylesheet" href="/static/main.css">',
    '</body></html>',
  ]);
  const response = await decorate(htmlResponse(source.body));
  expect(await response.text()).toBe(
    `<html><head>${authored}</head><body></body></html>`,
  );
});

it('recognizes valid stylesheet rel values regardless of ASCII case', async () => {
  const authored =
    '<LINK REL="StyleSheet" HREF="/static/main.css" integrity="sha384-case" crossorigin="anonymous">';
  const source = textChunks([
    `<html><head>${sentinel}`,
    authored,
    '</head><body></body></html>',
  ]);
  const response = await decorate(htmlResponse(source.body));
  expect(await response.text()).toBe(
    `<html><head>${authored}</head><body></body></html>`,
  );
});

it('discovers split rendered remote markers and inserts each missing React resource before its first marker', async () => {
  const remoteRequests: string[] = [];
  const jsonByUrl: Record<string, unknown> = {
    'https://remote.example/catalog/mf-manifest.json': {
      metaData: { publicPath: 'auto' },
      exposes: [
        {
          path: './Catalog',
          assets: {
            css: { sync: ['static/catalog.css', 'static/shared.css'] },
          },
        },
      ],
    },
    'https://remote.example/catalog/routes-manifest.json': {
      routeAssets: {
        main: { assets: ['static/shared.css', 'static/catalog-route.css'] },
      },
    },
    'https://remote.example/billing/mf-manifest.json': {
      exposes: [
        {
          path: './Billing',
          assets: { css: { sync: ['static/billing.css'] } },
        },
      ],
    },
    'https://remote.example/billing/routes-manifest.json': { routeAssets: {} },
  };
  const runtime = emittedRuntime(async input => {
    remoteRequests.push(input);
    if (!Object.hasOwn(jsonByUrl, input)) {
      throw new Error(`Unexpected remote asset ${input}`);
    }
    return Response.json(jsonByUrl[input]);
  });
  const env: Bindings = {
    ASSETS: {
      async fetch(request) {
        expect(new URL(request.url).pathname).toBe('/mf-manifest.json');
        return Response.json({
          remotes: [
            {
              alias: 'catalog',
              federationContainerName: 'catalog_container',
              entry: 'https://remote.example/catalog/mf-manifest.json',
            },
            {
              alias: 'billing',
              entry: 'https://remote.example/billing/mf-manifest.json',
            },
          ],
        });
      },
    },
  };
  const authored =
    '<link rel="stylesheet" href="https://remote.example/catalog/static/catalog.css" integrity="sha384-catalog" crossorigin="anonymous">';
  const catalogMarker =
    '<section title="rendered > catalog" data-modern-boundary-id="catalog_container" data-modern-mf-expose="./Catalog">catalog</section>';
  const billingMarker =
    '<section data-modern-mf-expose="./Billing" data-modern-boundary-id="billing">billing</section>';
  const source = textChunks([
    `<html><head>${sentinel}${authored}</head><body>shell`,
    catalogMarker.slice(0, 84),
    catalogMarker.slice(84),
    billingMarker,
    catalogMarker,
    '</body></html>',
  ]);
  const resource = (href: string) =>
    `<link href="${href}" rel="stylesheet" type="text/css" data-precedence="default">`;
  const response = await decorate(htmlResponse(source.body), { runtime, env });
  expect(await response.text()).toBe(
    `<html><head>${routeLink}${authored}</head><body>shell` +
      resource('https://remote.example/catalog/static/shared.css') +
      resource('https://remote.example/catalog/static/catalog-route.css') +
      catalogMarker +
      resource('https://remote.example/billing/static/billing.css') +
      billingMarker +
      catalogMarker +
      '</body></html>',
  );
  expect(remoteRequests).toEqual(Object.keys(jsonByUrl));
});

it('delivers the shell before delayed remote discovery when both arrive in one producer chunk', async () => {
  const discoveryEntered = Promise.withResolvers<void>();
  const releaseManifest = Promise.withResolvers<void>();
  let discoveryFinished = false;
  const manifestUrl = 'https://remote.example/catalog/mf-manifest.json';
  const routesUrl = 'https://remote.example/catalog/routes-manifest.json';
  const remoteRequests: string[] = [];
  const runtime = emittedRuntime(async input => {
    remoteRequests.push(input);
    if (input === manifestUrl) {
      discoveryEntered.resolve();
      await releaseManifest.promise;
      discoveryFinished = true;
      return Response.json({
        exposes: [
          {
            path: './Catalog',
            assets: { css: { sync: ['static/catalog.css'] } },
          },
        ],
      });
    }
    if (input === routesUrl) return Response.json({ routeAssets: {} });
    throw new Error(`Unexpected remote request ${input}`);
  });
  const env: Bindings = {
    ASSETS: {
      async fetch(request) {
        expect(new URL(request.url).pathname).toBe('/mf-manifest.json');
        return Response.json({
          remotes: [{ alias: 'catalog', entry: manifestUrl }],
        });
      },
    },
  };
  const shell = `<html><head>${sentinel}</head><body><main>shell</main>`;
  const marker =
    '<section data-modern-boundary-id="catalog" data-modern-mf-expose="./Catalog">catalog</section>';
  const tail = '</body></html>';
  const source = textChunks([shell + marker + tail]);
  const response = await decorate(htmlResponse(source.body), { runtime, env });
  const reader = readerFor(response);
  try {
    const first = await reader.read();
    expect(first.value).toEqual(
      encoder.encode(shell.replace(sentinel, routeLink)),
    );
    expect(first.done).toBe(false);
    expect(discoveryFinished).toBe(false);

    const deferredRead = reader.read();
    await discoveryEntered.promise;
    expect(discoveryFinished).toBe(false);
    expect(source.pulls()).toBe(1);
    releaseManifest.resolve();
    expect((await deferredRead).value).toEqual(
      encoder.encode(
        '<link href="https://remote.example/catalog/static/catalog.css" rel="stylesheet" type="text/css" data-precedence="default">' +
          marker +
          tail,
      ),
    );
    expect(await reader.read()).toEqual({ value: undefined, done: true });
    expect(remoteRequests).toEqual([manifestUrl, routesUrl]);
    expect(source.body.locked).toBe(false);
  } finally {
    releaseManifest.resolve();
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
});

it('returns the worker response and shell while its real fragment stylesheet drain is pending', async () => {
  const fragment: Fragment = {
    remote: 'catalog',
    boundaryId: 'catalog',
    expose: './Catalog',
    path: '/fragments/catalog',
  };
  const serviceEntered = Promise.withResolvers<void>();
  const releaseService = Promise.withResolvers<void>();
  let stylesheetDrainFinished = false;
  const observed: {
    context?: FragmentContext;
    resolution?: Promise<FragmentResult>;
    drain?: Promise<string[]>;
  } = {};
  const shell = `<html><head>${sentinel}</head><body><main>early shell</main>`;
  const source = textChunks([shell, '</body></html>']);
  const runtime = emittedRuntime(undefined, {
    serviceBindings: [
      {
        binding: 'CATALOG',
        prefix: '/services/catalog',
        fragments: [fragment],
      },
    ],
    workerModule: {
      requestHandler(
        _request: Request,
        options: {
          locals: { __modernDistributedSsrFragments: FragmentContext };
        },
      ) {
        const context = options.locals.__modernDistributedSsrFragments;
        observed.context = context;
        observed.resolution = Promise.resolve(
          context.resolve('catalog', './Catalog', { view: 'pending' }),
        );
        observed.drain = context.getStylesheetHrefs().then(hrefs => {
          stylesheetDrainFinished = true;
          return hrefs;
        });
        return htmlResponse(source.body);
      },
    },
  });
  const env: Bindings = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/html/main/index.html') {
          return htmlResponse('<html><head></head><body></body></html>');
        }
        if (pathname === '/routes-manifest.json') {
          return Response.json({
            routeAssets: { main: { assets: ['static/main.css'] } },
          });
        }
        if (pathname === '/loadable-stats.json') return Response.json({});
        if (pathname === '/mf-manifest.json') {
          return Response.json({
            remotes: [
              {
                alias: 'catalog',
                entry: 'https://remote.example/catalog/mf-manifest.json',
              },
            ],
          });
        }
        throw new Error(`Unexpected worker asset ${pathname}`);
      },
    },
    CATALOG: {
      async fetch() {
        serviceEntered.resolve();
        await releaseService.promise;
        return verifiedFragmentResponse(fragment, ['static/catalog.css']);
      },
    },
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await runtime.worker.fetch(
      new Request('https://worker.example/'),
      env,
    );
    await serviceEntered.promise;
    expect(stylesheetDrainFinished).toBe(false);
    expect(source.pulls()).toBe(0);
    expect(source.body.locked).toBe(false);
    reader = readerFor(response);
    expect((await reader.read()).value).toEqual(
      encoder.encode(shell.replace(sentinel, routeLink)),
    );
    expect(stylesheetDrainFinished).toBe(false);
    expect(observed.context?.getCurrentStylesheetHrefs()).toEqual([]);
    expect(source.pulls()).toBe(1);

    releaseService.resolve();
    await expect(observed.resolution).resolves.toMatchObject({
      status: 'ready',
    });
    await expect(observed.drain).resolves.toEqual([
      'https://remote.example/catalog/static/catalog.css',
    ]);
    expect(stylesheetDrainFinished).toBe(true);
  } finally {
    releaseService.resolve();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    await observed.resolution;
    await observed.drain;
  }
});

it('reads fresh verified fragment CSS for later markers and repeated markers without public discovery', async () => {
  const catalog: Fragment = {
    remote: 'catalog',
    boundaryId: 'catalog',
    expose: './Catalog',
    path: '/fragments/catalog',
  };
  const billing: Fragment = {
    remote: 'billing',
    boundaryId: 'billing',
    expose: './Billing',
    path: '/fragments/billing',
  };
  const releaseBilling = Promise.withResolvers<void>();
  const publicRequests: string[] = [];
  const runtime = emittedRuntime(
    async input => {
      publicRequests.push(input);
      throw new Error(
        `Verified service CSS requested public manifest ${input}`,
      );
    },
    {
      serviceBindings: [
        {
          binding: 'CATALOG',
          prefix: '/services/catalog',
          fragments: [catalog],
        },
        {
          binding: 'BILLING',
          prefix: '/services/billing',
          fragments: [billing],
        },
      ],
    },
  );
  const env: Bindings = {
    ASSETS: {
      async fetch(request) {
        expect(new URL(request.url).pathname).toBe('/mf-manifest.json');
        return Response.json({
          remotes: [catalog, billing].map(fragment => ({
            alias: fragment.remote,
            entry: `https://remote.example/${fragment.remote}/mf-manifest.json`,
          })),
        });
      },
    },
    CATALOG: {
      async fetch(request) {
        const props = JSON.parse(
          decodeURIComponent(
            request.headers.get('x-modern-distributed-ssr-props') ?? '',
          ),
        );
        return verifiedFragmentResponse(
          catalog,
          props.version === 'later'
            ? ['static/catalog.css', 'static/catalog-later.css']
            : ['static/catalog.css'],
        );
      },
    },
    BILLING: {
      async fetch() {
        await releaseBilling.promise;
        return verifiedFragmentResponse(billing, ['static/billing.css']);
      },
    },
  };
  const context = runtime.createDistributedSsrFragmentContext(
    new Request('https://worker.example/'),
    env,
  );
  if (!context) throw new Error('Configured fragment context is absent');
  await expect(
    Promise.resolve(
      context.resolve('catalog', './Catalog', { version: 'initial' }),
    ),
  ).resolves.toMatchObject({ status: 'ready' });
  const pendingBilling = Promise.resolve(
    context.resolve('billing', './Billing', { version: 'initial' }),
  );
  const shell = `<html><head>${sentinel}</head><body>shell`;
  const catalogMarker =
    '<section data-modern-boundary-id="catalog" data-modern-mf-expose="./Catalog">catalog</section>';
  const billingMarker =
    '<section data-modern-boundary-id="billing" data-modern-mf-expose="./Billing">billing</section>';
  const tail = '</body></html>';
  const source = textChunks([
    shell,
    catalogMarker,
    billingMarker,
    billingMarker,
    catalogMarker + tail,
  ]);
  const resource = (href: string) =>
    `<link href="${href}" rel="stylesheet" type="text/css" data-precedence="default">`;
  const response = await decorate(htmlResponse(source.body), {
    runtime,
    env,
    fragments: context,
  });
  const reader = readerFor(response);
  try {
    expect((await reader.read()).value).toEqual(
      encoder.encode(
        shell.replace(
          sentinel,
          routeLink +
            resource('https://remote.example/catalog/static/catalog.css'),
        ),
      ),
    );
    expect((await reader.read()).value).toEqual(encoder.encode(catalogMarker));
    expect(context.getCurrentStylesheetHrefs('billing', './Billing')).toEqual(
      [],
    );
    expect((await reader.read()).value).toEqual(encoder.encode(billingMarker));
    expect(publicRequests).toEqual([]);

    releaseBilling.resolve();
    await expect(pendingBilling).resolves.toMatchObject({ status: 'ready' });
    expect((await reader.read()).value).toEqual(
      encoder.encode(
        resource('https://remote.example/billing/static/billing.css') +
          billingMarker,
      ),
    );
    await expect(
      Promise.resolve(
        context.resolve('catalog', './Catalog', { version: 'later' }),
      ),
    ).resolves.toMatchObject({ status: 'ready' });
    expect((await reader.read()).value).toEqual(
      encoder.encode(
        resource('https://remote.example/catalog/static/catalog-later.css') +
          catalogMarker +
          tail,
      ),
    );
    expect(await reader.read()).toEqual({ value: undefined, done: true });
    expect(publicRequests).toEqual([]);
    expect(source.body.locked).toBe(false);
  } finally {
    releaseBilling.resolve();
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await pendingBilling;
  }
});

it('preserves custom elements without treating their tag prefixes as raw text or stylesheet links', async () => {
  const manifestUrl = 'https://remote.example/catalog/mf-manifest.json';
  const routesUrl = 'https://remote.example/catalog/routes-manifest.json';
  const cssHref = 'https://remote.example/catalog/static/catalog.css';
  const remoteRequests: string[] = [];
  const runtime = emittedRuntime(async input => {
    remoteRequests.push(input);
    if (input === manifestUrl) {
      return Response.json({
        exposes: [
          {
            path: './Catalog',
            assets: { css: { sync: ['static/catalog.css'] } },
          },
        ],
      });
    }
    if (input === routesUrl) return Response.json({ routeAssets: {} });
    throw new Error(`Unexpected remote request ${input}`);
  });
  const env: Bindings = {
    ASSETS: {
      async fetch(request) {
        expect(new URL(request.url).pathname).toBe('/mf-manifest.json');
        return Response.json({
          remotes: [{ alias: 'catalog', entry: manifestUrl }],
        });
      },
    },
  };
  const shell = `<html><head>${sentinel}</head><body>`;
  const customElements =
    '<script-card><style-guide>custom content</style-guide></script-card>' +
    '<title-card>custom title</title-card><textarea-card>custom text</textarea-card>' +
    `<link-card rel="stylesheet" href="${cssHref}">custom link</link-card>`;
  const marker =
    '<section data-modern-boundary-id="catalog" data-modern-mf-expose="./Catalog">catalog</section>';
  const tail = '</body></html>';
  const source = textChunks([shell + customElements, marker + tail]);
  const response = await decorate(htmlResponse(source.body), { runtime, env });
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    encoder.encode(
      shell.replace(sentinel, routeLink) +
        customElements +
        `<link href="${cssHref}" rel="stylesheet" type="text/css" data-precedence="default">` +
        marker +
        tail,
    ),
  );
  expect(remoteRequests).toEqual([manifestUrl, routesUrl]);
});

it.each([
  {
    name: 'unterminated tag',
    chunks: [
      '<html><head></head><body>',
      `<section title="${'x'.repeat(64 * 1024)}`,
    ],
    message: /unterminated tag larger than 64 KiB/,
  },
  {
    name: 'unclosed head',
    chunks: [
      '<html><head>',
      ...Array.from({ length: 4 }, () => 'x'.repeat(64 * 1024)),
    ],
    message: /head exceeds 256 KiB/,
  },
])(
  'bounds an incomplete $name and cancels its producer with the same failure',
  async ({ chunks, message }) => {
    const source = textChunks([...chunks, '<p>must remain unconsumed</p>']);
    const response = await decorate(htmlResponse(source.body));
    const failure = await response.text().then(
      () => {
        throw new Error('Oversized HTML unexpectedly completed');
      },
      error => error,
    );
    expect(failure).toBeInstanceOf(RangeError);
    expect(failure.message).toMatch(message);
    expect(source.cancellations).toEqual([failure]);
    expect(source.pulls()).toBe(chunks.length);
    expect(source.body.locked).toBe(false);
  },
);

it('includes generated sentinel links and the closing tag in the head size bound', async () => {
  const source = textChunks([
    '<html><head>',
    'x'.repeat(256 * 1024 - '<head>'.length - routeLink.length),
    sentinel,
    '</head>',
    '<body>must remain unconsumed</body></html>',
  ]);
  const response = await decorate(htmlResponse(source.body));
  const failure = await response.text().then(
    () => {
      throw new Error('Transformed oversized head unexpectedly completed');
    },
    error => error,
  );
  expect(failure).toBeInstanceOf(RangeError);
  expect(failure.message).toMatch(/head exceeds 256 KiB/);
  expect(source.cancellations).toEqual([failure]);
  expect(source.pulls()).toBe(4);
  expect(source.body.locked).toBe(false);
});

it.each([
  ['null HTML body', null, 'text/html; charset=utf-8', '0'],
  ['native Flight body', 'native Flight bytes', 'text/x-component', '19'],
] as const)(
  'passes through a %s and its original content length',
  async (_name, body, contentType, contentLength) => {
    const original = new Response(body, {
      status: 202,
      headers: { 'content-type': contentType, 'content-length': contentLength },
    });
    const response = await decorate(original);
    expect(response).toBe(original);
    expect(response.headers.get('content-length')).toBe(contentLength);
    expect(await response.text()).toBe(body ?? '');
  },
);

function localFragmentRequest(boundaryId: string, expose: string) {
  return new Request('https://worker.example/en/_mf/fragment/mini-cart', {
    headers: {
      'x-modern-js-fragment-request': '1',
      'x-modern-distributed-ssr-boundary-id': boundaryId,
      'x-modern-distributed-ssr-expose': expose,
      'x-modern-distributed-ssr-props': encodeURIComponent('{}'),
      'x-modern-distributed-ssr-remote': 'checkout',
      'x-modern-distributed-ssr-source-url': 'https://shell.example/en',
    },
  });
}

it.each([
  [
    'its own expose',
    'verticalCheckout',
    './MiniCart',
    ['/static/css/async/async-index.css'],
  ],
  ['another container', 'verticalExplore', './MiniCart', []],
  ['an unpublished expose', 'verticalCheckout', './Unknown', []],
] as const)(
  'reports the rendering route stylesheets for a fragment request for %s',
  async (_name, boundaryId, expose, expected) => {
    const runtime = emittedRuntime(undefined, {
      moduleFederation: {
        name: 'verticalCheckout',
        exposes: [{ path: './MiniCart', css: [] }],
        routeCss: ['/static/css/async/async-index.css'],
      },
    });
    const response = await runtime.withRouteCssLinks(
      htmlResponse(
        `<!doctype html><html><head>${sentinel}</head><body>` +
          '<a data-modern-boundary-id="checkout" data-modern-mf-expose="./MiniCart">basket</a>' +
          '</body></html>',
      ),
      route,
      { routeAssets: { main: { assets: ['static/main.css'] } } },
      localFragmentRequest(boundaryId, expose),
    );
    expect(
      JSON.parse(
        response.headers.get('x-modern-distributed-ssr-css') ?? 'null',
      ),
    ).toEqual(expected);
  },
);
