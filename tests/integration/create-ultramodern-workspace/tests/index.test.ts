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
  const pnpmWorkspace = readText(workspaceDir, 'pnpm-workspace.yaml');
  for (const requiredSnippet of [
    'minimumReleaseAge: 1440',
    'minimumReleaseAgeStrict: true',
    'minimumReleaseAgeIgnoreMissingTime: false',
    "minimumReleaseAgeExclude:\n  - '@modern-js/*'\n  - '@bleedingdev/*'\n  - '@effect/tsgo'\n  - '@effect/tsgo-*'\n  - '@typescript/native-preview'\n  - '@typescript/native-preview-*'",
    'trustPolicy: no-downgrade',
    'trustPolicyIgnoreAfter: 1440',
    'blockExoticSubdeps: true',
    'engineStrict: true',
    'pmOnFail: error',
    'verifyDepsBeforeRun: error',
    'strictDepBuilds: true',
    "allowBuilds:\n  '@swc/core': true\n  core-js: true\n  esbuild: true\n  msgpackr-extract: true\n  simple-git-hooks: true",
  ]) {
    expect(pnpmWorkspace).toContain(requiredSnippet);
  }
  expect(pnpmWorkspace).not.toContain('onlyBuiltDependencies');
}

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
    '@ultra-workspace/shared-effect-api',
    path.join(workspaceDir, 'packages/shared-effect-api'),
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
          'packages/shared-effect-api/src/index.ts',
          'services/service-recommendations-effect/api/effect/index.ts',
          'apps/shell-super-app/src/effect/recommendations-client.ts',
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
  recommendationsEffectApi,
  recommendationsOperationContexts,
} from '@ultra-workspace/shared-effect-api';

async function verifyClient() {
  const client = await runEffectRequest(
    makeEffectHttpApiClient(recommendationsEffectApi, {
      baseUrl: '/recommendations',
      requestContext: {
        operationContext: recommendationsOperationContexts.list,
      },
    }),
  );

  const list = await runEffectRequest(
    client.recommendations.list({ query: { limit: 1 } }),
  );
  const firstTitle: string = list.items[0]?.title ?? '';

  const item = await runEffectRequest(
    client.recommendations.get({
      params: { id: 'starter-recommendations' },
    }),
  );
  const itemId: string = item.id;

  const created = await runEffectRequest(
    client.recommendations.create({ payload: { title: firstTitle || itemId } }),
  );
  const createdTitle: string = created.item.title;

  return createdTitle;
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
  recommendationsEffectApi,
  recommendationsOperationContexts,
} from '@ultra-workspace/shared-effect-api';

async function verifyClientRejections() {
  const client = await runEffectRequest(
    makeEffectHttpApiClient(recommendationsEffectApi, {
      baseUrl: '/recommendations',
      requestContext: {
        operationContext: recommendationsOperationContexts.list,
      },
    }),
  );

  // @ts-expect-error unknown endpoint names are not part of the shared contract.
  await runEffectRequest(client.recommendations.remove({}));

  // @ts-expect-error get requires route params from the shared contract.
  await runEffectRequest(client.recommendations.get({}));

  await runEffectRequest(
    client.recommendations.get({
      // @ts-expect-error params.id must be a string.
      params: { id: 123 },
    }),
  );

  await runEffectRequest(
    client.recommendations.list({
      // @ts-expect-error query.limit must be a number.
      query: { limit: '10' },
    }),
  );

  await runEffectRequest(
    client.recommendations.create({
      // @ts-expect-error payload.title must be a string.
      payload: { title: 123 },
    }),
  );

  const created = await runEffectRequest(
    client.recommendations.create({ payload: { title: 'New item' } }),
  );
  // @ts-expect-error created item has no count field in the shared schema.
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
} from '@modern-js/plugin-bff/effect-server';
import {
  RecommendationNotFound,
  recommendationsEffectApi,
} from '@ultra-workspace/shared-effect-api';

HttpApiBuilder.group(recommendationsEffectApi, 'recommendations', handlers =>
  handlers
    .handle('list', () => Effect.succeed({ items: [] }))
    .handle('get', ({ params }) =>
      Effect.succeed({ id: params.id, title: 'Starter recommendations' }),
    )
    .handle('create', ({ payload }) =>
      Effect.succeed({
        item: { id: 'generated-recommendation', title: payload.title },
      }),
    )
    // @ts-expect-error unknown handler names are rejected by the shared contract.
    .handle('delete', () => Effect.succeed({})),
);

HttpApiBuilder.group(recommendationsEffectApi, 'recommendations', handlers =>
  handlers
    .handle('list', () =>
      // @ts-expect-error title must be a string in the shared success schema.
      Effect.succeed({
        items: [
          {
            id: 'starter-recommendations',
            title: 123,
          },
        ],
      }),
    )
    .handle('get', ({ params }) =>
      params.id === 'starter-recommendations'
        ? Effect.succeed({ id: params.id, title: 'Starter recommendations' })
        : Effect.fail(new RecommendationNotFound({ id: params.id })),
    )
    .handle('create', ({ payload }) =>
      Effect.succeed({
        item: { id: 'generated-recommendation', title: payload.title },
      }),
    ),
);

// @ts-expect-error typed error constructors own their schema and require string ids.
new RecommendationNotFound({ id: 123 });
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
      'scripts/validate-ultramodern-workspace.mjs',
      'scripts/bootstrap-agent-skills.mjs',
      '.modernjs/ultramodern-workspace-template-manifest.json',
      '.modernjs/ultramodern-package-source.json',
      'topology/reference-topology.json',
      'topology/ownership.json',
      'topology/local-overlays/development.json',
      'apps/shell-super-app/package.json',
      'apps/shell-super-app/modern.config.ts',
      'apps/shell-super-app/module-federation.config.ts',
      'apps/shell-super-app/postcss.config.mjs',
      'apps/shell-super-app/tailwind.config.ts',
      'apps/shell-super-app/src/routes/index.css',
      'apps/shell-super-app/src/effect/recommendations-client.ts',
      'apps/remotes/remote-commerce/package.json',
      'apps/remotes/remote-commerce/modern.config.ts',
      'apps/remotes/remote-commerce/module-federation.config.ts',
      'apps/remotes/remote-commerce/postcss.config.mjs',
      'apps/remotes/remote-commerce/tailwind.config.ts',
      'apps/remotes/remote-commerce/src/routes/index.css',
      'apps/remotes/remote-commerce/src/components/commerce-widget.tsx',
      'apps/remotes/remote-identity/package.json',
      'apps/remotes/remote-identity/modern.config.ts',
      'apps/remotes/remote-identity/module-federation.config.ts',
      'apps/remotes/remote-identity/postcss.config.mjs',
      'apps/remotes/remote-identity/tailwind.config.ts',
      'apps/remotes/remote-identity/src/routes/index.css',
      'apps/remotes/remote-identity/src/components/identity-widget.tsx',
      'apps/remotes/remote-design-system/package.json',
      'apps/remotes/remote-design-system/modern.config.ts',
      'apps/remotes/remote-design-system/module-federation.config.ts',
      'apps/remotes/remote-design-system/postcss.config.mjs',
      'apps/remotes/remote-design-system/tailwind.config.ts',
      'apps/remotes/remote-design-system/src/routes/index.css',
      'apps/remotes/remote-design-system/src/components/button.tsx',
      'apps/remotes/remote-design-system/src/tokens.ts',
      'services/service-recommendations-effect/package.json',
      'services/service-recommendations-effect/modern.config.ts',
      'services/service-recommendations-effect/postcss.config.mjs',
      'services/service-recommendations-effect/tailwind.config.ts',
      'services/service-recommendations-effect/api/effect/index.ts',
      'services/service-recommendations-effect/src/routes/index.css',
      'services/service-recommendations-effect/src/routes/page.tsx',
      'packages/shared-contracts/src/index.ts',
      'packages/shared-design-tokens/src/index.ts',
      'packages/shared-effect-api/src/index.ts',
    ]) {
      expectPath(workspaceDir, relativePath);
      if (relativePath.endsWith('.ts') || relativePath.endsWith('.tsx')) {
        expectNoHandlebarsArtifacts(readText(workspaceDir, relativePath));
      }
    }

    const rootPackage = readJson(workspaceDir, 'package.json');
    expect(rootPackage.name).toBe('ultra-workspace');
    expect(rootPackage.packageManager).toBe('pnpm@11.1.2');
    expect(rootPackage.engines.pnpm).toBe('>=11.0.0');
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
      '@typescript/native-preview': '7.0.0-dev.20260525.1',
      oxlint: '1.66.0',
      oxfmt: '0.51.0',
      ultracite: '7.7.0',
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
      'apps/remotes/remote-commerce/package.json',
      'apps/remotes/remote-identity/package.json',
      'apps/remotes/remote-design-system/package.json',
    ];

    for (const packagePath of appPackagePaths) {
      const packageJson = readJson(workspaceDir, packagePath);
      expect(packageJson.dependencies['@modern-js/plugin-tanstack']).toBe(
        'workspace:*',
      );
      expect(packageJson.dependencies['@modern-js/runtime']).toBe(
        'workspace:*',
      );
      expect(packageJson.devDependencies['@modern-js/app-tools']).toBe(
        'workspace:*',
      );
      expect(packageJson.devDependencies['@effect/tsgo']).toBe('0.11.0');
      expect(packageJson.devDependencies['@typescript/native-preview']).toBe(
        '7.0.0-dev.20260525.1',
      );
      expect(packageJson.devDependencies.typescript).toBe('6.0.3');
      expect(packageJson.devDependencies.tailwindcss).toBe('^4.3.0');
      expect(packageJson.devDependencies['@tailwindcss/postcss']).toBe(
        '^4.3.0',
      );
      expect(packageJson.devDependencies.postcss).toBe('^8.5.6');
      expect(packageJson.scripts.dev).toBe('modern dev');
      expect(packageJson.scripts.build).toBe('modern build');
      expect(packageJson.scripts.serve).toBe('modern serve');
      expect(
        Object.keys(packageJson.scripts).every(
          scriptName => !scriptName.startsWith('zephyr:'),
        ),
      ).toBe(true);
      expect(packageJson.scripts.typecheck).toContain('effect-tsgo');
      expect(packageJson.dependencies['@tanstack/react-router']).toBe(
        '1.170.8',
      );
      expect(packageJson.dependencies['@module-federation/modern-js-v3']).toBe(
        '2.5.0',
      );
      expect(packageJson.modernjs.preset).toBe('presetUltramodern');
    }

    for (const appDirectory of [
      'apps/shell-super-app',
      'apps/remotes/remote-commerce',
      'apps/remotes/remote-identity',
      'apps/remotes/remote-design-system',
    ]) {
      expect(
        readText(workspaceDir, `${appDirectory}/src/routes/index.css`),
      ).toContain("@import 'tailwindcss';");
      expect(
        readText(workspaceDir, `${appDirectory}/postcss.config.mjs`),
      ).toContain("'@tailwindcss/postcss'");
      expect(
        readText(workspaceDir, `${appDirectory}/tailwind.config.ts`),
      ).toContain("content: ['./src/**/*.{js,jsx,ts,tsx}']");
    }

    const shellConfig = readText(
      workspaceDir,
      'apps/shell-super-app/modern.config.ts',
    );
    expect(shellConfig).toContain('presetUltramodern(');
    expect(shellConfig).toContain('tanstackRouterPlugin()');
    expect(shellConfig).toContain('moduleFederationPlugin()');
    expect(shellConfig).toContain("mode: 'stream'");
    expect(shellConfig).toContain('moduleFederationAppSSR: true');

    const shellMfConfig = readText(
      workspaceDir,
      'apps/shell-super-app/module-federation.config.ts',
    );
    expect(shellMfConfig).toContain("name: 'shellSuperApp'");
    expect(shellMfConfig).toContain('dts: true');
    expect(shellMfConfig).toContain(
      'remoteCommerce@http://localhost:3021/mf-manifest.json',
    );
    expect(shellMfConfig).toContain(
      'remoteIdentity@http://localhost:3022/mf-manifest.json',
    );
    expect(shellMfConfig).toContain(
      'remoteDesignSystem@http://localhost:3023/mf-manifest.json',
    );

    const commerceMfConfig = readText(
      workspaceDir,
      'apps/remotes/remote-commerce/module-federation.config.ts',
    );
    expect(commerceMfConfig).toContain("name: 'remoteCommerce'");
    expect(commerceMfConfig).toContain('dts: true');
    expect(commerceMfConfig).toContain("'./Widget'");
    expect(commerceMfConfig).toContain("'./Route'");

    const designMfConfig = readText(
      workspaceDir,
      'apps/remotes/remote-design-system/module-federation.config.ts',
    );
    expect(designMfConfig).toContain("name: 'remoteDesignSystem'");
    expect(designMfConfig).toContain("'./Button'");
    expect(designMfConfig).toContain("'./tokens'");

    const servicePackage = readJson(
      workspaceDir,
      'services/service-recommendations-effect/package.json',
    );
    expect(servicePackage.devDependencies['@modern-js/plugin-bff']).toBe(
      'workspace:*',
    );
    expect(servicePackage.dependencies['@modern-js/runtime']).toBe(
      'workspace:*',
    );
    expect(servicePackage.devDependencies.tailwindcss).toBe('^4.3.0');
    expect(servicePackage.devDependencies['@tailwindcss/postcss']).toBe(
      '^4.3.0',
    );
    expect(servicePackage.devDependencies.postcss).toBe('^8.5.6');
    expect(servicePackage.modernjs.role).toBe('effect-service');

    expect(
      readText(
        workspaceDir,
        'services/service-recommendations-effect/src/routes/index.css',
      ),
    ).toContain("@import 'tailwindcss';");
    expect(
      readText(
        workspaceDir,
        'services/service-recommendations-effect/postcss.config.mjs',
      ),
    ).toContain("'@tailwindcss/postcss'");

    const serviceConfig = readText(
      workspaceDir,
      'services/service-recommendations-effect/modern.config.ts',
    );
    expect(serviceConfig).toContain("runtimeFramework: 'effect'");
    expect(serviceConfig).toContain('bffPlugin()');

    const serviceEntry = readText(
      workspaceDir,
      'services/service-recommendations-effect/api/effect/index.ts',
    );
    expect(serviceEntry).toContain('defineEffectBff');
    expect(serviceEntry).toContain('recommendationsEffectApi');
    expect(serviceEntry).toContain('useOperationContext');
    expect(serviceEntry).toContain('Effect.withSpan');
    expect(serviceEntry).toContain('modernjs.operation.route');
    expect(serviceEntry).toContain("from '@ultra-workspace/shared-effect-api'");
    expect(serviceEntry).toContain('new RecommendationNotFound');
    expect(serviceEntry).toContain(".handle('get'");
    expect(serviceEntry).toContain(".handle('create'");
    expect(serviceEntry).not.toContain('_tag');
    expect(serviceEntry).not.toContain('../../shared/effect/api');
    expect(serviceEntry).not.toContain('/shared/effect/api');
    expectNoPath(
      workspaceDir,
      'services/service-recommendations-effect/shared/effect/api.ts',
    );

    const sharedEffectApi = readText(
      workspaceDir,
      'packages/shared-effect-api/src/index.ts',
    );
    expect(sharedEffectApi).toContain('HttpApi.make');
    expect(sharedEffectApi).toContain('HttpApiSchema');
    expect(sharedEffectApi).toContain('OperationContext');
    expect(sharedEffectApi).toContain('RecommendationsEffectApi');
    expect(sharedEffectApi).toContain('RecommendationNotFound');
    expect(sharedEffectApi).toContain('TaggedErrorClass');
    expect(sharedEffectApi).toContain('recommendationsApiContract');
    expect(sharedEffectApi).toContain('recommendationsOperationContexts');
    expect(sharedEffectApi).toContain("source: 'generated-client'");
    expect(sharedEffectApi).toContain('query: {\n          limit:');
    expect(sharedEffectApi).toContain('params: {\n          id:');
    expect(sharedEffectApi).toContain(
      'payload: recommendationsCreatePayloadSchema',
    );
    expect(sharedEffectApi).toContain('error: recommendationNotFoundSchema');

    const shellEffectClient = readText(
      workspaceDir,
      'apps/shell-super-app/src/effect/recommendations-client.ts',
    );
    expect(shellEffectClient).toContain('makeEffectHttpApiClient');
    expect(shellEffectClient).toContain('runEffectRequest');
    expect(shellEffectClient).toContain('recommendationsEffectApi');
    expect(shellEffectClient).toContain('recommendationsOperationContexts');
    expect(shellEffectClient).toContain('const requestContext');
    expect(shellEffectClient).toContain('operationContext:');
    expect(shellEffectClient).toContain(
      'client.recommendations.list({ query: { limit: options.limit } })',
    );
    expect(shellEffectClient).toContain(
      'client.recommendations.get({ params: { id } })',
    );
    expect(shellEffectClient).toContain(
      'client.recommendations.create({ payload: { title } })',
    );

    writeEffectContractTypeFixtures(workspaceDir);
    runEffectContractTypecheck(workspaceDir);

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    expect(topology.sourceFixture).toBe(
      'scripts/mv-integration-pilot/__fixtures__/reference-topology.json',
    );
    expect(topology.preset).toBe('presetUltramodern');
    expect(topology.shell.remoteRefs).toEqual([
      'remote-commerce',
      'remote-identity',
      'remote-design-system',
    ]);
    expect(topology.remotes).toHaveLength(3);
    expect(
      topology.remotes.find(
        (remote: { id: string }) => remote.id === 'remote-design-system',
      ).kind,
    ).toBe('horizontal-design-system');
    expect(topology.effectServices[0].runtime).toBe('effect');
    expect(topology.sharedPackages).toHaveLength(3);

    const ownership = readJson(workspaceDir, 'topology/ownership.json');
    expect(
      ownership.owners.find(
        (owner: { id: string }) => owner.id === 'remote-commerce',
      ).ownership.team,
    ).toBe('commerce-experience');
    expect(
      ownership.owners.find(
        (owner: { id: string }) =>
          owner.id === 'service-recommendations-effect',
      ).package,
    ).toBe('@ultra-workspace/service-recommendations-effect');

    const manifest = readJson(
      workspaceDir,
      '.modernjs/ultramodern-workspace-template-manifest.json',
    );
    expect(manifest.template.id).toBe(
      'modernjs-ultramodern-superapp-workspace',
    );
    expect(manifest.template.compatibilityLane).toBe('ultramodern-mv');
    expect(manifest.validation.expectedCommands).toContain('pnpm install');
    expect(manifest.validation.expectedCommands).not.toContain(
      'pnpm install --ignore-scripts',
    );
    expect(manifest.validation.expectedCommands).toContain(
      'pnpm run ultramodern:check',
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

  test('adds a remote MicroVertical to an existing workspace', () => {
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
      build: 'modern build',
      serve: 'modern serve',
    });
    expect(remotePackage.dependencies['@tanstack/react-router']).toBe(
      '1.170.8',
    );
    expect(remotePackage.dependencies['@module-federation/modern-js-v3']).toBe(
      '2.5.0',
    );
    expect(remotePackage.dependencies['zephyr-modernjs-plugin']).toBe('1.1.1');
    expect(remotePackage.devDependencies.tailwindcss).toBe('^4.3.0');

    const remoteConfig = readText(
      workspaceDir,
      'apps/remotes/remote-catalog/modern.config.ts',
    );
    expect(remoteConfig).toContain('tanstackRouterPlugin()');
    expect(remoteConfig).toContain('moduleFederationPlugin()');
    expect(remoteConfig).toContain('withZephyr()');

    const shellMfConfig = readText(
      workspaceDir,
      'apps/shell-super-app/module-federation.config.ts',
    );
    expect(shellMfConfig).toContain(
      'remoteCatalog@http://localhost:3031/mf-manifest.json',
    );

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    expect(topology.shell.remoteRefs).toContain('remote-catalog');
    expect(
      topology.remotes.find(
        (remote: { id: string }) => remote.id === 'remote-catalog',
      ).moduleFederation.manifestUrl,
    ).toBe('http://localhost:3031/mf-manifest.json');

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
  });

  test('adds an Effect service MicroVertical to an existing workspace', () => {
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

    const serviceConfig = readText(
      workspaceDir,
      'services/service-catalog-api-effect/modern.config.ts',
    );
    expect(serviceConfig).toContain("runtimeFramework: 'effect'");
    expect(serviceConfig).toContain("prefix: '/catalog-api'");

    const serviceEntry = readText(
      workspaceDir,
      'services/service-catalog-api-effect/api/effect/index.ts',
    );
    expect(serviceEntry).toContain('catalogEffectApi');
    expect(serviceEntry).toContain('new CatalogNotFound');
    expect(serviceEntry).toContain(".handle('get'");
    expect(serviceEntry).toContain(".handle('create'");
    expect(serviceEntry).not.toContain('_tag');
    expect(serviceEntry).toContain(
      "from '@ultra-add-service-workspace/shared-effect-api'",
    );
    expect(serviceEntry).not.toContain('../../shared/effect/api');
    expect(serviceEntry).not.toContain('/shared/effect/api');
    expectNoPath(
      workspaceDir,
      'services/service-catalog-api-effect/shared/effect/api.ts',
    );

    const sharedEffectApi = readText(
      workspaceDir,
      'packages/shared-effect-api/src/index.ts',
    );
    expect(sharedEffectApi).toContain('recommendationsEffectApi');
    expect(sharedEffectApi).toContain('catalogEffectApi');
    expect(sharedEffectApi).toContain('CatalogEffectApi');
    expect(sharedEffectApi).toContain('CatalogNotFound');
    expect(sharedEffectApi).toContain('catalogCreatePayloadSchema');
    expect(sharedEffectApi).toContain('catalogNotFoundSchema');
    expect(sharedEffectApi).toContain(
      "basePath: '/catalog-api/effect/catalog'",
    );

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    expect(
      topology.effectServices.find(
        (service: { id: string }) =>
          service.id === 'service-catalog-api-effect',
      ).bff.prefix,
    ).toBe('/catalog-api');

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
    ).toBe('workspace:*');
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

    const servicePackage = readJson(
      workspaceDir,
      'services/service-recommendations-effect/package.json',
    );
    expect(servicePackage.devDependencies['@modern-js/plugin-bff']).toBe(
      '3.2.0-ultramodern.0',
    );
    expect(
      servicePackage.dependencies['@ultra-install-workspace/shared-effect-api'],
    ).toBe('workspace:*');

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
