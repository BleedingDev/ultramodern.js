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

const cloudflareSecurity = {
  enabled: true,
  headers: {
    referrerPolicy: 'strict-origin-when-cross-origin',
    contentTypeOptions: 'nosniff',
    permissionsPolicy:
      'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  },
  contentSecurityPolicy: {
    mode: 'report-only',
    directives: {
      'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https:'],
      'style-src': ["'self'", "'unsafe-inline'", 'https:'],
      'connect-src': ["'self'", 'https:', 'wss:'],
    },
  },
};

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
      prefix: '/explore-api',
      worker: 'worker/__modern_bff_effect.js',
    },
    security: cloudflareSecurity,
  });
  writeFile(path.join(outputDir, 'public/mf-manifest.json'), '{}\n');
  writeJson(path.join(outputDir, 'public/locales/en/translation.json'), {
    explore: {
      title: 'Explore Remote',
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
        const security = ${JSON.stringify(cloudflareSecurity)};
        const renderCsp = directives => Object.entries(directives)
          .map(([name, values]) => \`\${name} \${values.join(' ')}\`)
          .join('; ');
        const secure = response => {
          const headers = new Headers(response.headers);
          headers.set('referrer-policy', security.headers.referrerPolicy);
          headers.set('x-content-type-options', security.headers.contentTypeOptions);
          headers.set('permissions-policy', security.headers.permissionsPolicy);
          if ((headers.get('content-type') || '').includes('text/html')) {
            headers.set('content-security-policy-report-only', renderCsp(security.contentSecurityPolicy.directives));
          }
          return new Response(response.body, {
            headers,
            status: response.status,
            statusText: response.statusText
          });
        };
        const pathname = new URL(request.url).pathname;
        if (pathname === '/mf-manifest.json' || pathname === '/locales/en/translation.json') {
          return secure(await env.ASSETS.fetch(request));
        }
        if (pathname === '/en') {
          return secure(new Response('<html data-build-marker="build-123">Explore Remote</html>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }));
        }
        if (pathname === '/cs') {
          return secure(new Response('<html data-build-marker="build-123">Průzkumný remote</html>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }));
        }
        if (pathname === '/explore-api/effect/explore/readiness') {
          return secure(new Response(JSON.stringify({
            items: [{ marker: { build: '${bffBuild}' } }],
          }), {
            headers: { 'content-type': 'application/json; charset=utf-8' },
          }));
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
        enText: 'Explore Remote',
        csText: 'Průzkumný remote',
        matchBuildMarker: true,
      },
      generatedAt: '2026-05-27T00:00:00.000Z',
    });
    const written = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

    assert.equal(report.status, 'pass');
    assert.equal(report.responses.en.status, 200);
    assert.equal(report.responses.cs.status, 200);
    assert.equal(report.responses.locale.json.explore.title, 'Explore Remote');
    assert.equal(report.responses.bff.json.items[0].marker.build, 'build-123');
    assert.equal(
      report.responses.en.headers.referrerPolicy,
      'strict-origin-when-cross-origin',
    );
    assert.equal(report.responses.en.headers.xContentTypeOptions, 'nosniff');
    assert.match(
      report.responses.en.headers.contentSecurityPolicyReportOnly,
      /script-src/u,
    );
    assert.equal(
      report.responses.mfManifest.headers.xContentTypeOptions,
      'nosniff',
    );
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
      '--public-url',
      'https://worker.example.test',
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
      publicBaseUrl: 'https://worker.example.test',
      reportPath: '/tmp/report.json',
      routes: {
        en: '/en',
        cs: '/cs',
        locale: '/locales/en/translation.json',
        mfManifest: '/mf-manifest.json',
        bff: '/explore-api/effect/explore/readiness',
      },
      expected: {
        enText: 'English',
        csText: 'Czech',
        matchBuildMarker: true,
      },
    },
  );
});

test('validates public Cloudflare URL routes without local output', async () => {
  const calls = [];
  const fetchImpl = async url => {
    const pathname = new URL(url).pathname;
    calls.push(pathname);
    const bodies = {
      '/en':
        '<html data-app-id="remote-explore" data-build-marker="build-123">Explore Remote</html>',
      '/cs': '<html data-build-marker="build-123">Explore Remote CS</html>',
      '/locales/en/translation.json': JSON.stringify({
        explore: { title: 'Explore Remote' },
      }),
      '/mf-manifest.json': '{}',
      '/explore-api/effect/explore/readiness': JSON.stringify({
        marker: { build: 'build-123' },
      }),
    };
    return new Response(bodies[pathname] ?? 'Not found', {
      status: bodies[pathname] ? 200 : 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  };

  const report = await validateCloudflareSsr({
    publicBaseUrl: 'https://remote-explore.example.test',
    fetchImpl,
    routes: {
      en: '/en',
      cs: '/cs',
      locale: '/locales/en/translation.json',
      mfManifest: '/mf-manifest.json',
      bff: '/explore-api/effect/explore/readiness',
    },
    expected: {
      enText: 'Explore Remote',
      matchBuildMarker: true,
    },
    generatedAt: '2026-05-27T00:00:00.000Z',
  });

  assert.equal(report.mode, 'public-url');
  assert.equal(report.status, 'pass');
  assert.equal(report.markers.match, true);
  assert.deepEqual(calls.sort(), [
    '/cs',
    '/en',
    '/explore-api/effect/explore/readiness',
    '/locales/en/translation.json',
    '/mf-manifest.json',
  ]);
});
