const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseArgs,
  validateCloudflareSsr,
} = require('../validate-cloudflare-ssr');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'modern-cloudflare-ssr-'));
}

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFixture(rootDir, { bffBuild = 'build-123' } = {}) {
  const outputDir = path.join(rootDir, '.output');
  writeJson(path.join(outputDir, 'wrangler.json'), {
    main: 'server/index.mjs',
    compatibility_date: '2026-05-27',
    assets: {
      directory: './public',
      binding: 'ASSETS',
    },
  });
  writeJson(path.join(outputDir, 'server/modern-worker-manifest.json'), {
    bff: {
      prefix: '/commerce-api',
      worker: 'worker/__modern_bff_effect.js',
    },
  });
  writeFile(path.join(outputDir, 'public/mf-manifest.json'), '{}\n');
  writeJson(path.join(outputDir, 'public/locales/en/translation.json'), {
    commerce: {
      title: 'Commerce Remote',
    },
  });
  writeFile(
    path.join(outputDir, 'worker/__modern_bff_effect.js'),
    'export {};',
  );
  writeFile(
    path.join(outputDir, 'server/index.mjs'),
    `export default {
      async fetch(request, env) {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/mf-manifest.json' || pathname === '/locales/en/translation.json') {
          return env.ASSETS.fetch(request);
        }
        if (pathname === '/en') {
          return new Response('<html data-build-marker="build-123">Commerce Remote</html>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }
        if (pathname === '/cs') {
          return new Response('<html data-build-marker="build-123">Obchodni remote</html>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }
        if (pathname === '/commerce-api/effect/recommendations') {
          return new Response(JSON.stringify({
            items: [{ marker: { build: '${bffBuild}' } }],
          }), {
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        }
        return new Response('Not found', { status: 404 });
      },
    };
`,
  );
}

test('validates Worker SSR, assets, BFF JSON, and marker lockstep', async () => {
  const rootDir = tempRoot();
  const reportPath = path.join(rootDir, 'evidence.json');

  try {
    writeFixture(rootDir);
    const report = await validateCloudflareSsr({
      rootDir,
      reportPath,
      expected: {
        enText: 'Commerce Remote',
        csText: 'Obchodni remote',
        matchBuildMarker: true,
      },
      generatedAt: '2026-05-27T00:00:00.000Z',
    });
    const written = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

    assert.equal(report.status, 'pass');
    assert.equal(report.responses.en.status, 200);
    assert.equal(report.responses.cs.status, 200);
    assert.equal(
      report.responses.locale.json.commerce.title,
      'Commerce Remote',
    );
    assert.equal(report.responses.bff.json.items[0].marker.build, 'build-123');
    assert.equal(report.markers.match, true);
    assert.equal(written.status, report.status);
    assert.equal(written.markers.uiBuildMarker, report.markers.uiBuildMarker);
    assert.equal(written.markers.bffBuildMarker, report.markers.bffBuildMarker);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('fails when UI and BFF build markers differ', async () => {
  const rootDir = tempRoot();

  try {
    writeFixture(rootDir, { bffBuild: 'build-456' });

    await assert.rejects(
      () =>
        validateCloudflareSsr({
          rootDir,
          expected: {
            matchBuildMarker: true,
          },
        }),
      /UI\/BFF build markers differ/,
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('parseArgs maps validation options', () => {
  assert.deepEqual(
    parseArgs([
      '--root-dir',
      '/repo/app',
      '--output-dir',
      'dist',
      '--out',
      '/tmp/report.json',
      '--expect-en',
      'English',
      '--expect-cs',
      'Czech',
      '--match-build-marker',
    ]),
    {
      rootDir: '/repo/app',
      outputDir: 'dist',
      reportPath: '/tmp/report.json',
      routes: {
        en: '/en',
        cs: '/cs',
        locale: '/locales/en/translation.json',
        mfManifest: '/mf-manifest.json',
        bff: '/commerce-api/effect/recommendations',
      },
      expected: {
        enText: 'English',
        csText: 'Czech',
        matchBuildMarker: true,
      },
    },
  );
});
