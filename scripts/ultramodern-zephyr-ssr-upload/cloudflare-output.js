const fs = require('node:fs');

const path = require('node:path');

const { readJsonFile } = require('../lib/fs-kit');

const {
  DEFAULT_EVIDENCE_FILE,
  DEFAULT_OUTPUT_DIR,
  EFFECT_BFF_CLOUDFLARE_IMPORT_GUIDANCE,
  EXPECTED_ASSETS_BINDING,
  EXPECTED_ENTRYPOINT,
  WORKER_MANIFEST_FILE,
} = require('./constants');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function relativePath(fromDir, filePath) {
  return normalizePath(path.relative(fromDir, filePath));
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
    path.join(outputDir, WORKER_MANIFEST_FILE),
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

function appDeclaresEffectBff(rootDir) {
  const packageJson = readOptionalJson(path.join(rootDir, 'package.json'));

  return (
    isRecord(packageJson) &&
    isRecord(packageJson.modernjs) &&
    packageJson.modernjs.apiRuntime === 'effect-bff'
  );
}

function validateBffWorkerManifest({ rootDir, outputDir }) {
  const workerManifestPath = path.join(outputDir, WORKER_MANIFEST_FILE);
  const workerManifest = readOptionalJson(workerManifestPath);
  const declaresEffectBff = appDeclaresEffectBff(rootDir);

  if (!workerManifest) {
    if (declaresEffectBff) {
      throw new Error(
        `App package declares Effect BFF with modernjs.apiRuntime=effect-bff, but the Cloudflare worker manifest is missing: ${workerManifestPath}`,
      );
    }

    return;
  }

  if (!isRecord(workerManifest)) {
    if (declaresEffectBff) {
      throw new Error(
        `App package declares Effect BFF with modernjs.apiRuntime=effect-bff, but the Cloudflare worker manifest must contain a JSON object: ${workerManifestPath}`,
      );
    }

    return;
  }

  const bff = workerManifest.bff;
  if (!bff) {
    if (declaresEffectBff) {
      throw new Error(
        `App package declares Effect BFF with modernjs.apiRuntime=effect-bff, but the Cloudflare worker manifest is missing manifest.bff: ${workerManifestPath}`,
      );
    }

    return;
  }

  if (!isRecord(bff)) {
    throw new Error(
      `Cloudflare worker manifest bff metadata must contain a JSON object: ${workerManifestPath}`,
    );
  }

  if (declaresEffectBff && bff.runtimeFramework !== 'effect') {
    throw new Error(
      `App package declares Effect BFF with modernjs.apiRuntime=effect-bff, but manifest.bff.runtimeFramework is ${JSON.stringify(
        bff.runtimeFramework,
      )}; expected "effect".`,
    );
  }

  if (bff.runtimeFramework !== 'effect' && !declaresEffectBff) {
    return;
  }

  const bffWorker = typeof bff.worker === 'string' ? bff.worker.trim() : '';
  if (bffWorker.length === 0) {
    throw new Error(
      `Cloudflare Effect BFF worker manifest must declare manifest.bff.worker: ${workerManifestPath}. ${EFFECT_BFF_CLOUDFLARE_IMPORT_GUIDANCE}`,
    );
  }

  assertFile(
    path.resolve(outputDir, bffWorker),
    `Cloudflare Effect BFF worker bundle is missing. ${EFFECT_BFF_CLOUDFLARE_IMPORT_GUIDANCE}`,
  );
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

  validateBffWorkerManifest({
    rootDir: resolvedRootDir,
    outputDir: resolvedOutputDir,
  });

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

module.exports = {
  createOutputSummary,
  resolveDefaultEvidencePath,
  validateCloudflareOutput,
};
