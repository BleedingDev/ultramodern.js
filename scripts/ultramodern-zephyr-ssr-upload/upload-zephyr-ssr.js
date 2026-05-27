#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const DEFAULT_OUTPUT_DIR = '.output';
const DEFAULT_EVIDENCE_FILE = 'zephyr-ssr-upload-evidence.json';
const EXPECTED_ENTRYPOINT = 'server/index.mjs';
const EXPECTED_BUILDER = 'modern-js';
const EXPECTED_TARGET = 'cloudflare';
const EXPECTED_ASSETS_BINDING = 'ASSETS';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function relativePath(fromDir, filePath) {
  return normalizePath(path.relative(fromDir, filePath));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function pathExists(filePath) {
  return fs.existsSync(filePath);
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
        files.push(relativePath(dirPath, fullPath));
      }
    }
  }

  return files.sort();
}

function resolveDefaultEvidencePath(outputDir) {
  return path.join(outputDir, DEFAULT_EVIDENCE_FILE);
}

function resolveWranglerAssetsDirectory({ outputDir, wrangler }) {
  const assets = wrangler.assets;
  if (!isRecord(assets)) {
    throw new Error(
      'Cloudflare wrangler metadata is missing assets configuration',
    );
  }

  if (typeof assets.directory !== 'string' || assets.directory.length === 0) {
    throw new Error(
      'Cloudflare wrangler assets.directory must be a non-empty string',
    );
  }

  if (typeof assets.binding !== 'string' || assets.binding.length === 0) {
    throw new Error(
      'Cloudflare wrangler assets.binding must be a non-empty string',
    );
  }

  const assetsDirectory = path.isAbsolute(assets.directory)
    ? assets.directory
    : path.resolve(outputDir, assets.directory);

  return {
    binding: assets.binding,
    directory: assets.directory,
    resolvedDirectory: assetsDirectory,
  };
}

function readOptionalJson(filePath) {
  return pathExists(filePath) ? readJsonFile(filePath) : null;
}

function createOutputSummary({ outputDir, publicDir }) {
  const serverDir = path.join(outputDir, 'server');
  const workerDir = path.join(outputDir, 'worker');
  const routeJson = readOptionalJson(
    path.join(outputDir, 'server', 'route.json'),
  );
  const workerManifest = readOptionalJson(
    path.join(outputDir, 'server', 'modern-worker-manifest.json'),
  );

  return {
    files: {
      output: listFiles(outputDir),
      public: listFiles(publicDir),
      server: listFiles(serverDir),
      worker: listFiles(workerDir),
    },
    routeJson,
    workerManifest,
  };
}

function validateCloudflareOutput({
  rootDir = process.cwd(),
  outputDir = DEFAULT_OUTPUT_DIR,
  publicDir,
} = {}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedOutputDir = path.resolve(resolvedRootDir, outputDir);
  const entrypointPath = path.join(resolvedOutputDir, EXPECTED_ENTRYPOINT);
  const wranglerPath = path.join(resolvedOutputDir, 'wrangler.json');

  assertDirectory(
    resolvedOutputDir,
    'Modern Cloudflare output directory is missing',
  );
  assertFile(
    entrypointPath,
    'Modern Cloudflare SSR entrypoint is missing; run a Cloudflare SSR build first',
  );
  assertFile(
    wranglerPath,
    'Cloudflare wrangler metadata is missing; deploy.target=cloudflare output is required',
  );

  const wrangler = readJsonFile(wranglerPath);
  const wranglerAssets = resolveWranglerAssetsDirectory({
    outputDir: resolvedOutputDir,
    wrangler,
  });
  const resolvedPublicDir = path.resolve(
    resolvedRootDir,
    publicDir || wranglerAssets.resolvedDirectory,
  );

  assertDirectory(
    resolvedPublicDir,
    'Cloudflare public assets directory referenced by wrangler metadata is missing',
  );

  if (wranglerAssets.binding !== EXPECTED_ASSETS_BINDING) {
    throw new Error(
      `Cloudflare wrangler assets.binding must be ${EXPECTED_ASSETS_BINDING}; received ${wranglerAssets.binding}`,
    );
  }

  return {
    rootDir: resolvedRootDir,
    outputDir: resolvedOutputDir,
    publicDir: resolvedPublicDir,
    entrypoint: EXPECTED_ENTRYPOINT,
    wrangler: {
      path: wranglerPath,
      assets: wranglerAssets,
      compatibilityDate: wrangler.compatibility_date ?? null,
      main: wrangler.main ?? null,
    },
    outputSummary: createOutputSummary({
      outputDir: resolvedOutputDir,
      publicDir: resolvedPublicDir,
    }),
  };
}

function extractDeploymentEvidence({ result, deploymentInfo }) {
  const buildStats = deploymentInfo?.buildStats;
  const snapshot = deploymentInfo?.snapshot;

  return {
    deploymentUrl: result?.deploymentUrl ?? deploymentInfo?.url ?? null,
    entrypoint: result?.entrypoint ?? null,
    applicationUid: buildStats?.id ?? null,
    snapshotId: deploymentInfo?.snapshotId ?? snapshot?.uid ?? null,
    snapshotType: snapshot?.snapshotType ?? snapshot?.type ?? 'ssr',
    version: buildStats?.version ?? null,
    edgeUrl: buildStats?.edge?.url ?? null,
    app: buildStats?.app ?? null,
    target: buildStats?.context?.target ?? EXPECTED_TARGET,
    federatedDependencies: Array.isArray(deploymentInfo?.federatedDependencies)
      ? deploymentInfo.federatedDependencies.map(dependency => ({
          name: dependency.name ?? null,
          version: dependency.version ?? null,
          remote: dependency.remote ?? null,
        }))
      : [],
  };
}

function joinUrl(baseUrl, ...segments) {
  if (!baseUrl) {
    return null;
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedSegments = segments
    .filter(segment => typeof segment === 'string' && segment.length > 0)
    .map(segment => segment.replace(/^\/+|\/+$/g, ''))
    .filter(segment => segment.length > 0);
  return [normalizedBase, ...normalizedSegments].join('/');
}

function writeEvidence(evidence, evidencePath) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidencePath;
}

async function loadZephyrAgent() {
  try {
    return require('zephyr-agent');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'zephyr-agent is not installed in this workspace. Install zephyr-agent@1.1.1 or run this wrapper from a generated app that provides it.',
      );
    }
    throw error;
  }
}

async function uploadCloudflareSsrToZephyr({
  rootDir = process.cwd(),
  outputDir = DEFAULT_OUTPUT_DIR,
  publicDir,
  baseURL = '/',
  evidencePath,
  uploadOutputToZephyr,
  generatedAt = new Date().toISOString(),
} = {}) {
  const validation = validateCloudflareOutput({
    rootDir,
    outputDir,
    publicDir,
  });
  const deploymentEvents = [];
  const resolvedEvidencePath =
    evidencePath || resolveDefaultEvidencePath(validation.outputDir);
  const uploader =
    uploadOutputToZephyr || (await loadZephyrAgent()).uploadOutputToZephyr;

  if (typeof uploader !== 'function') {
    throw new Error('zephyr-agent does not export uploadOutputToZephyr');
  }

  const uploadOptions = {
    rootDir: validation.rootDir,
    outputDir: validation.outputDir,
    publicDir: validation.publicDir,
    baseURL,
    builder: EXPECTED_BUILDER,
    target: EXPECTED_TARGET,
    ssr: true,
    hooks: {
      onDeployComplete: async deploymentInfo => {
        deploymentEvents.push(deploymentInfo);
      },
    },
  };

  const result = await uploader(uploadOptions);
  const deploymentInfo = deploymentEvents.at(-1) ?? null;
  const deployment = extractDeploymentEvidence({ result, deploymentInfo });
  const evidence = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    status: 'uploaded',
    zephyrAgent: {
      package: 'zephyr-agent',
      requiredApi: 'uploadOutputToZephyr',
      verifiedVersion: '1.1.1',
    },
    upload: {
      rootDir: uploadOptions.rootDir,
      outputDir: uploadOptions.outputDir,
      publicDir: uploadOptions.publicDir,
      baseURL: uploadOptions.baseURL,
      builder: uploadOptions.builder,
      target: uploadOptions.target,
      ssr: uploadOptions.ssr,
      entrypoint: validation.entrypoint,
    },
    cloudflare: {
      wrangler: validation.wrangler,
    },
    output: validation.outputSummary,
    deployment,
    publicUrls: {
      mfManifest: joinUrl(
        deployment.deploymentUrl,
        baseURL,
        'mf-manifest.json',
      ),
    },
    evidencePath: resolvedEvidencePath,
  };

  writeEvidence(evidence, resolvedEvidencePath);
  return evidence;
}

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/ultramodern-zephyr-ssr-upload/upload-zephyr-ssr.js [options]

Options:
  --root-dir <path>     Workspace or app root. Defaults to the current directory.
  --output-dir <path>   Modern Cloudflare output directory. Defaults to .output.
  --public-dir <path>   Public assets directory. Defaults to wrangler assets.directory.
  --base-url <path>     Public base URL passed to zephyr-agent. Defaults to /.
  --out <path>          Evidence JSON path. Defaults to .output/${DEFAULT_EVIDENCE_FILE}.
  --help                Show this help.
`);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    const next = argv[index + 1];
    if (
      [
        '--root-dir',
        '--output-dir',
        '--public-dir',
        '--base-url',
        '--out',
      ].includes(arg)
    ) {
      if (!next) {
        throw new Error(`${arg} requires a value`);
      }
      parsed[
        {
          '--root-dir': 'rootDir',
          '--output-dir': 'outputDir',
          '--public-dir': 'publicDir',
          '--base-url': 'baseURL',
          '--out': 'evidencePath',
        }[arg]
      ] = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return;
  }

  const evidence = await uploadCloudflareSsrToZephyr(args);
  process.stdout.write(
    `[zephyr-ssr-upload] uploaded ${evidence.upload.entrypoint} to ${evidence.deployment.deploymentUrl ?? 'Zephyr'}\n`,
  );
  process.stdout.write(
    `[zephyr-ssr-upload] evidence written to ${evidence.evidencePath}\n`,
  );
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[zephyr-ssr-upload] ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_ASSETS_BINDING,
  EXPECTED_BUILDER,
  EXPECTED_ENTRYPOINT,
  EXPECTED_TARGET,
  createOutputSummary,
  extractDeploymentEvidence,
  joinUrl,
  parseArgs,
  uploadCloudflareSsrToZephyr,
  validateCloudflareOutput,
};
