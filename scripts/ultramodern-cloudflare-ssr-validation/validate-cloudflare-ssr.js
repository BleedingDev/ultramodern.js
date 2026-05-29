#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEMA_VERSION = 1;
const DEFAULT_OUTPUT_DIR = '.output';
const DEFAULT_REPORT_FILE = 'cloudflare-ssr-validation.json';
const DEFAULT_ROUTES = {
  en: '/en',
  cs: '/cs',
  locale: '/locales/en/translation.json',
  mfManifest: '/mf-manifest.json',
  bff: '/explore-api/effect/explore/readiness',
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pathExists(filePath) {
  return fs.existsSync(filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listFiles(dirPath) {
  if (!pathExists(dirPath)) {
    return [];
  }

  const files = [];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(path.relative(dirPath, fullPath).replace(/\\/g, '/'));
      }
    }
  }

  return files.sort();
}

function assertFile(filePath, message) {
  if (!pathExists(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${message}: ${filePath}`);
  }
}

function assertDirectory(dirPath, message) {
  if (!pathExists(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`${message}: ${dirPath}`);
  }
}

function resolveOutputPaths({
  rootDir = process.cwd(),
  outputDir = DEFAULT_OUTPUT_DIR,
}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedOutputDir = path.resolve(resolvedRootDir, outputDir);
  const wranglerPath = path.join(resolvedOutputDir, 'wrangler.json');

  assertDirectory(resolvedOutputDir, 'Cloudflare output directory is missing');
  assertFile(
    path.join(resolvedOutputDir, 'server', 'index.mjs'),
    'Cloudflare Worker entry is missing',
  );
  assertFile(wranglerPath, 'Cloudflare wrangler metadata is missing');

  const wrangler = readJson(wranglerPath);
  if (!isRecord(wrangler.assets)) {
    throw new Error('wrangler.json must define an assets binding');
  }
  if (wrangler.assets.binding !== 'ASSETS') {
    throw new Error(
      `wrangler assets.binding must be ASSETS; received ${wrangler.assets.binding}`,
    );
  }
  if (typeof wrangler.assets.directory !== 'string') {
    throw new Error('wrangler assets.directory must be a string');
  }

  const publicDir = path.resolve(resolvedOutputDir, wrangler.assets.directory);
  assertDirectory(publicDir, 'Cloudflare ASSETS directory is missing');

  return {
    rootDir: resolvedRootDir,
    outputDir: resolvedOutputDir,
    publicDir,
    wrangler,
    workerEntry: path.join(resolvedOutputDir, 'server', 'index.mjs'),
    workerManifestPath: path.join(
      resolvedOutputDir,
      'server',
      'modern-worker-manifest.json',
    ),
  };
}

function createContentType(filePath) {
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (filePath.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  return 'application/octet-stream';
}

function createAssetBinding(publicDir) {
  const assetRoot = path.resolve(publicDir);

  return {
    fetch: async request => {
      const { pathname } = new URL(request.url);
      const filePath = path.resolve(assetRoot, `.${pathname}`);
      const relativePath = path.relative(assetRoot, filePath);

      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return new Response('Forbidden', { status: 403 });
      }

      if (!pathExists(filePath) || !fs.statSync(filePath).isFile()) {
        return new Response('Not found', { status: 404 });
      }

      return new Response(fs.readFileSync(filePath), {
        status: 200,
        headers: {
          'content-type': createContentType(filePath),
        },
      });
    },
  };
}

async function importWorker(workerEntry) {
  const url = `${pathToFileURL(workerEntry).href}?t=${Date.now()}`;
  const mod = await import(url);
  const worker = mod.default ?? mod;

  if (!worker || typeof worker.fetch !== 'function') {
    throw new Error('Cloudflare Worker entry must export a fetch handler');
  }

  return worker;
}

async function fetchWorkerRoute({
  worker,
  publicDir,
  urlPath,
  baseUrl = 'https://modernjs.local',
}) {
  const request = new Request(new URL(urlPath, baseUrl));
  const response = await worker.fetch(request, {
    ASSETS: createAssetBinding(publicDir),
  });
  const body = await response.text();

  return {
    path: urlPath,
    status: response.status,
    contentType: response.headers.get('content-type'),
    body,
  };
}

async function fetchHttpRoute({
  fetchImpl = globalThis.fetch,
  urlPath,
  baseUrl,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('global fetch is not available in this Node runtime.');
  }
  const response = await fetchImpl(new URL(urlPath, baseUrl));
  const body = await response.text();

  return {
    path: urlPath,
    status: response.status,
    contentType: response.headers.get('content-type'),
    body,
  };
}

function parseMaybeJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function findBuildMarker(value) {
  if (!isRecord(value)) {
    return undefined;
  }
  if (isRecord(value.marker) && typeof value.marker.build === 'string') {
    return value.marker.build;
  }
  if (typeof value.build === 'string') {
    return value.build;
  }
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const marker = findBuildMarker(item);
        if (marker) {
          return marker;
        }
      }
    } else {
      const marker = findBuildMarker(nested);
      if (marker) {
        return marker;
      }
    }
  }
  return undefined;
}

function extractUiBuildMarker(html) {
  const match = html.match(/data-build-marker=["']([^"']+)["']/u);
  return match?.[1];
}

function assertSuccessfulResponse(result, label) {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${label} returned HTTP ${result.status}`);
  }
}

async function validateCloudflareSsr({
  rootDir = process.cwd(),
  outputDir = DEFAULT_OUTPUT_DIR,
  publicBaseUrl,
  fetchImpl = globalThis.fetch,
  routes = DEFAULT_ROUTES,
  expected = {},
  reportPath,
  generatedAt = new Date().toISOString(),
} = {}) {
  const paths = publicBaseUrl
    ? null
    : resolveOutputPaths({ rootDir, outputDir });
  const manifest =
    paths && pathExists(paths.workerManifestPath)
      ? readJson(paths.workerManifestPath)
      : null;

  let worker;
  if (paths) {
    assertFile(
      path.join(paths.publicDir, 'mf-manifest.json'),
      'MF manifest is missing',
    );
    if (routes.locale) {
      const localePath = path.join(paths.publicDir, routes.locale);
      assertFile(localePath, 'Locale asset is missing');
    }
    if (manifest?.bff?.worker) {
      assertFile(
        path.join(paths.outputDir, manifest.bff.worker),
        'Effect BFF worker bundle is missing',
      );
    }

    worker = await importWorker(paths.workerEntry);
  }

  const responses = {};

  for (const [label, urlPath] of Object.entries(routes)) {
    if (!urlPath) {
      continue;
    }
    const result = paths
      ? await fetchWorkerRoute({
          worker,
          publicDir: paths.publicDir,
          urlPath,
        })
      : await fetchHttpRoute({
          fetchImpl,
          baseUrl: publicBaseUrl,
          urlPath,
        });
    assertSuccessfulResponse(result, label);
    responses[label] = {
      status: result.status,
      contentType: result.contentType,
      bodyLength: result.body.length,
      bodySample: result.body.slice(0, 500),
      body: result.body,
      json: parseMaybeJson(result.body),
    };
  }

  if (expected.enText && !responses.en?.body.includes(expected.enText)) {
    throw new Error(`English SSR response did not include ${expected.enText}`);
  }
  if (expected.csText && !responses.cs?.body.includes(expected.csText)) {
    throw new Error(`Czech SSR response did not include ${expected.csText}`);
  }

  const uiBuildMarker = extractUiBuildMarker(responses.en?.body || '');
  const bffBuildMarker = findBuildMarker(responses.bff?.json);
  if (expected.matchBuildMarker && uiBuildMarker !== bffBuildMarker) {
    throw new Error(
      `UI/BFF build markers differ: ui=${uiBuildMarker}, bff=${bffBuildMarker}`,
    );
  }

  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    status: 'pass',
    mode: publicBaseUrl ? 'public-url' : 'local-worker',
    publicBaseUrl,
    rootDir: paths?.rootDir,
    outputDir: paths?.outputDir,
    publicDir: paths?.publicDir,
    wrangler: {
      main: paths?.wrangler.main,
      compatibilityDate: paths?.wrangler.compatibility_date,
      assets: paths?.wrangler.assets,
    },
    manifest,
    files: {
      public: paths ? listFiles(paths.publicDir) : [],
      server: paths ? listFiles(path.join(paths.outputDir, 'server')) : [],
      worker: paths ? listFiles(path.join(paths.outputDir, 'worker')) : [],
    },
    routes,
    responses,
    markers: {
      uiBuildMarker,
      bffBuildMarker,
      match: uiBuildMarker === bffBuildMarker,
    },
  };

  if (reportPath) {
    const compactReport = {
      ...report,
      responses: Object.fromEntries(
        Object.entries(responses).map(([label, response]) => {
          const { body, ...compactResponse } = response;
          return [label, compactResponse];
        }),
      ),
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(compactReport, null, 2)}\n`);
  }

  return report;
}

function parseArgs(argv) {
  const parsed = {
    routes: { ...DEFAULT_ROUTES },
    expected: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--match-build-marker') {
      parsed.expected.matchBuildMarker = true;
      continue;
    }

    const next = argv[index + 1];
    const field = {
      '--root-dir': 'rootDir',
      '--output-dir': 'outputDir',
      '--public-url': 'publicBaseUrl',
      '--out': 'reportPath',
      '--en': ['routes', 'en'],
      '--cs': ['routes', 'cs'],
      '--locale': ['routes', 'locale'],
      '--mf-manifest': ['routes', 'mfManifest'],
      '--bff': ['routes', 'bff'],
      '--expect-en': ['expected', 'enText'],
      '--expect-cs': ['expected', 'csText'],
    }[arg];

    if (!field) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (!next) {
      throw new Error(`${arg} requires a value`);
    }
    if (Array.isArray(field)) {
      parsed[field[0]][field[1]] = next;
    } else {
      parsed[field] = next;
    }
    index += 1;
  }

  return parsed;
}

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/ultramodern-cloudflare-ssr-validation/validate-cloudflare-ssr.js [options]

Options:
  --root-dir <path>       App root. Defaults to current directory.
  --output-dir <path>     Cloudflare output directory. Defaults to .output.
  --public-url <url>      Validate deployed public HTTP routes instead of local .output.
  --out <path>            Evidence JSON path.
  --en <path>             English SSR route. Defaults to /en.
  --cs <path>             Czech SSR route. Defaults to /cs.
  --locale <path>         Locale asset route. Defaults to /locales/en/translation.json.
  --mf-manifest <path>    MF manifest route. Defaults to /mf-manifest.json.
  --bff <path>            Effect BFF route. Defaults to /explore-api/effect/explore/readiness.
  --expect-en <text>      Text required in English SSR response.
  --expect-cs <text>      Text required in Czech SSR response.
  --match-build-marker    Require SSR UI marker and BFF JSON marker to match.
`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return;
  }
  const report = await validateCloudflareSsr(args);
  process.stdout.write(
    `[cloudflare-ssr-validation] ${report.status}: ${
      report.publicBaseUrl ?? report.outputDir
    }\n`,
  );
  if (args.reportPath) {
    process.stdout.write(
      `[cloudflare-ssr-validation] evidence written to ${args.reportPath}\n`,
    );
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[cloudflare-ssr-validation] ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_ROUTES,
  createAssetBinding,
  extractUiBuildMarker,
  fetchHttpRoute,
  findBuildMarker,
  parseArgs,
  validateCloudflareSsr,
};
