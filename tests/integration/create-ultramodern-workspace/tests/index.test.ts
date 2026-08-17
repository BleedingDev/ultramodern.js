import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(__dirname, '../../../../');
const createBin = path.resolve(repoRoot, 'packages/toolkit/create/bin/run.js');
const createPackageDir = path.resolve(repoRoot, 'packages/toolkit/create');
const codeToolsPackageDir = path.resolve(
  repoRoot,
  'packages/toolkit/code-tools',
);
const testFrameworkVersion = '3.2.0-ultramodern.108';
const frameworkVersionEnv = 'MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION';
const bleedingDevAliases: Record<string, string> = {
  '@modern-js/create': '@bleedingdev/modern-js-create',
  '@modern-js/code-tools': '@bleedingdev/modern-js-code-tools',
  '@modern-js/app-tools': '@bleedingdev/modern-js-app-tools',
  '@modern-js/plugin-bff': '@bleedingdev/modern-js-plugin-bff',
  '@modern-js/plugin-i18n': '@bleedingdev/modern-js-plugin-i18n',
  '@modern-js/plugin-tanstack': '@bleedingdev/modern-js-plugin-tanstack',
  '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
};

type ExecSyncError = Error & {
  stderr?: Buffer | string;
};

function expectedBleedingDevSpecifier(
  packageName: string,
  version = testFrameworkVersion,
) {
  const alias = bleedingDevAliases[packageName];
  if (!alias) {
    throw new Error('No BleedingDev alias configured for ' + packageName);
  }
  return 'npm:' + alias + '@' + version;
}

function differentUltramodernVersion(version: string) {
  const match = /^(\d+\.\d+\.\d+-ultramodern\.)(\d+)$/u.exec(version);
  if (!match) {
    throw new Error('Expected UltraModern test version, got ' + version);
  }
  return match[1] + (Number(match[2]) + 1);
}

function runCreate(projectDir: string, args: string[]) {
  execFileSync(process.execPath, [createBin, projectDir, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      [frameworkVersionEnv]: testFrameworkVersion,
      FORCE_COLOR: '0',
    },
    stdio: 'pipe',
  });
}

function captureCreateFailure(projectDir: string, args: string[]) {
  try {
    runCreate(projectDir, args);
  } catch (error) {
    const stderr = (error as ExecSyncError).stderr;
    return typeof stderr === 'string' ? stderr : stderr?.toString() || '';
  }
  throw new Error(`Expected create to reject: ${args.join(' ')}`);
}

function runCreateInWorkspace(workspaceDir: string, args: string[]) {
  execFileSync(process.execPath, [createBin, ...args], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      [frameworkVersionEnv]: testFrameworkVersion,
      FORCE_COLOR: '0',
    },
    stdio: 'pipe',
  });
}

function generatedToolEnv(env: Record<string, string | undefined> = {}) {
  return {
    ...process.env,
    ULTRAMODERN_CREATE_BIN: createBin,
    ...env,
  };
}

function readText(root: string, relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8');
}

function readJson<T = any>(root: string, relativePath: string): T {
  return JSON.parse(readText(root, relativePath));
}

function writeText(root: string, relativePath: string, content: string) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function runPerformanceReadiness(
  workspaceDir: string,
  env: Record<string, string> = {},
) {
  return execFileSync(
    process.execPath,
    ['scripts/ultramodern-performance-readiness.mts'],
    {
      cwd: workspaceDir,
      env: {
        ...generatedToolEnv(),
        ...env,
      },
      stdio: 'pipe',
    },
  ).toString();
}

function runWorkspaceValidator(workspaceDir: string) {
  return execFileSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mts'],
    {
      cwd: workspaceDir,
      env: generatedToolEnv(),
      stdio: 'pipe',
    },
  ).toString();
}

function expectWorkspaceValidatorPass(workspaceDir: string) {
  expect(runWorkspaceValidator(workspaceDir).trim()).toBe(
    'UltraModern workspace scaffold validated',
  );
}

function linkModernPackage(
  projectDir: string,
  name: string,
  packageDir: string,
) {
  const scopeDir = path.join(projectDir, 'node_modules/@modern-js');
  const packageLink = path.join(scopeDir, name);
  fs.mkdirSync(scopeDir, { recursive: true });
  if (!fs.existsSync(packageLink)) {
    fs.symlinkSync(packageDir, packageLink, 'dir');
  }
}

function linkWorkspaceToolPackages(projectDir: string) {
  linkModernPackage(projectDir, 'create', createPackageDir);
  linkModernPackage(projectDir, 'code-tools', codeToolsPackageDir);
}

function expectNoPath(root: string, relativePath: string) {
  expect(fs.existsSync(path.join(root, relativePath))).toBe(false);
}

describe('create-ultramodern-workspace', () => {
  let tempRoot = '';

  beforeAll(() => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-create-ultramodern-workspace-'),
    );
  });

  afterAll(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('scaffolds a shell-only UltraModern SuperApp workspace', async () => {
    const workspaceDir = path.join(tempRoot, 'ultra-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--lang', 'en']);

    const validationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mts'],
      {
        cwd: workspaceDir,
        env: generatedToolEnv(),
        stdio: 'pipe',
      },
    ).toString();
    expect(validationOutput.trim()).toBe(
      'UltraModern workspace scaffold validated',
    );

    const shellPackagePath = 'apps/shell-super-app/package.json';
    const originalShellPackage = readText(workspaceDir, shellPackagePath);
    const mutatedShellPackage = JSON.parse(originalShellPackage);
    mutatedShellPackage.dependencies['@modern-js/runtime'] =
      expectedBleedingDevSpecifier(
        '@modern-js/runtime',
        differentUltramodernVersion(testFrameworkVersion),
      );
    writeText(
      workspaceDir,
      shellPackagePath,
      `${JSON.stringify(mutatedShellPackage, null, 2)}\n`,
    );
    try {
      execFileSync(
        process.execPath,
        ['scripts/validate-ultramodern-workspace.mts'],
        {
          cwd: workspaceDir,
          env: generatedToolEnv(),
          stdio: 'pipe',
        },
      );
      throw new Error(
        'Expected workspace validator to reject a mixed Modern package cohort',
      );
    } catch (error) {
      const execError = error as Error & {
        stdout?: Buffer | string;
        stderr?: Buffer | string;
      };
      const stdout =
        typeof execError.stdout === 'string'
          ? execError.stdout
          : execError.stdout?.toString() || '';
      const stderr =
        typeof execError.stderr === 'string'
          ? execError.stderr
          : execError.stderr?.toString() || '';
      expect(`${stdout}\n${stderr}`).toMatch(
        /apps\/shell-super-app\/package\.json dependencies\.@modern-js\/runtime must match package source metadata/u,
      );
    } finally {
      writeText(workspaceDir, shellPackagePath, originalShellPackage);
    }

    const readinessOutput = runPerformanceReadiness(workspaceDir);
    expect(readinessOutput.trim()).toBe(
      'UltraModern performance readiness diagnostics reported',
    );
    const readinessReportPath =
      '.codex/reports/performance-readiness/ultramodern-performance-readiness.json';
    const readinessReport = readJson(workspaceDir, readinessReportPath);
    expect(readinessReport).toMatchObject({
      schemaVersion: 1,
      profile: 'ultramodern-performance-readiness-diagnostics-v1',
      status: 'pass',
      defaultOn: true,
      failOn: 'framework-invariant',
      signals: [
        'bfcache',
        'core-web-vitals-rum',
        'duplicate-prefetch-warmup',
        'cache-policy-sanity',
        'save-data-behavior',
        'cloudflare-ssr-cache-hints',
      ],
    });
    expect(readinessReport.apps).toEqual([
      {
        id: 'shell-super-app',
        path: 'apps/shell-super-app',
        signals: readinessReport.signals.map((id: string) =>
          expect.objectContaining({
            id,
            severity: 'diagnostic',
            status: 'pass',
          }),
        ),
      },
    ]);
    const firstReadinessReportText = readText(
      workspaceDir,
      readinessReportPath,
    );
    runPerformanceReadiness(workspaceDir);
    expect(readText(workspaceDir, readinessReportPath)).toBe(
      firstReadinessReportText,
    );
    const readinessConfigPath =
      'scripts/ultramodern-performance-readiness.config.mjs';
    const readinessConfigFile = path.join(workspaceDir, readinessConfigPath);
    const readinessConfigSource = readText(workspaceDir, readinessConfigPath);
    const readinessConfig = (
      await import(`${pathToFileURL(readinessConfigFile).href}?state=enabled`)
    ).default;
    expect(readinessConfig).toEqual({
      enabled: true,
      failOn: 'framework-invariant',
      reportPath: readinessReportPath,
    });
    writeText(
      workspaceDir,
      readinessConfigPath,
      `export default ${JSON.stringify({
        ...readinessConfig,
        enabled: false,
      })};\n`,
    );
    const disabledReadinessOutput = runPerformanceReadiness(workspaceDir);
    expect(disabledReadinessOutput.trim()).toBe(
      'UltraModern performance readiness diagnostics disabled',
    );
    expect(readJson(workspaceDir, readinessReportPath)).toMatchObject({
      schemaVersion: 1,
      profile: 'ultramodern-performance-readiness-diagnostics-v1',
      status: 'disabled',
      defaultOn: true,
      optOut: `${readinessConfigPath}#enabled=false`,
      apps: [],
    });
    writeText(workspaceDir, readinessConfigPath, readinessConfigSource);
    const envDisabledReadinessOutput = runPerformanceReadiness(workspaceDir, {
      ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS: 'false',
    });
    expect(envDisabledReadinessOutput.trim()).toBe(
      'UltraModern performance readiness diagnostics disabled',
    );
    expect(readJson(workspaceDir, readinessReportPath)).toMatchObject({
      status: 'disabled',
      optOut: 'ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS=false',
    });

    const legacyBoundaryFixturePath =
      'apps/shell-super-app/src/routes/__legacy-boundary-fixture.tsx';
    writeText(
      workspaceDir,
      legacyBoundaryFixturePath,
      `export default function LegacyBoundaryFixture() {
  return <div data-mf-boundary="legacy" />;
}
`,
    );
    linkWorkspaceToolPackages(workspaceDir);
    try {
      execFileSync(
        process.execPath,
        ['scripts/check-ultramodern-i18n-boundaries.mts'],
        {
          cwd: workspaceDir,
          stdio: 'pipe',
        },
      );
      throw new Error(
        'Expected i18n boundary checker to reject legacy data-mf-* attributes',
      );
    } catch (error) {
      const execError = error as Error & {
        stdout?: Buffer | string;
        stderr?: Buffer | string;
      };
      const stdout =
        typeof execError.stdout === 'string'
          ? execError.stdout
          : execError.stdout?.toString() || '';
      const stderr =
        typeof execError.stderr === 'string'
          ? execError.stderr
          : execError.stderr?.toString() || '';
      expect(`${stdout}\n${stderr}`).toMatch(
        /legacy data-mf-\* boundary attributes/u,
      );
    }
    fs.rmSync(path.join(workspaceDir, legacyBoundaryFixturePath));

    const fakeBinDir = path.join(tempRoot, 'fake-pnpm-bin');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    const fakePnpmPath = path.join(fakeBinDir, 'pnpm');
    const generatedPnpmVersion = String(
      readJson(workspaceDir, 'package.json').packageManager,
    ).replace(/^pnpm@/u, '');
    fs.writeFileSync(
      fakePnpmPath,
      `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

if (process.env.ULTRAMODERN_FAKE_PNPM_ACTIVE) {
  console.error('fake pnpm delegation re-entered');
  process.exit(1);
}

const args = process.argv.slice(2);
if (
  args.length === 2 &&
  args[0] === '--pm-on-fail=ignore' &&
  args[1] === '--version'
) {
  console.log(${JSON.stringify(generatedPnpmVersion)});
  process.exit(0);
}
if (args.includes('--version') || args.includes('-v')) {
  console.error('pmOnFail rejected active pnpm before version discovery');
  process.exit(1);
}

const fakeBinDir = ${JSON.stringify(fakeBinDir)};
const resolvedFakeBinDir = path.resolve(fakeBinDir);
const delegatedEnv = {
  ...process.env,
  PATH: (process.env.PATH || '')
    .split(path.delimiter)
    .filter(
      entry => entry !== fakeBinDir && path.resolve(entry) !== resolvedFakeBinDir,
    )
    .join(path.delimiter),
  ULTRAMODERN_FAKE_PNPM_ACTIVE: '1',
};
const result = spawnSync('pnpm', args, {
  env: delegatedEnv,
  stdio: 'inherit',
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
`,
      'utf-8',
    );
    fs.chmodSync(fakePnpmPath, 0o755);
    const patchVersionValidationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mts'],
      {
        cwd: workspaceDir,
        env: {
          ...generatedToolEnv(),
          PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
      },
    ).toString();
    expect(patchVersionValidationOutput.trim()).toBe(
      'UltraModern workspace scaffold validated',
    );
  });

  test('adds a full-stack MicroVertical to an existing workspace', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-add-remote-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--lang', 'en']);
    runCreateInWorkspace(workspaceDir, [
      'catalog',
      '--vertical',
      '--lang',
      'en',
    ]);

    expectWorkspaceValidatorPass(workspaceDir);
  });

  test('validates numbered vertical Tailwind prefixes as unique', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-numbered-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--lang', 'en']);
    runCreateInWorkspace(workspaceDir, [
      'erp-vertical-011',
      '--vertical',
      '--lang',
      'en',
    ]);
    runCreateInWorkspace(workspaceDir, [
      'erp-vertical-012',
      '--vertical',
      '--lang',
      'en',
    ]);

    expectWorkspaceValidatorPass(workspaceDir);
  });

  test('rejects removed legacy microvertical flag', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-legacy-flag-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--lang', 'en']);
    expect(() =>
      runCreateInWorkspace(workspaceDir, [
        'catalog-api',
        '--microvertical',
        'service',
        '--lang',
        'en',
      ]),
    ).toThrow(/Unexpected positional argument: --microvertical/u);
    expectNoPath(workspaceDir, 'services/service-catalog-api-effect');
  });

  test('rejects install-backed package source from a local source checkout', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-install-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    const stderr = captureCreateFailure(workspaceDir, [
      '--ultramodern-package-source',
      'install',
      '--ultramodern-package-version',
      '3.2.0-ultramodern.0',
      '--ultramodern-package-registry',
      'https://registry.example.test/',
      '--lang',
      'en',
    ]);

    expect(stderr).toContain(
      'local @modern-js/create source checkout cannot satisfy an explicit install',
    );
    expectNoPath(tempRoot, 'ultra-install-workspace');
  });

  test('generates public surface assets from route-owned content sources', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-public-content-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--lang', 'en']);

    const ultramodernConfig = readJson<Record<string, any>>(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const shellApp = ultramodernConfig.topology.apps.find(
      (app: { id: string }) => app.id === 'shell-super-app',
    );
    expect(shellApp).toBeDefined();
    shellApp.routes = {
      ...(shellApp.routes ?? {}),
      publicSurface: {
        artifactLifecycle: 'build-and-deploy-output',
        authoring: 'colocated-route-meta',
        cloudflareOutputRoot: 'dist-cloudflare/public',
        concreteUrlPaths: [],
        contentExpansion: {
          authoring: 'route-owned-esm-provider',
          defaultProviderFile: 'route.sitemap.mjs',
          draftPolicy: 'omit-draft-by-default',
          entryExport: 'default-or-entries',
          indexablePolicy: 'omit-indexable-false',
          lifecycle: 'executed-during-public-surface-generation',
          paramsSource: 'params-or-localeParams',
        },
        contentSources: [
          {
            entryExport: 'default-or-entries',
            module: 'src/routes/[lang]/talks/[slug]/route.sitemap.mjs',
            routeId: 'talk-detail',
          },
        ],
        files: ['robots.txt', 'sitemap.xml', 'site.webmanifest'],
        generatedManifest: './src/routes/ultramodern-route-metadata',
        generator: 'scripts/generate-public-surface-assets.mts',
        languages: ['en', 'cs'],
        metadataExport: './src/routes/ultramodern-route-metadata',
        omittedByDefault: ['api-catalog.json', 'llms.txt', 'security.txt'],
        outputRoot: 'dist/public',
        privateRoutePolicy: 'omit-from-generated-public-surface',
        publicRoutes: [
          {
            canonicalPath: '/talks/:slug',
            descriptionKey: 'shell.talks.detail.meta.description',
            id: 'talk-detail',
            localisedPaths: {
              en: '/talks/:slug',
              cs: '/prednasky/:slug',
            },
            namespace: 'shell',
            ownerAppId: 'shell-super-app',
            titleKey: 'shell.talks.detail.title',
          },
          {
            canonicalPath: '/sessions/:slug',
            descriptionKey: 'shell.sessions.detail.meta.description',
            id: 'session-detail',
            localisedPaths: {
              en: '/sessions/:slug',
              cs: '/sezeni/:slug',
            },
            namespace: 'shell',
            ownerAppId: 'shell-super-app',
            titleKey: 'shell.sessions.detail.title',
          },
          {
            canonicalPath: '/optional/:slug?',
            descriptionKey: 'shell.optional.detail.meta.description',
            id: 'optional-detail',
            localisedPaths: {
              en: '/optional/:slug?',
              cs: '/volitelne/:slug?',
            },
            namespace: 'shell',
            ownerAppId: 'shell-super-app',
            titleKey: 'shell.optional.detail.title',
          },
        ],
        routeEntries: [],
        source: 'route-owned-public-routes',
      },
    };
    writeText(
      workspaceDir,
      '.modernjs/ultramodern.json',
      JSON.stringify(ultramodernConfig, null, 2) + '\n',
    );

    writeText(
      workspaceDir,
      'apps/shell-super-app/src/routes/[lang]/talks/[slug]/route.sitemap.mjs',
      `/** @type {import('@ultra-public-content-workspace/shared-contracts').UltramodernPublicSitemapEntry[]} */
export const entries = [
  {
    params: { slug: 'building-public-web' },
    localeParams: { cs: { slug: 'verejny-web' } },
    lastModified: '2026-06-10',
    changeFrequency: 'monthly',
    priority: 0.7,
  },
  {
    params: { slug: 'draft-talk' },
    draft: true,
  },
  {
    params: { slug: 'noindex-talk' },
    indexable: false,
  },
];
`,
    );
    writeText(
      workspaceDir,
      'apps/shell-super-app/src/routes/[lang]/sessions/[slug]/route.sitemap.mjs',
      `export default function loadSessionEntries(context) {
  if (context.appId !== 'shell-super-app') {
    throw new Error('Unexpected appId ' + context.appId);
  }
  if (context.routeId !== 'session-detail') {
    throw new Error('Unexpected routeId ' + context.routeId);
  }
  if (!Array.isArray(context.languages) || context.languages.join(',') !== 'en,cs') {
    throw new Error('Unexpected languages ' + context.languages);
  }
  return [
    {
      params: { slug: 'provider-loader' },
      localeParams: { cs: { slug: 'nacist-poskytovatele' } },
      lastModified: '2026-06-11',
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
`,
    );
    writeText(
      workspaceDir,
      'apps/shell-super-app/src/routes/[lang]/optional/[slug$]/route.sitemap.mjs',
      `export const entries = [
  {
    params: { slug: 'route-owned-optional' },
    localeParams: { cs: { slug: 'volitelny-segment' } },
  },
];
`,
    );

    execFileSync(
      process.execPath,
      [
        'scripts/generate-public-surface-assets.mts',
        '--app',
        'shell-super-app',
        '--target',
        'dist',
        '--require-public-origin',
      ],
      {
        cwd: workspaceDir,
        env: {
          ...generatedToolEnv(),
          ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP: 'https://example.com',
        },
        stdio: 'pipe',
      },
    );

    const sitemap = readText(
      workspaceDir,
      'apps/shell-super-app/dist/public/sitemap.xml',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/en/talks/building-public-web</loc>',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/cs/prednasky/verejny-web</loc>',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/en/sessions/provider-loader</loc>',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/cs/sezeni/nacist-poskytovatele</loc>',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/en/optional/route-owned-optional</loc>',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/cs/volitelne/volitelny-segment</loc>',
    );
    expect(sitemap).toContain('hreflang="x-default"');
    expect(sitemap).toContain('<lastmod>2026-06-10</lastmod>');
    expect(sitemap).toContain('<lastmod>2026-06-11</lastmod>');
    expect(sitemap).toContain('<changefreq>monthly</changefreq>');
    expect(sitemap).toContain('<changefreq>weekly</changefreq>');
    expect(sitemap).toContain('<priority>0.7</priority>');
    expect(sitemap).toContain('<priority>1</priority>');
    expect(sitemap).not.toContain('draft-talk');
    expect(sitemap).not.toContain('noindex-talk');

    const robots = readText(
      workspaceDir,
      'apps/shell-super-app/dist/public/robots.txt',
    );
    expect(robots).toContain('Allow: /en/talks/building-public-web$');
    expect(robots).toContain('Allow: /cs/prednasky/verejny-web$');
    expect(robots).toContain('Allow: /en/sessions/provider-loader$');
    expect(robots).toContain('Allow: /cs/sezeni/nacist-poskytovatele$');
    expect(robots).toContain('Allow: /en/optional/route-owned-optional$');
    expect(robots).toContain('Allow: /cs/volitelne/volitelny-segment$');
    expect(robots).toContain('Sitemap: https://example.com/sitemap.xml');

    const webManifest = readJson(
      workspaceDir,
      'apps/shell-super-app/dist/public/site.webmanifest',
    );
    expect(webManifest.scope).toBe('/');
    expect(webManifest.start_url).toMatch(/^\/(cs|en)\//u);

    // Site-wide MODERN_PUBLIC_SITE_URL must win over per-app ULTRAMODERN_PUBLIC_URL_*
    // for SEO output (sitemap/robots origins), regardless of per-app env being set.
    execFileSync(
      process.execPath,
      [
        'scripts/generate-public-surface-assets.mts',
        '--app',
        'shell-super-app',
        '--target',
        'cloudflare-dist',
      ],
      {
        cwd: workspaceDir,
        env: {
          ...generatedToolEnv(),
          MODERN_PUBLIC_SITE_URL: 'https://global.example/path-is-ignored',
          ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP:
            'https://per-app.example.workers.dev',
        },
        stdio: 'pipe',
      },
    );
    const cloudflareSitemap = readText(
      workspaceDir,
      'apps/shell-super-app/dist-cloudflare/public/sitemap.xml',
    );
    expect(cloudflareSitemap).toContain(
      '<loc>https://global.example/en/sessions/provider-loader</loc>',
    );
    const cloudflareRobots = readText(
      workspaceDir,
      'apps/shell-super-app/dist-cloudflare/public/robots.txt',
    );
    expect(cloudflareRobots).toContain(
      'Sitemap: https://global.example/sitemap.xml',
    );
  });
  test('rejects install aliases from a local source checkout', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-alias-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    const stderr = captureCreateFailure(workspaceDir, [
      '--ultramodern-package-source',
      'install',
      '--ultramodern-package-version',
      '3.2.0-ultramodern.0',
      '--ultramodern-package-scope',
      'bleedingdev',
      '--ultramodern-package-name-prefix',
      'modern-js-',
      '--lang',
      'en',
    ]);

    expect(stderr).toContain(
      'local @modern-js/create source checkout cannot satisfy an explicit install',
    );
    expectNoPath(tempRoot, 'ultra-alias-workspace');
  });
});
