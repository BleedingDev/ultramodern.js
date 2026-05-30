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

function expectPath(root: string, relativePath: string) {
  expect(fs.existsSync(path.join(root, relativePath))).toBe(true);
}

function expectNoPath(root: string, relativePath: string) {
  expect(fs.existsSync(path.join(root, relativePath))).toBe(false);
}

function expectPnpm11Policy(workspaceDir: string) {
  expect(readPnpmConfig(workspaceDir, 'packages')).toEqual([
    'apps/*',
    'verticals/*',
    'packages/*',
  ]);
  expect(readPnpmConfig(workspaceDir, 'minimumReleaseAge')).toBe(0);
  expect(
    readPnpmConfig(workspaceDir, 'minimumReleaseAgeStrict'),
  ).toBeUndefined();
  expect(
    readPnpmConfig(workspaceDir, 'minimumReleaseAgeIgnoreMissingTime'),
  ).toBeUndefined();
  expect(
    readPnpmConfig(workspaceDir, 'minimumReleaseAgeExclude'),
  ).toBeUndefined();
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
  expect(readPnpmConfig(workspaceDir, 'trustPolicy')).toBeUndefined();
  expect(
    readPnpmConfig(workspaceDir, 'trustPolicyIgnoreAfter'),
  ).toBeUndefined();
  expect(readPnpmConfig(workspaceDir, 'blockExoticSubdeps')).toBe(true);
  expect(readPnpmConfig(workspaceDir, 'engineStrict')).toBe(true);
  expect(readPnpmConfig(workspaceDir, 'pmOnFail')).toBe('error');
  expect(readPnpmConfig(workspaceDir, 'verifyDepsBeforeRun')).toBe('error');
  expect(readPnpmConfig(workspaceDir, 'strictDepBuilds')).toBe(true);
  expect(readPnpmConfig(workspaceDir, 'allowBuilds')).toEqual({
    '@swc/core': true,
    'core-js': true,
    esbuild: true,
    lefthook: true,
    'msgpackr-extract': true,
    sharp: true,
    workerd: true,
  });
  expect(readPnpmConfig(workspaceDir, 'onlyBuiltDependencies')).toBeUndefined();
}

function readGeneratedContract(workspaceDir: string) {
  return readJson<{
    cssFederation: Record<string, any>;
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
  expect(contractEntry.styling).toMatchObject({
    tailwind: true,
    postcssPlugins: ['@tailwindcss/postcss'],
  });
}

function expectCssFederationContract(
  generatedContract: { cssFederation: Record<string, any> },
  contractEntry: { id: string; styling: Record<string, any> },
  expected: {
    classPrefix: string;
    ownedLayers: string[];
    role: string;
    rootSelector: string;
    remote?: boolean;
  },
) {
  expect(generatedContract.cssFederation.sharedDesignTokens).toMatchObject({
    owner: {
      id: 'shared-design-tokens',
    },
    role: 'shared-design-tokens',
    rootSelector: ':root',
    classPrefix: '--um-',
    layers: {
      owned: ['ultramodern-shared-tokens'],
    },
    entrypoints: {
      css: ['packages/shared-design-tokens/src/tokens.css'],
    },
    assets: {
      exports: ['./tokens.css'],
    },
    dedupe: {
      duplicateBaseStylesAllowed: false,
      runtimeLoad: 'once-per-content-hash',
    },
    ssr: {
      firstPaintRequired: true,
    },
  });
  expect(contractEntry.styling.federation).toMatchObject({
    owner: {
      id: contractEntry.id,
    },
    role: expected.role,
    rootSelector: expected.rootSelector,
    classPrefix: expected.classPrefix,
    layers: {
      shared: ['ultramodern-shared-tokens'],
      owned: expected.ownedLayers,
    },
    entrypoints: {
      css: ['src/routes/index.css'],
    },
    assets: {
      owned: ['src/routes/index.css'],
      emittedBy: 'modern-rspack-css-extraction',
      contentHash: true,
    },
    dedupe: {
      duplicateBaseStylesAllowed: false,
      runtimeLoad: 'once-per-content-hash',
    },
    ssr: {
      cloudflare: true,
      firstPaintRequired: true,
    },
  });
  expect(contractEntry.styling.federation.assets.shared).toEqual([
    expect.stringMatching(/\/shared-design-tokens\/tokens\.css$/),
  ]);
  if (expected.remote) {
    expect(contractEntry.styling.federation.entrypoints.remoteEntry).toBe(
      'src/remote-entry.tsx',
    );
    expect(contractEntry.styling.federation.ssr.remoteCss).toBe(
      'remote-manifest-owned-css',
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

  test('scaffolds a shell-only UltraModern SuperApp workspace', () => {
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
      'scripts/proof-cloudflare-version.mjs',
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
      'apps/shell-super-app/src/effect/vertical-clients.ts',
      'apps/shell-super-app/postcss.config.mjs',
      'apps/shell-super-app/tailwind.config.ts',
      'apps/shell-super-app/locales/en/translation.json',
      'apps/shell-super-app/locales/en/shell.json',
      'apps/shell-super-app/locales/cs/translation.json',
      'apps/shell-super-app/locales/cs/shell.json',
      'apps/shell-super-app/src/routes/index.css',
      'apps/shell-super-app/src/routes/ultramodern-route-metadata.ts',
      'packages/shared-contracts/src/index.ts',
      'packages/shared-design-tokens/src/index.ts',
      'packages/shared-design-tokens/src/tokens.css',
      'packages/shared-effect-api/src/index.ts',
    ]) {
      expectPath(workspaceDir, relativePath);
    }
    expectNoPath(workspaceDir, 'verticals/workspace');
    expectNoPath(workspaceDir, 'verticals/records');
    expectNoPath(workspaceDir, 'verticals/actions');
    expectNoPath(workspaceDir, 'services/service-recommendations-effect');
    expectNoPath(workspaceDir, 'apps/remotes/remote-commerce');
    expectNoPath(workspaceDir, 'apps/remotes/remote-identity');
    expectNoPath(workspaceDir, 'apps/remotes/remote-design-system');

    const rootPackage = readJson(workspaceDir, 'package.json');
    expect(rootPackage.name).toBe('ultra-workspace');
    expect(rootPackage.packageManager).toBe('pnpm@11.5.0');
    expect(rootPackage.engines.pnpm).toBe('>=11.5.0 <11.6.0');
    expectPath(workspaceDir, '.mise.toml');
    expect(rootPackage.workspaces).toEqual([
      'apps/*',
      'verticals/*',
      'packages/*',
    ]);
    expectPnpm11Policy(workspaceDir);
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
      'pnpm --filter "./apps/shell-super-app" run build && pnpm ultramodern:assert-mf-types',
    );
    expect(rootPackage.scripts['cloudflare:build']).toBe(
      'pnpm --filter "./apps/shell-super-app" run cloudflare:build && pnpm ultramodern:assert-mf-types',
    );
    expect(rootPackage.scripts['cloudflare:deploy']).toBe(
      'pnpm --filter "./apps/shell-super-app" run cloudflare:deploy',
    );
    expect(rootPackage.scripts['cloudflare:proof']).toBe(
      'node ./scripts/proof-cloudflare-version.mjs --out .codex/reports/cloudflare-version-proof/public-url-proof.json',
    );
    expect(rootPackage.scripts.format).toBe('oxfmt .');
    expect(rootPackage.scripts['format:check']).toBe('oxfmt --check .');
    expect(rootPackage.scripts.lint).toBe('oxlint .');
    expect(rootPackage.scripts['lint:fix']).toBe('oxlint . --fix');
    expect(rootPackage.scripts['skills:install']).toBe(
      'node ./scripts/bootstrap-agent-skills.mjs',
    );
    expect(rootPackage.scripts['skills:check']).toBe(
      'node ./scripts/bootstrap-agent-skills.mjs --check',
    );
    expect(rootPackage.scripts.postinstall).toBe(
      'node ./scripts/bootstrap-agent-skills.mjs && (git rev-parse --is-inside-work-tree >/dev/null 2>&1 && lefthook install || true) && node ./scripts/setup-agent-reference-repos.mjs',
    );
    expect(
      Object.keys(rootPackage.scripts).every(
        scriptName => !scriptName.startsWith('zephyr:'),
      ),
    ).toBe(true);
    expect(rootPackage.devDependencies).toMatchObject({
      '@effect/tsgo': '0.13.0',
      '@typescript/native-preview': '7.0.0-dev.20260527.2',
      lefthook: '^2.1.9',
      oxlint: '1.66.0',
      oxfmt: '0.51.0',
      ultracite: '7.7.0',
      wrangler: '4.95.0',
      'zephyr-agent': '1.1.1',
    });

    expectPath(workspaceDir, 'AGENTS.md');
    expectPath(workspaceDir, '.codex/hooks.json');
    expectPath(workspaceDir, 'lefthook.yml');

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
    expectPath(workspaceDir, '.agents/skills/rslib-modern-package/SKILL.md');
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

    const appPackagePaths = ['apps/shell-super-app/package.json'];
    const generatedContract = readGeneratedContract(workspaceDir);
    expect(generatedContract.apps.map(app => app.id)).toEqual([
      'shell-super-app',
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
      expect(packageJson.devDependencies['@effect/tsgo']).toBe('0.13.0');
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
      expect(packageJson.scripts.build).toBe('modern build');
      expect(packageJson.scripts['cloudflare:build']).toBe(
        'ULTRAMODERN_ZEPHYR=false MODERNJS_DEPLOY=cloudflare modern build && ULTRAMODERN_ZEPHYR=false MODERNJS_DEPLOY=cloudflare modern deploy',
      );
      expect(packageJson.scripts['cloudflare:deploy']).toBe(
        'ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS=true ULTRAMODERN_ZEPHYR=false MODERNJS_DEPLOY=cloudflare modern deploy',
      );
      expect(packageJson.scripts['cloudflare:preview']).toBe(
        'pnpm run cloudflare:build && wrangler dev --config .output/wrangler.json',
      );
      expect(packageJson.scripts['cloudflare:proof']).toBe(
        'node ../../scripts/proof-cloudflare-version.mjs --app shell-super-app',
      );
      expect(packageJson.scripts.serve).toBe('modern serve');
      expect(
        Object.keys(packageJson.scripts).every(
          scriptName => !scriptName.startsWith('zephyr:'),
        ),
      ).toBe(true);
      expect(packageJson['zephyr:dependencies']).toEqual({});
      expect(typeof packageJson.scripts.typecheck).toBe('string');
      expect(packageJson.dependencies['@tanstack/react-router']).toBe(
        '1.170.8',
      );
      expect(packageJson.dependencies['@module-federation/modern-js-v3']).toBe(
        '2.5.0',
      );
      expect(packageJson.dependencies['@modern-js/plugin-bff']).toBe(
        'workspace:*',
      );
      expect(packageJson.exports).toMatchObject({
        './effect/clients': './src/effect/vertical-clients.ts',
      });
      expect(packageJson.modernjs.preset).toBe('presetUltramodern');
    }

    for (const appDirectory of ['apps/shell-super-app']) {
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
    expectCssFederationContract(generatedContract, shellContract, {
      classPrefix: 'shell:',
      ownedLayers: ['ultramodern-shell-base', 'ultramodern-shell-overlay'],
      role: 'shell-base-overlay',
      rootSelector: '[data-app-id="shell-super-app"]',
    });
    expect(shellContract.moduleFederation).toMatchObject({
      name: 'shellSuperApp',
      dts: {
        displayErrorInTerminal: true,
        compilerInstance: '--package typescript -- tsc',
      },
    });
    expect(shellContract.moduleFederation.remoteRefs ?? []).toEqual([]);
    expect(shellContract.moduleFederation.remotes ?? []).toEqual([]);
    expect(shellContract.i18n).toMatchObject({
      backend: {
        enabled: true,
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
      namespace: 'shell',
      namespaces: ['shell', 'translation'],
      localisedUrls: {},
      resourceOwnership: {
        ownerAppId: 'shell-super-app',
        source: 'route-owned',
      },
    });
    expect(shellContract.routes).toMatchObject({
      source: 'route-owned',
      metadataExport: './src/routes/ultramodern-route-metadata',
      generatedRouteMap: true,
    });
    expect(shellContract.deploy).toMatchObject({
      target: 'cloudflare',
      cloudflare: {
        workerName: 'ultra-workspace-shell-super-app',
        publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
        assetsBinding: 'ASSETS',
        routes: {
          ssr: '/en',
          mfManifest: '/mf-manifest.json',
          locale: '/locales/en/shell.json',
        },
      },
      worker: {
        name: 'ultra-workspace-shell-super-app',
        ssr: true,
      },
    });
    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    expect(topology.description).toBe(
      'Generated UltraModern SuperApp shell that can grow by adding full-stack verticals.',
    );
    expect(topology.preset).toBe('presetUltramodern');
    expect(topology.shell.verticalRefs).toEqual([]);
    expect(topology.shell.moduleFederation.remotes).toEqual([]);
    expect(topology.shell.cloudflare).toMatchObject({
      workerName: 'ultra-workspace-shell-super-app',
      publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
      assetsBinding: 'ASSETS',
    });
    expect(topology.verticals).toEqual([]);
    expect(topology.sharedPackages).toHaveLength(3);

    const ownership = readJson(workspaceDir, 'topology/ownership.json');
    expect(
      ownership.owners.find(
        (owner: { id: string }) => owner.id === 'shell-super-app',
      ).ownership.team,
    ).toBe('super-app-platform');
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
    expect(manifest.validation.expectedCommands).toEqual([
      'mise install',
      'pnpm install',
      'pnpm run ultramodern:check',
    ]);
    expect(manifest.validation.postMaterializationValidation).toEqual([
      'ultramodern-workspace-contract-check',
      'github-workflow-security-enforced',
      'pnpm-11-policy-enforced',
      'template-manifest-retained',
    ]);
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
    expect(validationOutput.trim()).toBe(
      'UltraModern workspace scaffold validated',
    );

    const mfTypesHelp = execFileSync(
      process.execPath,
      ['scripts/assert-mf-types.mjs', '--help'],
      {
        cwd: workspaceDir,
        stdio: 'pipe',
      },
    ).toString();
    expect(mfTypesHelp).toMatch(/Usage:/u);
  });

  test('adds a full-stack MicroVertical to an existing workspace', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-add-remote-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--ultramodern-workspace', '--lang', 'en']);
    runCreateInWorkspace(workspaceDir, [
      'catalog',
      '--vertical',
      '--lang',
      'en',
    ]);

    for (const relativePath of [
      'verticals/catalog/package.json',
      'verticals/catalog/modern.config.ts',
      'verticals/catalog/module-federation.config.ts',
      'verticals/catalog/api/effect/index.ts',
      'verticals/catalog/shared/effect/api.ts',
      'verticals/catalog/src/effect/catalog-client.ts',
      'verticals/catalog/locales/en/translation.json',
      'verticals/catalog/locales/cs/translation.json',
      'verticals/catalog/src/routes/[lang]/page.tsx',
      'verticals/catalog/src/routes/index.css',
      'verticals/catalog/src/federation-entry.tsx',
      'verticals/catalog/src/components/catalog-widget.tsx',
      'verticals/catalog/postcss.config.mjs',
      'verticals/catalog/tailwind.config.ts',
    ]) {
      expectPath(workspaceDir, relativePath);
    }

    const remotePackage = readJson(
      workspaceDir,
      'verticals/catalog/package.json',
    );
    expect(remotePackage.scripts).toMatchObject({
      dev: 'modern dev',
      build: 'modern build && node ../../scripts/assert-mf-types.mjs',
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
      catalog: '@ultra-add-remote-workspace/catalog@workspace:*',
    });

    const shellContract = getGeneratedAppContract(
      workspaceDir,
      'shell-super-app',
    );
    const generatedContract = readGeneratedContract(workspaceDir);
    expect(shellContract.moduleFederation.remotes).toContainEqual(
      expect.objectContaining({
        id: 'catalog',
        alias: 'catalog',
        name: 'verticalCatalog',
        manifestEnv: 'VERTICAL_CATALOG_MF_MANIFEST',
        manifestUrl: 'http://localhost:3031/mf-manifest.json',
      }),
    );
    const catalogContract = getGeneratedAppContract(workspaceDir, 'catalog');
    expectCssFederationContract(generatedContract, catalogContract, {
      classPrefix: 'catalog:',
      ownedLayers: ['ultramodern-vertical-catalog'],
      role: 'vertical-css',
      rootSelector: '[data-app-id="catalog"]',
    });

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    expect(topology.shell.verticalRefs).toEqual(['catalog']);
    expect(
      topology.verticals.find(
        (vertical: { id: string }) => vertical.id === 'catalog',
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
            path: 'verticals/catalog/shared/effect/api.ts',
          },
          client: {
            export: './effect/client',
            path: 'verticals/catalog/src/effect/catalog-client.ts',
          },
          serverEntry: 'verticals/catalog/api/effect/index.ts',
        },
      },
      moduleFederation: {
        manifestUrl: 'http://localhost:3031/mf-manifest.json',
      },
    });
    expect(
      (topology.effectServices ?? []).some(
        (service: { id: string }) => service.id === 'service-catalog-effect',
      ),
    ).toBe(false);

    const ownership = readJson(workspaceDir, 'topology/ownership.json');
    expect(
      ownership.owners.find((owner: { id: string }) => owner.id === 'catalog')
        .ownership.team,
    ).toBe('super-app-platform');

    const overlay = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    expect(overlay.ports.catalog).toBe(3031);
    expect(overlay.manifests.catalog).toBe(
      'http://localhost:3031/mf-manifest.json',
    );
    expect(overlay.apis.catalog).toBe('http://localhost:3031/catalog-api');
    expect(overlay.services?.['service-catalog-effect']).toBeUndefined();
  });

  test('rejects the removed legacy microvertical flag', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-legacy-flag-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--ultramodern-workspace', '--lang', 'en']);
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
    expect(validationOutput.trim()).toBe(
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
    expect(validationOutput.trim()).toBe(
      'UltraModern workspace scaffold validated',
    );
  });
});
