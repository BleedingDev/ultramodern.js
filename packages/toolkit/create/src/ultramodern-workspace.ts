import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceTemplateDir = path.resolve(
  __dirname,
  '..',
  'template-workspace',
);

const TANSTACK_ROUTER_VERSION = '1.170.1';
const MODULE_FEDERATION_VERSION = '2.4.0';
const EFFECT_TSGO_VERSION = '0.7.3';
const TYPESCRIPT_NATIVE_PREVIEW_VERSION = '7.0.0-dev.20260518.1';
const OXLINT_VERSION = '1.65.0';
const OXFMT_VERSION = '0.50.0';
const ULTRACITE_VERSION = '7.7.0';
const I18NEXT_VERSION = '26.2.0';
const REACT_VERSION = '^19.2.6';
const REACT_DOM_VERSION = '^19.2.6';
const REACT_I18NEXT_VERSION = '17.0.8';
const WORKSPACE_PACKAGE_VERSION = 'workspace:*';
const RSTACK_AGENT_SKILLS_COMMIT = '61c948b42512e223bad44b83af4080eba48b2677';
const baselineAgentSkills = [
  'rsbuild-best-practices',
  'rspack-best-practices',
  'rspack-tracing',
  'rsdoctor-analysis',
  'rslib-best-practices',
  'rslib-modern-package',
  'rstest-best-practices',
];
const privateAgentSkills = [
  'plan-graph',
  'dag',
  'subagent-graph',
  'helm',
  'debugger-mode',
];
const effectTsgoTypecheckCommand =
  "node -e \"const fs = require('node:fs'); const { execFileSync, spawnSync } = require('node:child_process'); const bin = execFileSync('effect-tsgo', ['get-exe-path'], { encoding: 'utf8' }).trim(); if (process.platform !== 'win32') fs.chmodSync(bin, 0o755); const result = spawnSync(bin, ['--noEmit', '-p', 'tsconfig.json'], { stdio: 'inherit' }); process.exit(result.status ?? 1);\"";
const modernPackageNames = [
  '@modern-js/app-tools',
  '@modern-js/plugin-bff',
  '@modern-js/plugin-i18n',
  '@modern-js/plugin-tanstack',
  '@modern-js/runtime',
];

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type WorkspaceApp = {
  id: string;
  directory: string;
  packageSuffix: string;
  displayName: string;
  kind: 'shell' | 'vertical' | 'horizontal-design-system';
  domain?: string;
  portEnv: string;
  port: number;
  mfName: string;
  exposes?: Record<string, string>;
  remoteRefs?: string[];
  ownership: Ownership;
};

type UltramodernPackageSourceStrategy = 'workspace' | 'install';

type ResolvedPackageSource = {
  strategy: UltramodernPackageSourceStrategy;
  modernPackageVersion: string;
  registry?: string;
  aliasScope?: string;
  aliasPackageNamePrefix?: string;
};

type Ownership = {
  team: string;
  slack: string;
  pagerDuty: string;
  runbookRef: string;
  adrRef: string;
  blastRadius: {
    tier: string;
    references: string[];
  };
};

export type UltramodernWorkspaceOptions = {
  targetDir: string;
  packageName: string;
  modernVersion: string;
  packageSource?: {
    strategy?: UltramodernPackageSourceStrategy;
    modernPackageVersion?: string;
    registry?: string;
    aliasScope?: string;
    aliasPackageNamePrefix?: string;
  };
};

export const ULTRAMODERN_WORKSPACE_FLAG = '--ultramodern-workspace';

const shellApp: WorkspaceApp = {
  id: 'shell-super-app',
  directory: 'apps/shell-super-app',
  packageSuffix: 'shell-super-app',
  displayName: 'Shell Super App',
  kind: 'shell',
  portEnv: 'SHELL_SUPER_APP_PORT',
  port: 3020,
  mfName: 'shellSuperApp',
  remoteRefs: ['remote-commerce', 'remote-identity', 'remote-design-system'],
  ownership: {
    team: 'super-app-platform',
    slack: '#super-app-platform',
    pagerDuty: 'pd-super-app-platform',
    runbookRef: 'runbooks/wave2/shell-super-app.md',
    adrRef:
      'docs/super-app-rfc-adr/wave2/reference-topology.md#shell-super-app',
    blastRadius: {
      tier: 'tier-0-shell',
      references: [
        'docs/super-app-rfc-adr/wave2/blast-radius.md#shell',
        'docs/super-app-rfc-adr/wave2/rollback.md#shell-lkg',
      ],
    },
  },
};

const remoteApps: WorkspaceApp[] = [
  {
    id: 'remote-commerce',
    directory: 'apps/remotes/remote-commerce',
    packageSuffix: 'remote-commerce',
    displayName: 'Commerce Remote',
    kind: 'vertical',
    domain: 'commerce',
    portEnv: 'REMOTE_COMMERCE_PORT',
    port: 3021,
    mfName: 'remoteCommerce',
    exposes: {
      './Route': './src/remote-entry.tsx',
      './Widget': './src/components/commerce-widget.tsx',
    },
    ownership: {
      team: 'commerce-experience',
      slack: '#commerce-experience',
      pagerDuty: 'pd-commerce-experience',
      runbookRef: 'runbooks/wave2/remote-commerce.md',
      adrRef:
        'docs/super-app-rfc-adr/wave2/reference-topology.md#remote-commerce',
      blastRadius: {
        tier: 'tier-1-revenue-path',
        references: [
          'docs/super-app-rfc-adr/wave2/blast-radius.md#commerce',
          'docs/super-app-rfc-adr/wave2/rollback.md#commerce-lkg',
        ],
      },
    },
  },
  {
    id: 'remote-identity',
    directory: 'apps/remotes/remote-identity',
    packageSuffix: 'remote-identity',
    displayName: 'Identity Remote',
    kind: 'vertical',
    domain: 'identity',
    portEnv: 'REMOTE_IDENTITY_PORT',
    port: 3022,
    mfName: 'remoteIdentity',
    exposes: {
      './Route': './src/remote-entry.tsx',
      './Widget': './src/components/identity-widget.tsx',
    },
    ownership: {
      team: 'identity-platform',
      slack: '#identity-platform',
      pagerDuty: 'pd-identity-platform',
      runbookRef: 'runbooks/wave2/remote-identity.md',
      adrRef:
        'docs/super-app-rfc-adr/wave2/reference-topology.md#remote-identity',
      blastRadius: {
        tier: 'tier-0-authentication',
        references: [
          'docs/super-app-rfc-adr/wave2/blast-radius.md#identity',
          'docs/super-app-rfc-adr/wave2/rollback.md#identity-lkg',
        ],
      },
    },
  },
  {
    id: 'remote-design-system',
    directory: 'apps/remotes/remote-design-system',
    packageSuffix: 'remote-design-system',
    displayName: 'Design System Remote',
    kind: 'horizontal-design-system',
    domain: 'design-system',
    portEnv: 'REMOTE_DESIGN_SYSTEM_PORT',
    port: 3023,
    mfName: 'remoteDesignSystem',
    exposes: {
      './Button': './src/components/button.tsx',
      './tokens': './src/tokens.ts',
    },
    ownership: {
      team: 'design-platform',
      slack: '#design-platform',
      pagerDuty: 'pd-design-platform',
      runbookRef: 'runbooks/wave2/remote-design-system.md',
      adrRef:
        'docs/super-app-rfc-adr/wave2/reference-topology.md#remote-design-system',
      blastRadius: {
        tier: 'tier-0-shared-ui',
        references: [
          'docs/super-app-rfc-adr/wave2/blast-radius.md#design-system',
          'docs/super-app-rfc-adr/wave2/rollback.md#design-system-pins',
        ],
      },
    },
  },
];

const effectService = {
  id: 'service-recommendations-effect',
  directory: 'services/service-recommendations-effect',
  packageSuffix: 'service-recommendations-effect',
  portEnv: 'SERVICE_RECOMMENDATIONS_PORT',
  port: 3030,
  ownership: {
    team: 'personalization-platform',
    slack: '#personalization-platform',
    pagerDuty: 'pd-personalization-platform',
    runbookRef: 'runbooks/wave2/service-recommendations-effect.md',
    adrRef:
      'docs/super-app-rfc-adr/wave2/reference-topology.md#service-recommendations-effect',
    blastRadius: {
      tier: 'tier-2-personalization',
      references: [
        'docs/super-app-rfc-adr/wave2/blast-radius.md#recommendations',
        'docs/super-app-rfc-adr/wave2/rollback.md#effect-service-lkg',
      ],
    },
  },
};

const effectDiagnostics = [
  'anyUnknownInErrorContext',
  'classSelfMismatch',
  'duplicatePackage',
  'effectFnImplicitAny',
  'floatingEffect',
  'genericEffectServices',
  'missingEffectContext',
  'missingEffectError',
  'missingLayerContext',
  'missingReturnYieldStar',
  'missingStarInYieldEffectGen',
  'nonObjectEffectServiceType',
  'outdatedApi',
  'overriddenSchemaConstructor',
  'catchUnfailableEffect',
  'effectFnIife',
  'effectGenUsesAdapter',
  'effectInFailure',
  'effectInVoidSuccess',
  'globalErrorInEffectCatch',
  'globalErrorInEffectFailure',
  'layerMergeAllWithDependencies',
  'lazyPromiseInEffectSync',
  'leakingRequirements',
  'multipleEffectProvide',
  'returnEffectInGen',
  'runEffectInsideEffect',
  'schemaSyncInEffect',
  'scopeInLayerEffect',
  'strictEffectProvide',
  'tryCatchInEffectGen',
  'unknownInEffectCatch',
  'asyncFunction',
  'cryptoRandomUUID',
  'cryptoRandomUUIDInEffect',
  'extendsNativeError',
  'globalConsole',
  'globalConsoleInEffect',
  'globalDate',
  'globalDateInEffect',
  'globalFetch',
  'globalFetchInEffect',
  'globalRandom',
  'globalRandomInEffect',
  'globalTimers',
  'globalTimersInEffect',
  'instanceOfSchema',
  'newPromise',
  'nodeBuiltinImport',
  'preferSchemaOverJson',
  'processEnv',
  'processEnvInEffect',
  'unsafeEffectTypeAssertion',
  'catchAllToMapError',
  'deterministicKeys',
  'effectDoNotation',
  'effectFnOpportunity',
  'effectMapFlatten',
  'effectMapVoid',
  'effectSucceedWithVoid',
  'missedPipeableOpportunity',
  'missingEffectServiceDependency',
  'nestedEffectGenYield',
  'redundantSchemaTagIdentifier',
  'schemaStructWithTag',
  'schemaUnionOfLiterals',
  'serviceNotAsClass',
  'strictBooleanExpressions',
  'unnecessaryArrowBlock',
  'unnecessaryEffectGen',
  'unnecessaryFailYieldableError',
  'unnecessaryPipe',
  'unnecessaryPipeChain',
];

const sharedPackages = [
  {
    id: 'shared-contracts',
    directory: 'packages/shared-contracts',
    description: 'Route, ownership, and topology contract placeholders.',
  },
  {
    id: 'shared-design-tokens',
    directory: 'packages/shared-design-tokens',
    description: 'Design token placeholders consumed by shell and remotes.',
  },
  {
    id: 'shared-effect-api',
    directory: 'packages/shared-effect-api',
    description:
      'Shared Effect API type placeholders for services and clients.',
  },
];

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function assertSafeRelativePath(relativePath: string) {
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).includes('..')
  ) {
    throw new Error(`Unsafe workspace template path: ${relativePath}`);
  }
}

function ensureInsideRoot(root: string, targetPath: string) {
  const relativePath = path.relative(root, targetPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to write outside workspace root: ${targetPath}`);
  }
}

function writeFile(targetDir: string, relativePath: string, content: string) {
  assertSafeRelativePath(relativePath);
  const filePath = path.join(targetDir, relativePath);
  ensureInsideRoot(targetDir, filePath);
  if (fs.existsSync(filePath)) {
    throw new Error(
      `Refusing to overwrite generated workspace file: ${relativePath}`,
    );
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeJson(targetDir: string, relativePath: string, value: JsonValue) {
  writeFile(targetDir, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function renderTemplate(
  template: string,
  data: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => data[key] ?? match);
}

function collectTemplateFiles(dir: string): string[] {
  const files: string[] = [];

  function collect(currentDir: string) {
    for (const entry of fs
      .readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        collect(entryPath);
      } else if (entry.isFile()) {
        files.push(normalizePath(path.relative(dir, entryPath)));
      }
    }
  }

  collect(dir);
  return files;
}

function hashFile(filePath: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function hashTemplateTree(dir: string): string {
  const hash = crypto.createHash('sha256');

  for (const relativePath of collectTemplateFiles(dir)) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(hashFile(path.join(dir, relativePath)));
    hash.update('\0');
  }

  return hash.digest('hex');
}

function copyRootTemplate(targetDir: string, data: Record<string, string>) {
  for (const relativePath of collectTemplateFiles(workspaceTemplateDir)) {
    const sourcePath = path.join(workspaceTemplateDir, relativePath);
    const outputPath = relativePath.replace(/\.handlebars$/, '');
    const content = relativePath.endsWith('.handlebars')
      ? renderTemplate(fs.readFileSync(sourcePath, 'utf-8'), data)
      : fs.readFileSync(sourcePath, 'utf-8');
    writeFile(targetDir, outputPath, content);
  }
}

function toPackageScope(packageName: string): string {
  const normalized = packageName
    .replace(/^@/, '')
    .replace(/[\\/]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || 'ultramodern-superapp';
}

function packageName(scope: string, suffix: string): string {
  return `@${scope}/${suffix}`;
}

function relativeRootFor(packageDir: string): string {
  return normalizePath(path.relative(packageDir, '.') || '.');
}

function resolvePackageSource(
  options: UltramodernWorkspaceOptions,
): ResolvedPackageSource {
  const strategy = options.packageSource?.strategy ?? 'workspace';
  return {
    strategy,
    modernPackageVersion:
      strategy === 'install'
        ? (options.packageSource?.modernPackageVersion ?? options.modernVersion)
        : WORKSPACE_PACKAGE_VERSION,
    registry: options.packageSource?.registry,
    aliasScope: options.packageSource?.aliasScope,
    aliasPackageNamePrefix: options.packageSource?.aliasPackageNamePrefix,
  };
}

function modernPackageVersion(packageSource: ResolvedPackageSource): string {
  return packageSource.strategy === 'install'
    ? packageSource.modernPackageVersion
    : WORKSPACE_PACKAGE_VERSION;
}

function modernAliasPackageName(
  packageName: string,
  packageSource: ResolvedPackageSource,
): string {
  if (!packageSource.aliasScope) {
    return packageName;
  }

  const scope = packageSource.aliasScope.replace(/^@/, '');
  const unscopedName = packageName.split('/').at(-1);
  return `@${scope}/${packageSource.aliasPackageNamePrefix ?? ''}${unscopedName}`;
}

function modernPackageSpecifier(
  packageName: string,
  packageSource: ResolvedPackageSource,
): string {
  if (packageSource.strategy !== 'install') {
    return WORKSPACE_PACKAGE_VERSION;
  }

  if (!packageSource.aliasScope) {
    return packageSource.modernPackageVersion;
  }

  return `npm:${modernAliasPackageName(packageName, packageSource)}@${
    packageSource.modernPackageVersion
  }`;
}

function appDependencies(
  scope: string,
  packageSource: ResolvedPackageSource,
): Record<string, string> {
  return {
    '@modern-js/plugin-i18n': modernPackageSpecifier(
      '@modern-js/plugin-i18n',
      packageSource,
    ),
    '@modern-js/plugin-tanstack': modernPackageSpecifier(
      '@modern-js/plugin-tanstack',
      packageSource,
    ),
    '@modern-js/runtime': modernPackageSpecifier(
      '@modern-js/runtime',
      packageSource,
    ),
    '@module-federation/modern-js-v3': MODULE_FEDERATION_VERSION,
    '@module-federation/runtime': MODULE_FEDERATION_VERSION,
    '@tanstack/react-router': TANSTACK_ROUTER_VERSION,
    [packageName(scope, 'shared-contracts')]: WORKSPACE_PACKAGE_VERSION,
    [packageName(scope, 'shared-design-tokens')]: WORKSPACE_PACKAGE_VERSION,
    i18next: I18NEXT_VERSION,
    react: REACT_VERSION,
    'react-dom': REACT_DOM_VERSION,
    'react-i18next': REACT_I18NEXT_VERSION,
  };
}

function appDevDependencies(
  packageSource: ResolvedPackageSource,
): Record<string, string> {
  return {
    '@modern-js/app-tools': modernPackageSpecifier(
      '@modern-js/app-tools',
      packageSource,
    ),
    '@effect/tsgo': EFFECT_TSGO_VERSION,
    '@typescript/native-preview': TYPESCRIPT_NATIVE_PREVIEW_VERSION,
    '@types/node': '^20',
    '@types/react': '^19.1.8',
    '@types/react-dom': '^19.1.6',
  };
}

function createRootPackageJson(
  scope: string,
  packageSource: ResolvedPackageSource,
): JsonValue {
  return {
    private: true,
    name: scope,
    version: '0.1.0',
    type: 'module',
    packageManager: 'pnpm@11.1.2',
    scripts: {
      dev: `pnpm --parallel --filter ${packageName(
        scope,
        shellApp.packageSuffix,
      )} --filter ${packageName(
        scope,
        'remote-commerce',
      )} --filter ${packageName(
        scope,
        'remote-identity',
      )} --filter ${packageName(scope, 'remote-design-system')} dev`,
      'dev:shell': `pnpm --filter ${packageName(
        scope,
        shellApp.packageSuffix,
      )} dev`,
      'dev:commerce': `pnpm --filter ${packageName(scope, 'remote-commerce')} dev`,
      'dev:identity': `pnpm --filter ${packageName(scope, 'remote-identity')} dev`,
      'dev:design-system': `pnpm --filter ${packageName(
        scope,
        'remote-design-system',
      )} dev`,
      'dev:recommendations': `pnpm --filter ${packageName(
        scope,
        effectService.packageSuffix,
      )} dev`,
      build: 'pnpm -r --filter ./apps/** --filter ./services/** build',
      format: 'oxfmt .',
      'format:check': 'oxfmt --check .',
      'i18n:check': 'node ./scripts/check-i18n-strings.mjs',
      lint: 'oxlint .',
      'lint:fix': 'oxlint . --fix',
      typecheck: `pnpm -r --filter "@${scope}/*" typecheck`,
      'skills:install': 'node ./scripts/bootstrap-agent-skills.mjs',
      'skills:check': 'node ./scripts/bootstrap-agent-skills.mjs --check',
      'ultramodern:check': 'node ./scripts/validate-ultramodern-workspace.mjs',
      check:
        'pnpm format:check && pnpm lint && pnpm typecheck && pnpm i18n:check && pnpm skills:check && pnpm ultramodern:check',
    },
    engines: {
      node: '>=20',
      pnpm: '>=11.0.0',
    },
    workspaces: ['apps/*', 'apps/remotes/*', 'services/*', 'packages/*'],
    modernjs: {
      preset: 'presetUltramodern',
      workspace: 'ultramodern-superapp',
      topology: './topology/reference-topology.json',
      ownership: './topology/ownership.json',
      packageSource: {
        strategy: packageSource.strategy,
        config: './.modernjs/ultramodern-package-source.json',
      },
    },
    devDependencies: {
      '@effect/tsgo': EFFECT_TSGO_VERSION,
      '@typescript/native-preview': TYPESCRIPT_NATIVE_PREVIEW_VERSION,
      oxlint: OXLINT_VERSION,
      oxfmt: OXFMT_VERSION,
      ultracite: ULTRACITE_VERSION,
    },
  };
}

function createTsConfigBase(): JsonValue {
  return {
    compilerOptions: {
      target: 'ESNext',
      lib: ['ESNext', 'DOM', 'DOM.Iterable'],
      module: 'preserve',
      moduleResolution: 'Bundler',
      moduleDetection: 'force',
      jsx: 'preserve',
      isolatedModules: true,
      verbatimModuleSyntax: true,
      strict: true,
      noEmit: true,
      allowJs: true,
      esModuleInterop: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      noPropertyAccessFromIndexSignature: true,
      noImplicitReturns: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      plugins: [
        {
          name: '@effect/language-service',
          diagnostics: true,
          includeSuggestionsInTsc: true,
          ignoreEffectSuggestionsInTscExitCode: false,
          ignoreEffectWarningsInTscExitCode: false,
          ignoreEffectErrorsInTscExitCode: false,
          skipDisabledOptimization: true,
          diagnosticSeverity: Object.fromEntries(
            effectDiagnostics.map(name => [name, 'error']),
          ),
        },
      ],
    },
  };
}

function createPackageTsConfig(
  packageDir: string,
  includeApi = false,
): JsonValue {
  const include = ['src', 'modern.config.ts', 'module-federation.config.ts'];
  if (includeApi) {
    include.push('api', 'shared');
  }
  return {
    extends: `${relativeRootFor(packageDir)}/tsconfig.base.json`,
    include,
  };
}

function createAppPackage(
  scope: string,
  app: WorkspaceApp,
  packageSource: ResolvedPackageSource,
): JsonValue {
  return {
    private: true,
    name: packageName(scope, app.packageSuffix),
    version: '0.1.0',
    scripts: {
      dev: 'modern dev',
      build: 'modern build',
      serve: 'modern serve',
      typecheck: effectTsgoTypecheckCommand,
    },
    modernjs: {
      preset: 'presetUltramodern',
      role: app.kind === 'shell' ? 'shell' : 'module-federation-remote',
      appId: app.id,
      topology: `${relativeRootFor(app.directory)}/topology/reference-topology.json`,
    },
    dependencies: appDependencies(scope, packageSource),
    devDependencies: appDevDependencies(packageSource),
  };
}

function createServicePackage(
  scope: string,
  packageSource: ResolvedPackageSource,
): JsonValue {
  return {
    private: true,
    name: packageName(scope, effectService.packageSuffix),
    version: '0.1.0',
    scripts: {
      dev: 'modern dev',
      build: 'modern build',
      serve: 'modern serve',
      typecheck: effectTsgoTypecheckCommand,
    },
    modernjs: {
      preset: 'presetUltramodern',
      role: 'effect-service',
      appId: effectService.id,
      topology: `${relativeRootFor(effectService.directory)}/topology/reference-topology.json`,
    },
    dependencies: {
      '@modern-js/runtime': modernPackageSpecifier(
        '@modern-js/runtime',
        packageSource,
      ),
      [packageName(scope, 'shared-effect-api')]: WORKSPACE_PACKAGE_VERSION,
      react: REACT_VERSION,
      'react-dom': REACT_DOM_VERSION,
    },
    devDependencies: {
      '@modern-js/app-tools': modernPackageSpecifier(
        '@modern-js/app-tools',
        packageSource,
      ),
      '@modern-js/plugin-bff': modernPackageSpecifier(
        '@modern-js/plugin-bff',
        packageSource,
      ),
      '@effect/tsgo': EFFECT_TSGO_VERSION,
      '@typescript/native-preview': TYPESCRIPT_NATIVE_PREVIEW_VERSION,
      '@types/node': '^20',
      '@types/react': '^19.1.8',
      '@types/react-dom': '^19.1.6',
    },
  };
}

function createSharedPackage(
  scope: string,
  id: string,
  description: string,
): JsonValue {
  return {
    private: true,
    name: packageName(scope, id),
    version: '0.1.0',
    description,
    type: 'module',
    exports: {
      '.': './src/index.ts',
    },
    scripts: {
      typecheck: effectTsgoTypecheckCommand,
    },
    devDependencies: {
      '@effect/tsgo': EFFECT_TSGO_VERSION,
      '@typescript/native-preview': TYPESCRIPT_NATIVE_PREVIEW_VERSION,
    },
  };
}

function createAppModernConfig(app: WorkspaceApp): string {
  return `// @effect-diagnostics processEnv:off
import { appTools, defineConfig, presetUltramodern } from '@modern-js/app-tools';
import { i18nPlugin } from '@modern-js/plugin-i18n';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';

const appId = '${app.id}';
const port = Number(process.env['${app.portEnv}'] ?? ${app.port});
const configuredSiteUrl = process.env['MODERN_PUBLIC_SITE_URL'];
const hasConfiguredSiteUrl = typeof configuredSiteUrl === 'string' && configuredSiteUrl.length > 0;
const isProductionBuild =
  process.env['NODE_ENV'] === 'production' || process.argv.includes('build');

if (isProductionBuild && !hasConfiguredSiteUrl) {
  throw new Error(
    'MODERN_PUBLIC_SITE_URL must be set for production builds so canonical and hreflang URLs use the deployed origin.',
  );
}

const siteUrl = hasConfiguredSiteUrl ? configuredSiteUrl : \`http://localhost:\${port}\`;

export default defineConfig(
  presetUltramodern(
    {
      output: {
        disableTsChecker: true,
        polyfill: 'off',
        splitRouteChunks: false,
      },
      plugins: [
        appTools(),
        i18nPlugin({
          localeDetection: {
            fallbackLanguage: 'en',
            languages: ['en', 'cs'],
            localePathRedirect: true,
          },
        }),
        tanstackRouterPlugin(),
        moduleFederationPlugin(),
      ],
      server: {
        port,
        ssr: {
          mode: 'string',
          moduleFederationAppSSR: true,
        },
      },
      source: {
        globalVars: {
          ULTRAMODERN_SITE_URL: siteUrl,
        },
      },
    },
    {
      appId,
      enableBffRequestId: true,
      enableModuleFederationSSR: true,
      enableTelemetryExporters: true,
      telemetryFailLoudStartup: false,
    },
  ),
);
`;
}

function createSharedModuleFederationConfig(): string {
  return `  shared: {
    '@modern-js/runtime': {
      requiredVersion: runtimeVersion,
      singleton: true,
      treeShaking: false,
    },
    '@tanstack/react-router': {
      requiredVersion: dependencies['@tanstack/react-router'],
      singleton: true,
      treeShaking: false,
    },
    i18next: {
      requiredVersion: dependencies.i18next,
      singleton: true,
      treeShaking: false,
    },
    react: {
      requiredVersion: reactVersion,
      singleton: true,
      treeShaking: false,
    },
    'react-dom': {
      requiredVersion: reactDomVersion,
      singleton: true,
      treeShaking: false,
    },
    'react-i18next': {
      requiredVersion: dependencies['react-i18next'],
      singleton: true,
      treeShaking: false,
    },
  }`;
}

function formatTsObjectLiteral(value: Record<string, string>): string {
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  if (entries.length === 0) {
    return '{}';
  }

  return `{
${entries.map(([key, entryValue]) => `    '${key}': '${entryValue}',`).join('\n')}
  }`;
}

function createShellModuleFederationConfig(): string {
  return `// @effect-diagnostics nodeBuiltinImport:off processEnv:off
import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const runtimeVersion = (require('@modern-js/runtime/package.json') as { version: string }).version;
const reactVersion = (require('react/package.json') as { version: string }).version;
const reactDomVersion = (require('react-dom/package.json') as { version: string }).version;

export default createModuleFederationConfig({
  dts: false,
  filename: 'remoteEntry.js',
  name: '${shellApp.mfName}',
  remotes: {
    commerce:
      process.env['REMOTE_COMMERCE_MF_MANIFEST'] ??
      'remoteCommerce@http://localhost:3021/mf-manifest.json',
    designSystem:
      process.env['REMOTE_DESIGN_SYSTEM_MF_MANIFEST'] ??
      'remoteDesignSystem@http://localhost:3023/mf-manifest.json',
    identity:
      process.env['REMOTE_IDENTITY_MF_MANIFEST'] ??
      'remoteIdentity@http://localhost:3022/mf-manifest.json',
  },
${createSharedModuleFederationConfig()},
});
`;
}

function createRemoteModuleFederationConfig(app: WorkspaceApp): string {
  const exposes = formatTsObjectLiteral(app.exposes ?? {});
  return `// @effect-diagnostics nodeBuiltinImport:off
import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const runtimeVersion = (require('@modern-js/runtime/package.json') as { version: string }).version;
const reactVersion = (require('react/package.json') as { version: string }).version;
const reactDomVersion = (require('react-dom/package.json') as { version: string }).version;

export default createModuleFederationConfig({
  dts: false,
  exposes: ${exposes},
  filename: 'remoteEntry.js',
  name: '${app.mfName}',
${createSharedModuleFederationConfig()},
});
`;
}

function createServiceModernConfig(): string {
  return `// @effect-diagnostics processEnv:off
import { appTools, defineConfig, presetUltramodern } from '@modern-js/app-tools';
import { bffPlugin } from '@modern-js/plugin-bff';

const appId = '${effectService.id}';
const port = Number(process.env['${effectService.portEnv}'] ?? ${effectService.port});

export default defineConfig(
  presetUltramodern(
    {
      bff: {
        effect: {
          openapi: {
            path: '/openapi.json',
          },
        },
        prefix: '/recommendations-api',
        runtimeFramework: 'effect',
      },
      plugins: [appTools(), bffPlugin()],
      server: {
        port,
      },
    },
    {
      appId,
      enableBffRequestId: true,
      enableTelemetryExporters: true,
      telemetryFailLoudStartup: false,
    },
  ),
);
`;
}

function createAppRuntimeConfig(): string {
  return `import { defineRuntimeConfig } from '@modern-js/runtime';
import { createInstance } from 'i18next';

const i18nInstance = createInstance();

export default defineRuntimeConfig({
  i18n: {
    i18nInstance,
    initOptions: {
      defaultNS: 'translation',
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
      ns: ['translation'],
      supportedLngs: ['en', 'cs'],
    },
  },
  router: {
    framework: 'tanstack',
  },
});
`;
}

function createLocalizedHeadComponent(includeLocationSuffix = false): string {
  return `const fallbackLanguage = 'en';
const supportedLanguages = ['en', 'cs'] as const;
type SupportedLanguage = (typeof supportedLanguages)[number];

const isSupportedLanguage = (value: string): value is SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage);

const stripLanguagePrefix = (pathname: string) => {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0 && isSupportedLanguage(segments[0] ?? '')) {
    segments.shift();
  }
  return \`/\${segments.join('/')}\`;
};

const localizedPath = (pathname: string, language: SupportedLanguage) => {
  const pathWithoutLanguage = stripLanguagePrefix(pathname);
  return pathWithoutLanguage === '/' ? \`/\${language}\` : \`/\${language}\${pathWithoutLanguage}\`;
};

const absoluteUrl = (pathname: string) => {
  const origin = ULTRAMODERN_SITE_URL.replace(/\\/+$/u, '');
  return \`\${origin}\${pathname}\`;
};
${
  includeLocationSuffix
    ? `
const locationSuffix = (location: { hash?: unknown; search?: unknown; searchStr?: unknown }) => {
  const { hash, search, searchStr } = location;
  let locationSearch = '';
  if (typeof searchStr === 'string') {
    locationSearch = searchStr;
  } else if (typeof search === 'string') {
    locationSearch = search;
  }
  const locationHash = typeof hash === 'string' ? hash : '';
  return \`\${locationSearch}\${locationHash}\`;
};
`
    : ''
}
const LocalizedHead = () => {
  const { language } = useModernI18n();
  const location = useLocation();
  const currentLanguage = isSupportedLanguage(language) ? language : fallbackLanguage;
  const canonicalPath = localizedPath(location.pathname, currentLanguage);

  return (
    <Helmet>
      <link rel="canonical" href={absoluteUrl(canonicalPath)} />
      {supportedLanguages.map((code) => (
        <link
          href={absoluteUrl(localizedPath(location.pathname, code))}
          hrefLang={code}
          key={code}
          rel="alternate"
        />
      ))}
      <link
        href={absoluteUrl(localizedPath(location.pathname, fallbackLanguage))}
        hrefLang="x-default"
        rel="alternate"
      />
    </Helmet>
  );
};
`;
}

function createShellPage(): string {
  return `import { Helmet } from '@modern-js/runtime/head';
import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useLocation } from '@modern-js/plugin-tanstack/runtime';
import { useTranslation } from 'react-i18next';

const remotes = ['remote-commerce', 'remote-identity', 'remote-design-system'];

${createLocalizedHeadComponent(true)}
export default function ShellHome() {
  const { t } = useTranslation();
  const { language } = useModernI18n();
  const location = useLocation();
  const currentLanguage = isSupportedLanguage(language) ? language : fallbackLanguage;
  const suffix = locationSuffix(location);
  const languageOptions = supportedLanguages.map((code) => ({
    code,
    href: \`\${localizedPath(location.pathname, code)}\${suffix}\`,
    label: t(\`language.\${code}\`),
  }));
  return (
    <main>
      <LocalizedHead />
      <nav aria-label={t('language.switcher')}>
        {languageOptions.map((option) => (
          <a
            aria-current={currentLanguage === option.code ? 'page' : undefined}
            href={option.href}
            key={option.code}
          >
            {option.label}
          </a>
        ))}
      </nav>
      <h1>{t('shell.title')}</h1>
      <p data-testid="ultramodern-preset">{t('shell.preset')}</p>
      <ul>
        {remotes.map((remote) => (
          <li key={remote}>{t(\`shell.remotes.\${remote}\`)}</li>
        ))}
      </ul>
    </main>
  );
}
`;
}

function createRemotePage(app: WorkspaceApp): string {
  return `import { Helmet } from '@modern-js/runtime/head';
import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useLocation } from '@modern-js/plugin-tanstack/runtime';
import { useTranslation } from 'react-i18next';

${createLocalizedHeadComponent()}
export default function ${toPascalCase(app.id)}Home() {
  const { t } = useTranslation();

  return (
    <main>
      <LocalizedHead />
      <h1>{t('remote.title')}</h1>
      <p data-mf-role="${app.kind}">{t('remote.domain')}</p>
    </main>
  );
}
`;
}

function createLayout(appId: string): string {
  return `import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return <div data-app-id="${appId}">{children}</div>;
}
`;
}

function createRemoteEntry(app: WorkspaceApp): string {
  const componentFile =
    app.id === 'remote-identity' ? 'identity-widget' : 'commerce-widget';
  return `export { default } from './components/${componentFile}';
`;
}

function createRemoteWidget(app: WorkspaceApp): string {
  const componentName =
    app.id === 'remote-identity' ? 'IdentityWidget' : 'CommerceWidget';
  return `import { useTranslation } from 'react-i18next';

export default function ${componentName}() {
  const { t } = useTranslation();

  return (
    <section data-mf-remote="${app.id}">
      <h2>{t('remote.widget.title')}</h2>
      <p>{t('remote.widget.body')}</p>
    </section>
  );
}
`;
}

function createDesignButton(): string {
  return `import { designTokens } from '../tokens';

export default function Button({ label }: { label: string }) {
  return (
    <button
      type="button"
      style={{
        borderRadius: designTokens.radius.control,
        color: designTokens.color.foreground,
      }}
    >
      {label}
    </button>
  );
}
`;
}

function createDesignTokens(): string {
  return `export const designTokens = {
  color: {
    accent: '#2f8f68',
    foreground: '#133225',
  },
  radius: {
    control: '999px',
  },
} as const;
`;
}

function createEnglishTranslations(app: WorkspaceApp): JsonValue {
  if (app.kind === 'shell') {
    return {
      language: {
        cs: 'Czech',
        en: 'English',
        switcher: 'Language',
      },
      shell: {
        preset: 'presetUltramodern workspace',
        remotes: {
          'remote-commerce': 'Commerce Remote',
          'remote-design-system': 'Design System Remote',
          'remote-identity': 'Identity Remote',
        },
        title: 'UltraModern SuperApp Shell',
      },
    };
  }

  return {
    remote: {
      domain: app.domain ?? app.kind,
      title: app.displayName,
      widget: {
        body:
          app.kind === 'vertical'
            ? `Owns the ${app.domain} vertical route surface.`
            : 'Provides shared UI primitives for the workspace.',
        title: app.displayName,
      },
    },
  };
}

function createCzechTranslations(app: WorkspaceApp): JsonValue {
  if (app.kind === 'shell') {
    return {
      language: {
        cs: 'Cestina',
        en: 'Anglictina',
        switcher: 'Jazyk',
      },
      shell: {
        preset: 'presetUltramodern workspace',
        remotes: {
          'remote-commerce': 'Commerce remote',
          'remote-design-system': 'Design system remote',
          'remote-identity': 'Identity remote',
        },
        title: 'UltraModern SuperApp shell',
      },
    };
  }

  return {
    remote: {
      domain: app.domain ?? app.kind,
      title: app.displayName,
      widget: {
        body:
          app.kind === 'vertical'
            ? `Vlastni ${app.domain} vertical route surface.`
            : 'Poskytuje sdilene UI prvky pro workspace.',
        title: app.displayName,
      },
    },
  };
}

function createEffectSharedApi(): string {
  return `import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Schema,
} from '@modern-js/plugin-bff/effect-client';

const recommendationSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
});

export const recommendationsEffectApi = HttpApi.make('RecommendationsEffectApi').add(
  HttpApiGroup.make('recommendations').add(
    HttpApiEndpoint.get('list', '/effect/recommendations', {
      success: Schema.Struct({
        items: Schema.Array(recommendationSchema),
      }),
    }),
  ),
);
`;
}

function createEffectServiceEntry(): string {
  return `import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-server';
import { recommendationsEffectApi } from '../../shared/effect/api';

const recommendationsLayer = HttpApiBuilder.group(
  recommendationsEffectApi,
  'recommendations',
  (handlers) =>
    handlers.handle('list', () =>
      Effect.succeed({
        items: [
          {
            id: 'starter-recommendation',
            title: 'Wire a real recommendation source here',
          },
        ],
      }),
    ),
);

const layer = HttpApiBuilder.layer(recommendationsEffectApi).pipe(
  Layer.provide(recommendationsLayer),
);

export default defineEffectBff({
  api: recommendationsEffectApi,
  layer,
});
`;
}

function toPascalCase(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function createTopology(scope: string): JsonValue {
  return {
    schemaVersion: 1,
    id: 'ultramodern-superapp-workspace-reference-topology',
    description:
      'Generated UltraModern workspace skeleton based on the reference topology shape.',
    preset: 'presetUltramodern',
    sourceFixture:
      'scripts/mv-integration-pilot/__fixtures__/reference-topology.json',
    shell: {
      id: shellApp.id,
      kind: 'shell',
      package: packageName(scope, shellApp.packageSuffix),
      remoteRefs: shellApp.remoteRefs,
      moduleFederation: {
        role: 'host',
        name: shellApp.mfName,
        remotes: remoteApps.map(remote => ({
          id: remote.id,
          name: remote.mfName,
          manifestUrl: `http://localhost:${remote.port}/mf-manifest.json`,
        })),
        ssr: true,
        sharedContractVersion: 'mf-ssr-contract-v1',
      },
      ownership: shellApp.ownership,
    },
    remotes: remoteApps.map(remote => ({
      id: remote.id,
      kind: remote.kind,
      domain: remote.domain,
      package: packageName(scope, remote.packageSuffix),
      moduleFederation: {
        role: 'remote',
        name: remote.mfName,
        manifestUrl: `http://localhost:${remote.port}/mf-manifest.json`,
        exposes: Object.keys(remote.exposes ?? {}),
        ssr: true,
        fallbackTelemetryEvent: 'modernjs:mv-runtime-parity',
        sharedContractVersion: 'mf-ssr-contract-v1',
      },
      ownership: remote.ownership,
    })),
    effectServices: [
      {
        id: effectService.id,
        kind: 'effect-service',
        runtime: 'effect',
        package: packageName(scope, effectService.packageSuffix),
        consumedBy: [shellApp.id, 'remote-commerce'],
        bff: {
          prefix: '/recommendations-api',
          openapi: '/openapi.json',
        },
        ownership: effectService.ownership,
      },
    ],
    sharedPackages: sharedPackages.map(sharedPackage => ({
      id: sharedPackage.id,
      package: packageName(scope, sharedPackage.id),
      path: sharedPackage.directory,
      description: sharedPackage.description,
    })),
    validation: {
      script: 'scripts/validate-ultramodern-workspace.mjs',
      commands: ['pnpm ultramodern:check'],
    },
  };
}

function createOwnership(scope: string): JsonValue {
  return {
    schemaVersion: 1,
    preset: 'presetUltramodern',
    owners: [
      shellApp,
      ...remoteApps,
      {
        id: effectService.id,
        packageSuffix: effectService.packageSuffix,
        directory: effectService.directory,
        ownership: effectService.ownership,
      },
      ...sharedPackages.map(sharedPackage => ({
        id: sharedPackage.id,
        packageSuffix: sharedPackage.id,
        directory: sharedPackage.directory,
        ownership: {
          team: 'super-app-platform',
          slack: '#super-app-platform',
          pagerDuty: 'pd-super-app-platform',
          runbookRef: `runbooks/wave2/${sharedPackage.id}.md`,
          adrRef:
            'docs/super-app-rfc-adr/wave2/reference-topology.md#shared-packages',
          blastRadius: {
            tier: 'tier-1-shared-contract',
            references: [
              'docs/super-app-rfc-adr/wave2/blast-radius.md#shared-packages',
            ],
          },
        },
      })),
    ].map(owner => ({
      id: owner.id,
      package: packageName(scope, owner.packageSuffix),
      path: owner.directory,
      ownership: owner.ownership,
    })),
  };
}

function createDevelopmentOverlay(): JsonValue {
  return {
    schemaVersion: 1,
    environment: 'development',
    preset: 'presetUltramodern',
    ports: Object.fromEntries(
      [shellApp, ...remoteApps]
        .map(app => [app.id, app.port])
        .concat([[effectService.id, effectService.port]]),
    ),
    manifests: Object.fromEntries(
      remoteApps.map(remote => [
        remote.id,
        `http://localhost:${remote.port}/mf-manifest.json`,
      ]),
    ),
    services: {
      [effectService.id]: `http://localhost:${effectService.port}/recommendations-api`,
    },
  };
}

function createPackageSourceMetadata(
  scope: string,
  packageSource: ResolvedPackageSource,
): JsonValue {
  const modernPackages: {
    packages: string[];
    specifier: string;
    registry?: string;
    aliases?: Record<string, string>;
  } = {
    packages: modernPackageNames,
    specifier: modernPackageVersion(packageSource),
  };

  if (packageSource.registry) {
    modernPackages.registry = packageSource.registry;
  }

  if (packageSource.aliasScope) {
    modernPackages.aliases = Object.fromEntries(
      modernPackageNames.map(packageName => [
        packageName,
        modernAliasPackageName(packageName, packageSource),
      ]),
    );
  }

  return {
    schemaVersion: 1,
    strategy: packageSource.strategy,
    modernPackages,
    generatedWorkspacePackages: {
      packages: sharedPackages.map(sharedPackage =>
        packageName(scope, sharedPackage.id),
      ),
      specifier: WORKSPACE_PACKAGE_VERSION,
    },
    validation: {
      validator: 'scripts/validate-ultramodern-workspace.mjs',
      strategyAwareChecks: ['generated-validator', 'contract-doctor'],
    },
  };
}

function createTemplateManifest(
  modernVersion: string,
  packageSource: ResolvedPackageSource,
): JsonValue {
  return {
    schemaVersion: 1,
    template: {
      id: 'modernjs-ultramodern-superapp-workspace',
      version: modernVersion,
      displayName: 'Modern.js UltraModern SuperApp Workspace',
      description:
        'Canonical shell, remotes, Effect service, shared packages, and topology skeleton.',
      compatibilityLane: 'ultramodern-mv',
      minimumModernVersion: modernVersion,
    },
    source: {
      type: 'builtin',
      name: 'modernjs-ultramodern-superapp-workspace',
      repositoryPath: 'packages/toolkit/create/template-workspace',
      generator: 'packages/toolkit/create/src/ultramodern-workspace.ts',
    },
    integrity: {
      checksums: [
        {
          algorithm: 'sha256',
          value: hashTemplateTree(workspaceTemplateDir),
          scope: 'source-tree',
        },
      ],
      provenance: {
        kind: 'repo-local',
        issuer: '@modern-js/create',
        subject: 'packages/toolkit/create/template-workspace',
      },
    },
    materialization: {
      targetRoot: 'generated-project-root',
      allowedPaths: [
        '.agents/**',
        '.modernjs/**',
        'AGENTS.md',
        'README.md',
        'apps/**',
        'packages/**',
        'package.json',
        'oxfmt.config.ts',
        'oxlint.config.ts',
        'pnpm-workspace.yaml',
        'scripts/**',
        'services/**',
        'topology/**',
        'tsconfig.base.json',
      ],
      deniedPaths: [
        '.git/**',
        '.github/**',
        '.npmrc',
        '.yarnrc',
        '.env',
        '.env.*',
        'node_modules/**',
        'dist/**',
      ],
      overwritePolicy: 'deny-existing',
    },
    packageSource: {
      strategy: packageSource.strategy,
      config: '.modernjs/ultramodern-package-source.json',
      modernPackageSpecifier: modernPackageVersion(packageSource),
      generatedWorkspacePackageSpecifier: WORKSPACE_PACKAGE_VERSION,
    },
    agentSkills: {
      installDir: '.agents/skills',
      source: {
        repository: 'https://github.com/rstackjs/agent-skills',
        commit: RSTACK_AGENT_SKILLS_COMMIT,
        license: 'MIT',
        licensePath: '.agents/rstackjs-agent-skills-LICENSE',
      },
      baseline: baselineAgentSkills,
      privateSource: {
        repository: 'https://github.com/TechsioCZ/skills',
        install: 'clone-if-authorized',
        baseline: privateAgentSkills,
      },
      lockFile: '.agents/skills-lock.json',
    },
    validation: {
      schemaValidation: true,
      sourceValidation: [
        'source-type-supported',
        'checksum-verified',
        'provenance-present',
      ],
      materializationValidation: [
        'path-boundary-allowlist',
        'path-boundary-denylist',
        'no-path-traversal',
        'no-absolute-paths',
        'overwrite-policy-enforced',
      ],
      postMaterializationValidation: [
        'ultramodern-workspace-contract-check',
        'pnpm-11-policy-enforced',
        'template-manifest-retained',
      ],
      expectedCommands: ['pnpm install', 'pnpm run ultramodern:check'],
    },
  };
}

function writeApp(
  targetDir: string,
  scope: string,
  app: WorkspaceApp,
  packageSource: ResolvedPackageSource,
) {
  writeJson(
    targetDir,
    `${app.directory}/package.json`,
    createAppPackage(scope, app, packageSource),
  );
  writeJson(
    targetDir,
    `${app.directory}/tsconfig.json`,
    createPackageTsConfig(app.directory),
  );
  writeFile(
    targetDir,
    `${app.directory}/src/modern-app-env.d.ts`,
    "/// <reference types='@modern-js/app-tools/types' />\n\ndeclare const ULTRAMODERN_SITE_URL: string;\n",
  );
  writeFile(
    targetDir,
    `${app.directory}/modern.config.ts`,
    createAppModernConfig(app),
  );
  writeFile(
    targetDir,
    `${app.directory}/src/modern.runtime.ts`,
    createAppRuntimeConfig(),
  );
  writeJson(
    targetDir,
    `${app.directory}/config/public/locales/en/translation.json`,
    createEnglishTranslations(app),
  );
  writeJson(
    targetDir,
    `${app.directory}/config/public/locales/cs/translation.json`,
    createCzechTranslations(app),
  );
  writeFile(
    targetDir,
    `${app.directory}/module-federation.config.ts`,
    app.kind === 'shell'
      ? createShellModuleFederationConfig()
      : createRemoteModuleFederationConfig(app),
  );
  writeFile(
    targetDir,
    `${app.directory}/src/routes/layout.tsx`,
    createLayout(app.id),
  );
  writeFile(
    targetDir,
    `${app.directory}/src/routes/[lang]/page.tsx`,
    app.kind === 'shell' ? createShellPage() : createRemotePage(app),
  );

  if (app.kind === 'vertical') {
    writeFile(
      targetDir,
      `${app.directory}/src/remote-entry.tsx`,
      createRemoteEntry(app),
    );
    const widgetFile =
      app.id === 'remote-identity'
        ? 'identity-widget.tsx'
        : 'commerce-widget.tsx';
    writeFile(
      targetDir,
      `${app.directory}/src/components/${widgetFile}`,
      createRemoteWidget(app),
    );
  }

  if (app.kind === 'horizontal-design-system') {
    writeFile(
      targetDir,
      `${app.directory}/src/components/button.tsx`,
      createDesignButton(),
    );
    writeFile(
      targetDir,
      `${app.directory}/src/tokens.ts`,
      createDesignTokens(),
    );
  }
}

function writeEffectService(
  targetDir: string,
  scope: string,
  packageSource: ResolvedPackageSource,
) {
  writeJson(
    targetDir,
    `${effectService.directory}/package.json`,
    createServicePackage(scope, packageSource),
  );
  writeJson(
    targetDir,
    `${effectService.directory}/tsconfig.json`,
    createPackageTsConfig(effectService.directory, true),
  );
  writeFile(
    targetDir,
    `${effectService.directory}/src/modern-app-env.d.ts`,
    "/// <reference types='@modern-js/app-tools/types' />\n",
  );
  writeFile(
    targetDir,
    `${effectService.directory}/src/routes/page.tsx`,
    `export default function RecommendationsServiceHome() {
  return <main>Recommendations Effect service</main>;
}
`,
  );
  writeFile(
    targetDir,
    `${effectService.directory}/modern.config.ts`,
    createServiceModernConfig(),
  );
  writeFile(
    targetDir,
    `${effectService.directory}/shared/effect/api.ts`,
    createEffectSharedApi(),
  );
  writeFile(
    targetDir,
    `${effectService.directory}/api/effect/index.ts`,
    createEffectServiceEntry(),
  );
}

function writeSharedPackages(targetDir: string, scope: string) {
  for (const sharedPackage of sharedPackages) {
    writeJson(
      targetDir,
      `${sharedPackage.directory}/package.json`,
      createSharedPackage(scope, sharedPackage.id, sharedPackage.description),
    );
    writeJson(targetDir, `${sharedPackage.directory}/tsconfig.json`, {
      extends: `${relativeRootFor(sharedPackage.directory)}/tsconfig.base.json`,
      include: ['src'],
    });
  }

  writeFile(
    targetDir,
    'packages/shared-contracts/src/index.ts',
    `export const ultramodernWorkspaceContract = {
  ownership: 'topology/ownership.json',
  preset: 'presetUltramodern',
  topology: 'topology/reference-topology.json',
} as const;
`,
  );
  writeFile(
    targetDir,
    'packages/shared-design-tokens/src/index.ts',
    `export const sharedDesignTokens = {
  color: {
    accent: '#2f8f68',
    foreground: '#133225',
    surface: '#f6fbf7',
  },
} as const;
`,
  );
  writeFile(
    targetDir,
    'packages/shared-effect-api/src/index.ts',
    `export interface Recommendation {
  id: string;
  title: string;
}

export const recommendationsApiContract = {
  basePath: '/recommendations-api/effect/recommendations',
  serviceId: '${effectService.id}',
} as const;
`,
  );
}

export function generateUltramodernWorkspace(
  options: UltramodernWorkspaceOptions,
) {
  const scope = toPackageScope(options.packageName);
  const packageSource = resolvePackageSource(options);
  fs.mkdirSync(options.targetDir, { recursive: true });

  copyRootTemplate(options.targetDir, {
    packageName: options.packageName,
    packageScope: scope,
  });

  writeJson(
    options.targetDir,
    'package.json',
    createRootPackageJson(scope, packageSource),
  );
  writeJson(options.targetDir, 'tsconfig.base.json', createTsConfigBase());
  writeJson(
    options.targetDir,
    'topology/reference-topology.json',
    createTopology(scope),
  );
  writeJson(
    options.targetDir,
    'topology/ownership.json',
    createOwnership(scope),
  );
  writeJson(
    options.targetDir,
    'topology/local-overlays/development.json',
    createDevelopmentOverlay(),
  );
  writeJson(
    options.targetDir,
    '.modernjs/ultramodern-workspace-template-manifest.json',
    createTemplateManifest(options.modernVersion, packageSource),
  );
  writeJson(
    options.targetDir,
    '.modernjs/ultramodern-package-source.json',
    createPackageSourceMetadata(scope, packageSource),
  );

  writeApp(options.targetDir, scope, shellApp, packageSource);
  for (const remote of remoteApps) {
    writeApp(options.targetDir, scope, remote, packageSource);
  }
  writeEffectService(options.targetDir, scope, packageSource);
  writeSharedPackages(options.targetDir, scope);
}

export const ultramodernWorkspaceVersions = {
  tanstackRouter: TANSTACK_ROUTER_VERSION,
  moduleFederation: MODULE_FEDERATION_VERSION,
};
