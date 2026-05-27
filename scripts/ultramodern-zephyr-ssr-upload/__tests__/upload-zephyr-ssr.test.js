const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  EXPECTED_BUILDER,
  EXPECTED_TARGET,
  parseArgs,
  uploadCloudflareSsrToZephyr,
  validateCloudflareOutput,
} = require('../upload-zephyr-ssr');

function createTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-ssr-upload-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(filePath, value = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function writeCloudflareOutput(rootDir) {
  writeFile(
    path.join(rootDir, '.output', 'server', 'index.mjs'),
    'export default { fetch() { return new Response("ok"); } };\n',
  );
  writeJson(path.join(rootDir, '.output', 'wrangler.json'), {
    main: './server/index.mjs',
    compatibility_date: '2026-05-27',
    assets: {
      directory: './public',
      binding: 'ASSETS',
    },
  });
  writeFile(
    path.join(rootDir, '.output', 'public', 'mf-manifest.json'),
    '{}\n',
  );
  writeJson(
    path.join(rootDir, '.output', 'server', 'modern-worker-manifest.json'),
    {
      generatedBy: '@modern-js/app-tools',
      routes: [
        {
          urlPath: '/commerce',
          entryPath: 'html/commerce/index.html',
          worker: 'main.js',
        },
      ],
    },
  );
}

test('validation fails loudly when the Cloudflare SSR entrypoint is missing', () => {
  const rootDir = createTempWorkspace();
  try {
    writeJson(path.join(rootDir, '.output', 'wrangler.json'), {
      assets: { directory: './public', binding: 'ASSETS' },
    });
    writeFile(
      path.join(rootDir, '.output', 'public', 'mf-manifest.json'),
      '{}\n',
    );

    assert.throws(
      () => validateCloudflareOutput({ rootDir }),
      /Cloudflare SSR entrypoint is missing/,
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('validation fails loudly when wrangler assets metadata is missing', () => {
  const rootDir = createTempWorkspace();
  try {
    writeFile(path.join(rootDir, '.output', 'server', 'index.mjs'));
    writeJson(path.join(rootDir, '.output', 'wrangler.json'), {
      main: './server/index.mjs',
    });

    assert.throws(
      () => validateCloudflareOutput({ rootDir }),
      /wrangler metadata is missing assets configuration/,
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('uploads Modern Cloudflare SSR output through the zephyr-agent boundary', async () => {
  const rootDir = createTempWorkspace();
  const generatedAt = '2026-05-27T00:00:00.000Z';
  const evidencePath = path.join(rootDir, 'evidence', 'zephyr.json');
  let capturedOptions;

  try {
    writeCloudflareOutput(rootDir);

    const evidence = await uploadCloudflareSsrToZephyr({
      rootDir,
      evidencePath,
      generatedAt,
      uploadOutputToZephyr: async options => {
        capturedOptions = options;
        await options.hooks.onDeployComplete({
          url: 'https://modernjs-hjgv.zephyr-cloud.test',
          snapshotId: 'snapshot_123',
          snapshot: { snapshotType: 'ssr' },
          federatedDependencies: [
            { name: 'remote-commerce', version: '@latest' },
          ],
          buildStats: {
            id: 'app_uid_shell',
            version: 'snapshot_123',
            app: { buildId: 'build_123', name: 'shell-super-app' },
            edge: { url: 'https://edge.zephyr-cloud.test' },
            context: { target: 'cloudflare' },
          },
        });
        return {
          deploymentUrl: 'https://modernjs-hjgv.zephyr-cloud.test',
          entrypoint: 'server/index.mjs',
        };
      },
    });
    const writtenEvidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

    assert.equal(capturedOptions.rootDir, rootDir);
    assert.equal(capturedOptions.outputDir, path.join(rootDir, '.output'));
    assert.equal(
      capturedOptions.publicDir,
      path.join(rootDir, '.output', 'public'),
    );
    assert.equal(capturedOptions.builder, EXPECTED_BUILDER);
    assert.equal(capturedOptions.target, EXPECTED_TARGET);
    assert.equal(capturedOptions.ssr, true);
    assert.equal(capturedOptions.baseURL, '/');
    assert.equal(evidence.upload.entrypoint, 'server/index.mjs');
    assert.equal(evidence.deployment.applicationUid, 'app_uid_shell');
    assert.equal(evidence.deployment.snapshotId, 'snapshot_123');
    assert.equal(evidence.deployment.snapshotType, 'ssr');
    assert.equal(
      evidence.publicUrls.mfManifest,
      'https://modernjs-hjgv.zephyr-cloud.test/mf-manifest.json',
    );
    assert.equal(
      evidence.output.files.public.includes('mf-manifest.json'),
      true,
    );
    assert.deepEqual(writtenEvidence, evidence);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('parseArgs maps CLI flags to upload options', () => {
  assert.deepEqual(
    parseArgs([
      '--root-dir',
      '/repo/app',
      '--output-dir',
      'dist',
      '--public-dir',
      'dist/client',
      '--base-url',
      '/shop',
      '--out',
      '/tmp/evidence.json',
    ]),
    {
      rootDir: '/repo/app',
      outputDir: 'dist',
      publicDir: 'dist/client',
      baseURL: '/shop',
      evidencePath: '/tmp/evidence.json',
    },
  );
});
