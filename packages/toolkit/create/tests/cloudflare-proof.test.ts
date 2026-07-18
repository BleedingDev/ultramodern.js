import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const packageRoot = path.resolve(__dirname, '..');

type CloudflareProofModule = {
  resolveModuleFederationPublicPath: (
    publicPath: unknown,
    manifestUrl: URL,
  ) => string | undefined;
};

async function loadCloudflareProofModule() {
  return (await import(
    pathToFileURL(
      path.join(
        packageRoot,
        'templates/workspace-scripts/ultramodern-cloudflare-proof.mjs',
      ),
    ).href
  )) as CloudflareProofModule;
}

test('Cloudflare proof resolves MF publicPath values against the manifest URL', async () => {
  const { resolveModuleFederationPublicPath } =
    await loadCloudflareProofModule();
  const manifestUrl = new URL(
    'https://checkout.example.workers.dev/mf-manifest.json',
  );
  const expectedManifestBase = new URL('.', manifestUrl).toString();

  assert.equal(
    resolveModuleFederationPublicPath('/', manifestUrl),
    expectedManifestBase,
  );
  assert.equal(
    resolveModuleFederationPublicPath('./', manifestUrl),
    expectedManifestBase,
  );
  assert.equal(
    resolveModuleFederationPublicPath(
      'https://checkout.example.workers.dev/',
      manifestUrl,
    ),
    expectedManifestBase,
  );
  assert.equal(
    resolveModuleFederationPublicPath('assets/', manifestUrl),
    'https://checkout.example.workers.dev/assets/',
  );
  assert.notEqual(
    resolveModuleFederationPublicPath(
      'https://wrong-origin.example.com/',
      manifestUrl,
    ),
    expectedManifestBase,
  );
  assert.equal(resolveModuleFederationPublicPath('', manifestUrl), undefined);
  assert.equal(
    resolveModuleFederationPublicPath(undefined, manifestUrl),
    undefined,
  );
});

test('Cloudflare proof template asserts delivery-unit marker coupling on UI and API surfaces', () => {
  const proofTemplate = fs.readFileSync(
    path.join(
      packageRoot,
      'templates/workspace-scripts/ultramodern-cloudflare-proof.mjs',
    ),
    'utf-8',
  );

  assert.match(proofTemplate, /type: 'delivery-unit-ui-marker'/);
  assert.match(proofTemplate, /type: 'delivery-unit-api-marker'/);
  assert.match(
    proofTemplate,
    /is declared but SSR response is missing its build marker/,
  );
  assert.match(
    proofTemplate,
    /is declared but readiness response is missing its build marker/,
  );
});

test('Cloudflare version proof synthesizes a delivery-unit block per API app', () => {
  const generatorTemplate = fs.readFileSync(
    path.join(
      packageRoot,
      'templates/workspace-scripts/proof-cloudflare-version.mjs',
    ),
    'utf-8',
  );

  assert.match(generatorTemplate, /function createDeliveryUnit\(/);
  assert.match(generatorTemplate, /kind: 'microvertical-delivery-unit'/);
  assert.match(
    generatorTemplate,
    /surfaces: \{\s*ui: \{ \.\.\.identity, surface: 'ui' \},\s*api: \{ \.\.\.identity, surface: 'api' \},/,
  );
});

test('workerd SSR proof separates strict fragment evidence from body-safe API forwarding', async () => {
  const proofTemplate = fs.readFileSync(
    path.join(packageRoot, 'templates/workspace-scripts/proof-workerd-ssr.mts'),
    'utf-8',
  );
  const serviceBindingsStart = proofTemplate.indexOf(
    'const createServiceBindings =',
  );
  const proofsStart = proofTemplate.indexOf('const proofs = []');
  assert.notEqual(serviceBindingsStart, -1);
  assert.notEqual(proofsStart, -1);
  const serviceBindings = proofTemplate.slice(
    serviceBindingsStart,
    proofsStart,
  );

  assert.match(
    proofTemplate,
    /const DISTRIBUTED_SSR_FRAGMENT_REQUEST_HEADER =\s*"x-modern-js-fragment-request"/u,
  );
  for (const requiredHeader of [
    'x-modern-distributed-ssr-boundary-id',
    'x-modern-distributed-ssr-expose',
    'x-modern-distributed-ssr-props',
    'x-modern-distributed-ssr-remote',
    'x-modern-distributed-ssr-source-url',
  ]) {
    assert.match(
      proofTemplate,
      new RegExp(`"${requiredHeader}"`, 'u'),
      `fragment proof must require ${requiredHeader}`,
    );
  }
  assert.match(
    serviceBindings,
    /if \(isDistributedSsrFragmentRequest\(request\)\) \{/u,
  );
  assert.match(serviceBindings, /fragmentBindingRequests\.push\(\{/u);
  assert.match(
    serviceBindings,
    /apiBindingRequests\.push\(apiBindingRequest\)/u,
  );
  assert.match(serviceBindings, /method: request\.method/u);
  assert.match(
    serviceBindings,
    /const response = await target\.fetch\(request\);/u,
  );
  assert.match(serviceBindings, /status: response\.status/u);
  assert.match(serviceBindings, /return response;/u);
  assert.doesNotMatch(
    serviceBindings,
    /(?:request|response)\.(?:arrayBuffer|blob|bytes|clone|formData|json|text)\(/u,
    'ordinary API evidence must not clone or consume request or response bodies',
  );
  assert.match(proofTemplate, /fragmentBindingRequests:/u);
  assert.match(proofTemplate, /apiBindingRequests:/u);
  assert.doesNotMatch(proofTemplate, /\bbindingRequests:/u);

  const classifierStart = proofTemplate.indexOf(
    'const isDistributedSsrFragmentRequest =',
  );
  assert.notEqual(classifierStart, -1);
  const createServiceBindings = vm.runInNewContext(
    `${proofTemplate.slice(classifierStart, proofsStart)}
createServiceBindings;`,
    {
      DISTRIBUTED_SSR_FRAGMENT_REQUEST_HEADER: 'x-modern-js-fragment-request',
      DISTRIBUTED_SSR_REQUIRED_HEADERS: [
        'x-modern-distributed-ssr-boundary-id',
        'x-modern-distributed-ssr-expose',
        'x-modern-distributed-ssr-props',
        'x-modern-distributed-ssr-remote',
        'x-modern-distributed-ssr-source-url',
      ],
      URL,
      assert(condition: unknown, message: string) {
        if (!condition) {
          throw new Error(message);
        }
      },
    },
  ) as (
    caller: {
      id: string;
      wrangler: {
        services: Array<{ binding: string; service: string }>;
      };
    },
    evidence: {
      apiBindingRequests: Array<Record<string, unknown>>;
      failedServices: Set<string>;
      fragmentBindingRequests: Array<Record<string, unknown>>;
    },
  ) => Record<
    string,
    (
      request: Request,
      miniflare: {
        getWorker: (
          service: string,
        ) => Promise<{ fetch: (request: Request) => Promise<Response> }>;
      },
    ) => Promise<Response>
  >;

  const evidence = {
    apiBindingRequests: [] as Array<Record<string, unknown>>,
    failedServices: new Set<string>(),
    fragmentBindingRequests: [] as Array<Record<string, unknown>>,
  };
  let forwardedRequest: Request | undefined;
  let forwardedBody: string | undefined;
  const targetResponse = Response.json(
    { accepted: true },
    {
      headers: { 'x-proof-response': 'original' },
      status: 201,
    },
  );
  const bindings = createServiceBindings(
    {
      id: 'shell',
      wrangler: {
        services: [{ binding: 'CATALOG', service: 'catalog-worker' }],
      },
    },
    evidence,
  );
  const apiRequest = new Request('https://shell.example/catalog-api/catalog', {
    body: JSON.stringify({ title: 'body-survives' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

  const response = await bindings.CATALOG(apiRequest, {
    async getWorker() {
      return {
        async fetch(request) {
          forwardedRequest = request;
          forwardedBody = await request.text();
          return targetResponse;
        },
      };
    },
  });

  assert.equal(response, targetResponse);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('x-proof-response'), 'original');
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(forwardedRequest, apiRequest);
  assert.equal(forwardedBody, '{"title":"body-survives"}');
  assert.deepEqual(evidence.fragmentBindingRequests, []);
  assert.deepEqual(JSON.parse(JSON.stringify(evidence.apiBindingRequests)), [
    {
      binding: 'CATALOG',
      callerId: 'shell',
      method: 'POST',
      pathname: '/catalog-api/catalog',
      requestBody: {
        contentLength: null,
        contentType: 'application/json',
        present: true,
      },
      response: {
        contentType: 'application/json',
        status: 201,
      },
      service: 'catalog-worker',
    },
  ]);
});

test('workerd proof binds selected modules and API responses to the executed envelope', () => {
  const proofTemplate = fs.readFileSync(
    path.join(packageRoot, 'templates/workspace-scripts/proof-workerd-ssr.mts'),
    'utf-8',
  );

  assert.match(proofTemplate, /release\/microvertical-release-envelope\.json/u);
  assert.match(
    proofTemplate,
    /selected module \$\{logicalPath\} is not envelope-bound/u,
  );
  assert.match(
    proofTemplate,
    /envelope\.identity\?\.unitId === expectedUnitId/u,
  );
  assert.match(proofTemplate, /rawApp\.deliveryUnit\?\.unitId/u);
  assert.match(
    proofTemplate,
    /Miniflare main\/SSR modules are not envelope-bound SSR surfaces/u,
  );
  assert.match(
    proofTemplate,
    /BFF worker surface is not selected by Miniflare/u,
  );
  assert.match(
    proofTemplate,
    /artifact\.byteLength === bytes\.byteLength && artifact\.sha256 === digest/u,
  );
  assert.match(
    proofTemplate,
    /await miniflare\.getWorker\(workerName\(app\)\)/u,
  );
  assert.match(proofTemplate, /await miniflare\.dispatchFetch\(/u);
  assert.match(
    proofTemplate,
    /API response is not tied to its executed release identity/u,
  );
  assert.match(proofTemplate, /bodyBase64: bytes\.toString\("base64"\)/u);
  assert.match(proofTemplate, /schemaVersion: 3/u);
  assert.match(proofTemplate, /executions,/u);
  assert.match(proofTemplate, /apiProofs,/u);
  assert.match(
    proofTemplate,
    /if \(process\.env\.ULTRAMODERN_KEEP_WORKERD === "1"\) \{\s*writeReport\(\);/u,
    'strict browser acceptance must be able to consume the correlation report while workerd is running',
  );
});
