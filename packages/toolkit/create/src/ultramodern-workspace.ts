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

const TANSTACK_ROUTER_VERSION = '1.170.8';
const MODULE_FEDERATION_VERSION = '2.5.0';
const ZEPHYR_RSPACK_PLUGIN_VERSION = '1.1.1';
const ZEPHYR_AGENT_VERSION = '1.1.1';
const WRANGLER_VERSION = '4.95.0';
const TAILWIND_VERSION = '4.3.0';
const TAILWIND_POSTCSS_VERSION = '4.3.0';
const EFFECT_TSGO_VERSION = '0.11.0';
const TYPESCRIPT_VERSION = '6.0.3';
const TYPESCRIPT_NATIVE_PREVIEW_VERSION = '7.0.0-dev.20260527.2';
const OXLINT_VERSION = '1.66.0';
const OXFMT_VERSION = '0.51.0';
const ULTRACITE_VERSION = '7.7.0';
const I18NEXT_VERSION = '26.2.0';
const REACT_VERSION = '^19.2.6';
const REACT_DOM_VERSION = '^19.2.6';
const PNPM_VERSION = '11.4.0';
const WORKSPACE_PACKAGE_VERSION = 'workspace:*';
const GENERATED_CONTRACT_PATH = '.modernjs/ultramodern-generated-contract.json';
const RSTACK_AGENT_SKILLS_COMMIT = '61c948b42512e223bad44b83af4080eba48b2677';
const MODULE_FEDERATION_AGENT_SKILLS_COMMIT =
  '07bb5b6c43ad457609e00c081b72d4c42508ec76';
const baselineAgentSkills = [
  'rsbuild-best-practices',
  'rspack-best-practices',
  'rspack-tracing',
  'rsdoctor-analysis',
  'rslib-best-practices',
  'rslib-modern-package',
  'rstest-best-practices',
];
const moduleFederationAgentSkills = ['mf'];
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
  kind: 'shell' | 'vertical' | 'horizontal-remote' | 'horizontal-design-system';
  domain?: string;
  portEnv: string;
  port: number;
  mfName: string;
  exposes?: Record<string, string>;
  effectApi?: WorkspaceEffectApi;
  remoteRefs?: string[];
  ownership: Ownership;
};

type WorkspaceEffectApi = {
  stem: string;
  prefix: string;
  consumedBy: string[];
};

export type MicroVerticalKind =
  | 'remote'
  | 'horizontal-remote'
  | 'service'
  | 'shared';

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
  enableTailwind?: boolean;
  packageSource?: {
    strategy?: UltramodernPackageSourceStrategy;
    modernPackageVersion?: string;
    registry?: string;
    aliasScope?: string;
    aliasPackageNamePrefix?: string;
  };
};

export type AddUltramodernMicroVerticalOptions = {
  workspaceRoot: string;
  name: string;
  kind: MicroVerticalKind;
  modernVersion: string;
  enableTailwind?: boolean;
  packageSource?: UltramodernWorkspaceOptions['packageSource'];
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
    effectApi: {
      stem: 'recommendations',
      prefix: '/commerce-api',
      consumedBy: [shellApp.id, 'remote-commerce'],
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
    effectApi: {
      stem: 'identity',
      prefix: '/identity-api',
      consumedBy: [shellApp.id, 'remote-identity'],
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

function createNeutralOwnership(
  id: string,
  tier = 'tier-2-microvertical',
): Ownership {
  return {
    team: 'super-app-platform',
    slack: '#super-app-platform',
    pagerDuty: 'pd-super-app-platform',
    runbookRef: `runbooks/microverticals/${id}.md`,
    adrRef: `docs/super-app-rfc-adr/microverticals.md#${id}`,
    blastRadius: {
      tier,
      references: [`docs/super-app-rfc-adr/blast-radius.md#${id}`],
    },
  };
}

function createRemoteDescriptor(
  name: string,
  kind: Extract<MicroVerticalKind, 'remote' | 'horizontal-remote'>,
  port: number,
): WorkspaceApp {
  const domain = toKebabCase(name);
  const id = `remote-${domain}`;
  const displayPrefix = toPascalCase(domain).replace(
    /([a-z])([A-Z])/g,
    '$1 $2',
  );
  return {
    id,
    directory: `apps/remotes/${id}`,
    packageSuffix: id,
    displayName: `${displayPrefix} Remote`,
    kind: kind === 'horizontal-remote' ? 'horizontal-remote' : 'vertical',
    domain,
    portEnv: `REMOTE_${toEnvSegment(domain)}_PORT`,
    port,
    mfName: `remote${toPascalCase(domain)}`,
    exposes: {
      './Route': './src/remote-entry.tsx',
      './Widget': `./src/components/${domain}-widget.tsx`,
    },
    ...(kind === 'remote'
      ? {
          effectApi: {
            stem: domain,
            prefix: `/${domain}-api`,
            consumedBy: [shellApp.id, id],
          },
        }
      : {}),
    ownership: createNeutralOwnership(id),
  };
}

function createServiceDescriptor(name: string, port: number) {
  const normalized = toKebabCase(name);
  const suffix = normalized.endsWith('-effect')
    ? normalized
    : `service-${normalized.replace(/^service-/, '')}-effect`;
  return {
    id: suffix,
    directory: `services/${suffix}`,
    packageSuffix: suffix,
    portEnv: `${toEnvSegment(suffix)}_PORT`,
    port,
    ownership: createNeutralOwnership(suffix, 'tier-2-effect-service'),
  };
}

function serviceApiPrefix(service: { id: string }): string {
  const name = service.id.replace(/^service-/, '').replace(/-effect$/, '');
  return name.endsWith('-api') ? `/${name}` : `/${name}-api`;
}

function appHasEffectApi(app: WorkspaceApp): app is WorkspaceApp & {
  effectApi: WorkspaceEffectApi;
} {
  return app.effectApi !== undefined;
}

function effectApiPrefix(target: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return target.effectApi?.prefix ?? serviceApiPrefix(target);
}

function effectApiStem(target: { id: string; effectApi?: WorkspaceEffectApi }) {
  return (
    target.effectApi?.stem ??
    target.id
      .replace(/^service-/, '')
      .replace(/-effect$/, '')
      .replace(/-api$/, '')
  );
}

function verticalEffectApps(remotes: WorkspaceApp[] = remoteApps) {
  return remotes.filter(appHasEffectApi);
}

function createSharedPackageDescriptor(name: string) {
  const normalized = toKebabCase(name);
  const id = normalized.startsWith('shared-')
    ? normalized
    : `shared-${normalized}`;
  return {
    id,
    directory: `packages/${id}`,
    description: `Shared ${normalized.replace(/^shared-/, '')} package placeholder.`,
  };
}

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

function writeFileReplacing(
  targetDir: string,
  relativePath: string,
  content: string,
) {
  assertSafeRelativePath(relativePath);
  const filePath = path.join(targetDir, relativePath);
  ensureInsideRoot(targetDir, filePath);
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

function toKebabCase(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/[._]+/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized;
}

function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`;
}

function toEnvSegment(value: string): string {
  return toKebabCase(value).replace(/-/g, '_').toUpperCase();
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
  app: WorkspaceApp,
): Record<string, string> {
  const dependencies: Record<string, string> = {
    '@modern-js/plugin-tanstack': modernPackageSpecifier(
      '@modern-js/plugin-tanstack',
      packageSource,
    ),
    '@modern-js/plugin-i18n': modernPackageSpecifier(
      '@modern-js/plugin-i18n',
      packageSource,
    ),
    '@modern-js/runtime': modernPackageSpecifier(
      '@modern-js/runtime',
      packageSource,
    ),
    '@module-federation/modern-js-v3': MODULE_FEDERATION_VERSION,
    '@module-federation/runtime': MODULE_FEDERATION_VERSION,
    '@tanstack/react-router': TANSTACK_ROUTER_VERSION,
    i18next: I18NEXT_VERSION,
    'node-fetch': '^3.3.2',
    [packageName(scope, 'shared-contracts')]: WORKSPACE_PACKAGE_VERSION,
    [packageName(scope, 'shared-design-tokens')]: WORKSPACE_PACKAGE_VERSION,
    react: REACT_VERSION,
    'react-dom': REACT_DOM_VERSION,
  };

  if (app.kind === 'shell') {
    dependencies['@modern-js/plugin-bff'] = modernPackageSpecifier(
      '@modern-js/plugin-bff',
      packageSource,
    );
    for (const remote of verticalEffectApps()) {
      dependencies[packageName(scope, remote.packageSuffix)] =
        WORKSPACE_PACKAGE_VERSION;
    }
  }

  if (appHasEffectApi(app)) {
    dependencies['@modern-js/plugin-bff'] = modernPackageSpecifier(
      '@modern-js/plugin-bff',
      packageSource,
    );
  }

  return dependencies;
}

function appDevDependencies(
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
): Record<string, string> {
  return {
    '@modern-js/app-tools': modernPackageSpecifier(
      '@modern-js/app-tools',
      packageSource,
    ),
    '@effect/tsgo': EFFECT_TSGO_VERSION,
    ...(enableTailwind
      ? {
          '@tailwindcss/postcss': `^${TAILWIND_POSTCSS_VERSION}`,
          postcss: '^8.5.6',
          tailwindcss: `^${TAILWIND_VERSION}`,
        }
      : {}),
    '@typescript/native-preview': TYPESCRIPT_NATIVE_PREVIEW_VERSION,
    '@types/node': '^20',
    '@types/react': '^19.1.8',
    '@types/react-dom': '^19.1.6',
    typescript: TYPESCRIPT_VERSION,
    'zephyr-rspack-plugin': ZEPHYR_RSPACK_PLUGIN_VERSION,
    wrangler: WRANGLER_VERSION,
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
    packageManager: `pnpm@${PNPM_VERSION}`,
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
      build:
        'pnpm -r --filter "./apps/remotes/**" run build && pnpm --filter "./apps/shell-super-app" run build && pnpm ultramodern:assert-mf-types',
      format: 'oxfmt .',
      'format:check': 'oxfmt --check .',
      lint: 'oxlint .',
      'lint:fix': 'oxlint . --fix',
      typecheck: `pnpm -r --filter "@${scope}/*" typecheck`,
      'cloudflare:build':
        'pnpm -r --filter "./apps/remotes/**" run cloudflare:build && pnpm --filter "./apps/shell-super-app" run cloudflare:build && pnpm ultramodern:assert-mf-types',
      'skills:install': 'node ./scripts/bootstrap-agent-skills.mjs',
      'skills:check': 'node ./scripts/bootstrap-agent-skills.mjs --check',
      'agents:refs:install': 'node ./scripts/setup-agent-reference-repos.mjs',
      'agents:refs:check':
        'node ./scripts/setup-agent-reference-repos.mjs --check',
      'ultramodern:assert-mf-types': 'node ./scripts/assert-mf-types.mjs',
      'ultramodern:check': 'node ./scripts/validate-ultramodern-workspace.mjs',
      postinstall:
        'node ./scripts/setup-agent-reference-repos.mjs && node ./scripts/bootstrap-agent-skills.mjs',
      check:
        'pnpm format:check && pnpm lint && pnpm typecheck && pnpm skills:check && pnpm ultramodern:check',
    },
    engines: {
      node: '>=20',
      pnpm: `>=${PNPM_VERSION} <11.5.0`,
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
      wrangler: WRANGLER_VERSION,
      'zephyr-agent': ZEPHYR_AGENT_VERSION,
    },
  };
}

function remoteDependencyAlias(remote: WorkspaceApp): string {
  return toCamelCase(remote.domain ?? remote.id.replace(/^remote-/, ''));
}

function zephyrRemoteDependency(scope: string, remote: WorkspaceApp): string {
  return `${packageName(scope, remote.packageSuffix)}@workspace:*`;
}

function createZephyrDependencies(
  scope: string,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = remoteApps,
): JsonValue {
  if (app.kind !== 'shell') {
    return {};
  }

  return Object.fromEntries(
    remotes.map(remote => [
      remoteDependencyAlias(remote),
      zephyrRemoteDependency(scope, remote),
    ]),
  );
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
    exclude: ['src/modern-tanstack'],
  };
}

function createAppPackage(
  scope: string,
  app: WorkspaceApp,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
): JsonValue {
  const packageJson: Record<string, JsonValue> = {
    private: true,
    name: packageName(scope, app.packageSuffix),
    version: '0.1.0',
    scripts: {
      dev: 'modern dev',
      build: app.exposes
        ? `modern build && node ${relativeRootFor(app.directory)}/scripts/assert-mf-types.mjs`
        : 'modern build',
      'cloudflare:build':
        'MODERNJS_DEPLOY=cloudflare modern build && MODERNJS_DEPLOY=cloudflare modern deploy',
      'cloudflare:preview':
        'MODERNJS_DEPLOY=cloudflare modern build && MODERNJS_DEPLOY=cloudflare modern deploy && wrangler dev --config .output/wrangler.json',
      serve: 'modern serve',
      typecheck: effectTsgoTypecheckCommand,
    },
    modernjs: {
      preset: 'presetUltramodern',
      role: app.kind === 'shell' ? 'shell' : 'module-federation-remote',
      appId: app.id,
      topology: `${relativeRootFor(app.directory)}/topology/reference-topology.json`,
      ...(appHasEffectApi(app) ? { apiRuntime: 'effect-bff' } : {}),
    },
    'zephyr:dependencies': createZephyrDependencies(scope, app),
    dependencies: appDependencies(scope, packageSource, app),
    devDependencies: appDevDependencies(packageSource, enableTailwind),
  };

  if (appHasEffectApi(app)) {
    packageJson.exports = {
      './effect/client': `./src/effect/${app.effectApi.stem}-client.ts`,
      './shared/effect/api': './shared/effect/api.ts',
    };
  }

  return packageJson;
}

function createServicePackage(
  scope: string,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
  service = effectService,
): JsonValue {
  return {
    private: true,
    name: packageName(scope, service.packageSuffix),
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
      appId: service.id,
      topology: `${relativeRootFor(service.directory)}/topology/reference-topology.json`,
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
      ...(enableTailwind
        ? {
            '@tailwindcss/postcss': `^${TAILWIND_POSTCSS_VERSION}`,
            postcss: '^8.5.6',
            tailwindcss: `^${TAILWIND_VERSION}`,
          }
        : {}),
      '@typescript/native-preview': TYPESCRIPT_NATIVE_PREVIEW_VERSION,
      '@types/node': '^20',
      '@types/react': '^19.1.8',
      '@types/react-dom': '^19.1.6',
      typescript: TYPESCRIPT_VERSION,
    },
  };
}

function createSharedPackage(
  scope: string,
  id: string,
  description: string,
  packageSource: ResolvedPackageSource,
): JsonValue {
  const packageJson: Record<string, JsonValue> = {
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

  if (id === 'shared-effect-api') {
    packageJson.dependencies = {
      '@modern-js/plugin-bff': modernPackageSpecifier(
        '@modern-js/plugin-bff',
        packageSource,
      ),
    };
  }

  return packageJson;
}

function createAppModernConfig(app: WorkspaceApp): string {
  const bffImport = appHasEffectApi(app)
    ? "import { bffPlugin } from '@modern-js/plugin-bff';\n"
    : '';
  const bffConfig = appHasEffectApi(app)
    ? `      bff: {
        effect: {
          openapi: {
            path: '/openapi.json',
          },
        },
        prefix: '${effectApiPrefix(app)}',
        runtimeFramework: 'effect',
      },
`
    : '';
  const bffPluginEntry = appHasEffectApi(app) ? '        bffPlugin(),\n' : '';
  return `// @effect-diagnostics processEnv:off
import {
  appTools,
  defineConfig,
  presetUltramodern,
} from '@modern-js/app-tools';
${bffImport}import { i18nPlugin } from '@modern-js/plugin-i18n';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';
import { withZephyr as withZephyrRspack } from 'zephyr-rspack-plugin';

type ZephyrRspackConfig = Parameters<ReturnType<typeof withZephyrRspack>>[0];

const zephyrRspackPlugin = () => ({
  name: 'ultramodern-zephyr-rspack-plugin',
  pre: ['@modern-js/plugin-module-federation-config'],
  setup(api: {
    modifyRspackConfig: (
      handler: (
        config: ZephyrRspackConfig,
      ) => ZephyrRspackConfig | Promise<ZephyrRspackConfig>,
    ) => void;
  }) {
    api.modifyRspackConfig(config => withZephyrRspack()(config));
  },
});

const appId = '${app.id}';
const port = Number(process.env['${app.portEnv}'] ?? ${app.port});
const configuredSiteUrl = process.env['MODERN_PUBLIC_SITE_URL'];
const hasConfiguredSiteUrl =
  typeof configuredSiteUrl === 'string' && configuredSiteUrl.length > 0;
const isProductionBuild =
  process.env['NODE_ENV'] === 'production' || process.argv.includes('build');

if (isProductionBuild && !hasConfiguredSiteUrl) {
  throw new Error(
    'MODERN_PUBLIC_SITE_URL must be set for production builds so canonical and hreflang URLs use the deployed origin.',
  );
}

const siteUrl = hasConfiguredSiteUrl
  ? configuredSiteUrl
  : \`http://localhost:\${port}\`;

export default defineConfig(
  presetUltramodern(
    {
${bffConfig}      output: {
        disableTsChecker: true,
        distPath: {
          html: './',
        },
        polyfill: 'off',
        splitRouteChunks: false,
      },
      performance: {
        rsdoctor: {
          enabled: process.env['ULTRAMODERN_RSDOCTOR'] === 'true',
          disableClientServer: true,
        },
      },
      html: {
        outputStructure: 'flat',
      },
      plugins: [
        appTools(),
        tanstackRouterPlugin(),
        i18nPlugin({
          backend: {
            enabled: true,
          },
          reactI18next: false,
          localeDetection: {
            fallbackLanguage: 'en',
            languages: ['en', 'cs'],
            localePathRedirect: true,
            ignoreRedirectRoutes: [
              '/@mf-types',
              '/bundles',
              '${effectApiPrefix(app)}',
              '/locales',
              '/mf-manifest.json',
              '/mf-stats.json',
              '/remoteEntry.js',
              '/static',
              '/zephyr-manifest.json',
            ],
          },
        }),
${bffPluginEntry}        moduleFederationPlugin(),
        zephyrRspackPlugin(),
      ],
      tools: {
        autoprefixer: {
          overrideBrowserslist: ['defaults'],
        },
        bundlerChain: chain => {
          chain.ignoreWarnings([
            {
              message: /the request of a dependency is an expression/u,
              module: /modern-js-plugin-i18n/u,
            },
          ]);
        },
      },
      deploy: {
        target: 'cloudflare',
        worker: {
          ssr: true,
        },
      },
      server: {
        port,
        publicDir: './locales',
        ssr: {
          mode: 'stream',
          moduleFederationAppSSR: true,
        },
      },
      source: {
        mainEntryName: 'index',
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
    'react-dom/client': {
      requiredVersion: reactDomVersion,
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

function createRemoteManifestEnv(remote: WorkspaceApp): string {
  return `REMOTE_${toEnvSegment(remote.domain ?? remote.id)}_MF_MANIFEST`;
}

function createShellModuleFederationConfig(
  remotes: WorkspaceApp[] = remoteApps,
): string {
  const remoteEntries = remotes
    .map(remote => {
      const key = remoteDependencyAlias(remote);
      return `    ${key}:
      process.env['${createRemoteManifestEnv(remote)}'] ??
      '${remote.mfName}@http://localhost:${remote.port}/mf-manifest.json',`;
    })
    .join('\n');

  return `// @effect-diagnostics nodeBuiltinImport:off processEnv:off
import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const runtimeVersion = (require('@modern-js/runtime/package.json') as { version: string }).version;
const reactVersion = (require('react/package.json') as { version: string }).version;
const reactDomVersion = (require('react-dom/package.json') as { version: string }).version;

export default createModuleFederationConfig({
  treeShakingSharedExcludePlugins: ['RspackModuleFederationPlugin'],
  dev: {
    disableDynamicRemoteTypeHints: true,
  },
  dts: {
    displayErrorInTerminal: true,
    generateTypes: {
      compilerInstance: '--package typescript -- tsc',
    },
  },
  filename: 'remoteEntry.js',
  name: '${shellApp.mfName}',
  remotes: {
${remoteEntries}
  },
${createSharedModuleFederationConfig()},
});
`;
}

function createBuildMarker(
  scope: string,
  app: { id: string; packageSuffix: string },
) {
  return crypto
    .createHash('sha256')
    .update(`${scope}:${app.packageSuffix}:${app.id}:0.1.0`)
    .digest('hex')
    .slice(0, 16);
}

function createUltramodernBuildModule(
  scope: string,
  app: { id: string; packageSuffix: string },
): string {
  return `export const ultramodernVerticalIdentity = {
  appId: '${app.id}',
  packageName: '${packageName(scope, app.packageSuffix)}',
  version: '0.1.0',
  build: '${createBuildMarker(scope, app)}',
  deployProfile: 'cloudflare-ssr-mf-effect-v1',
} as const;

export const ultramodernUiMarker = {
  ...ultramodernVerticalIdentity,
  surface: 'ui',
} as const;

export const ultramodernApiMarker = {
  ...ultramodernVerticalIdentity,
  surface: 'effect-bff',
} as const;
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
  treeShakingSharedExcludePlugins: ['RspackModuleFederationPlugin'],
  dev: {
    disableDynamicRemoteTypeHints: true,
  },
  dts: {
    displayErrorInTerminal: true,
    generateTypes: {
      compilerInstance: '--package typescript -- tsc',
    },
  },
  exposes: ${exposes},
  filename: 'remoteEntry.js',
  name: '${app.mfName}',
${createSharedModuleFederationConfig()},
});
`;
}

function remoteWidgetFile(app: WorkspaceApp): string {
  return `${app.domain ?? app.id.replace(/^remote-/, '')}-widget`;
}

function createServiceModernConfig(): string {
  return createServiceModernConfigFor(effectService);
}

function createServiceModernConfigFor(service = effectService): string {
  return `// @effect-diagnostics processEnv:off
import { appTools, defineConfig, presetUltramodern } from '@modern-js/app-tools';
import { bffPlugin } from '@modern-js/plugin-bff';

const appId = '${service.id}';
const port = Number(process.env['${service.portEnv}'] ?? ${service.port});

export default defineConfig(
  presetUltramodern(
    {
      bff: {
        effect: {
          openapi: {
            path: '/openapi.json',
          },
        },
        prefix: '${serviceApiPrefix(service)}',
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

function createAppRuntimeConfig(app: WorkspaceApp): string {
  const resources = {
    cs: {
      translation: createAppLocaleMessages(app, 'cs'),
    },
    en: {
      translation: createAppLocaleMessages(app, 'en'),
    },
  };

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
      resources: ${JSON.stringify(resources, null, 8)
        .split('\n')
        .join('\n      ')},
      supportedLngs: ['en', 'cs'],
    },
  },
  router: {
    framework: 'tanstack',
  },
});
`;
}

function createAppStyles(enableTailwind: boolean): string {
  return `${enableTailwind ? "@import 'tailwindcss';\n\n" : ''}:root {
  color: #10231c;
  background: #f1eadc;
  font-family:
    Geist,
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

body {
  margin: 0;
}

main {
  min-height: 100vh;
  padding: 2rem;
}

nav {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 2rem;
}

a {
  color: #166b4b;
}

.commerce-shell {
  background: #f1eadc;
  color: #0b0a08;
  min-height: 100vh;
  padding: 1.5rem clamp(1rem, 4vw, 3rem) 4rem;
}

.commerce-header,
.commerce-footer {
  align-items: center;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 0.625rem 1.875rem rgba(25, 20, 12, 0.08);
  display: flex;
  gap: 1.25rem;
  justify-content: space-between;
  margin: 0 auto;
  max-width: 88rem;
  padding: 1.25rem 1.75rem;
}

.commerce-logo {
  font-size: 1.35rem;
  font-weight: 800;
}

.commerce-nav,
.commerce-actions,
.commerce-language {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.commerce-nav {
  margin: 0;
}

.commerce-pill,
.commerce-button,
.commerce-link-button,
.commerce-cart-button,
.commerce-quantity-button {
  align-items: center;
  border-radius: 999px;
  border: 0.0625rem solid rgba(23, 23, 23, 0.14);
  box-shadow: 0 0.25rem 0.75rem rgba(20, 17, 10, 0.08);
  color: #14120d;
  display: inline-flex;
  font: inherit;
  font-weight: 750;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0.65rem 1.05rem;
  text-decoration: none;
}

.commerce-button {
  background: #00624b;
  border-color: #00624b;
  color: #ffffff;
}

.commerce-link-button,
.commerce-pill,
.commerce-cart-button,
.commerce-quantity-button {
  background: rgba(255, 255, 255, 0.92);
}

.commerce-page {
  margin: 3rem auto 0;
  max-width: 88rem;
}

.commerce-product {
  align-items: center;
  display: grid;
  gap: clamp(2rem, 5vw, 4rem);
  grid-template-columns: minmax(0, 1fr) minmax(20rem, 0.95fr);
}

.commerce-product-media {
  aspect-ratio: 1 / 0.92;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0) 42%),
    linear-gradient(135deg, #97c66d 0 20%, #6f9748 20% 34%, #d6c15d 34% 36%, #6a8f3e 36% 46%, #315824 46% 64%, #8bb85e 64% 100%);
  border: 1.25rem solid #ffe987;
  border-radius: 1.6rem;
  box-shadow: inset 0 -7rem 8rem rgba(58, 77, 35, 0.22);
  overflow: hidden;
}

.commerce-product-media::after {
  background:
    radial-gradient(circle at 27% 76%, #1e2422 0 5%, transparent 5.4%),
    radial-gradient(circle at 55% 76%, #1e2422 0 6%, transparent 6.4%),
    linear-gradient(0deg, #004b7b 0 100%);
  border-radius: 1.2rem;
  content: "";
  display: block;
  height: 19%;
  margin: 58% auto 0;
  width: 42%;
}

.commerce-eyebrow {
  color: #00624b;
  font-size: 0.85rem;
  font-weight: 850;
  letter-spacing: 0.16rem;
  text-transform: uppercase;
}

.commerce-title {
  font-size: clamp(2.5rem, 6vw, 4.8rem);
  line-height: 0.95;
  margin: 0.65rem 0 1.4rem;
}

.commerce-lede {
  color: #555149;
  font-size: 1.2rem;
  line-height: 1.65;
  max-width: 42rem;
}

.commerce-facts {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 2rem 0;
}

.commerce-fact,
.commerce-card,
.commerce-cart-panel {
  background: rgba(255, 255, 255, 0.92);
  border-radius: 1rem;
  box-shadow: 0 0.5rem 1.25rem rgba(25, 20, 12, 0.08);
  padding: 1.25rem;
}

.commerce-fact span,
.commerce-card span {
  color: #767067;
  display: block;
  font-weight: 750;
  margin-bottom: 0.45rem;
}

.commerce-fact strong {
  font-size: 1.1rem;
}

.commerce-checkout {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.commerce-section-title {
  font-size: 1.8rem;
  margin: 4.5rem 0 1.5rem;
}

.commerce-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.commerce-card strong {
  display: block;
  font-size: 1.45rem;
}

.commerce-cart-panel {
  margin-top: 2rem;
}

.commerce-cart-line {
  align-items: center;
  border-top: 0.0625rem solid rgba(23, 23, 23, 0.12);
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 1rem 0;
}

.commerce-cart-line:first-of-type {
  border-top: 0;
}

.commerce-quantity {
  align-items: center;
  display: flex;
  gap: 0.45rem;
}

.commerce-quantity-button {
  min-height: 2rem;
  min-width: 2rem;
  padding: 0.25rem;
}

.commerce-boundary-toggle {
  align-items: center;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 0.8rem;
  bottom: 1.5rem;
  box-shadow: 0 0.75rem 2rem rgba(18, 15, 10, 0.14);
  display: flex;
  gap: 0.65rem;
  left: 1.5rem;
  padding: 0.8rem 1rem;
  position: fixed;
  z-index: 80;
}

.commerce-boundary-toggle input {
  accent-color: #00624b;
  height: 1rem;
  width: 1rem;
}

.boundary-overlay {
  inset: 0;
  pointer-events: none;
  position: fixed;
  z-index: 70;
}

.boundary-overlay__box {
  border: 0.0625rem solid var(--boundary-color);
  border-radius: 0.55rem;
  box-shadow:
    0 0 0 0.0625rem rgba(255, 255, 255, 0.72),
    0 0.35rem 1.25rem color-mix(in srgb, var(--boundary-color) 20%, transparent);
  position: fixed;
}

.boundary-overlay__label {
  background: color-mix(in srgb, var(--boundary-color) 88%, white);
  border-radius: 999px;
  color: #0b0a08;
  font-size: 0.7rem;
  font-weight: 850;
  line-height: 1;
  padding: 0.3rem 0.55rem;
  position: absolute;
  right: 0.35rem;
  top: 0.35rem;
  white-space: nowrap;
}

.boundary-overlay__box[data-label-placement="above"] .boundary-overlay__label {
  bottom: calc(100% + 0.25rem);
  top: auto;
}

@media (max-width: 860px) {
  .commerce-header,
  .commerce-footer,
  .commerce-product,
  .commerce-grid,
  .commerce-facts {
    grid-template-columns: 1fr;
  }

  .commerce-header,
  .commerce-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .commerce-product-media {
    min-height: 20rem;
  }
}
`;
}

function createPostcssConfig(): string {
  return `export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`;
}

function createTailwindConfig(): string {
  return `import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
} satisfies Config;
`;
}

function createLocalizedHeadComponent(): string {
  return `const fallbackLanguage = 'en';
const supportedLanguages = ['en', 'cs'] as const;
type SupportedLanguage = (typeof supportedLanguages)[number];

const localizedPath = (language: SupportedLanguage) => \`/\${language}\`;

const absoluteUrl = (pathname: string) => {
  const origin = ULTRAMODERN_SITE_URL.replace(/\\/+$/u, '');
  return \`\${origin}\${pathname}\`;
};
const LocalizedHead = () => {
  const canonicalPath = localizedPath(fallbackLanguage);

  return (
    <>
      <link rel="canonical" href={absoluteUrl(canonicalPath)} />
      {supportedLanguages.map(code => (
        <link
          href={absoluteUrl(localizedPath(code))}
          hrefLang={code}
          key={code}
          rel="alternate"
        />
      ))}
      <link
        href={absoluteUrl(localizedPath(fallbackLanguage))}
        hrefLang="x-default"
        rel="alternate"
      />
    </>
  );
};
`;
}

function createShellPage(): string {
  return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { ultramodernUiMarker } from '../../ultramodern-build';

const languageCodes = ['en', 'cs'] as const;

const remoteKeys = ['commerce', 'identity', 'designSystem'] as const;

${createLocalizedHeadComponent()}
export default function ShellHome() {
  const { i18nInstance, language } = useModernI18n();
  const t = i18nInstance.t.bind(i18nInstance);

  return (
    <main>
      <LocalizedHead />
      <nav aria-label={t('shell.language.switcher')}>
        {languageCodes.map(code => (
          <a
            aria-current={language === code ? 'page' : undefined}
            href={\`/\${code}\`}
            key={code}
          >
            {t(\`shell.language.\${code}\`)}
          </a>
        ))}
      </nav>
      <h1>{t('shell.title')}</h1>
      <p data-testid="ultramodern-preset">presetUltramodern workspace</p>
      <p data-build-marker={ultramodernUiMarker.build} data-testid="ultramodern-ui-marker">
        {ultramodernUiMarker.appId}:{ultramodernUiMarker.version}
      </p>
      <ul>
        {remoteKeys.map(remote => (
          <li key={remote}>{t(\`shell.remotes.\${remote}\`)}</li>
        ))}
      </ul>
    </main>
  );
}
`;
}

function createRemotePage(app: WorkspaceApp): string {
  if (app.id === 'remote-commerce') {
    return createCommerceRemotePage(app);
  }

  const effectBffImport = appHasEffectApi(app)
    ? `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useEffect, useState } from 'react';
import { ultramodernUiMarker } from '../../ultramodern-build';
`
    : "import { useModernI18n } from '@modern-js/plugin-i18n/runtime';\nimport { ultramodernUiMarker } from '../../ultramodern-build';\n";
  const effectBffState = appHasEffectApi(app)
    ? `  const [effectApiStatus, setEffectApiStatus] = useState('pending');

  useEffect(() => {
    void fetch('${effectApiPrefix(app)}/effect/${effectApiStem(app)}?limit=1', {
      headers: {
        accept: 'application/json',
      },
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(\`Effect BFF request failed: \${response.status}\`);
        }

        return response.json() as Promise<{ items?: Array<{ title?: string }> }>;
      })
      .then(data => {
        setEffectApiStatus(data.items[0]?.title ?? 'empty');
      })
      .catch(() => {
        setEffectApiStatus('unavailable');
      });
  }, []);

`
    : '';
  const effectBffMarkup = appHasEffectApi(app)
    ? `      <p data-testid="effect-bff-status">{effectApiStatus}</p>
`
    : '';

  return `${effectBffImport}
${createLocalizedHeadComponent()}
export default function ${toPascalCase(app.id)}Home() {
  const { i18nInstance, language } = useModernI18n();
  const t = i18nInstance.t.bind(i18nInstance);
${effectBffState}  return (
    <main>
      <LocalizedHead />
      <nav aria-label={t('${app.domain}.language.switcher')}>
        {supportedLanguages.map(code => (
          <a
            aria-current={language === code ? 'page' : undefined}
            href={\`/\${code}\`}
            key={code}
          >
            {t(\`${app.domain}.language.\${code}\`)}
          </a>
        ))}
      </nav>
      <h1>{t('${app.domain}.title')}</h1>
      <p data-mf-role="${app.kind}">{t('${app.domain}.role')}</p>
      <p data-build-marker={ultramodernUiMarker.build} data-testid="ultramodern-ui-marker">
        {ultramodernUiMarker.appId}:{ultramodernUiMarker.version}
      </p>
${effectBffMarkup}    </main>
  );
}
`;
}

function createCommerceRemotePage(app: WorkspaceApp): string {
  return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useEffect, useState, type CSSProperties } from 'react';
import { ultramodernUiMarker } from '../../ultramodern-build';

const languageCodes = ['en', 'cs'] as const;

const boundaryDefinitions = [
  {
    color: '#ff5a57',
    id: 'explore',
    labelKey: 'commerce.boundaries.explore',
  },
  {
    color: '#24d671',
    id: 'decide',
    labelKey: 'commerce.boundaries.decide',
  },
  {
    color: '#f4d044',
    id: 'checkout',
    labelKey: 'commerce.boundaries.checkout',
  },
] as const;

type BoundaryId = (typeof boundaryDefinitions)[number]['id'];
type BoundaryDefinition = (typeof boundaryDefinitions)[number];

const boundaryMetadata: Record<BoundaryId, BoundaryDefinition> = {
  checkout: boundaryDefinitions[2],
  decide: boundaryDefinitions[1],
  explore: boundaryDefinitions[0],
};

const products = [
  {
    id: 'field-loader-112',
    titleKey: 'commerce.products.fieldLoader.title',
    descriptionKey: 'commerce.products.fieldLoader.description',
    priceKey: 'commerce.products.fieldLoader.price',
    powerKey: 'commerce.products.fieldLoader.power',
    availabilityKey: 'commerce.products.fieldLoader.availability',
  },
  {
    id: 'orchard-tractor',
    titleKey: 'commerce.products.orchard.title',
    badgeKey: 'commerce.products.orchard.badge',
  },
  {
    id: 'autonomy-kit',
    titleKey: 'commerce.products.autonomy.title',
    badgeKey: 'commerce.products.autonomy.badge',
  },
] as const;

type ProductId = (typeof products)[number]['id'];
type CartState = Partial<Record<ProductId, number>>;

type BoundaryLabels = Record<BoundaryId, string>;
type BoundaryBox = {
  color: string;
  height: number;
  id: BoundaryId;
  label: string;
  labelPlacement: 'above' | 'inside';
  left: number;
  top: number;
  width: number;
};

const featuredProduct = products[0];
const recommendations = [products[1], products[2]] as const;

${createLocalizedHeadComponent()}
const isBoundaryId = (value: string): value is BoundaryId =>
  Object.prototype.hasOwnProperty.call(boundaryMetadata, value);

function collectBoundaryBoxes(labels: BoundaryLabels): BoundaryBox[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-boundary], [data-boundary-page]'),
  )
    .map(element => {
      const id = element.dataset.boundary ?? element.dataset.boundaryPage;

      if (id === undefined || !isBoundaryId(id)) {
        return undefined;
      }

      const rect = element.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return undefined;
      }

      return {
        color: boundaryMetadata[id].color,
        height: rect.height,
        id,
        label: labels[id],
        labelPlacement: rect.top > 28 ? 'above' : 'inside',
        left: rect.left,
        top: rect.top,
        width: rect.width,
      };
    })
    .filter((box): box is BoundaryBox => box !== undefined);
}

function BoundaryOverlay({
  labels,
  visible,
}: {
  labels: BoundaryLabels;
  visible: boolean;
}) {
  const [boxes, setBoxes] = useState<BoundaryBox[]>([]);

  useEffect(() => {
    if (!visible) {
      setBoxes([]);
      return;
    }

    let animationFrame = 0;
    const update = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        setBoxes(collectBoundaryBoxes(labels));
      });
    };
    const observer = new ResizeObserver(update);

    observer.observe(document.body);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [labels, visible]);

  if (!visible) {
    return null;
  }

  return (
    <div aria-hidden="true" className="boundary-overlay">
      {boxes.map((box, index) => (
        <div
          className="boundary-overlay__box"
          data-boundary-id={box.id}
          data-label-placement={box.labelPlacement}
          key={\`\${box.id}-\${index}\`}
          style={{
            '--boundary-color': box.color,
            height: box.height,
            left: box.left,
            top: box.top,
            width: box.width,
          } as CSSProperties}
        >
          <span className="boundary-overlay__label">{box.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function ${toPascalCase(app.id)}Home() {
  const { i18nInstance, language } = useModernI18n();
  const t = i18nInstance.t.bind(i18nInstance);
  const [cart, setCart] = useState<CartState>({});
  const [showBoundaries, setShowBoundaries] = useState(false);
  const [effectApiStatus, setEffectApiStatus] = useState('pending');
  const boundaryLabels = {
    checkout: t('commerce.boundaries.checkout'),
    decide: t('commerce.boundaries.decide'),
    explore: t('commerce.boundaries.explore'),
  } satisfies BoundaryLabels;
  const cartLines = products
    .map(product => ({
      product,
      quantity: cart[product.id] ?? 0,
    }))
    .filter(line => line.quantity > 0);
  const cartCount = cartLines.reduce((total, line) => total + line.quantity, 0);

  useEffect(() => {
    void fetch('${effectApiPrefix(app)}/effect/${effectApiStem(app)}?limit=1', {
      headers: {
        accept: 'application/json',
      },
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(\`Effect BFF request failed: \${response.status}\`);
        }

        return response.json() as Promise<{ items?: Array<{ title?: string }> }>;
      })
      .then(data => {
        setEffectApiStatus(data.items[0]?.title ?? 'empty');
      })
      .catch(() => {
        setEffectApiStatus('unavailable');
      });
  }, []);

  const addToCart = (id: ProductId) => {
    setCart(current => ({
      ...current,
      [id]: (current[id] ?? 0) + 1,
    }));
  };

  const reduceQuantity = (id: ProductId) => {
    setCart(current => {
      const quantity = current[id] ?? 0;
      const next = { ...current };

      if (quantity <= 1) {
        delete next[id];
      } else {
        next[id] = quantity - 1;
      }

      return next;
    });
  };

  const removeFromCart = (id: ProductId) => {
    setCart(current => {
      const next = { ...current };

      delete next[id];
      return next;
    });
  };

  return (
    <main className="commerce-shell">
      <LocalizedHead />
      <BoundaryOverlay labels={boundaryLabels} visible={showBoundaries} />
      <header className="commerce-header" data-boundary="explore">
        <strong className="commerce-logo">{t('commerce.brand')}</strong>
        <nav aria-label={t('commerce.navigation.primary')} className="commerce-nav">
          <a className="commerce-pill" href="#machines">
            {t('commerce.navigation.machines')}
          </a>
          <a className="commerce-pill" href="#checkout">
            {t('commerce.navigation.checkout')}
          </a>
        </nav>
        <div className="commerce-actions">
          <a className="commerce-cart-button" data-boundary="checkout" href="#cart">
            {t('commerce.cart.button', { count: cartCount })}
          </a>
          <nav aria-label={t('commerce.language.switcher')} className="commerce-language">
            {languageCodes.map(code => (
              <a
                aria-current={language === code ? 'page' : undefined}
                className="commerce-pill"
                href={\`/\${code}\`}
                key={code}
              >
                {t(\`commerce.language.\${code}\`)}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="commerce-page">
        <section className="commerce-product" data-boundary-page="decide" id="machines">
          <div
            aria-label={t('commerce.products.fieldLoader.imageAlt')}
            className="commerce-product-media"
            role="img"
          />
          <div>
            <p className="commerce-eyebrow">{t('commerce.detail.eyebrow')}</p>
            <h1 className="commerce-title">{t(featuredProduct.titleKey)}</h1>
            <p className="commerce-lede">{t(featuredProduct.descriptionKey)}</p>
            <div className="commerce-facts">
              <div className="commerce-fact">
                <span>{t('commerce.detail.price')}</span>
                <strong>{t(featuredProduct.priceKey)}</strong>
              </div>
              <div className="commerce-fact">
                <span>{t('commerce.detail.power')}</span>
                <strong>{t(featuredProduct.powerKey)}</strong>
              </div>
              <div className="commerce-fact">
                <span>{t('commerce.detail.availability')}</span>
                <strong>{t(featuredProduct.availabilityKey)}</strong>
              </div>
            </div>
            <div className="commerce-checkout" data-boundary="checkout" id="checkout">
              <button
                className="commerce-button"
                onClick={() => addToCart(featuredProduct.id)}
                type="button"
              >
                {t('commerce.cart.add')}
              </button>
              <a className="commerce-link-button" href="#cart">
                {t('commerce.cart.view')}
              </a>
            </div>
          </div>
        </section>

        <section data-boundary="explore">
          <h2 className="commerce-section-title">{t('commerce.recommendations.title')}</h2>
          <div className="commerce-grid">
            {recommendations.map(product => (
              <article className="commerce-card" key={product.id}>
                <span>{t(product.badgeKey)}</span>
                <strong>{t(product.titleKey)}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="commerce-cart-panel" data-boundary="checkout" id="cart">
          <h2>{t('commerce.cart.title')}</h2>
          {cartLines.length === 0 ? (
            <p>{t('commerce.cart.empty')}</p>
          ) : (
            cartLines.map(line => (
              <div className="commerce-cart-line" key={line.product.id}>
                <strong>{t(line.product.titleKey)}</strong>
                <div className="commerce-quantity">
                  <button
                    aria-label={t('commerce.cart.decrease', {
                      name: t(line.product.titleKey),
                    })}
                    className="commerce-quantity-button"
                    onClick={() => reduceQuantity(line.product.id)}
                    type="button"
                  >
                    -
                  </button>
                  <span>{line.quantity}</span>
                  <button
                    aria-label={t('commerce.cart.increase', {
                      name: t(line.product.titleKey),
                    })}
                    className="commerce-quantity-button"
                    onClick={() => addToCart(line.product.id)}
                    type="button"
                  >
                    +
                  </button>
                  <button
                    className="commerce-link-button"
                    onClick={() => removeFromCart(line.product.id)}
                    type="button"
                  >
                    {t('commerce.cart.remove')}
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      <footer className="commerce-footer" data-boundary="explore">
        <span>{t('commerce.footer.stack')}</span>
        <span data-testid="effect-bff-status">{effectApiStatus}</span>
        <span data-build-marker={ultramodernUiMarker.build} data-testid="ultramodern-ui-marker">
          {ultramodernUiMarker.appId}:{ultramodernUiMarker.version}
        </span>
      </footer>

      <label className="commerce-boundary-toggle">
        <input
          checked={showBoundaries}
          onChange={event => setShowBoundaries(event.currentTarget.checked)}
          type="checkbox"
        />
        {t('commerce.boundaries.toggle')}
      </label>
    </main>
  );
}
`;
}

function createLayout(appId: string): string {
  return `import { Outlet } from '@modern-js/plugin-tanstack/runtime';
import './index.css';

export default function Layout() {
  return (
    <div data-app-id="${appId}">
      <Outlet />
    </div>
  );
}
`;
}

function createRemoteEntry(app: WorkspaceApp): string {
  return `export { default } from './components/${remoteWidgetFile(app)}';
`;
}

function createRemoteWidget(app: WorkspaceApp): string {
  const componentName = `${toPascalCase(app.domain ?? app.id)}Widget`;
  const body =
    app.kind === 'vertical'
      ? `Owns the ${app.domain} vertical route surface.`
      : 'Provides shared UI primitives for the workspace.';

  return `export default function ${componentName}() {
  return (
    <section data-mf-remote="${app.id}">
      <h2>${app.displayName}</h2>
      <p>${body}</p>
    </section>
  );
}
`;
}

function createAppLocaleMessages(app: WorkspaceApp, language: 'en' | 'cs') {
  const czechLabels: Record<string, { role: string; title: string }> = {
    commerce: {
      role: 'obchod',
      title: 'Obchodní remote',
    },
    'design-system': {
      role: 'design system',
      title: 'Design system remote',
    },
    identity: {
      role: 'identita',
      title: 'Identitní remote',
    },
  };

  if (app.kind === 'shell') {
    return {
      shell: {
        language: {
          cs: language === 'en' ? 'Czech' : 'Čeština',
          en: language === 'en' ? 'English' : 'Angličtina',
          switcher: language === 'en' ? 'Language' : 'Jazyk',
        },
        remotes: {
          commerce: language === 'en' ? 'Commerce Remote' : 'Obchodní remote',
          designSystem:
            language === 'en' ? 'Design System Remote' : 'Design system remote',
          identity: language === 'en' ? 'Identity Remote' : 'Identitní remote',
        },
        title:
          language === 'en'
            ? 'UltraModern SuperApp Shell'
            : 'UltraModern SuperApp shell',
      },
    };
  }

  const domain = app.domain ?? app.id;
  const czechLabel = czechLabels[domain] ?? {
    role: domain,
    title: `${app.displayName} CZ`,
  };

  if (domain === 'commerce') {
    return {
      commerce: {
        boundaries: {
          checkout: language === 'en' ? 'checkout' : 'pokladna',
          decide: language === 'en' ? 'decide' : 'rozhodování',
          explore: language === 'en' ? 'explore' : 'procházení',
          toggle:
            language === 'en'
              ? 'show team boundaries'
              : 'zobrazit hranice týmů',
        },
        brand: 'Acre & Iron',
        cart: {
          add: language === 'en' ? 'Add to cart' : 'Přidat do košíku',
          button:
            language === 'en' ? 'Your cart ({{count}})' : 'Košík ({{count}})',
          decrease:
            language === 'en'
              ? 'Decrease {{name}} quantity'
              : 'Snížit množství položky {{name}}',
          empty:
            language === 'en' ? 'Your cart is empty.' : 'Košík je prázdný.',
          increase:
            language === 'en'
              ? 'Increase {{name}} quantity'
              : 'Zvýšit množství položky {{name}}',
          remove: language === 'en' ? 'Remove' : 'Odebrat',
          title: language === 'en' ? 'Cart' : 'Košík',
          view: language === 'en' ? 'View cart' : 'Zobrazit košík',
        },
        detail: {
          availability: language === 'en' ? 'Availability' : 'Dostupnost',
          eyebrow: language === 'en' ? 'Machine detail' : 'Detail stroje',
          power: language === 'en' ? 'Power' : 'Výkon',
          price: language === 'en' ? 'Price' : 'Cena',
        },
        footer: {
          stack:
            language === 'en'
              ? 'SPA, SSR-ready Module Federation, React, Effect BFF'
              : 'SPA, SSR-ready Module Federation, React, Effect BFF',
        },
        language: {
          cs: language === 'en' ? 'Czech' : 'Čeština',
          en: language === 'en' ? 'English' : 'Angličtina',
          switcher: language === 'en' ? 'Language' : 'Jazyk',
        },
        navigation: {
          checkout: language === 'en' ? 'Checkout' : 'Pokladna',
          machines: language === 'en' ? 'Machines' : 'Stroje',
          primary:
            language === 'en'
              ? 'Primary commerce navigation'
              : 'Hlavní navigace obchodu',
        },
        products: {
          autonomy: {
            badge: language === 'en' ? 'AI-first option' : 'AI varianta',
            title:
              language === 'en'
                ? 'Autonomy Retrofit Kit'
                : 'Sada pro autonomní řízení',
          },
          fieldLoader: {
            availability: language === 'en' ? 'In stock' : 'Skladem',
            description:
              language === 'en'
                ? 'A loader-ready tractor for feed, hay, gravel, and winter road work.'
                : 'Traktor připravený na nakladač pro krmivo, seno, štěrk i zimní údržbu cest.',
            imageAlt:
              language === 'en'
                ? 'Field Loader 112 tractor working on a bright farm lane'
                : 'Traktor Field Loader 112 pracuje na světlé polní cestě',
            power: '112 hp',
            price: 'EUR 42,500',
            title: 'Field Loader 112',
          },
          orchard: {
            badge:
              language === 'en'
                ? 'Best for tight rows'
                : 'Nejlepší do úzkých řádků',
            title:
              language === 'en'
                ? 'Narrow Orchard Tractor'
                : 'Úzký sadový traktor',
          },
        },
        recommendations: {
          title:
            language === 'en' ? 'Compare alternatives' : 'Porovnat alternativy',
        },
        role: language === 'en' ? 'commerce' : 'obchod',
        title: language === 'en' ? app.displayName : czechLabel.title,
      },
    };
  }

  return {
    [domain]: {
      language: {
        cs: language === 'en' ? 'Czech' : 'Čeština',
        en: language === 'en' ? 'English' : 'Angličtina',
        switcher: language === 'en' ? 'Language' : 'Jazyk',
      },
      role: language === 'en' ? (app.domain ?? app.kind) : czechLabel.role,
      title: language === 'en' ? app.displayName : czechLabel.title,
    },
  };
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

function serviceEffectApiExport(
  service: { id: string; effectApi?: WorkspaceEffectApi } = effectService,
) {
  return `${toCamelCase(effectApiStem(service))}EffectApi`;
}

function serviceEffectGroupName(
  service: { id: string; effectApi?: WorkspaceEffectApi } = effectService,
) {
  return toCamelCase(effectApiStem(service));
}

function serviceEffectApiName(
  service: { id: string; effectApi?: WorkspaceEffectApi } = effectService,
) {
  return `${toPascalCase(effectApiStem(service))}EffectApi`;
}

function serviceEffectSchemaExport(
  service: { id: string; effectApi?: WorkspaceEffectApi } = effectService,
) {
  return `${toCamelCase(effectApiStem(service))}ItemSchema`;
}

function serviceEffectErrorStem(
  service: { id: string; effectApi?: WorkspaceEffectApi } = effectService,
) {
  const stem = effectApiStem(service);
  return stem === 'recommendations' ? 'recommendation' : stem;
}

function serviceEffectCreatePayloadSchemaExport(
  service: { id: string; effectApi?: WorkspaceEffectApi } = effectService,
) {
  return `${toCamelCase(effectApiStem(service))}CreatePayloadSchema`;
}

function serviceEffectNotFoundErrorExport(
  service: { id: string; effectApi?: WorkspaceEffectApi } = effectService,
) {
  return `${toPascalCase(serviceEffectErrorStem(service))}NotFound`;
}

function serviceEffectNotFoundSchemaExport(
  service: { id: string; effectApi?: WorkspaceEffectApi } = effectService,
) {
  return `${toCamelCase(serviceEffectErrorStem(service))}NotFoundSchema`;
}

function createEffectSharedApiImports(): string {
  return `import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  Schema,
} from '@modern-js/plugin-bff/effect-client';
`;
}

function createEffectSharedApiContract(
  service: { id: string; effectApi?: WorkspaceEffectApi } = effectService,
): string {
  const schemaExport = serviceEffectSchemaExport(service);
  const createPayloadSchemaExport =
    serviceEffectCreatePayloadSchemaExport(service);
  const notFoundErrorExport = serviceEffectNotFoundErrorExport(service);
  const notFoundSchemaExport = serviceEffectNotFoundSchemaExport(service);
  const apiExport = serviceEffectApiExport(service);
  const apiName = serviceEffectApiName(service);
  const groupName = serviceEffectGroupName(service);
  const stem = effectApiStem(service);
  const servicePrefix = effectApiPrefix(service);

  return `export const ${schemaExport} = Schema.Struct({
  id: Schema.String,
  marker: Schema.Struct({
    appId: Schema.String,
    packageName: Schema.String,
    version: Schema.String,
    build: Schema.String,
    deployProfile: Schema.String,
    surface: Schema.String,
  }),
  title: Schema.String,
});

export const ${createPayloadSchemaExport} = Schema.Struct({
  title: Schema.String,
});

export class ${notFoundErrorExport} extends Schema.TaggedErrorClass<${notFoundErrorExport}>()(
  '${notFoundErrorExport}',
  {
    id: Schema.String,
  },
) {}

export const ${notFoundSchemaExport} = ${notFoundErrorExport}.pipe(
  HttpApiSchema.status(404),
);

export type OperationContext = {
  operationId: string;
  routePath: string;
  method: string;
  source: string;
  traceId?: string;
};

export const ${apiExport} = HttpApi.make('${apiName}').add(
  HttpApiGroup.make('${groupName}')
    .add(
      HttpApiEndpoint.get('list', '/effect/${stem}', {
        query: {
          limit: Schema.optional(Schema.NumberFromString),
        },
        success: Schema.Struct({
          items: Schema.Array(${schemaExport}),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('get', '/effect/${stem}/:id', {
        params: {
          id: Schema.String,
        },
        success: ${schemaExport},
        error: ${notFoundSchemaExport},
      }),
    )
    .add(
      HttpApiEndpoint.post('create', '/effect/${stem}', {
        payload: ${createPayloadSchemaExport},
        success: Schema.Struct({
          item: ${schemaExport},
        }),
      }),
    ),
);

export const ${groupName}OperationContexts = {
  list: {
    operationId: '${apiName}:${groupName}:list',
    routePath: '/effect/${stem}',
    method: 'GET',
    source: 'generated-client',
  },
  get: {
    operationId: '${apiName}:${groupName}:get',
    routePath: '/effect/${stem}/:id',
    method: 'GET',
    source: 'generated-client',
  },
  create: {
    operationId: '${apiName}:${groupName}:create',
    routePath: '/effect/${stem}',
    method: 'POST',
    source: 'generated-client',
  },
} satisfies Record<string, OperationContext>;

export const ${groupName}ApiContract = {
  basePath: '${servicePrefix}/effect/${stem}',
  ownerId: '${service.id}',
  servicePrefix: '${servicePrefix}',
} as const;
`;
}

function createEffectSharedApi(service?: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}): string {
  if (service) {
    return `${createEffectSharedApiImports()}
${createEffectSharedApiContract(service)}`;
  }

  return `export const sharedEffectApiPackage = {
  scope: 'external-effect-service-contracts',
} as const;
`;
}

function createEffectServiceEntry(
  scope: string,
  service: { id: string; effectApi?: WorkspaceEffectApi } = effectService,
  contractImportPath = packageName(scope, 'shared-effect-api'),
): string {
  const apiExport = serviceEffectApiExport(service);
  const groupName = serviceEffectGroupName(service);
  const notFoundErrorExport = serviceEffectNotFoundErrorExport(service);
  const stem = effectApiStem(service);

  return `import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-edge';
import { ultramodernApiMarker } from '../../src/ultramodern-build';
import {
  ${apiExport},
  ${groupName}OperationContexts,
  ${notFoundErrorExport},
  type OperationContext,
} from '${contractImportPath}';

const ${groupName}Items = [
  {
    id: 'starter-${stem}',
    marker: ultramodernApiMarker,
    title: 'Wire a real ${stem} source here',
  },
];

const operationAttributes = (operationContext: OperationContext) => {
  return {
    'modernjs.operation.id': operationContext.operationId,
    'modernjs.operation.method': operationContext.method,
    'modernjs.operation.route': operationContext.routePath,
    'modernjs.operation.source': operationContext.source,
    ...(typeof operationContext.traceId === 'string'
      ? { 'modernjs.trace.id': operationContext.traceId }
      : {}),
  };
};

const ${groupName}Layer = HttpApiBuilder.group(
  ${apiExport},
  '${groupName}',
  (handlers) =>
    handlers
      .handle('list', ({ query }) =>
        Effect.succeed({
          items:
            typeof query.limit === 'number'
              ? ${groupName}Items.slice(0, query.limit)
              : ${groupName}Items,
        }).pipe(
          Effect.withSpan('ultramodern.effect.${groupName}.list', {
            attributes: operationAttributes(${groupName}OperationContexts.list),
            kind: 'server',
          }),
        ),
      )
      .handle('get', ({ params }) => {
        const item = ${groupName}Items.find(item => item.id === params.id);
        return (item !== undefined
          ? Effect.succeed(item)
          : Effect.fail(new ${notFoundErrorExport}({ id: params.id }))).pipe(
            Effect.withSpan('ultramodern.effect.${groupName}.get', {
              attributes: operationAttributes(${groupName}OperationContexts.get),
              kind: 'server',
            }),
          );
      })
      .handle('create', ({ payload }) =>
        Effect.succeed({
          item: {
            id: \`generated-${stem}-\${payload.title
              .toLowerCase()
              .replaceAll(/[^a-z0-9]+/g, '-')
              .replaceAll(/^-|-$/g, '')}\`,
            marker: ultramodernApiMarker,
            title: payload.title,
          },
        }).pipe(
          Effect.withSpan('ultramodern.effect.${groupName}.create', {
            attributes: operationAttributes(${groupName}OperationContexts.create),
            kind: 'server',
          }),
        ),
      ),
);

const layer = HttpApiBuilder.layer(${apiExport}).pipe(
  Layer.provide(${groupName}Layer),
);

export default defineEffectBff({
  api: ${apiExport},
  layer,
});
`;
}

function createEffectClient(
  service: { id: string; effectApi?: WorkspaceEffectApi },
  contractImportPath: string,
): string {
  const apiExport = serviceEffectApiExport(service);
  const contractExport = serviceEffectGroupName(service);
  const stem = effectApiStem(service);
  const groupName = serviceEffectGroupName(service);
  const singular = serviceEffectErrorStem(service);
  const clientOptionsName = `${toPascalCase(stem)}ClientOptions`;
  const createClientName = `create${toPascalCase(stem)}Client`;
  const listName = `list${toPascalCase(stem)}`;
  const getName = `get${toPascalCase(singular)}`;
  const createName = `create${toPascalCase(singular)}`;

  return `import {
  makeEffectHttpApiClient,
  runEffectRequest,
} from '@modern-js/plugin-bff/effect-client';
import {
  ${contractExport}ApiContract,
  ${apiExport},
  ${groupName}OperationContexts,
  type OperationContext,
} from '${contractImportPath}';

export type ${clientOptionsName} = {
  baseUrl?: string | URL;
  locale?: string;
  operationContext?: OperationContext;
  traceparent?: string;
};

export function ${createClientName}(
  options: ${clientOptionsName} = {},
) {
  return makeEffectHttpApiClient(${apiExport}, {
    baseUrl: options.baseUrl ?? ${contractExport}ApiContract.servicePrefix,
  });
}

export function ${listName}(
  options: ${clientOptionsName} & { limit?: number } = {},
) {
  return runEffectRequest(
    ${createClientName}({
      ...options,
      operationContext:
        options.operationContext ?? ${groupName}OperationContexts.list,
    }),
  ).then(client =>
    runEffectRequest(
      client.${groupName}.list({ query: { limit: options.limit } }),
    ),
  );
}

export function ${getName}(
  id: string,
  options: ${clientOptionsName} = {},
) {
  return runEffectRequest(
    ${createClientName}({
      ...options,
      operationContext:
        options.operationContext ?? ${groupName}OperationContexts.get,
    }),
  ).then(client =>
    runEffectRequest(client.${groupName}.get({ params: { id } })),
  );
}

export function ${createName}(
  title: string,
  options: ${clientOptionsName} = {},
) {
  return runEffectRequest(
    ${createClientName}({
      ...options,
      operationContext:
        options.operationContext ?? ${groupName}OperationContexts.create,
    }),
  ).then(client =>
    runEffectRequest(
      client.${groupName}.create({ payload: { title } }),
    ),
  );
}
`;
}

function createShellEffectClient(scope: string): string {
  return `export {
  createRecommendation,
  createRecommendationsClient,
  getRecommendation,
  listRecommendations,
  type RecommendationsClientOptions,
} from '${packageName(scope, 'remote-commerce')}/effect/client';
`;
}

function toPascalCase(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function effectApiTopologyMetadata(app: WorkspaceApp): JsonValue | undefined {
  if (!appHasEffectApi(app)) {
    return undefined;
  }

  return {
    effect: {
      runtime: 'effect',
      bff: {
        prefix: app.effectApi.prefix,
        openapi: '/openapi.json',
      },
      contract: {
        export: './shared/effect/api',
        path: `${app.directory}/shared/effect/api.ts`,
      },
      client: {
        export: './effect/client',
        path: `${app.directory}/src/effect/${app.effectApi.stem}-client.ts`,
      },
      serverEntry: `${app.directory}/api/effect/index.ts`,
      basePath: `${app.effectApi.prefix}/effect/${app.effectApi.stem}`,
      consumedBy: app.effectApi.consumedBy,
    },
  };
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
      ...(effectApiTopologyMetadata(remote)
        ? { api: effectApiTopologyMetadata(remote) }
        : {}),
      ownership: remote.ownership,
    })),
    effectServices: [],
    sharedPackages: sharedPackages.map(sharedPackage => ({
      id: sharedPackage.id,
      package: packageName(scope, sharedPackage.id),
      path: sharedPackage.directory,
      description: sharedPackage.description,
    })),
    validation: {
      script: 'scripts/validate-ultramodern-workspace.mjs',
      commands: ['mise exec -- pnpm ultramodern:check'],
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
      [shellApp, ...remoteApps].map(app => [app.id, app.port]),
    ),
    manifests: Object.fromEntries(
      remoteApps.map(remote => [
        remote.id,
        `http://localhost:${remote.port}/mf-manifest.json`,
      ]),
    ),
    apis: Object.fromEntries(
      verticalEffectApps().map(app => [
        app.id,
        `http://localhost:${app.port}${effectApiPrefix(app)}`,
      ]),
    ),
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

function createEffectOperationContract(target: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}): JsonValue {
  const stem = effectApiStem(target);
  return {
    group: serviceEffectGroupName(target),
    notFound: serviceEffectNotFoundErrorExport(target),
    operations: {
      list: {
        method: 'GET',
        path: `/effect/${stem}`,
        source: 'generated-client',
      },
      get: {
        method: 'GET',
        path: `/effect/${stem}/:id`,
        source: 'generated-client',
      },
      create: {
        method: 'POST',
        path: `/effect/${stem}`,
        source: 'generated-client',
      },
    },
  };
}

function createAppConfigContract(app: WorkspaceApp): JsonValue {
  return {
    preset: 'presetUltramodern',
    plugins: [
      'appTools',
      'tanstackRouterPlugin',
      'i18nPlugin',
      ...(appHasEffectApi(app) ? ['bffPlugin'] : []),
      'moduleFederationPlugin',
      'zephyrRspackPlugin',
    ],
    output: {
      disableTsChecker: true,
      distPath: {
        html: './',
      },
      polyfill: 'off',
      splitRouteChunks: false,
    },
    performance: {
      rsdoctor: {
        enabledByEnv: 'ULTRAMODERN_RSDOCTOR=true',
        disableClientServer: true,
      },
    },
    html: {
      outputStructure: 'flat',
    },
    source: {
      mainEntryName: 'index',
      siteUrlGlobal: 'ULTRAMODERN_SITE_URL',
    },
    ...(appHasEffectApi(app)
      ? {
          bff: {
            runtimeFramework: 'effect',
            prefix: app.effectApi.prefix,
            openapi: '/openapi.json',
          },
        }
      : {}),
  };
}

function createStylingContract(enableTailwind: boolean): JsonValue {
  return {
    tailwind: enableTailwind,
    ...(enableTailwind
      ? {
          postcssPlugins: ['@tailwindcss/postcss'],
          contentGlobs: ['./src/**/*.{js,jsx,ts,tsx}'],
        }
      : {}),
  };
}

function createAppGeneratedContract(
  scope: string,
  app: WorkspaceApp,
  apps: WorkspaceApp[],
  enableTailwind: boolean,
): JsonValue {
  const remoteAppsForShell = apps.filter(
    candidate => candidate.kind !== 'shell' && candidate.mfName,
  );

  return {
    id: app.id,
    package: packageName(scope, app.packageSuffix),
    path: app.directory,
    kind: app.kind,
    config: createAppConfigContract(app),
    styling: createStylingContract(enableTailwind),
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
    i18n: {
      plugin: '@modern-js/plugin-i18n',
      backend: true,
      reactI18next: false,
      languages: ['en', 'cs'],
      fallbackLanguage: 'en',
      publicDir: './locales',
    },
    moduleFederation: {
      name: app.mfName,
      ...(app.kind === 'shell'
        ? {
            remotes: remoteAppsForShell.map(remote => ({
              id: remote.id,
              alias: remoteDependencyAlias(remote),
              name: remote.mfName,
              manifestEnv: createRemoteManifestEnv(remote),
              manifestUrl: `http://localhost:${remote.port}/mf-manifest.json`,
            })),
          }
        : {}),
      exposes: Object.keys(app.exposes ?? {}),
      dts: {
        displayErrorInTerminal: true,
        compilerInstance: '--package typescript -- tsc',
      },
      browserSafeExposesOnly: true,
      zephyrRspackPlugin: ZEPHYR_RSPACK_PLUGIN_VERSION,
    },
    marker: {
      appId: app.id,
      packageName: packageName(scope, app.packageSuffix),
      version: '0.1.0',
      build: createBuildMarker(scope, app),
      deployProfile: 'cloudflare-ssr-mf-effect-v1',
      uiSurface: 'ui',
      ...(appHasEffectApi(app) ? { apiSurface: 'effect-bff' } : {}),
    },
    ...(app.domain === 'commerce'
      ? {
          boundaryVisualization: {
            mode: 'overlay',
            layoutAffecting: false,
            toggle: 'user-controlled',
            boundaries: [
              {
                id: 'explore',
                labelKey: 'commerce.boundaries.explore',
                owner: 'team-explore',
                color: '#ff5a57',
                owns: ['header', 'footer', 'recommendations', 'catalog'],
              },
              {
                id: 'decide',
                labelKey: 'commerce.boundaries.decide',
                owner: 'team-decide',
                color: '#24d671',
                owns: ['product-detail', 'variant-selection'],
              },
              {
                id: 'checkout',
                labelKey: 'commerce.boundaries.checkout',
                owner: 'team-checkout',
                color: '#f4d044',
                owns: ['add-to-cart', 'cart-link', 'cart-lines'],
              },
            ],
          },
        }
      : {}),
    ...(appHasEffectApi(app)
      ? {
          effect: {
            runtime: 'effect',
            import: '@modern-js/plugin-bff/effect-edge',
            prefix: app.effectApi.prefix,
            openapi: '/openapi.json',
            workerEntry: 'worker/__modern_bff_effect.js',
            contract: './shared/effect/api',
            client: './effect/client',
            ...createEffectOperationContract(app),
          },
        }
      : {}),
  };
}

function createGeneratedContract(
  scope: string,
  apps: WorkspaceApp[] = [shellApp, ...remoteApps],
  enableTailwind = true,
): JsonValue {
  return {
    schemaVersion: 1,
    profile: 'cloudflare-ssr-mf-effect-v1',
    packageManager: {
      source: 'package.json',
      manager: 'pnpm',
      version: PNPM_VERSION,
      toolchain: 'mise',
      corepack: false,
    },
    versions: {
      typescript: TYPESCRIPT_VERSION,
      typescriptNativePreview: TYPESCRIPT_NATIVE_PREVIEW_VERSION,
      moduleFederation: MODULE_FEDERATION_VERSION,
      tanstackRouter: TANSTACK_ROUTER_VERSION,
      i18next: I18NEXT_VERSION,
      zephyrRspackPlugin: ZEPHYR_RSPACK_PLUGIN_VERSION,
      zephyrAgent: ZEPHYR_AGENT_VERSION,
      wrangler: WRANGLER_VERSION,
    },
    apps: apps.map(app =>
      createAppGeneratedContract(scope, app, apps, enableTailwind),
    ),
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
        '.github/**',
        '.gitignore',
        '.mise.toml',
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
      moduleFederationSource: {
        repository: 'https://github.com/module-federation/agent-skills',
        commit: MODULE_FEDERATION_AGENT_SKILLS_COMMIT,
        install: 'clone',
        baseline: moduleFederationAgentSkills,
      },
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
        'github-workflow-security-enforced',
        'pnpm-11-policy-enforced',
        'template-manifest-retained',
      ],
      expectedCommands: [
        'mise install',
        'mise exec -- pnpm install',
        'mise exec -- pnpm run ultramodern:check',
      ],
    },
  };
}

function writeApp(
  targetDir: string,
  scope: string,
  app: WorkspaceApp,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
) {
  writeJson(
    targetDir,
    `${app.directory}/package.json`,
    createAppPackage(scope, app, packageSource, enableTailwind),
  );
  writeJson(
    targetDir,
    `${app.directory}/tsconfig.json`,
    createPackageTsConfig(app.directory, appHasEffectApi(app)),
  );
  writeFile(
    targetDir,
    `${app.directory}/src/modern-app-env.d.ts`,
    "/// <reference types='@modern-js/app-tools/types' />\n\ndeclare const ULTRAMODERN_SITE_URL: string;\n",
  );
  writeFile(
    targetDir,
    `${app.directory}/src/ultramodern-build.ts`,
    createUltramodernBuildModule(scope, app),
  );
  writeFile(
    targetDir,
    `${app.directory}/modern.config.ts`,
    createAppModernConfig(app),
  );
  writeFile(
    targetDir,
    `${app.directory}/src/modern.runtime.ts`,
    createAppRuntimeConfig(app),
  );
  writeJson(
    targetDir,
    `${app.directory}/locales/en/translation.json`,
    createAppLocaleMessages(app, 'en'),
  );
  writeJson(
    targetDir,
    `${app.directory}/locales/cs/translation.json`,
    createAppLocaleMessages(app, 'cs'),
  );
  writeFile(
    targetDir,
    `${app.directory}/src/routes/index.css`,
    createAppStyles(enableTailwind),
  );
  if (enableTailwind) {
    writeFile(
      targetDir,
      `${app.directory}/postcss.config.mjs`,
      createPostcssConfig(),
    );
    writeFile(
      targetDir,
      `${app.directory}/tailwind.config.ts`,
      createTailwindConfig(),
    );
  }
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

  if (app.kind === 'shell') {
    writeFile(
      targetDir,
      `${app.directory}/src/effect/recommendations-client.ts`,
      createShellEffectClient(scope),
    );
  }

  if (appHasEffectApi(app)) {
    writeFile(
      targetDir,
      `${app.directory}/shared/effect/api.ts`,
      createEffectSharedApi(app),
    );
    writeFile(
      targetDir,
      `${app.directory}/api/effect/index.ts`,
      createEffectServiceEntry(scope, app, '../../shared/effect/api'),
    );
    writeFile(
      targetDir,
      `${app.directory}/src/effect/${app.effectApi.stem}-client.ts`,
      createEffectClient(app, '../../shared/effect/api'),
    );
  }

  if (app.kind === 'vertical' || app.kind === 'horizontal-remote') {
    writeFile(
      targetDir,
      `${app.directory}/src/remote-entry.tsx`,
      createRemoteEntry(app),
    );
    writeFile(
      targetDir,
      `${app.directory}/src/components/${remoteWidgetFile(app)}.tsx`,
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
  enableTailwind: boolean,
  service = effectService,
) {
  writeJson(
    targetDir,
    `${service.directory}/package.json`,
    createServicePackage(scope, packageSource, enableTailwind, service),
  );
  writeJson(
    targetDir,
    `${service.directory}/tsconfig.json`,
    createPackageTsConfig(service.directory, true),
  );
  writeFile(
    targetDir,
    `${service.directory}/src/modern-app-env.d.ts`,
    "/// <reference types='@modern-js/app-tools/types' />\n",
  );
  writeFile(
    targetDir,
    `${service.directory}/src/ultramodern-build.ts`,
    createUltramodernBuildModule(scope, service),
  );
  writeFile(
    targetDir,
    `${service.directory}/src/routes/layout.tsx`,
    createLayout(service.id),
  );
  writeFile(
    targetDir,
    `${service.directory}/src/routes/page.tsx`,
    `export default function ${toPascalCase(service.id)}Home() {
  return <main>${service.id} Effect service</main>;
}
`,
  );
  writeFile(
    targetDir,
    `${service.directory}/src/routes/index.css`,
    createAppStyles(enableTailwind),
  );
  if (enableTailwind) {
    writeFile(
      targetDir,
      `${service.directory}/postcss.config.mjs`,
      createPostcssConfig(),
    );
    writeFile(
      targetDir,
      `${service.directory}/tailwind.config.ts`,
      createTailwindConfig(),
    );
  }
  writeFile(
    targetDir,
    `${service.directory}/modern.config.ts`,
    createServiceModernConfigFor(service),
  );
  writeFile(
    targetDir,
    `${service.directory}/api/effect/index.ts`,
    createEffectServiceEntry(scope, service),
  );
}

function writeGenericSharedPackage(
  targetDir: string,
  scope: string,
  packageSource: ResolvedPackageSource,
  sharedPackage: (typeof sharedPackages)[number],
) {
  writeJson(
    targetDir,
    `${sharedPackage.directory}/package.json`,
    createSharedPackage(
      scope,
      sharedPackage.id,
      sharedPackage.description,
      packageSource,
    ),
  );
  writeJson(targetDir, `${sharedPackage.directory}/tsconfig.json`, {
    extends: `${relativeRootFor(sharedPackage.directory)}/tsconfig.base.json`,
    include: ['src'],
  });
  writeFile(
    targetDir,
    `${sharedPackage.directory}/src/index.ts`,
    `export const packageId = '${sharedPackage.id}';
`,
  );
}

function writeSharedPackages(
  targetDir: string,
  scope: string,
  packageSource: ResolvedPackageSource,
) {
  for (const sharedPackage of sharedPackages) {
    writeJson(
      targetDir,
      `${sharedPackage.directory}/package.json`,
      createSharedPackage(
        scope,
        sharedPackage.id,
        sharedPackage.description,
        packageSource,
      ),
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
    createEffectSharedApi(),
  );
}

function readJsonFile(filePath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJsonFile(filePath: string, value: JsonValue) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function appendEffectSharedApiContract(
  targetDir: string,
  service = effectService,
) {
  const relativePath = 'packages/shared-effect-api/src/index.ts';
  assertSafeRelativePath(relativePath);
  const filePath = path.join(targetDir, relativePath);
  ensureInsideRoot(targetDir, filePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing generated Effect API package: ${relativePath}`);
  }
  const current = fs.readFileSync(filePath, 'utf-8');
  const apiExport = serviceEffectApiExport(service);
  if (current.includes(`export const ${apiExport} =`)) {
    return;
  }
  const contentWithImports = current.includes(
    '@modern-js/plugin-bff/effect-client',
  )
    ? current.trimEnd()
    : `${createEffectSharedApiImports()}\n${current.trimEnd()}`;
  fs.writeFileSync(
    filePath,
    `${contentWithImports}\n\n${createEffectSharedApiContract(service)}`,
    'utf-8',
  );
}

function existingPackageSource(
  workspaceRoot: string,
  modernVersion: string,
  packageSource?: UltramodernWorkspaceOptions['packageSource'],
): ResolvedPackageSource {
  if (packageSource) {
    return resolvePackageSource({
      targetDir: workspaceRoot,
      packageName: path.basename(workspaceRoot),
      modernVersion,
      packageSource,
    });
  }

  const metadataPath = path.join(
    workspaceRoot,
    '.modernjs/ultramodern-package-source.json',
  );
  if (!fs.existsSync(metadataPath)) {
    return resolvePackageSource({
      targetDir: workspaceRoot,
      packageName: path.basename(workspaceRoot),
      modernVersion,
    });
  }

  const metadata = readJsonFile(metadataPath);
  const aliases = metadata.modernPackages?.aliases ?? {};
  const firstAlias = Object.values(aliases).find(
    (value): value is string => typeof value === 'string',
  );
  const firstPackage = Object.keys(aliases)[0];
  const aliasScope = firstAlias?.match(/^@([^/]+)\//)?.[1];
  const unscopedName = firstPackage?.split('/').at(-1) ?? '';
  const aliasUnscopedName = firstAlias?.split('/').at(-1) ?? '';
  const aliasPackageNamePrefix =
    aliasUnscopedName &&
    unscopedName &&
    aliasUnscopedName.endsWith(unscopedName)
      ? aliasUnscopedName.slice(0, -unscopedName.length)
      : undefined;

  return {
    strategy: metadata.strategy === 'install' ? 'install' : 'workspace',
    modernPackageVersion:
      typeof metadata.modernPackages?.specifier === 'string'
        ? metadata.modernPackages.specifier
        : modernVersion,
    registry: metadata.modernPackages?.registry,
    aliasScope,
    aliasPackageNamePrefix,
  };
}

function assertValidMicroVerticalName(name: string): string {
  const normalized = toKebabCase(name);
  if (!normalized || normalized !== name) {
    throw new Error(
      `Invalid MicroVertical name "${name}". Use lowercase kebab-case.`,
    );
  }
  return normalized;
}

function nextAvailablePort(ports: Record<string, unknown>): number {
  const numericPorts = Object.values(ports).filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  return Math.max(3030, ...numericPorts) + 1;
}

function assertCanCreate(workspaceRoot: string, relativePath: string) {
  if (fs.existsSync(path.join(workspaceRoot, relativePath))) {
    throw new Error(`Refusing to overwrite existing path: ${relativePath}`);
  }
}

function addRootDevScript(
  workspaceRoot: string,
  scope: string,
  packageSuffix: string,
  scriptName: string,
) {
  const packagePath = path.join(workspaceRoot, 'package.json');
  const rootPackage = readJsonFile(packagePath);
  rootPackage.scripts ??= {};
  rootPackage.scripts[`dev:${scriptName}`] =
    `pnpm --filter ${packageName(scope, packageSuffix)} dev`;
  if (
    typeof rootPackage.scripts.dev === 'string' &&
    !rootPackage.scripts.dev.includes(packageName(scope, packageSuffix))
  ) {
    const packageFilter = `--filter ${packageName(scope, packageSuffix)}`;
    rootPackage.scripts.dev = rootPackage.scripts.dev.endsWith(' dev')
      ? rootPackage.scripts.dev.replace(/ dev$/u, ` ${packageFilter} dev`)
      : `${rootPackage.scripts.dev} ${packageFilter}`;
  }
  writeJsonFile(packagePath, rootPackage as JsonValue);
}

function addShellZephyrDependency(
  workspaceRoot: string,
  scope: string,
  remote: WorkspaceApp,
) {
  const packagePath = path.join(
    workspaceRoot,
    shellApp.directory,
    'package.json',
  );
  const shellPackage = readJsonFile(packagePath);
  shellPackage['zephyr:dependencies'] ??= {};
  shellPackage['zephyr:dependencies'][remoteDependencyAlias(remote)] =
    zephyrRemoteDependency(scope, remote);
  writeJsonFile(packagePath, shellPackage as JsonValue);
}

function addShellWorkspaceDependency(
  workspaceRoot: string,
  scope: string,
  remote: WorkspaceApp,
) {
  if (!appHasEffectApi(remote)) {
    return;
  }

  const packagePath = path.join(
    workspaceRoot,
    shellApp.directory,
    'package.json',
  );
  const shellPackage = readJsonFile(packagePath);
  shellPackage.dependencies ??= {};
  shellPackage.dependencies[packageName(scope, remote.packageSuffix)] =
    WORKSPACE_PACKAGE_VERSION;
  writeJsonFile(packagePath, shellPackage as JsonValue);
}

function remoteTopologyEntry(scope: string, remote: WorkspaceApp): JsonValue {
  return {
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
    ...(effectApiTopologyMetadata(remote)
      ? { api: effectApiTopologyMetadata(remote) }
      : {}),
    ownership: remote.ownership,
  };
}

function ownershipEntry(
  scope: string,
  owner: {
    id: string;
    packageSuffix: string;
    directory: string;
    ownership: Ownership;
  },
): JsonValue {
  return {
    id: owner.id,
    package: packageName(scope, owner.packageSuffix),
    path: owner.directory,
    ownership: owner.ownership,
  };
}

function remotesFromTopology(
  topology: Record<string, any>,
  ports: Record<string, unknown>,
) {
  return (topology.remotes ?? []).map((remote: any) => {
    const effectApi = remote.api?.effect
      ? ({
          stem:
            typeof remote.api.effect.basePath === 'string'
              ? (remote.api.effect.basePath.split('/').filter(Boolean).at(-1) ??
                remote.domain ??
                String(remote.id).replace(/^remote-/, ''))
              : (remote.domain ?? String(remote.id).replace(/^remote-/, '')),
          prefix:
            remote.api.effect.bff?.prefix ??
            `/${remote.domain ?? String(remote.id).replace(/^remote-/, '')}-api`,
          consumedBy: Array.isArray(remote.api.effect.consumedBy)
            ? remote.api.effect.consumedBy
            : [shellApp.id, remote.id],
        } satisfies WorkspaceEffectApi)
      : undefined;

    return {
      id: remote.id,
      directory: '',
      packageSuffix: remote.package?.split('/').at(-1) ?? remote.id,
      displayName: remote.id,
      kind: remote.kind ?? 'vertical',
      domain: remote.domain ?? String(remote.id).replace(/^remote-/, ''),
      portEnv: '',
      port: typeof ports[remote.id] === 'number' ? ports[remote.id] : 0,
      mfName:
        remote.moduleFederation?.name ?? `remote${toPascalCase(remote.id)}`,
      ...(effectApi ? { effectApi } : {}),
      ownership: remote.ownership ?? createNeutralOwnership(remote.id),
    };
  }) as WorkspaceApp[];
}

export function addUltramodernMicroVertical(
  options: AddUltramodernMicroVerticalOptions,
) {
  const name = assertValidMicroVerticalName(options.name);
  const rootPackage = readJsonFile(
    path.join(options.workspaceRoot, 'package.json'),
  );
  const scope = toPackageScope(
    String(rootPackage.name ?? path.basename(options.workspaceRoot)),
  );
  const topologyPath = path.join(
    options.workspaceRoot,
    'topology/reference-topology.json',
  );
  const ownershipPath = path.join(
    options.workspaceRoot,
    'topology/ownership.json',
  );
  const overlayPath = path.join(
    options.workspaceRoot,
    'topology/local-overlays/development.json',
  );

  for (const requiredPath of [topologyPath, ownershipPath, overlayPath]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Missing UltraModern workspace file: ${requiredPath}`);
    }
  }

  const topology = readJsonFile(topologyPath);
  const ownership = readJsonFile(ownershipPath);
  const overlay = readJsonFile(overlayPath);
  overlay.ports ??= {};
  const packageSource = existingPackageSource(
    options.workspaceRoot,
    options.modernVersion,
    options.packageSource,
  );
  const enableTailwind = options.enableTailwind !== false;
  const port = nextAvailablePort(overlay.ports);

  if (options.kind === 'remote' || options.kind === 'horizontal-remote') {
    const remote = createRemoteDescriptor(name, options.kind, port);
    assertCanCreate(options.workspaceRoot, remote.directory);
    if ((topology.remotes ?? []).some((entry: any) => entry.id === remote.id)) {
      throw new Error(`Topology already contains ${remote.id}`);
    }
    if (Object.values(overlay.ports).includes(remote.port)) {
      throw new Error(`Development port ${remote.port} is already in use`);
    }

    writeApp(
      options.workspaceRoot,
      scope,
      remote,
      packageSource,
      enableTailwind,
    );
    topology.shell ??= {};
    topology.shell.remoteRefs ??= [];
    topology.shell.remoteRefs.push(remote.id);
    topology.shell.moduleFederation ??= {};
    topology.shell.moduleFederation.remotes ??= [];
    topology.shell.moduleFederation.remotes.push({
      id: remote.id,
      name: remote.mfName,
      manifestUrl: `http://localhost:${remote.port}/mf-manifest.json`,
    });
    topology.remotes ??= [];
    topology.remotes.push(remoteTopologyEntry(scope, remote));
    ownership.owners ??= [];
    ownership.owners.push(ownershipEntry(scope, remote));
    overlay.ports[remote.id] = remote.port;
    overlay.manifests ??= {};
    overlay.manifests[remote.id] =
      `http://localhost:${remote.port}/mf-manifest.json`;
    if (appHasEffectApi(remote)) {
      overlay.apis ??= {};
      overlay.apis[remote.id] =
        `http://localhost:${remote.port}${effectApiPrefix(remote)}`;
    }
    writeJsonFile(topologyPath, topology as JsonValue);
    writeJsonFile(ownershipPath, ownership as JsonValue);
    writeJsonFile(overlayPath, overlay as JsonValue);
    writeJsonFile(
      path.join(options.workspaceRoot, GENERATED_CONTRACT_PATH),
      createGeneratedContract(
        scope,
        [shellApp, ...remotesFromTopology(topology, overlay.ports)],
        enableTailwind,
      ),
    );
    const shellConfigPath = path.join(
      options.workspaceRoot,
      `${shellApp.directory}/module-federation.config.ts`,
    );
    writeFileReplacing(
      options.workspaceRoot,
      `${shellApp.directory}/module-federation.config.ts`,
      createShellModuleFederationConfig(
        remotesFromTopology(topology, overlay.ports),
      ),
    );
    if (!fs.existsSync(shellConfigPath)) {
      throw new Error('Shell Module Federation config was not regenerated');
    }
    addShellZephyrDependency(options.workspaceRoot, scope, remote);
    addShellWorkspaceDependency(options.workspaceRoot, scope, remote);
    addRootDevScript(options.workspaceRoot, scope, remote.packageSuffix, name);
    return;
  }

  if (options.kind === 'service') {
    const service = createServiceDescriptor(name, port);
    assertCanCreate(options.workspaceRoot, service.directory);
    if (
      (topology.effectServices ?? []).some(
        (entry: any) => entry.id === service.id,
      )
    ) {
      throw new Error(`Topology already contains ${service.id}`);
    }
    writeEffectService(
      options.workspaceRoot,
      scope,
      packageSource,
      enableTailwind,
      service,
    );
    appendEffectSharedApiContract(options.workspaceRoot, service);
    topology.effectServices ??= [];
    topology.effectServices.push({
      id: service.id,
      kind: 'effect-service',
      runtime: 'effect',
      package: packageName(scope, service.packageSuffix),
      consumedBy: [shellApp.id],
      bff: {
        prefix: serviceApiPrefix(service),
        openapi: '/openapi.json',
      },
      contract: {
        package: packageName(scope, 'shared-effect-api'),
        export: serviceEffectApiExport(service),
        path: 'packages/shared-effect-api/src/index.ts',
      },
      serverEntry: `${service.directory}/api/effect/index.ts`,
      basePath: `${serviceApiPrefix(service)}/effect/${effectApiStem(service)}`,
      ...createEffectOperationContract(service),
      ownership: service.ownership,
    });
    ownership.owners ??= [];
    ownership.owners.push(ownershipEntry(scope, service));
    overlay.ports[service.id] = service.port;
    overlay.services ??= {};
    overlay.services[service.id] =
      `http://localhost:${service.port}${serviceApiPrefix(service)}`;
    writeJsonFile(topologyPath, topology as JsonValue);
    writeJsonFile(ownershipPath, ownership as JsonValue);
    writeJsonFile(overlayPath, overlay as JsonValue);
    addRootDevScript(options.workspaceRoot, scope, service.packageSuffix, name);
    return;
  }

  if (options.kind === 'shared') {
    const sharedPackage = createSharedPackageDescriptor(name);
    assertCanCreate(options.workspaceRoot, sharedPackage.directory);
    if (
      (topology.sharedPackages ?? []).some(
        (entry: any) => entry.id === sharedPackage.id,
      )
    ) {
      throw new Error(`Topology already contains ${sharedPackage.id}`);
    }
    writeGenericSharedPackage(
      options.workspaceRoot,
      scope,
      packageSource,
      sharedPackage,
    );
    topology.sharedPackages ??= [];
    topology.sharedPackages.push({
      id: sharedPackage.id,
      package: packageName(scope, sharedPackage.id),
      path: sharedPackage.directory,
      description: sharedPackage.description,
    });
    ownership.owners ??= [];
    ownership.owners.push(
      ownershipEntry(scope, {
        id: sharedPackage.id,
        packageSuffix: sharedPackage.id,
        directory: sharedPackage.directory,
        ownership: createNeutralOwnership(
          sharedPackage.id,
          'tier-1-shared-contract',
        ),
      }),
    );
    writeJsonFile(topologyPath, topology as JsonValue);
    writeJsonFile(ownershipPath, ownership as JsonValue);
    return;
  }

  throw new Error(`Unsupported MicroVertical kind: ${options.kind}`);
}

export function generateUltramodernWorkspace(
  options: UltramodernWorkspaceOptions,
) {
  const scope = toPackageScope(options.packageName);
  const packageSource = resolvePackageSource(options);
  const enableTailwind = options.enableTailwind !== false;
  fs.mkdirSync(options.targetDir, { recursive: true });

  copyRootTemplate(options.targetDir, {
    packageName: options.packageName,
    packageScope: scope,
    pnpmVersion: PNPM_VERSION,
    tailwindEnabled: String(enableTailwind),
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
  writeJson(
    options.targetDir,
    GENERATED_CONTRACT_PATH,
    createGeneratedContract(scope, [shellApp, ...remoteApps], enableTailwind),
  );

  writeApp(options.targetDir, scope, shellApp, packageSource, enableTailwind);
  for (const remote of remoteApps) {
    writeApp(options.targetDir, scope, remote, packageSource, enableTailwind);
  }
  writeSharedPackages(options.targetDir, scope, packageSource);
}

export const ultramodernWorkspaceVersions = {
  tanstackRouter: TANSTACK_ROUTER_VERSION,
  moduleFederation: MODULE_FEDERATION_VERSION,
  tailwind: TAILWIND_VERSION,
  tailwindPostcss: TAILWIND_POSTCSS_VERSION,
};
