import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../');
const createBin = path.resolve(repoRoot, 'packages/toolkit/create/bin/run.js');

function runCreate(projectDir: string, args: string[]) {
  execFileSync(process.execPath, [createBin, projectDir, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
    stdio: 'pipe',
  });
}

function runCreateInWorkspace(workspaceDir: string, args: string[]) {
  execFileSync(process.execPath, [createBin, ...args], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
    stdio: 'pipe',
  });
}

function readText(root: string, relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8');
}

function readJson<T = any>(root: string, relativePath: string): T {
  return JSON.parse(readText(root, relativePath));
}

function readPnpmConfig<T = any>(root: string, key: string): T | undefined {
  const env = { ...process.env };
  for (const envKey of Object.keys(env)) {
    if (/^(?:npm|pnpm)_config_/i.test(envKey)) {
      delete env[envKey];
    }
  }
  const output = execFileSync('pnpm', ['config', 'get', key, '--json'], {
    cwd: root,
    env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return output ? JSON.parse(output) : undefined;
}

function writeText(root: string, relativePath: string, content: string) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function expectNoHandlebarsArtifacts(content: string) {
  expect(/\{\{[#/]|(?:\{\{\w+)/.test(content)).toBe(false);
}

function expectPath(root: string, relativePath: string) {
  expect(fs.existsSync(path.join(root, relativePath))).toBe(true);
}

function expectNoPath(root: string, relativePath: string) {
  expect(fs.existsSync(path.join(root, relativePath))).toBe(false);
}

function expectPnpm11Policy(workspaceDir: string) {
  expect(readPnpmConfig(workspaceDir, 'packages')).toEqual([
    'apps/*',
    'apps/remotes/*',
    'services/*',
    'packages/*',
  ]);
  expect(readPnpmConfig(workspaceDir, 'minimumReleaseAge')).toBe(1440);
  expect(readPnpmConfig(workspaceDir, 'minimumReleaseAgeStrict')).toBe(true);
  expect(
    readPnpmConfig(workspaceDir, 'minimumReleaseAgeIgnoreMissingTime'),
  ).toBe(false);
  expect(readPnpmConfig(workspaceDir, 'minimumReleaseAgeExclude')).toEqual([
    '@modern-js/*',
    '@bleedingdev/*',
    '@effect/tsgo',
    '@effect/tsgo-*',
    '@typescript/native-preview',
    '@typescript/native-preview-*',
    '@cloudflare/*',
    'miniflare',
    'workerd',
    'wrangler',
  ]);
  expect(readPnpmConfig(workspaceDir, 'peerDependencyRules')).toEqual({
    allowedVersions: {
      react: '>=19.0.0',
      typescript: '>=6.0.0',
    },
  });
  expect(readPnpmConfig(workspaceDir, 'overrides')).toEqual({
    '@tanstack/react-router': '1.170.8',
    'node-fetch': '^3.3.2',
  });
  expect(readPnpmConfig(workspaceDir, 'trustPolicy')).toBe('no-downgrade');
  expect(readPnpmConfig(workspaceDir, 'trustPolicyIgnoreAfter')).toBe(1440);
  expect(readPnpmConfig(workspaceDir, 'blockExoticSubdeps')).toBe(true);
  expect(readPnpmConfig(workspaceDir, 'engineStrict')).toBe(true);
  expect(readPnpmConfig(workspaceDir, 'pmOnFail')).toBe('error');
  expect(readPnpmConfig(workspaceDir, 'verifyDepsBeforeRun')).toBe('error');
  expect(readPnpmConfig(workspaceDir, 'strictDepBuilds')).toBe(true);
  expect(readPnpmConfig(workspaceDir, 'allowBuilds')).toEqual({
    '@swc/core': true,
    'core-js': true,
    esbuild: true,
    'msgpackr-extract': true,
    sharp: true,
    'simple-git-hooks': true,
    workerd: true,
  });
  expect(readPnpmConfig(workspaceDir, 'onlyBuiltDependencies')).toBeUndefined();
}

function readGeneratedContract(workspaceDir: string) {
  return readJson<{
    apps: Array<{
      id: string;
      config: Record<string, any>;
      deploy: Record<string, any>;
      effect?: Record<string, any>;
      i18n: Record<string, any>;
      kind: string;
      marker: Record<string, any>;
      moduleFederation: Record<string, any>;
      styling: Record<string, any>;
    }>;
  }>(workspaceDir, '.modernjs/ultramodern-generated-contract.json');
}

function getGeneratedAppContract(workspaceDir: string, appId: string) {
  const contractEntry = readGeneratedContract(workspaceDir).apps.find(
    app => app.id === appId,
  );
  expect(contractEntry).toBeDefined();
  return contractEntry!;
}

function expectAppConfigContract(
  contractEntry: { config: Record<string, any>; ssr?: Record<string, any> },
  expected: { apiPrefix?: string; hasEffect?: boolean },
) {
  expect(contractEntry.config).toMatchObject({
    preset: 'presetUltramodern',
    output: {
      disableTsChecker: true,
      distPath: {
        html: './',
      },
      polyfill: 'off',
      splitRouteChunks: false,
    },
    html: {
      outputStructure: 'flat',
    },
    source: {
      mainEntryName: 'index',
      siteUrlGlobal: 'ULTRAMODERN_SITE_URL',
    },
  });
  expect(contractEntry.config.plugins).toEqual(
    expected.hasEffect
      ? [
          'appTools',
          'tanstackRouterPlugin',
          'i18nPlugin',
          'bffPlugin',
          'moduleFederationPlugin',
          'zephyrRspackPlugin',
        ]
      : [
          'appTools',
          'tanstackRouterPlugin',
          'i18nPlugin',
          'moduleFederationPlugin',
          'zephyrRspackPlugin',
        ],
  );
  if (expected.hasEffect) {
    expect(contractEntry.config.bff).toMatchObject({
      runtimeFramework: 'effect',
      prefix: expected.apiPrefix,
      openapi: '/openapi.json',
    });
  } else {
    expect(contractEntry.config.bff).toBeUndefined();
  }
  expect(contractEntry.ssr).toMatchObject({
    mode: 'stream',
    moduleFederationAppSSR: true,
  });
}

function expectTailwindContract(contractEntry: {
  styling: Record<string, any>;
}) {
  expect(contractEntry.styling).toEqual({
    tailwind: true,
    postcssPlugins: ['@tailwindcss/postcss'],
    contentGlobs: ['./src/**/*.{js,jsx,ts,tsx}'],
  });
}

const fullStackVerticals = [
  {
    id: 'remote-explore',
    domain: 'explore',
    stem: 'explore',
    group: 'explore',
    notFound: 'ExploreNotFound',
    path: 'apps/remotes/remote-explore',
    mfName: 'remoteExplore',
    apiPrefix: '/explore-api',
  },
  {
    id: 'remote-decide',
    domain: 'decide',
    stem: 'decide',
    group: 'decide',
    notFound: 'DecideNotFound',
    path: 'apps/remotes/remote-decide',
    mfName: 'remoteDecide',
    apiPrefix: '/decide-api',
  },
  {
    id: 'remote-checkout',
    domain: 'checkout',
    stem: 'checkout',
    group: 'checkout',
    notFound: 'CheckoutNotFound',
    path: 'apps/remotes/remote-checkout',
    mfName: 'remoteCheckout',
    apiPrefix: '/checkout-api',
  },
] as const;

function linkTypecheckPackage(
  workspaceDir: string,
  name: string,
  target: string,
) {
  const linkPath = path.join(workspaceDir, 'node_modules', ...name.split('/'));
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(
    target,
    linkPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

function writeEffectContractTypeFixtures(workspaceDir: string) {
  const pluginBffDir = path.join(repoRoot, 'packages/cli/plugin-bff');
  const createRequestDir = path.join(
    repoRoot,
    'packages/server/create-request',
  );
  linkTypecheckPackage(workspaceDir, '@modern-js/plugin-bff', pluginBffDir);
  linkTypecheckPackage(
    workspaceDir,
    '@modern-js/create-request',
    createRequestDir,
  );
  linkTypecheckPackage(
    workspaceDir,
    '@ultra-workspace/remote-explore',
    path.join(workspaceDir, 'apps/remotes/remote-explore'),
  );
  writeText(
    workspaceDir,
    'tsconfig.effect-contracts.json',
    `${JSON.stringify(
      {
        compilerOptions: {
          allowImportingTsExtensions: true,
          exactOptionalPropertyTypes: true,
          jsx: 'react-jsx',
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2023',
        },
        include: [
          'apps/remotes/remote-explore/shared/effect/api.ts',
          'apps/remotes/remote-explore/src/effect/explore-client.ts',
          'apps/remotes/remote-explore/api/effect/index.ts',
          'tests/type-contracts/*.ts',
        ],
      },
      null,
      2,
    )}\n`,
  );

  writeText(
    workspaceDir,
    'tests/type-contracts/effect-client-positive.ts',
    `import {
  makeEffectHttpApiClient,
  runEffectRequest,
} from '@modern-js/plugin-bff/effect-client';
import {
  exploreEffectApi,
} from '@ultra-workspace/remote-explore/shared/effect/api';
import {
  createExploreClient,
} from '@ultra-workspace/remote-explore/effect/client';

async function verifyClient() {
  const client = await runEffectRequest(
    makeEffectHttpApiClient(exploreEffectApi, { baseUrl: '/explore-api' }),
  );

  const list = await runEffectRequest(
    client.explore.list({ query: { limit: 1 } }),
  );
  const firstTitle: string = list.items[0]?.title ?? '';

  const item = await runEffectRequest(
    client.explore.get({
      params: { id: 'starter-explore' },
    }),
  );
  const itemId: string = item.id;

  const created = await runEffectRequest(
    client.explore.create({ payload: { title: firstTitle || itemId } }),
  );
  const createdTitle: string = created.item.title;
  const packageClient = await runEffectRequest(
    createExploreClient({ baseUrl: '/explore-api' }),
  );
  const packageList = await runEffectRequest(
    packageClient.explore.list({ query: { limit: 1 } }),
  );
  const packageTitle: string = packageList.items[0]?.title ?? '';

  return createdTitle || packageTitle;
}

void verifyClient;
`,
  );

  writeText(
    workspaceDir,
    'tests/type-contracts/effect-client-negative.ts',
    `import {
  makeEffectHttpApiClient,
  runEffectRequest,
} from '@modern-js/plugin-bff/effect-client';
import {
  exploreEffectApi,
} from '@ultra-workspace/remote-explore/shared/effect/api';

async function verifyClientRejections() {
  const client = await runEffectRequest(
    makeEffectHttpApiClient(exploreEffectApi, { baseUrl: '/explore-api' }),
  );

  // @ts-expect-error unknown endpoint names are not part of the vertical contract.
  await runEffectRequest(client.explore.remove({}));

  // @ts-expect-error get requires route params from the vertical contract.
  await runEffectRequest(client.explore.get({}));

  await runEffectRequest(
    client.explore.get({
      // @ts-expect-error params.id must be a string.
      params: { id: 123 },
    }),
  );

  await runEffectRequest(
    client.explore.list({
      // @ts-expect-error query.limit must be a number.
      query: { limit: '10' },
    }),
  );

  await runEffectRequest(
    client.explore.create({
      // @ts-expect-error payload.title must be a string.
      payload: { title: 123 },
    }),
  );

  const created = await runEffectRequest(
    client.explore.create({ payload: { title: 'New item' } }),
  );
  // @ts-expect-error created item has no count field in the vertical schema.
  created.item.count;
}

void verifyClientRejections;
`,
  );

  writeText(
    workspaceDir,
    'tests/type-contracts/effect-server-negative.ts',
    `import {
  Effect,
  HttpApiBuilder,
} from '@modern-js/plugin-bff/effect-edge';
import {
  ExploreNotFound,
  exploreEffectApi,
} from '@ultra-workspace/remote-explore/shared/effect/api';

const marker = {
  appId: 'remote-explore',
  packageName: '@ultra-workspace/remote-explore',
  version: '0.1.0',
  build: 'type-contract-marker',
  deployProfile: 'cloudflare-ssr-mf-effect-v1',
  surface: 'effect-bff',
};

HttpApiBuilder.group(exploreEffectApi, 'explore', handlers =>
  handlers
    .handle('list', () => Effect.succeed({ items: [{ id: 'starter-explore', marker, title: 'Starter explore' }] }))
    .handle('get', ({ params }) =>
      Effect.succeed({ id: params.id, marker, title: 'Starter explore' }),
    )
    .handle('create', ({ payload }) =>
      Effect.succeed({
        item: { id: 'generated-explore', marker, title: payload.title },
      }),
    )
    // @ts-expect-error unknown handler names are rejected by the vertical contract.
    .handle('delete', () => Effect.succeed({})),
);

HttpApiBuilder.group(exploreEffectApi, 'explore', handlers =>
  handlers
    .handle('list', () =>
      // @ts-expect-error title must be a string in the shared success schema.
      Effect.succeed({
        items: [
          {
            id: 'starter-explore',
            marker,
            title: 123,
          },
        ],
      }),
    )
    .handle('get', ({ params }) =>
      params.id === 'starter-explore'
        ? Effect.succeed({ id: params.id, marker, title: 'Starter explore' })
        : Effect.fail(new ExploreNotFound({ id: params.id })),
    )
    .handle('create', ({ payload }) =>
      Effect.succeed({
        item: { id: 'generated-explore', marker, title: payload.title },
      }),
    ),
);

// @ts-expect-error typed error constructors own their schema and require string ids.
new ExploreNotFound({ id: 123 });
`,
  );
}

function runEffectContractTypecheck(workspaceDir: string) {
  const tsgoBin = path.join(
    repoRoot,
    'node_modules/@typescript/native-preview/bin/tsgo.js',
  );
  try {
    execFileSync(
      process.execPath,
      [tsgoBin, '--noEmit', '-p', 'tsconfig.effect-contracts.json'],
      {
        cwd: workspaceDir,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
        },
        stdio: 'pipe',
      },
    );
  } catch (error) {
    const failure = error as Error & {
      stderr?: Buffer;
      stdout?: Buffer;
    };
    throw new Error(
      [failure.message, failure.stdout?.toString(), failure.stderr?.toString()]
        .filter(Boolean)
        .join('\n'),
    );
  }
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

  test('scaffolds the canonical UltraModern SuperApp workspace', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--ultramodern-workspace', '--lang', 'en']);

    for (const relativePath of [
      'AGENTS.md',
      'package.json',
      'pnpm-workspace.yaml',
      'README.md',
      'oxlint.config.ts',
      'oxfmt.config.ts',
      '.agents/skills-lock.json',
      '.agents/rstackjs-agent-skills-LICENSE',
      '.agents/skills/rsbuild-best-practices/SKILL.md',
      '.agents/skills/rspack-best-practices/SKILL.md',
      '.agents/skills/rspack-tracing/SKILL.md',
      '.agents/skills/rspack-tracing/references/tracing-guide.md',
      '.agents/skills/rspack-tracing/scripts/analyze_trace.js',
      '.agents/skills/rsdoctor-analysis/SKILL.md',
      '.agents/skills/rsdoctor-analysis/references/rsdoctor-data-types.md',
      '.agents/skills/rslib-best-practices/SKILL.md',
      '.agents/skills/rslib-modern-package/SKILL.md',
      '.agents/skills/rstest-best-practices/SKILL.md',
      'scripts/assert-mf-types.mjs',
      'scripts/validate-ultramodern-workspace.mjs',
      'scripts/bootstrap-agent-skills.mjs',
      '.modernjs/ultramodern-workspace-template-manifest.json',
      '.modernjs/ultramodern-package-source.json',
      '.modernjs/ultramodern-generated-contract.json',
      'topology/reference-topology.json',
      'topology/ownership.json',
      'topology/local-overlays/development.json',
      'apps/shell-super-app/package.json',
      'apps/shell-super-app/modern.config.ts',
      'apps/shell-super-app/module-federation.config.ts',
      'apps/shell-super-app/src/ultramodern-build.ts',
      'apps/shell-super-app/postcss.config.mjs',
      'apps/shell-super-app/tailwind.config.ts',
      'apps/shell-super-app/locales/en/translation.json',
      'apps/shell-super-app/locales/cs/translation.json',
      'apps/shell-super-app/src/routes/index.css',
      'apps/remotes/remote-explore/package.json',
      'apps/remotes/remote-explore/modern.config.ts',
      'apps/remotes/remote-explore/module-federation.config.ts',
      'apps/remotes/remote-explore/src/ultramodern-build.ts',
      'apps/remotes/remote-explore/postcss.config.mjs',
      'apps/remotes/remote-explore/tailwind.config.ts',
      'apps/remotes/remote-explore/api/effect/index.ts',
      'apps/remotes/remote-explore/shared/effect/api.ts',
      'apps/remotes/remote-explore/src/effect/explore-client.ts',
      'apps/remotes/remote-explore/locales/en/translation.json',
      'apps/remotes/remote-explore/locales/cs/translation.json',
      'apps/remotes/remote-explore/src/routes/index.css',
      'apps/remotes/remote-explore/src/components/explore-widget.tsx',
      'apps/remotes/remote-decide/package.json',
      'apps/remotes/remote-decide/modern.config.ts',
      'apps/remotes/remote-decide/module-federation.config.ts',
      'apps/remotes/remote-decide/src/ultramodern-build.ts',
      'apps/remotes/remote-decide/postcss.config.mjs',
      'apps/remotes/remote-decide/tailwind.config.ts',
      'apps/remotes/remote-decide/api/effect/index.ts',
      'apps/remotes/remote-decide/shared/effect/api.ts',
      'apps/remotes/remote-decide/src/effect/decide-client.ts',
      'apps/remotes/remote-decide/locales/en/translation.json',
      'apps/remotes/remote-decide/locales/cs/translation.json',
      'apps/remotes/remote-decide/src/routes/index.css',
      'apps/remotes/remote-decide/src/components/decide-widget.tsx',
      'apps/remotes/remote-checkout/package.json',
      'apps/remotes/remote-checkout/modern.config.ts',
      'apps/remotes/remote-checkout/module-federation.config.ts',
      'apps/remotes/remote-checkout/src/ultramodern-build.ts',
      'apps/remotes/remote-checkout/postcss.config.mjs',
      'apps/remotes/remote-checkout/tailwind.config.ts',
      'apps/remotes/remote-checkout/api/effect/index.ts',
      'apps/remotes/remote-checkout/shared/effect/api.ts',
      'apps/remotes/remote-checkout/src/effect/checkout-client.ts',
      'apps/remotes/remote-checkout/locales/en/translation.json',
      'apps/remotes/remote-checkout/locales/cs/translation.json',
      'apps/remotes/remote-checkout/src/routes/index.css',
      'apps/remotes/remote-checkout/src/components/checkout-widget.tsx',
      'packages/shared-contracts/src/index.ts',
      'packages/shared-design-tokens/src/index.ts',
      'packages/shared-effect-api/src/index.ts',
    ]) {
      expectPath(workspaceDir, relativePath);
      if (relativePath.endsWith('.ts') || relativePath.endsWith('.tsx')) {
        expectNoHandlebarsArtifacts(readText(workspaceDir, relativePath));
      }
    }
    expectNoPath(workspaceDir, 'services/service-recommendations-effect');
    expectNoPath(workspaceDir, 'apps/remotes/remote-commerce');
    expectNoPath(workspaceDir, 'apps/remotes/remote-identity');
    expectNoPath(workspaceDir, 'apps/remotes/remote-design-system');

    const rootPackage = readJson(workspaceDir, 'package.json');
    const packageScope = rootPackage.name;
    expect(rootPackage.name).toBe('ultra-workspace');
    expect(rootPackage.packageManager).toBe('pnpm@11.4.0');
    expect(rootPackage.engines.pnpm).toBe('>=11.4.0 <11.5.0');
    expectPath(workspaceDir, '.mise.toml');
    expect(rootPackage.workspaces).toEqual([
      'apps/*',
      'apps/remotes/*',
      'services/*',
      'packages/*',
    ]);
    expectPnpm11Policy(workspaceDir);
    expect(readText(workspaceDir, 'pnpm-workspace.yaml')).toContain(
      'packages:\n  - apps/*\n  - apps/remotes/*\n  - services/*\n  - packages/*',
    );
    expect(rootPackage.modernjs.preset).toBe('presetUltramodern');
    expect(rootPackage.modernjs.packageSource).toEqual({
      strategy: 'workspace',
      config: './.modernjs/ultramodern-package-source.json',
    });
    expect(rootPackage.scripts['ultramodern:check']).toBe(
      'node ./scripts/validate-ultramodern-workspace.mjs',
    );
    expect(rootPackage.scripts['ultramodern:assert-mf-types']).toBe(
      'node ./scripts/assert-mf-types.mjs',
    );
    expect(rootPackage.scripts.build).toBe(
      'pnpm -r --filter "./apps/remotes/**" run build && pnpm --filter "./apps/shell-super-app" run build && pnpm ultramodern:assert-mf-types',
    );
    expect(rootPackage.scripts['cloudflare:build']).toBe(
      'pnpm -r --filter "./apps/remotes/**" run cloudflare:build && pnpm --filter "./apps/shell-super-app" run cloudflare:build && pnpm ultramodern:assert-mf-types',
    );
    expect(rootPackage.scripts.format).toBe('oxfmt .');
    expect(rootPackage.scripts['format:check']).toBe('oxfmt --check .');
    expect(rootPackage.scripts.lint).toBe('oxlint .');
    expect(rootPackage.scripts['lint:fix']).toBe('oxlint . --fix');
    expect(rootPackage.scripts['skills:install']).toBe(
      'node ./scripts/bootstrap-agent-skills.mjs',
    );
    expect(rootPackage.scripts.postinstall).toBe(
      'node ./scripts/setup-agent-reference-repos.mjs && node ./scripts/bootstrap-agent-skills.mjs',
    );
    expect(
      Object.keys(rootPackage.scripts).every(
        scriptName => !scriptName.startsWith('zephyr:'),
      ),
    ).toBe(true);
    expect(rootPackage.devDependencies).toMatchObject({
      '@effect/tsgo': '0.11.0',
      '@typescript/native-preview': '7.0.0-dev.20260527.2',
      oxlint: '1.66.0',
      oxfmt: '0.51.0',
      ultracite: '7.7.0',
      wrangler: '4.95.0',
      'zephyr-agent': '1.1.1',
    });

    const agentsInstructions = readText(workspaceDir, 'AGENTS.md');
    expect(agentsInstructions).toContain('UltraModern Agent Contract');
    expect(agentsInstructions).toContain('Required Skill Baseline');
    expect(agentsInstructions).toContain('module-federation/agent-skills');
    expect(agentsInstructions).toContain('`mf`');
    expect(agentsInstructions).toContain('TechsioCZ/skills');

    const skillsLock = readJson(workspaceDir, '.agents/skills-lock.json');
    expect(skillsLock.source.repository).toBe(
      'https://github.com/rstackjs/agent-skills',
    );
    expect(skillsLock.source.commit).toBe(
      '61c948b42512e223bad44b83af4080eba48b2677',
    );
    expect(skillsLock.installDir).toBe('.agents/skills');
    expect(
      skillsLock.baseline.map((skill: { name: string }) => skill.name),
    ).toEqual([
      'rsbuild-best-practices',
      'rspack-best-practices',
      'rspack-tracing',
      'rsdoctor-analysis',
      'rslib-best-practices',
      'rslib-modern-package',
      'rstest-best-practices',
      'mf',
    ]);
    expect(
      readText(workspaceDir, '.agents/skills/rslib-modern-package/SKILL.md'),
    ).toContain('name: rslib-modern-package');
    const privateSource = skillsLock.sources.find(
      (source: { repository: string }) =>
        source.repository === 'https://github.com/TechsioCZ/skills',
    );
    const moduleFederationSource = skillsLock.sources.find(
      (source: { repository: string }) =>
        source.repository ===
        'https://github.com/module-federation/agent-skills',
    );
    expect(moduleFederationSource).toMatchObject({
      install: 'clone',
      commit: '07bb5b6c43ad457609e00c081b72d4c42508ec76',
    });
    expect(
      moduleFederationSource.baseline.map(
        (skill: { name: string }) => skill.name,
      ),
    ).toEqual(['mf']);
    expect(privateSource.install).toBe('clone-if-authorized');
    expect(
      privateSource.baseline.map((skill: { name: string }) => skill.name),
    ).toEqual(['plan-graph', 'dag', 'subagent-graph', 'helm', 'debugger-mode']);

    const appPackagePaths = [
      'apps/shell-super-app/package.json',
      'apps/remotes/remote-explore/package.json',
      'apps/remotes/remote-decide/package.json',
      'apps/remotes/remote-checkout/package.json',
    ];
    const expectedZephyrDependencies = {
      checkout: `@${packageScope}/remote-checkout@workspace:*`,
      decide: `@${packageScope}/remote-decide@workspace:*`,
      explore: `@${packageScope}/remote-explore@workspace:*`,
    };
    const generatedContract = readGeneratedContract(workspaceDir);
    expect(generatedContract.apps.map(app => app.id)).toEqual([
      'shell-super-app',
      'remote-explore',
      'remote-decide',
      'remote-checkout',
    ]);

    for (const packagePath of appPackagePaths) {
      const packageJson = readJson(workspaceDir, packagePath);
      expect(packageJson.dependencies['@modern-js/plugin-tanstack']).toBe(
        'workspace:*',
      );
      expect(packageJson.dependencies['@modern-js/plugin-i18n']).toBe(
        'workspace:*',
      );
      expect(packageJson.dependencies['@modern-js/runtime']).toBe(
        'workspace:*',
      );
      expect(packageJson.dependencies.i18next).toBe('26.2.0');
      expect(packageJson.dependencies['react-i18next']).toBeUndefined();
      expect(packageJson.dependencies['node-fetch']).toBe('^3.3.2');
      expect(packageJson.devDependencies['@modern-js/app-tools']).toBe(
        'workspace:*',
      );
      expect(packageJson.devDependencies['@effect/tsgo']).toBe('0.11.0');
      expect(packageJson.devDependencies['@typescript/native-preview']).toBe(
        '7.0.0-dev.20260527.2',
      );
      expect(packageJson.devDependencies.typescript).toBe('6.0.3');
      expect(packageJson.devDependencies['zephyr-rspack-plugin']).toBe('1.1.1');
      expect(packageJson.devDependencies.wrangler).toBe('4.95.0');
      expect(
        packageJson.devDependencies['zephyr-modernjs-plugin'],
      ).toBeUndefined();
      expect(packageJson.devDependencies.tailwindcss).toBe('^4.3.0');
      expect(packageJson.devDependencies['@tailwindcss/postcss']).toBe(
        '^4.3.0',
      );
      expect(packageJson.devDependencies.postcss).toBe('^8.5.6');
      expect(packageJson.scripts.dev).toBe('modern dev');
      expect(packageJson.scripts.build).toBe(
        packagePath.includes('/remotes/')
          ? 'modern build && node ../../../scripts/assert-mf-types.mjs'
          : 'modern build',
      );
      expect(packageJson.scripts['cloudflare:build']).toBe(
        'MODERNJS_DEPLOY=cloudflare modern build && MODERNJS_DEPLOY=cloudflare modern deploy',
      );
      expect(packageJson.scripts['cloudflare:preview']).toBe(
        'MODERNJS_DEPLOY=cloudflare modern build && MODERNJS_DEPLOY=cloudflare modern deploy && wrangler dev --config .output/wrangler.json',
      );
      expect(packageJson.scripts.serve).toBe('modern serve');
      expect(
        Object.keys(packageJson.scripts).every(
          scriptName => !scriptName.startsWith('zephyr:'),
        ),
      ).toBe(true);
      expect(packageJson['zephyr:dependencies']).toEqual(
        packagePath.includes('/remotes/') ? {} : expectedZephyrDependencies,
      );
      expect(packageJson.scripts.typecheck).toContain('effect-tsgo');
      expect(packageJson.dependencies['@tanstack/react-router']).toBe(
        '1.170.8',
      );
      expect(packageJson.dependencies['@module-federation/modern-js-v3']).toBe(
        '2.5.0',
      );
      const fullStackVertical = fullStackVerticals.find(
        vertical => `${vertical.path}/package.json` === packagePath,
      );
      if (fullStackVertical) {
        expect(packageJson.dependencies['@modern-js/plugin-bff']).toBe(
          'workspace:*',
        );
        expect(packageJson.exports).toMatchObject({
          './effect/client': `./src/effect/${fullStackVertical.stem}-client.ts`,
          './shared/effect/api': './shared/effect/api.ts',
        });
      }
      expect(packageJson.modernjs.preset).toBe('presetUltramodern');
    }

    for (const appDirectory of [
      'apps/shell-super-app',
      'apps/remotes/remote-explore',
      'apps/remotes/remote-decide',
      'apps/remotes/remote-checkout',
    ]) {
      const contractEntry = generatedContract.apps.find(
        app => app.path === appDirectory,
      );
      expect(contractEntry).toBeDefined();
      expectTailwindContract(contractEntry!);
    }

    const shellContract = getGeneratedAppContract(
      workspaceDir,
      'shell-super-app',
    );
    expectAppConfigContract(shellContract, {});
    expect(shellContract.moduleFederation).toMatchObject({
      name: 'shellSuperApp',
      dts: {
        displayErrorInTerminal: true,
        compilerInstance: '--package typescript -- tsc',
      },
    });
    expect(shellContract.moduleFederation.remotes).toEqual([
      {
        id: 'remote-explore',
        alias: 'explore',
        name: 'remoteExplore',
        manifestEnv: 'REMOTE_EXPLORE_MF_MANIFEST',
        manifestUrl: 'http://localhost:3021/mf-manifest.json',
      },
      {
        id: 'remote-decide',
        alias: 'decide',
        name: 'remoteDecide',
        manifestEnv: 'REMOTE_DECIDE_MF_MANIFEST',
        manifestUrl: 'http://localhost:3022/mf-manifest.json',
      },
      {
        id: 'remote-checkout',
        alias: 'checkout',
        name: 'remoteCheckout',
        manifestEnv: 'REMOTE_CHECKOUT_MF_MANIFEST',
        manifestUrl: 'http://localhost:3023/mf-manifest.json',
      },
    ]);

    for (const vertical of fullStackVerticals) {
      const contractEntry = generatedContract.apps.find(
        (app: { id: string }) => app.id === vertical.id,
      );
      expect(contractEntry).toBeDefined();
      const verticalContract = contractEntry!;
      expectAppConfigContract(verticalContract, {
        hasEffect: true,
        apiPrefix: vertical.apiPrefix,
      });
      expect(verticalContract).toMatchObject({
        deploy: {
          target: 'cloudflare',
          worker: {
            ssr: true,
          },
          output: {
            flat: true,
            htmlDistPath: './',
          },
        },
        ssr: {
          mode: 'stream',
          moduleFederationAppSSR: true,
        },
        effect: {
          runtime: 'effect',
          import: '@modern-js/plugin-bff/effect-edge',
          prefix: vertical.apiPrefix,
          workerEntry: 'worker/__modern_bff_effect.js',
          contract: './shared/effect/api',
          client: './effect/client',
          group: vertical.group,
          notFound: vertical.notFound,
          operations: {
            list: {
              method: 'GET',
              path: `/effect/${vertical.stem}`,
              source: 'generated-client',
            },
            get: {
              method: 'GET',
              path: `/effect/${vertical.stem}/:id`,
              source: 'generated-client',
            },
            create: {
              method: 'POST',
              path: `/effect/${vertical.stem}`,
              source: 'generated-client',
            },
          },
        },
        marker: {
          appId: vertical.id,
          version: '0.1.0',
          deployProfile: 'cloudflare-ssr-mf-effect-v1',
          uiSurface: 'ui',
          apiSurface: 'effect-bff',
        },
      });
      expect(verticalContract.moduleFederation.exposes).toEqual(
        expect.arrayContaining(['./Widget', './Route']),
      );
      expect(verticalContract.moduleFederation.exposes).toHaveLength(2);
      expect(verticalContract.moduleFederation.dts).toEqual({
        displayErrorInTerminal: true,
        compilerInstance: '--package typescript -- tsc',
      });
      expect(verticalContract.moduleFederation.browserSafeExposesOnly).toBe(
        true,
      );
      expect(verticalContract.marker.build).toMatch(/^[a-f0-9]{16}$/);
    }

    writeEffectContractTypeFixtures(workspaceDir);
    runEffectContractTypecheck(workspaceDir);

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    expect(topology.sourceFixture).toBe(
      'scripts/mv-integration-pilot/__fixtures__/reference-topology.json',
    );
    expect(topology.preset).toBe('presetUltramodern');
    expect(topology.shell.remoteRefs).toEqual([
      'remote-explore',
      'remote-decide',
      'remote-checkout',
    ]);
    expect(topology.remotes).toHaveLength(3);
    for (const vertical of fullStackVerticals) {
      const topologyEntry = topology.remotes.find(
        (remote: { id: string }) => remote.id === vertical.id,
      );
      expect(topologyEntry.kind).toBe('vertical');
      expect(topologyEntry.moduleFederation.manifestUrl).toContain(
        '/mf-manifest.json',
      );
      expect(topologyEntry.api).toMatchObject({
        effect: {
          runtime: 'effect',
          bff: {
            prefix: vertical.apiPrefix,
            openapi: '/openapi.json',
          },
          contract: {
            export: './shared/effect/api',
            path: `${vertical.path}/shared/effect/api.ts`,
          },
          client: {
            export: './effect/client',
            path: `${vertical.path}/src/effect/${vertical.stem}-client.ts`,
          },
          serverEntry: `${vertical.path}/api/effect/index.ts`,
        },
      });
    }
    expect(
      topology.remotes.every(
        (remote: { kind: string }) => remote.kind === 'vertical',
      ),
    ).toBe(true);
    expect(topology.effectServices ?? []).toEqual([]);
    expect(topology.sharedPackages).toHaveLength(3);

    const ownership = readJson(workspaceDir, 'topology/ownership.json');
    expect(
      ownership.owners.find(
        (owner: { id: string }) => owner.id === 'remote-explore',
      ).ownership.team,
    ).toBe('tractor-explore');
    expect(
      ownership.owners.some(
        (owner: { id: string; path: string }) =>
          owner.id === 'service-recommendations-effect' ||
          owner.path === 'services/service-recommendations-effect',
      ),
    ).toBe(false);

    const manifest = readJson(
      workspaceDir,
      '.modernjs/ultramodern-workspace-template-manifest.json',
    );
    expect(manifest.template.id).toBe(
      'modernjs-ultramodern-superapp-workspace',
    );
    expect(manifest.template.compatibilityLane).toBe('ultramodern-mv');
    expect(manifest.validation.expectedCommands).toContain(
      'mise exec -- pnpm install',
    );
    expect(manifest.validation.expectedCommands).not.toContain(
      'pnpm install --ignore-scripts',
    );
    expect(manifest.validation.expectedCommands).toContain(
      'mise exec -- pnpm run ultramodern:check',
    );
    expect(manifest.validation.postMaterializationValidation).toContain(
      'pnpm-11-policy-enforced',
    );
    expect(manifest.packageSource.strategy).toBe('workspace');
    expect(manifest.agentSkills.source.commit).toBe(
      '61c948b42512e223bad44b83af4080eba48b2677',
    );
    expect(manifest.agentSkills.baseline).toEqual([
      'rsbuild-best-practices',
      'rspack-best-practices',
      'rspack-tracing',
      'rsdoctor-analysis',
      'rslib-best-practices',
      'rslib-modern-package',
      'rstest-best-practices',
    ]);
    expect(manifest.agentSkills.moduleFederationSource).toMatchObject({
      repository: 'https://github.com/module-federation/agent-skills',
      commit: '07bb5b6c43ad457609e00c081b72d4c42508ec76',
      install: 'clone',
      baseline: ['mf'],
    });
    expect(manifest.agentSkills.privateSource).toMatchObject({
      repository: 'https://github.com/TechsioCZ/skills',
      install: 'clone-if-authorized',
      baseline: [
        'plan-graph',
        'dag',
        'subagent-graph',
        'helm',
        'debugger-mode',
      ],
    });

    const packageSource = readJson(
      workspaceDir,
      '.modernjs/ultramodern-package-source.json',
    );
    expect(packageSource.strategy).toBe('workspace');
    expect(packageSource.modernPackages.specifier).toBe('workspace:*');
    expect(packageSource.generatedWorkspacePackages.specifier).toBe(
      'workspace:*',
    );

    const validationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mjs'],
      {
        cwd: workspaceDir,
        stdio: 'pipe',
      },
    ).toString();
    expect(validationOutput).toContain(
      'UltraModern workspace scaffold validated',
    );
  });

  test('adds a full-stack remote MicroVertical to an existing workspace', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-add-remote-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--ultramodern-workspace', '--lang', 'en']);
    runCreateInWorkspace(workspaceDir, [
      'catalog',
      '--microvertical',
      'remote',
      '--lang',
      'en',
    ]);

    for (const relativePath of [
      'apps/remotes/remote-catalog/package.json',
      'apps/remotes/remote-catalog/modern.config.ts',
      'apps/remotes/remote-catalog/module-federation.config.ts',
      'apps/remotes/remote-catalog/api/effect/index.ts',
      'apps/remotes/remote-catalog/shared/effect/api.ts',
      'apps/remotes/remote-catalog/src/effect/catalog-client.ts',
      'apps/remotes/remote-catalog/locales/en/translation.json',
      'apps/remotes/remote-catalog/locales/cs/translation.json',
      'apps/remotes/remote-catalog/src/routes/[lang]/page.tsx',
      'apps/remotes/remote-catalog/src/routes/index.css',
      'apps/remotes/remote-catalog/src/remote-entry.tsx',
      'apps/remotes/remote-catalog/src/components/catalog-widget.tsx',
      'apps/remotes/remote-catalog/postcss.config.mjs',
      'apps/remotes/remote-catalog/tailwind.config.ts',
    ]) {
      expectPath(workspaceDir, relativePath);
    }

    const remotePackage = readJson(
      workspaceDir,
      'apps/remotes/remote-catalog/package.json',
    );
    expect(remotePackage.scripts).toMatchObject({
      dev: 'modern dev',
      build: 'modern build && node ../../../scripts/assert-mf-types.mjs',
      serve: 'modern serve',
    });
    expect(remotePackage.dependencies['@tanstack/react-router']).toBe(
      '1.170.8',
    );
    expect(remotePackage.dependencies['@module-federation/modern-js-v3']).toBe(
      '2.5.0',
    );
    expect(remotePackage.dependencies['@modern-js/plugin-i18n']).toBe(
      'workspace:*',
    );
    expect(remotePackage.dependencies.i18next).toBe('26.2.0');
    expect(remotePackage.dependencies['react-i18next']).toBeUndefined();
    expect(remotePackage.dependencies['node-fetch']).toBe('^3.3.2');
    expect(remotePackage.devDependencies['zephyr-rspack-plugin']).toBe('1.1.1');
    expect(
      remotePackage.devDependencies['zephyr-modernjs-plugin'],
    ).toBeUndefined();
    expect(remotePackage.devDependencies.tailwindcss).toBe('^4.3.0');
    expect(remotePackage['zephyr:dependencies']).toEqual({});
    expect(remotePackage.dependencies['@modern-js/plugin-bff']).toBe(
      'workspace:*',
    );
    expect(remotePackage.exports).toMatchObject({
      './effect/client': './src/effect/catalog-client.ts',
      './shared/effect/api': './shared/effect/api.ts',
    });
    expectNoPath(workspaceDir, 'services/service-catalog-effect');

    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    expect(shellPackage['zephyr:dependencies']).toMatchObject({
      catalog: '@ultra-add-remote-workspace/remote-catalog@workspace:*',
    });

    const shellContract = getGeneratedAppContract(
      workspaceDir,
      'shell-super-app',
    );
    expect(shellContract.moduleFederation.remotes).toContainEqual(
      expect.objectContaining({
        id: 'remote-catalog',
        alias: 'catalog',
        name: 'remoteCatalog',
        manifestEnv: 'REMOTE_CATALOG_MF_MANIFEST',
        manifestUrl: 'http://localhost:3031/mf-manifest.json',
      }),
    );

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    expect(topology.shell.remoteRefs).toContain('remote-catalog');
    expect(
      topology.remotes.find(
        (remote: { id: string }) => remote.id === 'remote-catalog',
      ),
    ).toMatchObject({
      api: {
        effect: {
          runtime: 'effect',
          bff: {
            prefix: '/catalog-api',
            openapi: '/openapi.json',
          },
          contract: {
            export: './shared/effect/api',
            path: 'apps/remotes/remote-catalog/shared/effect/api.ts',
          },
          client: {
            export: './effect/client',
            path: 'apps/remotes/remote-catalog/src/effect/catalog-client.ts',
          },
          serverEntry: 'apps/remotes/remote-catalog/api/effect/index.ts',
        },
      },
      moduleFederation: {
        manifestUrl: 'http://localhost:3031/mf-manifest.json',
      },
    });
    expect(
      topology.effectServices?.some(
        (service: { id: string }) => service.id === 'service-catalog-effect',
      ),
    ).toBe(false);

    const ownership = readJson(workspaceDir, 'topology/ownership.json');
    expect(
      ownership.owners.find(
        (owner: { id: string }) => owner.id === 'remote-catalog',
      ).ownership.team,
    ).toBe('super-app-platform');

    const overlay = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    expect(overlay.ports['remote-catalog']).toBe(3031);
    expect(overlay.manifests['remote-catalog']).toBe(
      'http://localhost:3031/mf-manifest.json',
    );
    expect(overlay.apis['remote-catalog']).toBe(
      'http://localhost:3031/catalog-api',
    );
    expect(overlay.services?.['service-catalog-effect']).toBeUndefined();
  });

  test('adds an explicit external Effect service to an existing workspace', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-add-service-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--ultramodern-workspace', '--lang', 'en']);
    runCreateInWorkspace(workspaceDir, [
      'catalog-api',
      '--microvertical',
      'service',
      '--lang',
      'en',
    ]);

    for (const relativePath of [
      'services/service-catalog-api-effect/package.json',
      'services/service-catalog-api-effect/modern.config.ts',
      'services/service-catalog-api-effect/api/effect/index.ts',
      'services/service-catalog-api-effect/src/routes/index.css',
      'services/service-catalog-api-effect/postcss.config.mjs',
      'services/service-catalog-api-effect/tailwind.config.ts',
    ]) {
      expectPath(workspaceDir, relativePath);
    }

    const servicePackage = readJson(
      workspaceDir,
      'services/service-catalog-api-effect/package.json',
    );
    expect(servicePackage.modernjs.role).toBe('effect-service');
    expect(servicePackage.devDependencies['@modern-js/plugin-bff']).toBe(
      'workspace:*',
    );
    expect(servicePackage.devDependencies.tailwindcss).toBe('^4.3.0');

    expectNoPath(
      workspaceDir,
      'services/service-catalog-api-effect/shared/effect/api.ts',
    );

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    const serviceTopology = topology.effectServices.find(
      (service: { id: string }) => service.id === 'service-catalog-api-effect',
    );
    expect(serviceTopology).toMatchObject({
      id: 'service-catalog-api-effect',
      kind: 'effect-service',
      runtime: 'effect',
      package: '@ultra-add-service-workspace/service-catalog-api-effect',
      bff: {
        prefix: '/catalog-api',
        openapi: '/openapi.json',
      },
      contract: {
        package: '@ultra-add-service-workspace/shared-effect-api',
        export: 'catalogEffectApi',
        path: 'packages/shared-effect-api/src/index.ts',
      },
      serverEntry: 'services/service-catalog-api-effect/api/effect/index.ts',
      basePath: '/catalog-api/effect/catalog',
      group: 'catalog',
      notFound: 'CatalogNotFound',
      operations: {
        list: {
          method: 'GET',
          path: '/effect/catalog',
          source: 'generated-client',
        },
        get: {
          method: 'GET',
          path: '/effect/catalog/:id',
          source: 'generated-client',
        },
        create: {
          method: 'POST',
          path: '/effect/catalog',
          source: 'generated-client',
        },
      },
    });

    const overlay = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    expect(overlay.ports['service-catalog-api-effect']).toBe(3031);
    expect(overlay.services['service-catalog-api-effect']).toBe(
      'http://localhost:3031/catalog-api',
    );
  });

  test('scaffolds install-backed Modern package source metadata', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-install-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, [
      '--ultramodern-workspace',
      '--ultramodern-package-source',
      'install',
      '--ultramodern-package-version',
      '3.2.0-ultramodern.0',
      '--ultramodern-package-registry',
      'https://registry.example.test/',
      '--lang',
      'en',
    ]);

    const rootPackage = readJson(workspaceDir, 'package.json');
    expect(rootPackage.modernjs.packageSource).toEqual({
      strategy: 'install',
      config: './.modernjs/ultramodern-package-source.json',
    });

    const packageSource = readJson(
      workspaceDir,
      '.modernjs/ultramodern-package-source.json',
    );
    expect(packageSource.strategy).toBe('install');
    expect(packageSource.modernPackages.specifier).toBe('3.2.0-ultramodern.0');
    expect(packageSource.modernPackages.registry).toBe(
      'https://registry.example.test/',
    );
    expect(packageSource.generatedWorkspacePackages.specifier).toBe(
      'workspace:*',
    );

    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    expect(shellPackage.dependencies['@modern-js/plugin-tanstack']).toBe(
      '3.2.0-ultramodern.0',
    );
    expect(shellPackage.dependencies['@modern-js/runtime']).toBe(
      '3.2.0-ultramodern.0',
    );
    expect(shellPackage.dependencies['@modern-js/plugin-bff']).toBe(
      '3.2.0-ultramodern.0',
    );
    expect(
      shellPackage.dependencies['@ultra-install-workspace/shared-effect-api'],
    ).toBeUndefined();
    expect(shellPackage.devDependencies['@modern-js/app-tools']).toBe(
      '3.2.0-ultramodern.0',
    );
    expect(
      shellPackage.dependencies['@ultra-install-workspace/shared-contracts'],
    ).toBe('workspace:*');
    expect(
      shellPackage.dependencies[
        '@ultra-install-workspace/shared-design-tokens'
      ],
    ).toBe('workspace:*');

    for (const vertical of [
      'remote-explore',
      'remote-decide',
      'remote-checkout',
    ]) {
      const verticalPackage = readJson(
        workspaceDir,
        `apps/remotes/${vertical}/package.json`,
      );
      expect(verticalPackage.dependencies['@modern-js/plugin-bff']).toBe(
        '3.2.0-ultramodern.0',
      );
      expect(
        verticalPackage.dependencies[
          '@ultra-install-workspace/shared-effect-api'
        ],
      ).toBeUndefined();
    }

    expectNoPath(
      workspaceDir,
      'services/service-recommendations-effect/package.json',
    );

    const sharedEffectPackage = readJson(
      workspaceDir,
      'packages/shared-effect-api/package.json',
    );
    expect(sharedEffectPackage.dependencies['@modern-js/plugin-bff']).toBe(
      '3.2.0-ultramodern.0',
    );

    const validationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mjs'],
      {
        cwd: workspaceDir,
        stdio: 'pipe',
      },
    ).toString();
    expect(validationOutput).toContain(
      'UltraModern workspace scaffold validated',
    );
  });

  test('scaffolds npm alias package source metadata for external forks', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-alias-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, [
      '--ultramodern-workspace',
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

    const packageSource = readJson(
      workspaceDir,
      '.modernjs/ultramodern-package-source.json',
    );
    expect(packageSource.modernPackages.aliases).toMatchObject({
      '@modern-js/app-tools': '@bleedingdev/modern-js-app-tools',
      '@modern-js/plugin-bff': '@bleedingdev/modern-js-plugin-bff',
      '@modern-js/plugin-i18n': '@bleedingdev/modern-js-plugin-i18n',
      '@modern-js/plugin-tanstack': '@bleedingdev/modern-js-plugin-tanstack',
      '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
    });

    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    expect(shellPackage.dependencies['@modern-js/plugin-tanstack']).toBe(
      'npm:@bleedingdev/modern-js-plugin-tanstack@3.2.0-ultramodern.0',
    );
    expect(shellPackage.dependencies['@modern-js/plugin-i18n']).toBe(
      'npm:@bleedingdev/modern-js-plugin-i18n@3.2.0-ultramodern.0',
    );
    expect(shellPackage.dependencies['@modern-js/runtime']).toBe(
      'npm:@bleedingdev/modern-js-runtime@3.2.0-ultramodern.0',
    );
    expect(shellPackage.devDependencies['@modern-js/app-tools']).toBe(
      'npm:@bleedingdev/modern-js-app-tools@3.2.0-ultramodern.0',
    );

    const validationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mjs'],
      {
        cwd: workspaceDir,
        stdio: 'pipe',
      },
    ).toString();
    expect(validationOutput).toContain(
      'UltraModern workspace scaffold validated',
    );
  });
});
