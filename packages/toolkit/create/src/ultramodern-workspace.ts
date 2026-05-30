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
const EFFECT_TSGO_VERSION = '0.13.0';
const TYPESCRIPT_VERSION = '6.0.3';
const TYPESCRIPT_NATIVE_PREVIEW_VERSION = '7.0.0-dev.20260527.2';
const OXLINT_VERSION = '1.66.0';
const OXFMT_VERSION = '0.51.0';
const ULTRACITE_VERSION = '7.7.0';
const LEFTHOOK_VERSION = '^2.1.9';
const I18NEXT_VERSION = '26.2.0';
const REACT_VERSION = '^19.2.6';
const REACT_DOM_VERSION = '^19.2.6';
const REACT_ROUTER_DOM_VERSION = '7.16.0';
const PNPM_VERSION = '11.5.0';
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
  kind: 'shell' | 'vertical' | 'horizontal-design-system';
  domain?: string;
  portEnv: string;
  port: number;
  mfName: string;
  exposes?: Record<string, string>;
  effectApi?: WorkspaceEffectApi;
  verticalRefs?: string[];
  ownership: Ownership;
};

type WorkspaceEffectApi = {
  stem: string;
  prefix: string;
  consumedBy: string[];
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

type SupportedWorkspaceLanguage = 'en' | 'cs';

type RouteOwnedI18nPath = {
  id: string;
  canonicalPath: string;
  localisedPaths: Record<SupportedWorkspaceLanguage, string>;
  titleKey: string;
  ownerAppId: string;
  mfBoundaryId: string;
  namespace: string;
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

export type AddUltramodernVerticalOptions = {
  workspaceRoot: string;
  name: string;
  modernVersion: string;
  enableTailwind?: boolean;
  packageSource?: UltramodernWorkspaceOptions['packageSource'];
};

export const ULTRAMODERN_WORKSPACE_FLAG = '--ultramodern-workspace';

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const shellApp: WorkspaceApp = {
  id: 'shell-super-app',
  directory: 'apps/shell-super-app',
  packageSuffix: 'shell-super-app',
  displayName: 'Shell Super App',
  kind: 'shell',
  portEnv: 'SHELL_SUPER_APP_PORT',
  port: 3020,
  mfName: 'shellSuperApp',
  verticalRefs: ['explore', 'decide', 'checkout'],
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

const verticalApps: WorkspaceApp[] = [
  {
    id: 'explore',
    directory: 'verticals/explore',
    packageSuffix: 'explore',
    displayName: 'Explore Vertical',
    kind: 'vertical',
    domain: 'explore',
    portEnv: 'VERTICAL_EXPLORE_PORT',
    port: 3021,
    mfName: 'verticalExplore',
    exposes: {
      './Footer': './src/components/footer.tsx',
      './Header': './src/components/header.tsx',
      './Recommendations': './src/components/recommendations.tsx',
      './Route': './src/federation-entry.tsx',
      './StorePicker': './src/components/store-picker.tsx',
    },
    effectApi: {
      stem: 'explore',
      prefix: '/explore-api',
      consumedBy: [shellApp.id, 'explore'],
    },
    ownership: {
      team: 'tractor-explore',
      slack: '#tractor-explore',
      pagerDuty: 'pd-tractor-explore',
      runbookRef: 'runbooks/wave2/explore.md',
      adrRef: 'docs/super-app-rfc-adr/wave2/reference-topology.md#explore',
      blastRadius: {
        tier: 'tier-1-tractor-discovery',
        references: [
          'docs/super-app-rfc-adr/wave2/blast-radius.md#explore',
          'docs/super-app-rfc-adr/wave2/rollback.md#explore-lkg',
        ],
      },
    },
  },
  {
    id: 'decide',
    directory: 'verticals/decide',
    packageSuffix: 'decide',
    displayName: 'Decide Vertical',
    kind: 'vertical',
    domain: 'decide',
    portEnv: 'VERTICAL_DECIDE_PORT',
    port: 3022,
    mfName: 'verticalDecide',
    verticalRefs: ['explore', 'checkout'],
    exposes: {
      './ProductPage': './src/components/product-page.tsx',
      './Route': './src/federation-entry.tsx',
    },
    effectApi: {
      stem: 'decide',
      prefix: '/decide-api',
      consumedBy: [shellApp.id, 'decide'],
    },
    ownership: {
      team: 'tractor-decide',
      slack: '#tractor-decide',
      pagerDuty: 'pd-tractor-decide',
      runbookRef: 'runbooks/wave2/decide.md',
      adrRef: 'docs/super-app-rfc-adr/wave2/reference-topology.md#decide',
      blastRadius: {
        tier: 'tier-1-tractor-configuration',
        references: [
          'docs/super-app-rfc-adr/wave2/blast-radius.md#decide',
          'docs/super-app-rfc-adr/wave2/rollback.md#decide-lkg',
        ],
      },
    },
  },
  {
    id: 'checkout',
    directory: 'verticals/checkout',
    packageSuffix: 'checkout',
    displayName: 'Checkout Vertical',
    kind: 'vertical',
    domain: 'checkout',
    portEnv: 'VERTICAL_CHECKOUT_PORT',
    port: 3023,
    mfName: 'verticalCheckout',
    exposes: {
      './AddToCart': './src/components/add-to-cart.tsx',
      './CartPage': './src/components/cart-page.tsx',
      './CheckoutPage': './src/components/checkout-page.tsx',
      './MiniCart': './src/components/mini-cart.tsx',
      './Route': './src/federation-entry.tsx',
      './ThanksPage': './src/components/thanks-page.tsx',
    },
    effectApi: {
      stem: 'checkout',
      prefix: '/checkout-api',
      consumedBy: [shellApp.id, 'checkout'],
    },
    ownership: {
      team: 'tractor-checkout',
      slack: '#tractor-checkout',
      pagerDuty: 'pd-tractor-checkout',
      runbookRef: 'runbooks/wave2/checkout.md',
      adrRef: 'docs/super-app-rfc-adr/wave2/reference-topology.md#checkout',
      blastRadius: {
        tier: 'tier-1-tractor-purchase',
        references: [
          'docs/super-app-rfc-adr/wave2/blast-radius.md#checkout',
          'docs/super-app-rfc-adr/wave2/rollback.md#checkout-lkg',
        ],
      },
    },
  },
];

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
    description: 'Design token placeholders consumed by shell and verticals.',
  },
  {
    id: 'shared-effect-api',
    directory: 'packages/shared-effect-api',
    description: 'Shared Effect API type placeholders for vertical clients.',
  },
];

function createNeutralOwnership(
  id: string,
  tier = 'tier-2-vertical',
): Ownership {
  return {
    team: 'super-app-platform',
    slack: '#super-app-platform',
    pagerDuty: 'pd-super-app-platform',
    runbookRef: `runbooks/verticals/${id}.md`,
    adrRef: `docs/super-app-rfc-adr/verticals.md#${id}`,
    blastRadius: {
      tier,
      references: [`docs/super-app-rfc-adr/blast-radius.md#${id}`],
    },
  };
}

function createVerticalDescriptor(name: string, port: number): WorkspaceApp {
  const domain = toKebabCase(name);
  const id = domain;
  const displayPrefix = toPascalCase(domain).replace(
    /([a-z])([A-Z])/g,
    '$1 $2',
  );
  return {
    id,
    directory: `verticals/${domain}`,
    packageSuffix: domain,
    displayName: `${displayPrefix} Vertical`,
    kind: 'vertical',
    domain,
    portEnv: `VERTICAL_${toEnvSegment(domain)}_PORT`,
    port,
    mfName: `vertical${toPascalCase(domain)}`,
    exposes: {
      './Route': './src/federation-entry.tsx',
      './Widget': `./src/components/${domain}-widget.tsx`,
    },
    effectApi: {
      stem: domain,
      prefix: `/${domain}-api`,
      consumedBy: [shellApp.id, id],
    },
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

function verticalEffectApps(remotes: WorkspaceApp[] = verticalApps) {
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
    'react-router-dom': REACT_ROUTER_DOM_VERSION,
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

  for (const remote of resolveRemoteRefs(app)) {
    dependencies[packageName(scope, remote.packageSuffix)] =
      WORKSPACE_PACKAGE_VERSION;
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
      )} --filter ${packageName(scope, 'explore')} --filter ${packageName(
        scope,
        'decide',
      )} --filter ${packageName(scope, 'checkout')} dev`,
      'dev:shell': `pnpm --filter ${packageName(
        scope,
        shellApp.packageSuffix,
      )} dev`,
      'dev:explore': `pnpm --filter ${packageName(scope, 'explore')} dev`,
      'dev:decide': `pnpm --filter ${packageName(scope, 'decide')} dev`,
      'dev:checkout': `pnpm --filter ${packageName(scope, 'checkout')} dev`,
      build:
        'pnpm -r --filter "./verticals/*" run build && pnpm --filter "./apps/shell-super-app" run build && pnpm ultramodern:assert-mf-types',
      format: 'oxfmt .',
      'format:check': 'oxfmt --check .',
      lint: 'oxlint .',
      'lint:fix': 'oxlint . --fix',
      typecheck: `pnpm -r --filter "@${scope}/*" typecheck`,
      'cloudflare:build':
        'pnpm -r --filter "./verticals/*" run cloudflare:build && pnpm --filter "./apps/shell-super-app" run cloudflare:build && pnpm ultramodern:assert-mf-types',
      'cloudflare:deploy':
        'pnpm -r --filter "./verticals/*" run cloudflare:deploy && pnpm --filter "./apps/shell-super-app" run cloudflare:deploy',
      'cloudflare:proof':
        'node ./scripts/proof-cloudflare-version.mjs --out .codex/reports/cloudflare-version-proof/public-url-proof.json',
      'skills:install': 'node ./scripts/bootstrap-agent-skills.mjs',
      'skills:check': 'node ./scripts/bootstrap-agent-skills.mjs --check',
      'agents:refs:install': 'node ./scripts/setup-agent-reference-repos.mjs',
      'agents:refs:check':
        'node ./scripts/setup-agent-reference-repos.mjs --check',
      'ultramodern:assert-mf-types': 'node ./scripts/assert-mf-types.mjs',
      'ultramodern:check': 'node ./scripts/validate-ultramodern-workspace.mjs',
      postinstall:
        'node ./scripts/bootstrap-agent-skills.mjs && (git rev-parse --is-inside-work-tree >/dev/null 2>&1 && lefthook install || true) && node ./scripts/setup-agent-reference-repos.mjs',
      check:
        'pnpm format:check && pnpm lint && pnpm typecheck && pnpm skills:check && pnpm ultramodern:check',
    },
    engines: {
      node: '>=20',
      pnpm: `>=${PNPM_VERSION} <11.6.0`,
    },
    workspaces: ['apps/*', 'verticals/*', 'packages/*'],
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
      lefthook: LEFTHOOK_VERSION,
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

function resolveRemoteRefs(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = verticalApps,
): WorkspaceApp[] {
  const verticalRefs = app.verticalRefs ?? [];

  return verticalRefs
    .map(remoteRef => remotes.find(remote => remote.id === remoteRef))
    .filter((remote): remote is WorkspaceApp => remote !== undefined);
}

function createModuleFederationRemoteContracts(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = verticalApps,
) {
  return resolveRemoteRefs(app, remotes).map(remote => ({
    id: remote.id,
    alias: remoteDependencyAlias(remote),
    name: remote.mfName,
    manifestEnv: createRemoteManifestEnv(remote),
    manifestUrl: `http://localhost:${remote.port}/mf-manifest.json`,
  }));
}

function createZephyrDependencies(
  scope: string,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = verticalApps,
): JsonValue {
  if (!app.verticalRefs?.length) {
    return {};
  }

  return Object.fromEntries(
    resolveRemoteRefs(app, remotes).map(remote => [
      remoteDependencyAlias(remote),
      zephyrRemoteDependency(scope, remote),
    ]),
  );
}

function createCloudflareWorkerName(scope: string, app: WorkspaceApp): string {
  return toKebabCase(`${scope}-${app.packageSuffix}`).slice(0, 63);
}

function createCloudflarePublicUrlEnv(app: WorkspaceApp): string {
  return `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`;
}

function createCloudflareProofRoute(app: WorkspaceApp): JsonValue {
  if (app.kind === 'shell') {
    return {
      ssr: '/en',
      mfManifest: '/mf-manifest.json',
      locale: `/locales/en/${appI18nNamespace(app)}.json`,
    };
  }

  const languageRoutes = createLocalisedUrlsMap(app);
  const firstCanonicalPath = Object.keys(languageRoutes)[0];
  const localizedPath =
    firstCanonicalPath && isRecord(languageRoutes[firstCanonicalPath])
      ? (languageRoutes[firstCanonicalPath].en as string | undefined)
      : undefined;

  return {
    ssr: localizedPath ?? '/en',
    mfManifest: '/mf-manifest.json',
    locale: `/locales/en/${appI18nNamespace(app)}.json`,
    ...(appHasEffectApi(app)
      ? {
          effectReadiness: `${effectApiPrefix(app)}/effect/${effectApiStem(
            app,
          )}/readiness`,
        }
      : {}),
  };
}

function createCloudflareDeployContract(
  scope: string,
  app: WorkspaceApp,
): JsonValue {
  return {
    target: 'cloudflare',
    workerName: createCloudflareWorkerName(scope, app),
    publicUrlEnv: createCloudflarePublicUrlEnv(app),
    compatibilityFlags: ['nodejs_compat'],
    assetsBinding: 'ASSETS',
    routes: createCloudflareProofRoute(app),
    evidence: {
      proofScript: 'scripts/proof-cloudflare-version.mjs',
      reportDefault:
        '.codex/reports/cloudflare-version-proof/public-url-proof.json',
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
    exclude: ['src/modern-tanstack'],
  };
}

function createAppPackage(
  scope: string,
  app: WorkspaceApp,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
): JsonValue {
  const packageExports: Record<string, JsonValue> = Object.fromEntries(
    Object.entries(app.exposes ?? {}).map(([expose, source]) => [
      expose,
      source,
    ]),
  );
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
      'cloudflare:deploy': 'MODERNJS_DEPLOY=cloudflare modern deploy',
      'cloudflare:preview':
        'MODERNJS_DEPLOY=cloudflare modern build && MODERNJS_DEPLOY=cloudflare modern deploy && wrangler dev --config .output/wrangler.json',
      'cloudflare:proof': `node ${relativeRootFor(
        app.directory,
      )}/scripts/proof-cloudflare-version.mjs --app ${app.id}`,
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
    Object.assign(packageExports, {
      './effect/client': `./src/effect/${app.effectApi.stem}-client.ts`,
      './shared/effect/api': './shared/effect/api.ts',
    });
  } else if (app.kind === 'shell') {
    Object.assign(packageExports, {
      './effect/clients': './src/effect/recommendations-client.ts',
    });
  }

  if (Object.keys(packageExports).length > 0) {
    packageJson.exports = packageExports;
  }

  return packageJson;
}

function createServicePackage(
  scope: string,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
  service: {
    id: string;
    packageSuffix: string;
    directory: string;
  },
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

  if (id === 'shared-design-tokens') {
    packageJson.exports = {
      ...(packageJson.exports as Record<string, JsonValue>),
      './tokens.css': './src/tokens.css',
    };
  }

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

function createAppModernConfig(scope: string, app: WorkspaceApp): string {
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
import { ultramodernLocalisedUrls } from './src/routes/ultramodern-route-metadata';

type ZephyrRspackConfig = Parameters<ReturnType<typeof withZephyrRspack>>[0];

const zephyrEnabled = process.env['ULTRAMODERN_ZEPHYR'] !== 'false';
const cloudflareDeployEnabled =
  process.env['MODERNJS_DEPLOY'] === 'cloudflare';

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
    if (!zephyrEnabled) {
      return;
    }
    api.modifyRspackConfig(config => withZephyrRspack()(config));
  },
});

const appId = '${app.id}';
const cloudflareWorkerName = '${createCloudflareWorkerName(scope, app)}';
const port = Number(process.env['${app.portEnv}'] ?? ${app.port});
const configuredSiteUrl = process.env['MODERN_PUBLIC_SITE_URL']?.trim();
const configuredCloudflareUrl =
  process.env['${createCloudflarePublicUrlEnv(app)}']?.trim();
const siteUrl =
  configuredSiteUrl || configuredCloudflareUrl || \`http://localhost:\${port}\`;

export default defineConfig(
  presetUltramodern(
    {
${bffConfig}      output: {
        assetPrefix: siteUrl,
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
            localisedUrls: ultramodernLocalisedUrls as Record<string, Record<string, string>>,
            ignoreRedirectRoutes: [
              '/@mf-types',
              '/assets',
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
      ...(cloudflareDeployEnabled
        ? {
            deploy: {
              target: 'cloudflare',
              worker: {
                name: cloudflareWorkerName,
                ssr: true,
              },
            },
          }
        : {}),
      server: {
        port,
        publicDir: ['./locales', './assets'],
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
    '@modern-js/plugin-i18n/runtime': {
      requiredVersion: pluginI18nVersion,
      singleton: true,
      treeShaking: false,
    },
    '@modern-js/plugin-tanstack/runtime': {
      requiredVersion: pluginTanstackVersion,
      singleton: true,
      treeShaking: false,
    },
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
  return `VERTICAL_${toEnvSegment(remote.domain ?? remote.id)}_MF_MANIFEST`;
}

function createModuleFederationRemotesConfig(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = verticalApps,
): string {
  const remoteEntries = resolveRemoteRefs(app, remotes)
    .map(remote => {
      const key = remoteDependencyAlias(remote);
      return `    ${key}:
      process.env['${createRemoteManifestEnv(remote)}'] ??
      (process.env['${createCloudflarePublicUrlEnv(remote)}']?.trim()
        ? \`${remote.mfName}@\${process.env['${createCloudflarePublicUrlEnv(remote)}']!.trim().replace(/\\/+$/u, '')}/mf-manifest.json\`
        : undefined) ??
      '${remote.mfName}@http://localhost:${remote.port}/mf-manifest.json',`;
    })
    .join('\n');

  if (!remoteEntries) {
    return '';
  }

  return `  remotes: {
${remoteEntries}
  },
`;
}

function createShellModuleFederationConfig(
  remotes: WorkspaceApp[] = verticalApps,
): string {
  const shellHost = {
    ...shellApp,
    verticalRefs: remotes.map(remote => remote.id),
  };

  return `// @effect-diagnostics nodeBuiltinImport:off processEnv:off
import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const pluginI18nVersion = (require('@modern-js/plugin-i18n/package.json') as { version: string }).version;
const pluginTanstackVersion = (require('@modern-js/plugin-tanstack/package.json') as { version: string }).version;
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
${createModuleFederationRemotesConfig(shellHost, remotes)}${createSharedModuleFederationConfig()},
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

function createRemoteModuleFederationConfig(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = verticalApps,
): string {
  const exposes = formatTsObjectLiteral(app.exposes ?? {});
  return `// @effect-diagnostics nodeBuiltinImport:off
import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const pluginI18nVersion = (require('@modern-js/plugin-i18n/package.json') as { version: string }).version;
const pluginTanstackVersion = (require('@modern-js/plugin-tanstack/package.json') as { version: string }).version;
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
${createModuleFederationRemotesConfig(app, remotes)}${createSharedModuleFederationConfig()},
});
`;
}

function remoteWidgetFile(app: WorkspaceApp): string {
  return `${app.domain ?? app.id.replace(/^remote-/, '')}-widget`;
}

function appI18nNamespace(app: WorkspaceApp): string {
  return app.kind === 'shell' ? 'shell' : (app.domain ?? app.id);
}

function createRouteOwnedI18nPaths(app: WorkspaceApp): RouteOwnedI18nPath[] {
  const namespace = appI18nNamespace(app);
  const base = {
    mfBoundaryId: app.mfName,
    namespace,
    ownerAppId: app.id,
  };

  if (app.kind === 'shell') {
    return [
      {
        ...base,
        canonicalPath: '/',
        id: 'shell-home',
        localisedPaths: {
          cs: '/',
          en: '/',
        },
        titleKey: 'shell.title',
      },
      {
        ...base,
        canonicalPath: '/tractors',
        id: 'shell-tractors',
        localisedPaths: {
          cs: '/traktory',
          en: '/tractors',
        },
        titleKey: 'shell.routes.listing',
      },
      {
        ...base,
        canonicalPath: '/stores',
        id: 'shell-stores',
        localisedPaths: {
          cs: '/prodejci',
          en: '/stores',
        },
        titleKey: 'shell.routes.storePicker',
      },
      {
        ...base,
        canonicalPath: '/tractors/:slug',
        id: 'shell-product-detail',
        localisedPaths: {
          cs: '/traktory/:slug',
          en: '/tractors/:slug',
        },
        titleKey: 'shell.routes.productDetail',
      },
      {
        ...base,
        canonicalPath: '/cart',
        id: 'shell-cart',
        localisedPaths: {
          cs: '/kosik',
          en: '/cart',
        },
        titleKey: 'shell.routes.cart',
      },
    ];
  }

  if (app.domain === 'explore') {
    return [
      {
        ...base,
        canonicalPath: '/',
        id: 'explore-home',
        localisedPaths: {
          cs: '/',
          en: '/',
        },
        titleKey: 'explore.title',
      },
      {
        ...base,
        canonicalPath: '/tractors',
        id: 'explore-listing',
        localisedPaths: {
          cs: '/traktory',
          en: '/tractors',
        },
        titleKey: 'explore.routes.listing',
      },
      {
        ...base,
        canonicalPath: '/stores',
        id: 'explore-store-picker',
        localisedPaths: {
          cs: '/prodejci',
          en: '/stores',
        },
        titleKey: 'explore.routes.storePicker',
      },
      {
        ...base,
        canonicalPath: '/unavailable',
        id: 'explore-unavailable',
        localisedPaths: {
          cs: '/nedostupne',
          en: '/unavailable',
        },
        titleKey: 'explore.routes.unavailable',
      },
    ];
  }

  if (app.domain === 'decide') {
    return [
      {
        ...base,
        canonicalPath: '/',
        id: 'decide-home',
        localisedPaths: {
          cs: '/',
          en: '/',
        },
        titleKey: 'decide.title',
      },
      {
        ...base,
        canonicalPath: '/tractors',
        id: 'decide-listing-parent',
        localisedPaths: {
          cs: '/traktory',
          en: '/tractors',
        },
        titleKey: 'decide.routes.listing',
      },
      {
        ...base,
        canonicalPath: '/tractors/:slug',
        id: 'decide-product-detail',
        localisedPaths: {
          cs: '/traktory/:slug',
          en: '/tractors/:slug',
        },
        titleKey: 'decide.routes.productDetail',
      },
      {
        ...base,
        canonicalPath: '/unavailable',
        id: 'decide-unavailable',
        localisedPaths: {
          cs: '/nedostupne',
          en: '/unavailable',
        },
        titleKey: 'decide.routes.unavailable',
      },
    ];
  }

  if (app.domain === 'checkout') {
    return [
      {
        ...base,
        canonicalPath: '/',
        id: 'checkout-home',
        localisedPaths: {
          cs: '/',
          en: '/',
        },
        titleKey: 'checkout.title',
      },
      {
        ...base,
        canonicalPath: '/cart',
        id: 'checkout-cart',
        localisedPaths: {
          cs: '/kosik',
          en: '/cart',
        },
        titleKey: 'checkout.routes.cart',
      },
      {
        ...base,
        canonicalPath: '/checkout',
        id: 'checkout-start',
        localisedPaths: {
          cs: '/pokladna',
          en: '/checkout',
        },
        titleKey: 'checkout.routes.checkout',
      },
      {
        ...base,
        canonicalPath: '/checkout/thank-you',
        id: 'checkout-thank-you-parent',
        localisedPaths: {
          cs: '/pokladna/dekujeme',
          en: '/checkout/thank-you',
        },
        titleKey: 'checkout.routes.thankYou',
      },
      {
        ...base,
        canonicalPath: '/checkout/thank-you/:orderId?',
        id: 'checkout-thank-you',
        localisedPaths: {
          cs: '/pokladna/dekujeme/:orderId?',
          en: '/checkout/thank-you/:orderId?',
        },
        titleKey: 'checkout.routes.thankYou',
      },
      {
        ...base,
        canonicalPath: '/unavailable',
        id: 'checkout-unavailable',
        localisedPaths: {
          cs: '/nedostupne',
          en: '/unavailable',
        },
        titleKey: 'checkout.routes.unavailable',
      },
    ];
  }

  return [
    {
      ...base,
      canonicalPath: '/',
      id: `${app.id}-home`,
      localisedPaths: {
        cs: '/',
        en: '/',
      },
      titleKey: `${namespace}.title`,
    },
  ];
}

function createLocalisedUrlsMap(app: WorkspaceApp): Record<string, JsonValue> {
  return Object.fromEntries(
    createRouteOwnedI18nPaths(app).flatMap(route => {
      if (route.canonicalPath === '/') {
        return [];
      }

      return Array.from(
        new Set([route.canonicalPath, ...Object.values(route.localisedPaths)]),
      ).map(pathname => [pathname, route.localisedPaths] as const);
    }),
  );
}

function createRouteMetadataModule(app: WorkspaceApp): string {
  const routes = createRouteOwnedI18nPaths(app);
  const localisedUrls = createLocalisedUrlsMap(app);
  const namespace = appI18nNamespace(app);

  return `export const ultramodernRouteNamespace = '${namespace}' as const;

export const ultramodernRouteMetadata = ${JSON.stringify(routes, null, 2)} as const;

export const ultramodernLocalisedUrls = ${JSON.stringify(localisedUrls, null, 2)} as const;

export const ultramodernRouteConfig = {
  source: 'route-owned',
  namespace: ultramodernRouteNamespace,
  localisedUrls: ultramodernLocalisedUrls,
  routes: ultramodernRouteMetadata,
} as const;
`;
}

function routeSegmentToDirectory(segment: string): string {
  if (segment.startsWith(':')) {
    const name = segment.slice(1).replace(/\?$/u, '');
    return segment.endsWith('?') ? `[${name}$]` : `[${name}]`;
  }

  return segment;
}

function createRoutePageFilePath(app: WorkspaceApp, canonicalPath: string) {
  const segments = canonicalPath
    .split('/')
    .filter(Boolean)
    .map(routeSegmentToDirectory);

  return `${app.directory}/src/routes/[lang]/${[...segments, 'page.tsx'].join(
    '/',
  )}`;
}

function createRouteAliasPage(canonicalPath: string): string {
  const depth = canonicalPath.split('/').filter(Boolean).length;
  const rootPageImport = `${'../'.repeat(depth)}page`;

  return `export { default } from '${rootPageImport}';
`;
}

function createAppEnvDts(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = verticalApps,
): string {
  const remoteModuleDeclarations = resolveRemoteRefs(app, remotes)
    .flatMap(remote =>
      Object.keys(remote.exposes ?? {})
        .filter(expose => expose !== './Route')
        .map(expose => {
          const moduleName = `${remoteDependencyAlias(remote)}/${expose.replace(
            /^\.\//u,
            '',
          )}`;
          return `declare module '${moduleName}' {
  const Component: import('react').ComponentType<Record<string, never>>;
  export default Component;
}
`;
        }),
    )
    .join('\n');

  return `/// <reference types='@modern-js/app-tools/types' />

declare const ULTRAMODERN_SITE_URL: string;
declare module '*.svg' {
  const url: string;
  export default url;
}
${remoteModuleDeclarations ? `\n${remoteModuleDeclarations}` : ''}`;
}

function createServiceModernConfigFor(service): string {
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
  const namespace = appI18nNamespace(app);
  const localeMessages = (language: 'en' | 'cs') => {
    if (app.kind !== 'shell') {
      return createAppLocaleMessages(app, language);
    }

    return Object.assign(
      {},
      createAppLocaleMessages(app, language),
      ...verticalApps.map(remote => createAppLocaleMessages(remote, language)),
    );
  };
  const resources = {
    cs: {
      [namespace]: localeMessages('cs'),
      translation: localeMessages('cs'),
    },
    en: {
      [namespace]: localeMessages('en'),
      translation: localeMessages('en'),
    },
  };

  return `import { defineRuntimeConfig } from '@modern-js/runtime';
import { createInstance } from 'i18next';
import { ultramodernRouteNamespace } from './routes/ultramodern-route-metadata';

const i18nInstance = createInstance();

export default defineRuntimeConfig({
  i18n: {
    i18nInstance,
    initOptions: {
      defaultNS: ultramodernRouteNamespace,
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
      ns: [ultramodernRouteNamespace, 'translation'],
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

function createCssTokenImport(scope: string): string {
  return `@import '${packageName(scope, 'shared-design-tokens')}/tokens.css';\n`;
}

function createTailwindPrefix(raw: string): string {
  const prefix = raw.toLowerCase().replace(/[^a-z]/gu, '');

  if (!prefix) {
    throw new Error(`Cannot derive a Tailwind prefix from ${raw}`);
  }

  return prefix;
}

function tailwindPrefixForApp(app: WorkspaceApp): string {
  if (app.kind === 'shell') {
    return 'shell';
  }

  return createTailwindPrefix(app.domain ?? app.id);
}

function tailwindPrefixForService(service: { id: string }): string {
  return createTailwindPrefix(service.id);
}

function assertUniqueTailwindPrefixes(
  apps: WorkspaceApp[],
  services: Array<{ id: string }> = [],
) {
  const seen = new Map<string, string>();
  const entries = [
    ...apps.map(app => [app.id, tailwindPrefixForApp(app)] as const),
    ...services.map(
      service => [service.id, tailwindPrefixForService(service)] as const,
    ),
  ];

  for (const [id, prefix] of entries) {
    const previous = seen.get(prefix);
    if (previous) {
      throw new Error(
        `Tailwind prefix ${prefix} for ${id} collides with ${previous}`,
      );
    }
    seen.set(prefix, id);
  }
}

function createTailwindImport(prefix: string): string {
  return `@import 'tailwindcss' prefix(${prefix}) source(none);\n@source '..';\n`;
}

function createShellStyles(enableTailwind: boolean, scope: string): string {
  return `${enableTailwind ? createTailwindImport(tailwindPrefixForApp(shellApp)) : ''}${createCssTokenImport(
    scope,
  )}`;
}

function createRemoteStyles(
  enableTailwind: boolean,
  scope: string,
  app: WorkspaceApp,
): string {
  return `${enableTailwind ? createTailwindImport(tailwindPrefixForApp(app)) : ''}${createCssTokenImport(
    scope,
  )}`;
}

function createServiceStyles(
  enableTailwind: boolean,
  scope: string,
  service: { id: string },
): string {
  return `${enableTailwind ? createTailwindImport(tailwindPrefixForService(service)) : ''}${createCssTokenImport(
    scope,
  )}`;
}

function createAppStyles(
  enableTailwind: boolean,
  scope: string,
  app: WorkspaceApp,
): string {
  return app.kind === 'shell'
    ? createShellStyles(enableTailwind, scope)
    : createRemoteStyles(enableTailwind, scope, app);
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
} satisfies Config;
`;
}

function createTw(prefix: string) {
  return (classList: string) =>
    classList
      .split(/\s+/u)
      .filter(Boolean)
      .map(candidate => `${prefix}:${candidate.replace(/\[&&\]:/gu, '')}`)
      .join(' ');
}

function createCommerceAssetSvg(
  title: string,
  palette: { accent: string; ground: string; sky: string; tractor: string },
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${palette.sky}"/>
      <stop offset="1" stop-color="#fff8dc"/>
    </linearGradient>
    <linearGradient id="field" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${palette.ground}"/>
      <stop offset="1" stop-color="${palette.accent}"/>
    </linearGradient>
  </defs>
  <rect width="1440" height="900" fill="url(#sky)"/>
  <path d="M0 566c172-78 330-102 474-72 125 26 219 91 340 106 170 21 339-74 626-43v343H0z" fill="url(#field)"/>
  <path d="M0 686c205-70 451-66 738 12 287 77 521 66 702-33v235H0z" fill="#4f7f38" opacity=".55"/>
  <g fill="none" stroke="#fff6b7" stroke-linecap="round" stroke-width="10" opacity=".55">
    <path d="M108 820c205-138 382-202 530-192"/>
    <path d="M322 862c176-134 338-198 486-193"/>
    <path d="M583 886c119-121 260-190 422-207"/>
    <path d="M868 878c95-94 207-153 336-176"/>
  </g>
  <g transform="translate(430 430)">
    <circle cx="170" cy="210" r="92" fill="#161616"/>
    <circle cx="170" cy="210" r="54" fill="#d7c46d"/>
    <circle cx="514" cy="214" r="108" fill="#161616"/>
    <circle cx="514" cy="214" r="63" fill="#d7c46d"/>
    <path d="M194 142h194l72-100h114c49 0 89 39 89 88v57H625l-51-90H452l-78 114H209z" fill="${palette.tractor}"/>
    <path d="M283 67h134l-54 73H249z" fill="#c9ecff" opacity=".72"/>
    <path d="M120 184h430v54H120z" fill="${palette.tractor}"/>
    <path d="M578 52l60-35M618 37l34 72" stroke="#171717" stroke-linecap="round" stroke-width="14"/>
    <path d="M90 236h578" stroke="#171717" stroke-linecap="round" stroke-width="18"/>
  </g>
</svg>
`;
}

const commerceAssetPublicRoot = 'assets/ultramodern';

function commerceAssetPublicPath(filename: string): string {
  return `${commerceAssetPublicRoot}/${filename}`;
}

function commerceAssetUrl(filename: string): string {
  return `/${commerceAssetPublicRoot}/${filename}`;
}

function commerceAssetsForApp(app: WorkspaceApp): Record<string, string> {
  if (app.kind === 'shell') {
    return {
      [commerceAssetPublicPath('hero-field.svg')]: createCommerceAssetSvg(
        'Tractor crossing cultivated fields',
        {
          accent: '#d6b85d',
          ground: '#84ad58',
          sky: '#9fd6e8',
          tractor: '#005f73',
        },
      ),
      [commerceAssetPublicPath('autonomy.svg')]: createCommerceAssetSvg(
        'Autonomous tractor concept',
        {
          accent: '#c26a2e',
          ground: '#668f55',
          sky: '#d5e7de',
          tractor: '#f2a51a',
        },
      ),
      [commerceAssetPublicPath('field-loader.svg')]: createCommerceAssetSvg(
        'Field Loader 112 tractor',
        {
          accent: '#d6b85d',
          ground: '#84ad58',
          sky: '#9fd6e8',
          tractor: '#00624b',
        },
      ),
      [commerceAssetPublicPath('orchard.svg')]: createCommerceAssetSvg(
        'Orchard tractor between tight rows',
        {
          accent: '#b45b2d',
          ground: '#6f9b4a',
          sky: '#c9ebff',
          tractor: '#1d5d9b',
        },
      ),
      [commerceAssetPublicPath('vineyard.svg')]: createCommerceAssetSvg(
        'Vineyard narrow tractor',
        {
          accent: '#b88d58',
          ground: '#5e8a45',
          sky: '#f1dcb9',
          tractor: '#914d76',
        },
      ),
    };
  }

  if (app.id === 'explore') {
    return {
      [commerceAssetPublicPath('autonomy.svg')]: createCommerceAssetSvg(
        'Autonomous tractor concept',
        {
          accent: '#c26a2e',
          ground: '#668f55',
          sky: '#d5e7de',
          tractor: '#f2a51a',
        },
      ),
      [commerceAssetPublicPath('field-loader.svg')]: createCommerceAssetSvg(
        'Field Loader 112 tractor',
        {
          accent: '#d6b85d',
          ground: '#84ad58',
          sky: '#9fd6e8',
          tractor: '#00624b',
        },
      ),
      [commerceAssetPublicPath('orchard.svg')]: createCommerceAssetSvg(
        'Orchard tractor between tight rows',
        {
          accent: '#b45b2d',
          ground: '#6f9b4a',
          sky: '#c9ebff',
          tractor: '#1d5d9b',
        },
      ),
      [commerceAssetPublicPath('vineyard.svg')]: createCommerceAssetSvg(
        'Vineyard narrow tractor',
        {
          accent: '#b88d58',
          ground: '#5e8a45',
          sky: '#f1dcb9',
          tractor: '#914d76',
        },
      ),
    };
  }

  if (app.id === 'decide') {
    return {
      [commerceAssetPublicPath('field-loader.svg')]: createCommerceAssetSvg(
        'Field Loader 112 tractor detail',
        {
          accent: '#d6b85d',
          ground: '#84ad58',
          sky: '#9fd6e8',
          tractor: '#00624b',
        },
      ),
    };
  }

  return {};
}

function createLocalizedHeadComponent(): string {
  return `const fallbackLanguage = 'en';
const supportedLanguages = ['en', 'cs'] as const;
type SupportedLanguage = (typeof supportedLanguages)[number];

const localisedUrls = ultramodernLocalisedUrls as Record<
  string,
  Record<SupportedLanguage, string>
>;

const isSupportedLanguage = (value: string): value is SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage);

const normalisePath = (pathname: string) => {
  const normalised = pathname.replace(/\\/+$/u, '').replace(/\\/+/gu, '/');
  return normalised.length > 0 ? normalised : '/';
};

const stripLanguagePrefix = (pathname: string) => {
  const segments = normalisePath(pathname).split('/').filter(Boolean);
  if (segments.length > 0 && isSupportedLanguage(segments[0] ?? '')) {
    segments.shift();
  }
  return \`/\${segments.join('/')}\`;
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');

const paramName = (segment: string) => segment.slice(1).replace(/\\?$/u, '');

const matchPattern = (pathname: string, pattern: string) => {
  const names: string[] = [];
  const source = normalisePath(pattern)
    .split('/')
    .filter(Boolean)
    .map(segment => {
      if (segment.startsWith(':')) {
        names.push(paramName(segment));
        return segment.endsWith('?') ? '(?:/([^/]+))?' : '/([^/]+)';
      }
      return \`/\${escapeRegExp(segment)}\`;
    })
    .join('');
  const match = new RegExp(\`^\${source || '/'}$\`).exec(normalisePath(pathname));

  if (!match) {
    return undefined;
  }

  return names.reduce<Record<string, string>>((params, name, index) => {
    params[name] = decodeURIComponent(match[index + 1] ?? '');
    return params;
  }, {});
};

const buildPath = (pattern: string, params: Record<string, string>) => {
  const path = normalisePath(pattern)
    .split('/')
    .filter(Boolean)
    .map(segment => {
      if (!segment.startsWith(':')) {
        return segment;
      }
      const value = params[paramName(segment)];
      return value ? encodeURIComponent(value) : '';
    })
    .filter(Boolean)
    .join('/');

  return \`/\${path}\`;
};

const resolveLocalisedPath = (
  pathname: string,
  targetLanguage: SupportedLanguage,
) => {
  const pathWithoutLanguage = stripLanguagePrefix(pathname);

  for (const entry of Object.values(localisedUrls)) {
    const targetPattern = entry[targetLanguage];
    if (!targetPattern) {
      continue;
    }

    for (const language of supportedLanguages) {
      const sourcePattern = entry[language];
      const params = sourcePattern
        ? matchPattern(pathWithoutLanguage, sourcePattern)
        : undefined;
      if (params) {
        return buildPath(targetPattern, params);
      }
    }
  }

  return pathWithoutLanguage;
};

const localizedPath = (pathname: string, language: SupportedLanguage) => {
  const pathWithoutLanguage = resolveLocalisedPath(pathname, language);
  return pathWithoutLanguage === '/' ? \`/\${language}\` : \`/\${language}\${pathWithoutLanguage}\`;
};

const absoluteUrl = (pathname: string) => {
  const origin = ULTRAMODERN_SITE_URL.replace(/\\/+$/u, '');
  return \`\${origin}\${pathname}\`;
};

const locationSuffix = (location: {
  hash?: unknown;
  search?: unknown;
  searchStr?: unknown;
}) => {
  const locationSearch =
    typeof location.searchStr === 'string'
      ? location.searchStr
      : typeof location.search === 'string'
        ? location.search
        : '';
  const locationHash = typeof location.hash === 'string' ? location.hash : '';

  return \`\${locationSearch}\${locationHash}\`;
};

const LocalizedHead = () => {
  const location = useLocation();
  const canonicalPath = localizedPath(location.pathname, fallbackLanguage);

  return (
    <Helmet>
      <link rel="canonical" href={absoluteUrl(canonicalPath)} />
      {supportedLanguages.map(code => (
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
  const tw = createTw(tailwindPrefixForApp(shellApp));

  return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { Helmet } from '@modern-js/runtime/head';
import { useLocation } from '@modern-js/plugin-tanstack/runtime';
import ShellFrame from '../shell-frame';
import { StorePicker } from '../vertical-components';
import { ultramodernLocalisedUrls } from '../ultramodern-route-metadata';
import { ultramodernUiMarker } from '../../ultramodern-build';

const heroField = '${commerceAssetUrl('hero-field.svg')}';

${createLocalizedHeadComponent()}
export default function ShellHome() {
  const { i18nInstance, language } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <ShellFrame>
      <LocalizedHead />
      <section className="${tw('mx-auto grid max-w-7xl items-center gap-8 py-8 md:grid-cols-[0.9fr_1.1fr] lg:gap-14')}">
        <div className="${tw('min-w-0')}">
          <p className="${tw('text-xs font-black uppercase tracking-[0.18em] text-emerald-800')}">{t('shell.hero.eyebrow')}</p>
          <h1 className="${tw('mt-3 max-w-3xl text-5xl font-black leading-none tracking-normal text-stone-950 md:text-7xl')}">{t('shell.title')}</h1>
          <p className="${tw('mt-5 max-w-2xl text-lg leading-8 text-stone-600')}">{t('shell.hero.lede')}</p>
          <div className="${tw('mt-7 flex flex-wrap gap-3')}">
            <a className="${tw('inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-800 px-5 font-bold text-white shadow-lg shadow-stone-900/10')}" href={\`/\${language}/tractors/field-loader-112\`}>
            {t('shell.hero.primary')}
            </a>
            <a className="${tw('inline-flex min-h-11 items-center justify-center rounded-full border border-stone-900/15 bg-white/90 px-5 font-bold text-stone-950 shadow-lg shadow-stone-900/10')}" href={\`/\${language}/tractors\`}>
            {t('shell.hero.secondary')}
            </a>
          </div>
        </div>
        <img alt="" className="${tw('aspect-[16/10] w-full rounded-3xl bg-stone-200 object-cover shadow-2xl shadow-stone-900/20')}" src={heroField} />
      </section>
      <StorePicker />
      <p className="${tw('sr-only')}" data-testid="ultramodern-preset">presetUltramodern workspace</p>
      <p className="${tw('sr-only')}" data-build-marker={ultramodernUiMarker.build} data-testid="ultramodern-ui-marker">
        {ultramodernUiMarker.appId}:{ultramodernUiMarker.version}
      </p>
    </ShellFrame>
  );
}
`;
}

function createShellTractorsPage(): string {
  return `import { Helmet } from '@modern-js/runtime/head';
import { useLocation } from '@modern-js/plugin-tanstack/runtime';
import ShellFrame from '../../shell-frame';
import { Recommendations } from '../../vertical-components';
import { ultramodernLocalisedUrls } from '../../ultramodern-route-metadata';

${createLocalizedHeadComponent()}
export default function ShellTractorsPage() {
  return (
    <ShellFrame>
      <LocalizedHead />
      <Recommendations />
    </ShellFrame>
  );
}
`;
}

function createShellStoresPage(): string {
  return `import { Helmet } from '@modern-js/runtime/head';
import { useLocation } from '@modern-js/plugin-tanstack/runtime';
import ShellFrame from '../../shell-frame';
import { StorePicker } from '../../vertical-components';
import { ultramodernLocalisedUrls } from '../../ultramodern-route-metadata';

${createLocalizedHeadComponent()}
export default function ShellStoresPage() {
  return (
    <ShellFrame>
      <LocalizedHead />
      <StorePicker />
    </ShellFrame>
  );
}
`;
}

function createShellProductPage(): string {
  return `import { Helmet } from '@modern-js/runtime/head';
import { useLocation } from '@modern-js/plugin-tanstack/runtime';
import ShellFrame from '../../../shell-frame';
import { ProductPage } from '../../../vertical-components';
import { ultramodernLocalisedUrls } from '../../../ultramodern-route-metadata';

${createLocalizedHeadComponent()}
export default function ShellProductPage() {
  return (
    <ShellFrame boundary="decide">
      <LocalizedHead />
      <ProductPage />
    </ShellFrame>
  );
}
`;
}

function createShellCartPage(): string {
  return `import { Helmet } from '@modern-js/runtime/head';
import { useLocation } from '@modern-js/plugin-tanstack/runtime';
import ShellFrame from '../../shell-frame';
import { CartPage } from '../../vertical-components';
import { ultramodernLocalisedUrls } from '../../ultramodern-route-metadata';

${createLocalizedHeadComponent()}
export default function ShellCartPage() {
  return (
    <ShellFrame boundary="checkout" showCart={false}>
      <LocalizedHead />
      <CartPage />
    </ShellFrame>
  );
}
`;
}

function createShellFrameComponent(): string {
  const tw = createTw(tailwindPrefixForApp(shellApp));

  return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useLocation } from '@modern-js/plugin-tanstack/runtime';
import type { ReactNode } from 'react';
import BoundaryOverlay from './boundary-overlay';
import { Header, MiniCart } from './vertical-components';
import { ultramodernLocalisedUrls } from './ultramodern-route-metadata';

const supportedLanguages = ['en', 'cs'] as const;
type SupportedLanguage = (typeof supportedLanguages)[number];

type ShellFrameProps = {
  boundary?: 'checkout' | 'decide' | 'explore';
  children: ReactNode;
  showCart?: boolean;
};

const localisedUrls = ultramodernLocalisedUrls as Record<
  string,
  Record<SupportedLanguage, string>
>;

const isSupportedLanguage = (value: string): value is SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage);

const normalisePath = (pathname: string) => {
  const normalised = pathname.replace(/\\/+$/u, '').replace(/\\/+/gu, '/');
  return normalised.length > 0 ? normalised : '/';
};

const stripLanguagePrefix = (pathname: string) => {
  const segments = normalisePath(pathname).split('/').filter(Boolean);
  if (segments.length > 0 && isSupportedLanguage(segments[0] ?? '')) {
    segments.shift();
  }
  return \`/\${segments.join('/')}\`;
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');

const paramName = (segment: string) => segment.slice(1).replace(/\\?$/u, '');

const matchPattern = (pathname: string, pattern: string) => {
  const names: string[] = [];
  const source = normalisePath(pattern)
    .split('/')
    .filter(Boolean)
    .map(segment => {
      if (segment.startsWith(':')) {
        names.push(paramName(segment));
        return segment.endsWith('?') ? '(?:/([^/]+))?' : '/([^/]+)';
      }
      return \`/\${escapeRegExp(segment)}\`;
    })
    .join('');
  const match = new RegExp(\`^\${source || '/'}$\`).exec(normalisePath(pathname));

  if (!match) {
    return undefined;
  }

  return names.reduce<Record<string, string>>((params, name, index) => {
    params[name] = decodeURIComponent(match[index + 1] ?? '');
    return params;
  }, {});
};

const buildPath = (pattern: string, params: Record<string, string>) => {
  const path = normalisePath(pattern)
    .split('/')
    .filter(Boolean)
    .map(segment => {
      if (!segment.startsWith(':')) {
        return segment;
      }
      const value = params[paramName(segment)];
      return value ? encodeURIComponent(value) : '';
    })
    .filter(Boolean)
    .join('/');

  return \`/\${path}\`;
};

const resolveLocalisedPath = (
  pathname: string,
  targetLanguage: SupportedLanguage,
) => {
  const pathWithoutLanguage = stripLanguagePrefix(pathname);

  for (const entry of Object.values(localisedUrls)) {
    const targetPattern = entry[targetLanguage];
    if (!targetPattern) {
      continue;
    }

    for (const language of supportedLanguages) {
      const sourcePattern = entry[language];
      const params = sourcePattern
        ? matchPattern(pathWithoutLanguage, sourcePattern)
        : undefined;
      if (params) {
        return buildPath(targetPattern, params);
      }
    }
  }

  return pathWithoutLanguage;
};

const localizedPath = (pathname: string, language: SupportedLanguage) => {
  const pathWithoutLanguage = resolveLocalisedPath(pathname, language);
  return pathWithoutLanguage === '/' ? \`/\${language}\` : \`/\${language}\${pathWithoutLanguage}\`;
};

const locationSuffix = (location: {
  hash?: unknown;
  search?: unknown;
  searchStr?: unknown;
}) => {
  const locationSearch =
    typeof location.searchStr === 'string'
      ? location.searchStr
      : typeof location.search === 'string'
        ? location.search
        : '';
  const locationHash = typeof location.hash === 'string' ? location.hash : '';

  return \`\${locationSearch}\${locationHash}\`;
};

export default function ShellFrame({ boundary = 'explore', children, showCart = true }: ShellFrameProps) {
  const { i18nInstance, language } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);
  const location = useLocation();
  const suffix = locationSuffix(location);

  return (
    <main className="${tw('min-h-screen bg-um-canvas px-4 py-5 text-um-foreground sm:px-6 lg:px-12')}" data-mf-page-boundary={boundary}>
      <div className="${tw('mx-auto flex min-h-20 max-w-7xl flex-col items-start gap-3 bg-white/90 px-4 py-3 shadow-xl shadow-stone-900/10 sm:px-6 md:flex-row md:flex-wrap md:items-center md:justify-between')}">
        <Header />
        <div className="${tw('flex min-w-0 flex-wrap items-center gap-2 md:ml-auto')}">
          <label className="${tw('sr-only')}" htmlFor="ultramodern-language">
            {t('shell.language.switcher')}
          </label>
          <select
            aria-label={t('shell.language.switcher')}
            className="${tw('h-10 w-10 cursor-pointer appearance-none border-0 bg-transparent p-0 text-center text-3xl font-black leading-none text-stone-950 shadow-none [appearance:none] [text-align-last:center] focus-visible:rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-emerald-700/40 [&::-ms-expand]:hidden [&::picker-icon]:hidden [&_option]:text-xl')}"
            id="ultramodern-language"
            name="language"
            onChange={event => {
              const nextLanguage = event.currentTarget.value;
              if (isSupportedLanguage(nextLanguage)) {
                window.location.assign(
                  \`\${localizedPath(location.pathname, nextLanguage)}\${suffix}\`,
                );
              }
            }}
            value={language}
          >
            <option aria-label={t('shell.language.en')} value="en">
              🇬🇧
            </option>
            <option aria-label={t('shell.language.cs')} value="cs">
              🇨🇿
            </option>
          </select>
          {showCart ? <MiniCart /> : null}
        </div>
      </div>
      <BoundaryOverlay />
      {children}
    </main>
  );
}
`;
}

function createShellBoundaryOverlay(): string {
  const tw = createTw(tailwindPrefixForApp(shellApp));

  return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

type BoundaryConfig = {
  color: string;
  label: string;
};

type BoundaryBox = BoundaryConfig & {
  height: number;
  id: string;
  labelPlacement: 'above' | 'edge' | 'inside';
  left: number;
  top: number;
  width: number;
};

declare global {
  interface Window {
    __ULTRAMODERN_BOUNDARIES__?: Partial<Record<string, Partial<BoundaryConfig>>>;
  }
}

const defaultBoundaryColors = {
  checkout: 'var(--um-boundary-checkout, #f6cf45)',
  decide: 'var(--um-boundary-decide, #30e27a)',
  explore: 'var(--um-boundary-explore, #ff5a5f)',
} as const;

const boundaryIds = ['explore', 'decide', 'checkout'] as const;

export default function BoundaryOverlay() {
  const { i18nInstance, language } = useModernI18n();
  const [mounted, setMounted] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [boxes, setBoxes] = useState<BoundaryBox[]>([]);
  const boundaryConfig = useMemo(() => {
    const t = i18nInstance['t'].bind(i18nInstance);
    const runtimeOverrides =
      typeof window === 'undefined'
        ? {}
        : (window.__ULTRAMODERN_BOUNDARIES__ ?? {});

    return Object.fromEntries(
      boundaryIds.map(id => [
        id,
        {
          color: runtimeOverrides[id]?.color ?? defaultBoundaryColors[id],
          label: runtimeOverrides[id]?.label ?? t(\`shell.boundaries.\${id}\`),
        },
      ]),
    ) as Record<string, BoundaryConfig>;
  }, [i18nInstance, language]);
  const toggleLabel = i18nInstance['t'].bind(i18nInstance)(
    'shell.boundaries.toggle',
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setBoxes([]);
      return;
    }

    const readBoxes = () => {
      const nextBoxes = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-mf-page-boundary], [data-mf-boundary]',
        ),
      )
        .map((element, index) => {
          const pageBoundary = element.dataset.mfPageBoundary;
          const id = pageBoundary ?? element.dataset.mfBoundary ?? 'unknown';
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            return undefined;
          }
          const fallback = {
            color: 'var(--um-boundary-unknown, #7c8cff)',
            label: id,
          };
          const config = boundaryConfig[id] ?? fallback;

          return {
            ...config,
            height: rect.height,
            id: \`\${id}-\${index}\`,
            labelPlacement: pageBoundary ? 'edge' : rect.height < 48 ? 'above' : 'inside',
            left: rect.left,
            top: rect.top,
            width: rect.width,
          } satisfies BoundaryBox;
        })
        .filter((box): box is BoundaryBox => box !== undefined);

      setBoxes(nextBoxes);
    };

    readBoxes();

    const resizeObserver = new ResizeObserver(readBoxes);
    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-mf-page-boundary], [data-mf-boundary]',
    )) {
      resizeObserver.observe(element);
    }

    const mutationObserver = new MutationObserver(readBoxes);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener('resize', readBoxes);
    window.addEventListener('scroll', readBoxes, true);

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', readBoxes);
      window.removeEventListener('scroll', readBoxes, true);
    };
  }, [boundaryConfig, enabled]);

  if (!mounted) {
    return null;
  }

  return (
    <>
      <label className="${tw('fixed bottom-5 left-5 z-[80] flex items-center gap-2 rounded-xl border border-stone-900/10 bg-white/95 px-4 py-3 text-sm font-semibold text-stone-950 shadow-2xl shadow-stone-900/15')}">
        <input
          className="${tw('size-4 accent-emerald-800')}"
          checked={enabled}
          onChange={event => setEnabled(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>{toggleLabel}</span>
      </label>
      {enabled ? (
        <div aria-hidden="true" className="${tw('pointer-events-none fixed inset-0 z-[70]')}">
          {boxes.map(box => (
            <div
              className="${tw('fixed rounded-lg border-2')}"
              data-label-placement={box.labelPlacement}
              key={box.id}
              style={
                {
                  borderColor: box.color,
                  boxShadow: \`0 0 0 1px rgba(255,255,255,.72), 0 6px 20px color-mix(in srgb, \${box.color} 20%, transparent)\`,
                  height: box.height,
                  left: box.left,
                  top: box.top,
                  width: box.width,
                } as CSSProperties
              }
            >
              <span
                className={\`${tw('absolute whitespace-nowrap rounded-full px-2 py-1 text-[0.7rem] font-black leading-none text-stone-950')} \${box.labelPlacement === 'above' ? '${tw('bottom-[calc(100%+0.25rem)] right-1 top-auto')}' : box.labelPlacement === 'edge' ? '${tw('left-0 top-28 -translate-x-[calc(100%-1px)] -rotate-90 rounded-b-none')}' : '${tw('right-1 top-1')}'}\`}
                style={{ backgroundColor: box.color }}
              >
                {box.label}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
`;
}

function createShellRemoteComponents(scope: string): string {
  const tw = createTw(tailwindPrefixForApp(shellApp));

  return `import { createLazyComponent } from '@module-federation/modern-js-v3/react';
import { getInstance, loadRemote } from '@module-federation/modern-js-v3/runtime';
import { Suspense, useEffect, useMemo, useState, type ComponentType } from 'react';
import HeaderServer from '${packageName(scope, 'explore')}/Header';
import StorePickerServer from '${packageName(scope, 'explore')}/StorePicker';
import RecommendationsServer from '${packageName(scope, 'explore')}/Recommendations';
import ProductPageServer from '${packageName(scope, 'decide')}/ProductPage';
import MiniCartServer from '${packageName(scope, 'checkout')}/MiniCart';
import CartPageServer from '${packageName(scope, 'checkout')}/CartPage';

type RemoteComponentModule = {
  default: ComponentType;
};

const loadRemoteComponent = async (specifier: string) => {
  const module = await loadRemote<RemoteComponentModule>(specifier);
  if (!module) {
    throw new Error(\`Remote module unavailable: \${specifier}\`);
  }
  return module;
};

const remoteFallback =
  ({ error }: { error: Error }) =>
    <div className="${tw('rounded-xl border border-red-900/20 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900')}" data-remote-error={error.name}>Vertical unavailable</div>;

const createHydratedRemote = (
  ServerComponent: ComponentType,
  specifier: string,
) => {
  return function HydratedRemote() {
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
      setHydrated(true);
    }, []);

    const FederatedComponent = useMemo(() => {
      if (!hydrated) {
        return undefined;
      }
      const instance = getInstance();
      if (!instance) {
        return undefined;
      }
      return createLazyComponent({
        export: 'default',
        fallback: remoteFallback,
        instance,
        loader: () => loadRemoteComponent(specifier),
        loading: <ServerComponent />,
      });
    }, [hydrated]);

    if (!FederatedComponent) {
      return <ServerComponent />;
    }

    return (
      <Suspense fallback={<ServerComponent />}>
        <FederatedComponent />
      </Suspense>
    );
  };
};

export const Header = createHydratedRemote(HeaderServer, 'explore/Header');
export const StorePicker = createHydratedRemote(StorePickerServer, 'explore/StorePicker');
export const Recommendations = createHydratedRemote(RecommendationsServer, 'explore/Recommendations');
export const ProductPage = createHydratedRemote(ProductPageServer, 'decide/ProductPage');
export const MiniCart = createHydratedRemote(MiniCartServer, 'checkout/MiniCart');
export const CartPage = createHydratedRemote(CartPageServer, 'checkout/CartPage');
`;
}

function createRemotePage(app: WorkspaceApp): string {
  const tw = createTw(tailwindPrefixForApp(app));
  const effectBffImport = appHasEffectApi(app)
    ? `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { Helmet } from '@modern-js/runtime/head';
import { useLocation } from '@modern-js/plugin-tanstack/runtime';
import { useEffect, useState } from 'react';
import { ultramodernLocalisedUrls } from '../ultramodern-route-metadata';
import { ultramodernUiMarker } from '../../ultramodern-build';
`
    : "import { useModernI18n } from '@modern-js/plugin-i18n/runtime';\nimport { Helmet } from '@modern-js/runtime/head';\nimport { useLocation } from '@modern-js/plugin-tanstack/runtime';\nimport { ultramodernLocalisedUrls } from '../ultramodern-route-metadata';\nimport { ultramodernUiMarker } from '../../ultramodern-build';\n";
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
  const t = i18nInstance['t'].bind(i18nInstance);
  const location = useLocation();
  const suffix = locationSuffix(location);
${effectBffState}  return (
    <main className="${tw('min-h-screen bg-um-canvas px-4 py-6 text-um-foreground sm:px-8')}">
      <LocalizedHead />
      <nav aria-label={t('${app.domain}.language.switcher')} className="${tw('flex gap-3')}">
        {supportedLanguages.map(code => (
          <a
            aria-current={language === code ? 'page' : undefined}
            className="${tw('rounded-full border border-stone-900/15 bg-white px-4 py-2 text-sm font-bold text-stone-950 no-underline')}"
            href={\`\${localizedPath(location.pathname, code)}\${suffix}\`}
            key={code}
          >
            {t(\`${app.domain}.language.\${code}\`)}
          </a>
        ))}
      </nav>
      <h1 className="${tw('mt-10 text-5xl font-black')}">{t('${app.domain}.title')}</h1>
      <p className="${tw('mt-3 text-lg text-stone-600')}" data-mf-role="${app.kind}">{t('${app.domain}.role')}</p>
      <p className="${tw('sr-only')}" data-build-marker={ultramodernUiMarker.build} data-testid="ultramodern-ui-marker">
        {ultramodernUiMarker.appId}:{ultramodernUiMarker.version}
      </p>
${effectBffMarkup}    </main>
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
  const tw = createTw(tailwindPrefixForApp(app));

  if (app.exposes?.['./ProductPage']) {
    return `export { default } from './components/product-page';
`;
  }

  if (app.exposes?.['./CartPage']) {
    return `export { default } from './components/cart-page';
`;
  }

  return `export default function ${toPascalCase(app.domain ?? app.id)}Route() {
  return (
    <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}" data-mf-remote="${app.id}" data-mf-expose="./Route">
      <h2 className="${tw('text-2xl font-black')}">${app.displayName}</h2>
      <p className="${tw('mt-2 text-stone-600')}">Route surface for ${app.domain ?? app.id}.</p>
    </section>
  );
}
`;
}

function createRemoteWidget(app: WorkspaceApp): string {
  const tw = createTw(tailwindPrefixForApp(app));
  const componentName = `${toPascalCase(app.domain ?? app.id)}Widget`;
  const body =
    app.kind === 'vertical'
      ? `Owns the ${app.domain} vertical route surface.`
      : 'Provides shared UI primitives for the workspace.';

  return `export default function ${componentName}() {
  return (
    <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}" data-mf-remote="${app.id}">
      <h2 className="${tw('text-2xl font-black')}">${app.displayName}</h2>
      <p className="${tw('mt-2 text-stone-600')}">${body}</p>
    </section>
  );
}
`;
}

function createRemoteExposeComponent(
  app: WorkspaceApp,
  expose: string,
): string {
  const tw = createTw(tailwindPrefixForApp(app));

  if (app.id === 'explore' && expose === './Header') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function Header() {
  const { i18nInstance, language } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <header className="${tw('flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 md:flex-1')}" data-mf-boundary="explore">
      <a className="${tw('whitespace-nowrap text-xl font-black tracking-normal text-stone-950 no-underline')}" href={\`/\${language}\`}>Acre & Iron</a>
      <nav aria-label={t('explore.header.navigation')} className="${tw('flex items-center gap-5')}">
        <a className="${tw('text-sm font-extrabold text-stone-900 no-underline')}" href={\`/\${language}/tractors\`}>{t('explore.header.machines')}</a>
        <a className="${tw('text-sm font-extrabold text-stone-900 no-underline')}" href={\`/\${language}/stores\`}>{t('explore.header.stores')}</a>
      </nav>
    </header>
  );
}
`;
  }

  if (app.id === 'explore' && expose === './Recommendations') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

const tractors = [
  { badge: 'explore.recommendations.bestRows', image: '${commerceAssetUrl('orchard.svg')}', name: 'Orchard Tractor', slug: 'orchard-tractor' },
  { badge: 'explore.recommendations.aiFirst', image: '${commerceAssetUrl('autonomy.svg')}', name: 'Autonomy Retrofit Kit', slug: 'autonomy-retrofit-kit' },
  { badge: 'explore.recommendations.loaderReady', image: '${commerceAssetUrl('field-loader.svg')}', name: 'Field Loader 112', slug: 'field-loader-112' },
  { badge: 'explore.recommendations.vineyard', image: '${commerceAssetUrl('vineyard.svg')}', name: 'Vineyard Narrow 80', slug: 'vineyard-narrow-80' },
] as const;

export default function Recommendations() {
  const { i18nInstance, language } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <section className="${tw('mx-auto mt-12 max-w-7xl')}" data-mf-boundary="explore">
      <h2 className="${tw('text-3xl font-black tracking-normal text-stone-950')}">{t('explore.recommendations.title')}</h2>
      <div className="${tw('mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4')}">
        {tractors.map(tractor => (
          <a className="${tw('block rounded-2xl bg-white/90 p-4 text-stone-950 no-underline shadow-xl shadow-stone-900/10 transition hover:-translate-y-0.5 hover:shadow-2xl')}" href={\`/\${language}/tractors/\${tractor.slug}\`} key={tractor.slug}>
            <img alt="" className="${tw('aspect-video w-full rounded-xl bg-stone-200 object-cover')}" src={tractor.image} />
            <span className="${tw('mt-4 block text-xs font-black uppercase tracking-[0.16em] text-amber-700')}">{t(tractor.badge)}</span>
            <strong className="${tw('mt-2 block text-xl font-black leading-tight')}">{tractor.name}</strong>
          </a>
        ))}
      </div>
    </section>
  );
}
`;
  }

  if (app.id === 'explore' && expose === './StorePicker') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

const fieldLoaderImage = '${commerceAssetUrl('field-loader.svg')}';
const vineyardImage = '${commerceAssetUrl('vineyard.svg')}';

export default function StorePicker() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <section className="${tw('mx-auto mt-12 max-w-7xl')}" data-mf-boundary="explore">
      <h2 className="${tw('text-3xl font-black tracking-normal text-stone-950')}">{t('explore.stores.title')}</h2>
      <div className="${tw('mt-5 grid gap-4 md:grid-cols-2')}">
        <article className="${tw('rounded-2xl bg-white/90 p-4 shadow-xl shadow-stone-900/10')}">
          <img alt="" className="${tw('aspect-video w-full rounded-xl bg-stone-200 object-cover')}" src={fieldLoaderImage} />
          <span className="${tw('mt-4 block text-xs font-black uppercase tracking-[0.16em] text-emerald-800')}">{t('explore.stores.northRegion')}</span>
          <strong className="${tw('mt-2 block text-2xl font-black')}">Bohemia Field Supply</strong>
        </article>
        <article className="${tw('rounded-2xl bg-white/90 p-4 shadow-xl shadow-stone-900/10')}">
          <img alt="" className="${tw('aspect-video w-full rounded-xl bg-stone-200 object-cover')}" src={vineyardImage} />
          <span className="${tw('mt-4 block text-xs font-black uppercase tracking-[0.16em] text-emerald-800')}">{t('explore.stores.southRegion')}</span>
          <strong className="${tw('mt-2 block text-2xl font-black')}">Moravia Iron Works</strong>
        </article>
      </div>
    </section>
  );
}
`;
  }

  if (app.id === 'explore' && expose === './Footer') {
    return `export default function Footer() {
  return <footer className="${tw('mx-auto mt-12 max-w-7xl text-sm font-bold text-stone-600')}" data-mf-boundary="explore">Acre & Iron</footer>;
}
`;
  }

  if (expose === './Widget') {
    return createRemoteWidget(app);
  }

  const componentName = `${toPascalCase(app.domain ?? app.id)}${toPascalCase(
    expose.replace(/^\.\//u, ''),
  )}`;

  if (app.id === 'decide' && expose === './ProductPage') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { AddToCart, Recommendations } from './vertical-components';

const fieldLoaderImage = '${commerceAssetUrl('field-loader.svg')}';

export default function ${componentName}() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <>
      <section className="${tw('mx-auto mt-10 grid max-w-7xl items-center gap-8 md:grid-cols-[1fr_0.95fr] lg:gap-14')}" data-mf-boundary="decide" data-mf-remote="${app.id}" data-mf-expose="${expose}">
        <img alt="" className="${tw('aspect-[1/0.9] w-full rounded-3xl border-[18px] border-amber-200 bg-stone-200 object-cover shadow-2xl shadow-stone-900/20')}" src={fieldLoaderImage} />
        <div>
          <p className="${tw('text-xs font-black uppercase tracking-[0.18em] text-emerald-800')}">{t('decide.product.eyebrow')}</p>
          <h1 className="${tw('mt-3 text-5xl font-black leading-none tracking-normal text-stone-950 md:text-7xl')}">Field Loader 112</h1>
          <p className="${tw('mt-5 max-w-2xl text-lg leading-8 text-stone-600')}">{t('decide.product.lede')}</p>
          <div className="${tw('mt-8 grid gap-4 sm:grid-cols-3')}">
            <article className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}"><span className="${tw('block text-sm font-bold text-stone-500')}">{t('decide.product.price')}</span><strong className="${tw('mt-2 block text-lg font-black')}">EUR 42,500</strong></article>
            <article className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}"><span className="${tw('block text-sm font-bold text-stone-500')}">{t('decide.product.power')}</span><strong className="${tw('mt-2 block text-lg font-black')}">112 hp</strong></article>
            <article className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}"><span className="${tw('block text-sm font-bold text-stone-500')}">{t('decide.product.availability')}</span><strong className="${tw('mt-2 block text-lg font-black')}">{t('decide.product.inStock')}</strong></article>
          </div>
          <AddToCart />
        </div>
      </section>
      <Recommendations />
    </>
  );
}
`;
  }

  if (app.id === 'checkout' && expose === './AddToCart') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useCartLines } from '../cart-store';

export default function ${componentName}() {
  const { i18nInstance, language } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);
  const cart = useCartLines();

  return (
    <div className="${tw('mt-8 flex flex-wrap gap-3')}" data-mf-boundary="checkout">
      <button className="${tw('inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-800 px-5 font-bold text-white shadow-lg shadow-stone-900/10')}" onClick={cart.addFieldLoader} type="button">
        {t('checkout.actions.addToCart')}
      </button>
      <a className="${tw('inline-flex min-h-11 items-center justify-center rounded-full border border-stone-900/15 bg-white/90 px-5 font-bold text-stone-950 shadow-lg shadow-stone-900/10')}" href={\`/\${language}/cart\`}>
        {t('checkout.actions.viewCart')}
      </a>
    </div>
  );
}
`;
  }

  if (app.id === 'checkout' && expose === './MiniCart') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useCartLines } from '../cart-store';

export default function ${componentName}() {
  const { i18nInstance, language } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);
  const cart = useCartLines();
  const count = cart.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <a className="${tw('inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-stone-900/15 bg-white px-4 text-sm font-extrabold text-stone-950 no-underline shadow-lg shadow-stone-900/5')}" data-mf-boundary="checkout" href={\`/\${language}/cart\`}>
      {t('checkout.cart.title')} ({count})
    </a>
  );
}
`;
  }

  if (app.id === 'checkout' && expose === './CartPage') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useCartLines } from '../cart-store';

export default function ${componentName}() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);
  const cart = useCartLines();

  return (
    <section className="${tw('mx-auto mt-10 max-w-7xl')}" data-mf-boundary="checkout" data-mf-remote="${app.id}" data-mf-expose="${expose}">
      <h1 className="${tw('text-5xl font-black leading-none tracking-normal text-stone-950 md:text-7xl')}">{t('checkout.cart.title')}</h1>
      <div className="${tw('mt-8 rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}">
        {cart.lines.length === 0 ? (
          <p>{t('checkout.cart.empty')}</p>
        ) : (
          <>
            {cart.lines.map(line => (
              <article className="${tw('grid gap-4 border-t border-stone-900/10 py-4 first:border-t-0 sm:grid-cols-[1fr_auto] sm:items-center')}" key={line.id}>
                <div>
                  <strong className="${tw('text-lg font-black')}">{line.name}</strong>
                  <p className="${tw('text-stone-600')}">EUR {line.price.toLocaleString('en-US')}</p>
                </div>
                <div className="${tw('flex flex-wrap items-center gap-2')}">
                  <button className="${tw('inline-flex size-9 items-center justify-center rounded-full border border-stone-900/15 bg-white font-black')}" onClick={() => cart.decrement(line.id)} type="button">-</button>
                  <span className="${tw('min-w-6 text-center font-black')}">{line.quantity}</span>
                  <button className="${tw('inline-flex size-9 items-center justify-center rounded-full border border-stone-900/15 bg-white font-black')}" onClick={() => cart.increment(line.id)} type="button">+</button>
                  <button className="${tw('inline-flex min-h-10 items-center justify-center rounded-full border border-stone-900/15 bg-white px-4 font-bold text-stone-950')}" onClick={() => cart.remove(line.id)} type="button">
                    {t('checkout.actions.remove')}
                  </button>
                </div>
              </article>
            ))}
            <p><strong>{t('checkout.cart.total')}: EUR {cart.total.toLocaleString('en-US')}</strong></p>
          </>
        )}
      </div>
    </section>
  );
}
`;
  }

  return `export default function ${componentName}() {
  return (
    <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}" data-mf-remote="${app.id}" data-mf-expose="${expose}">
      <h2 className="${tw('text-2xl font-black')}">${app.displayName} ${expose.replace(/^\.\//u, '')}</h2>
      <p className="${tw('mt-2 text-stone-600')}">Module Federation surface owned by ${app.ownership.team}.</p>
    </section>
  );
}
`;
}

function createDecideRemoteComponents(
  scope: string,
  app: WorkspaceApp,
): string {
  const tw = createTw(tailwindPrefixForApp(app));

  return `import { createLazyComponent } from '@module-federation/modern-js-v3/react';
import { getInstance, loadRemote } from '@module-federation/modern-js-v3/runtime';
import { Suspense, useEffect, useMemo, useState, type ComponentType } from 'react';
import RecommendationsServer from '${packageName(scope, 'explore')}/Recommendations';
import AddToCartServer from '${packageName(scope, 'checkout')}/AddToCart';

type RemoteComponentModule = {
  default: ComponentType;
};

const loadRemoteComponent = async (specifier: string) => {
  const module = await loadRemote<RemoteComponentModule>(specifier);
  if (!module) {
    throw new Error(\`Remote module unavailable: \${specifier}\`);
  }
  return module;
};

const remoteFallback =
  ({ error }: { error: Error }) =>
    <div className="${tw('rounded-xl border border-red-900/20 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900')}" data-remote-error={error.name}>Vertical unavailable</div>;

const createHydratedRemote = (
  ServerComponent: ComponentType,
  specifier: string,
) => {
  return function HydratedRemote() {
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
      setHydrated(true);
    }, []);

    const FederatedComponent = useMemo(() => {
      if (!hydrated) {
        return undefined;
      }
      const instance = getInstance();
      if (!instance) {
        return undefined;
      }
      return createLazyComponent({
        export: 'default',
        fallback: remoteFallback,
        instance,
        loader: () => loadRemoteComponent(specifier),
        loading: <ServerComponent />,
      });
    }, [hydrated]);

    if (!FederatedComponent) {
      return <ServerComponent />;
    }

    return (
      <Suspense fallback={<ServerComponent />}>
        <FederatedComponent />
      </Suspense>
    );
  };
};

export const AddToCart = createHydratedRemote(AddToCartServer, 'checkout/AddToCart');
export const Recommendations = createHydratedRemote(RecommendationsServer, 'explore/Recommendations');
`;
}

function remoteComponentOutputPath(app: WorkspaceApp, expose: string) {
  const exposePath = app.exposes?.[expose];

  if (!exposePath?.startsWith('./src/components/')) {
    return undefined;
  }

  return `${app.directory}/${exposePath.replace(/^\.\//u, '')}`;
}

function createAppLocaleMessages(app: WorkspaceApp, language: 'en' | 'cs') {
  const czechLabels: Record<string, { role: string; title: string }> = {
    checkout: {
      role: 'pokladna',
      title: 'Pokladní remote',
    },
    decide: {
      role: 'rozhodování',
      title: 'Rozhodovací remote',
    },
    'design-system': {
      role: 'design system',
      title: 'Design system remote',
    },
    explore: {
      role: 'procházení',
      title: 'Průzkumný remote',
    },
    identity: {
      role: 'identita',
      title: 'Identitní remote',
    },
  };

  if (app.kind === 'shell') {
    return {
      shell: {
        hero: {
          eyebrow:
            language === 'en'
              ? 'Federated tractor commerce'
              : 'Federovaný obchod s traktory',
          lede:
            language === 'en'
              ? 'A full-stack Micro Vertical reference where Explore, Decide, and Checkout ship independently but compose into one storefront.'
              : 'Full-stack Micro Vertical ukázka, kde Procházení, Rozhodování a Pokladna vycházejí samostatně, ale skládají jeden obchod.',
          primary:
            language === 'en' ? 'View Field Loader' : 'Zobrazit Field Loader',
          secondary: language === 'en' ? 'Compare machines' : 'Porovnat stroje',
        },
        language: {
          cs: language === 'en' ? 'Czech' : 'Čeština',
          en: language === 'en' ? 'English' : 'Angličtina',
          switcher: language === 'en' ? 'Language' : 'Jazyk',
        },
        remotes: {
          checkout: language === 'en' ? 'Checkout Vertical' : 'Checkout remote',
          decide: language === 'en' ? 'Decide Vertical' : 'Decide remote',
          explore: language === 'en' ? 'Explore Vertical' : 'Explore remote',
        },
        boundaries: {
          checkout: language === 'en' ? 'checkout' : 'pokladna',
          decide: language === 'en' ? 'decide' : 'rozhodování',
          explore: language === 'en' ? 'explore' : 'procházení',
          toggle:
            language === 'en'
              ? 'show team boundaries'
              : 'zobrazit hranice týmů',
        },
        routes: {
          cart: language === 'en' ? 'Cart' : 'Košík',
          home: language === 'en' ? 'Home' : 'Domů',
          listing: language === 'en' ? 'Tractors' : 'Traktory',
          productDetail:
            language === 'en' ? 'Tractor detail' : 'Detail traktoru',
          storePicker: language === 'en' ? 'Stores' : 'Prodejci',
        },
        title: language === 'en' ? 'Acre & Iron' : 'Acre & Iron',
      },
    };
  }

  const domain = app.domain ?? app.id;
  const czechLabel = czechLabels[domain] ?? {
    role: domain,
    title: `${app.displayName} CZ`,
  };

  return {
    [domain]: {
      language: {
        cs: language === 'en' ? 'Czech' : 'Čeština',
        en: language === 'en' ? 'English' : 'Angličtina',
        switcher: language === 'en' ? 'Language' : 'Jazyk',
      },
      role: language === 'en' ? (app.domain ?? app.kind) : czechLabel.role,
      routes: {
        cart: language === 'en' ? 'Cart' : 'Košík',
        checkout: language === 'en' ? 'Checkout' : 'Pokladna',
        home: language === 'en' ? 'Home' : 'Domů',
        listing: language === 'en' ? 'Tractors' : 'Traktory',
        productDetail: language === 'en' ? 'Tractor detail' : 'Detail traktoru',
        storePicker: language === 'en' ? 'Store picker' : 'Výběr prodejce',
        thankYou:
          language === 'en' ? 'Order confirmation' : 'Potvrzení objednávky',
        unavailable: language === 'en' ? 'Unavailable' : 'Nedostupné',
      },
      title: language === 'en' ? app.displayName : czechLabel.title,
      ...(domain === 'explore'
        ? {
            header: {
              machines: language === 'en' ? 'Machines' : 'Stroje',
              navigation:
                language === 'en' ? 'Main navigation' : 'Hlavní navigace',
              stores: language === 'en' ? 'Stores' : 'Prodejci',
            },
            recommendations: {
              aiFirst: language === 'en' ? 'AI-first option' : 'AI varianta',
              bestRows:
                language === 'en'
                  ? 'Best for tight rows'
                  : 'Nejlepší do úzkých řádků',
              loaderReady:
                language === 'en' ? 'Loader-ready' : 'Připraveno pro nakladač',
              title:
                language === 'en'
                  ? 'Compare alternatives'
                  : 'Porovnat alternativy',
              vineyard:
                language === 'en' ? 'Vineyard profile' : 'Profil pro vinice',
            },
            stores: {
              northRegion:
                language === 'en' ? 'North region' : 'Severní region',
              southRegion: language === 'en' ? 'South region' : 'Jižní region',
              title: language === 'en' ? 'Stores' : 'Prodejci',
            },
          }
        : {}),
      ...(domain === 'decide'
        ? {
            product: {
              availability: language === 'en' ? 'Availability' : 'Dostupnost',
              eyebrow: language === 'en' ? 'Machine detail' : 'Detail stroje',
              inStock: language === 'en' ? 'In stock' : 'Skladem',
              lede:
                language === 'en'
                  ? 'A loader-ready tractor for feed, hay, gravel, and winter road work.'
                  : 'Traktor připravený pro nakladač na krmivo, seno, štěrk a zimní údržbu cest.',
              power: language === 'en' ? 'Power' : 'Výkon',
              price: language === 'en' ? 'Price' : 'Cena',
            },
          }
        : {}),
      ...(domain === 'checkout'
        ? {
            actions: {
              addToCart: language === 'en' ? 'Add to cart' : 'Přidat do košíku',
              remove: language === 'en' ? 'Remove' : 'Odebrat',
              viewCart: language === 'en' ? 'View cart' : 'Zobrazit košík',
            },
            cart: {
              empty:
                language === 'en' ? 'Your cart is empty.' : 'Košík je prázdný.',
              title: language === 'en' ? 'Your cart' : 'Váš košík',
              total: language === 'en' ? 'Total' : 'Celkem',
            },
          }
        : {}),
    },
  };
}

function createDesignButton(app: WorkspaceApp): string {
  const tw = createTw(tailwindPrefixForApp(app));

  return `export default function Button({ label }: { label: string }) {
  return (
    <button className="${tw('rounded-full text-um-foreground')}" type="button">
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

function createCheckoutCartStore(): string {
  return `import { useEffect, useMemo, useState } from 'react';

export type CartLine = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

const storageKey = 'ultramodern-tractor-cart';
const cartEvent = 'ultramodern-cart-change';
const fieldLoader: CartLine = {
  id: 'field-loader-112',
  name: 'Field Loader 112',
  price: 42500,
  quantity: 1,
};

const readCart = (): CartLine[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const value = window.localStorage.getItem(storageKey);
    return value ? (JSON.parse(value) as CartLine[]) : [];
  } catch {
    return [];
  }
};

const writeCart = (lines: CartLine[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(lines));
  window.dispatchEvent(new CustomEvent(cartEvent));
};

const updateLine = (
  id: string,
  updater: (line: CartLine) => CartLine | undefined,
) => {
  const next = readCart()
    .map(line => (line.id === id ? updater(line) : line))
    .filter((line): line is CartLine => Boolean(line));
  writeCart(next);
};

export function useCartLines() {
  const [lines, setLines] = useState<CartLine[]>(() => readCart());

  useEffect(() => {
    const refresh = () => setLines(readCart());
    window.addEventListener(cartEvent, refresh);
    window.addEventListener('storage', refresh);
    refresh();

    return () => {
      window.removeEventListener(cartEvent, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return useMemo(
    () => ({
      lines,
      total: lines.reduce((sum, line) => sum + line.price * line.quantity, 0),
      addFieldLoader: () => {
        const existing = readCart();
        const match = existing.find(line => line.id === fieldLoader.id);
        writeCart(
          match
            ? existing.map(line =>
                line.id === fieldLoader.id
                  ? { ...line, quantity: line.quantity + 1 }
                  : line,
              )
            : [...existing, fieldLoader],
        );
      },
      increment: (id: string) =>
        updateLine(id, line => ({ ...line, quantity: line.quantity + 1 })),
      decrement: (id: string) =>
        updateLine(id, line =>
          line.quantity > 1 ? { ...line, quantity: line.quantity - 1 } : undefined,
        ),
      remove: (id: string) => writeCart(readCart().filter(line => line.id !== id)),
    }),
    [lines],
  );
}
`;
}

function createSharedDesignTokensCss(): string {
  return `@theme {
  --color-um-accent: #2f8f68;
  --color-um-canvas: #f1eadc;
  --color-um-foreground: #133225;
  --color-um-link: #166b4b;
  --color-um-surface: #f6fbf7;
}
`;
}

function serviceEffectApiExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toCamelCase(effectApiStem(service))}EffectApi`;
}

function serviceEffectGroupName(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return toCamelCase(effectApiStem(service));
}

function serviceEffectApiName(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toPascalCase(effectApiStem(service))}EffectApi`;
}

function serviceEffectSchemaExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toCamelCase(effectApiStem(service))}ItemSchema`;
}

function serviceEffectMarkerSchemaExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toCamelCase(effectApiStem(service))}MarkerSchema`;
}

function serviceEffectReadinessSchemaExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toCamelCase(effectApiStem(service))}ReadinessSchema`;
}

function serviceEffectErrorStem(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  const stem = effectApiStem(service);
  return stem === 'recommendations' ? 'recommendation' : stem;
}

function serviceEffectCreatePayloadSchemaExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toCamelCase(effectApiStem(service))}CreatePayloadSchema`;
}

function serviceEffectNotFoundErrorExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
  return `${toPascalCase(serviceEffectErrorStem(service))}NotFound`;
}

function serviceEffectNotFoundSchemaExport(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}) {
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

function createEffectSharedApiContract(service: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}): string {
  const schemaExport = serviceEffectSchemaExport(service);
  const markerSchemaExport = serviceEffectMarkerSchemaExport(service);
  const readinessSchemaExport = serviceEffectReadinessSchemaExport(service);
  const createPayloadSchemaExport =
    serviceEffectCreatePayloadSchemaExport(service);
  const notFoundErrorExport = serviceEffectNotFoundErrorExport(service);
  const notFoundSchemaExport = serviceEffectNotFoundSchemaExport(service);
  const apiExport = serviceEffectApiExport(service);
  const apiName = serviceEffectApiName(service);
  const groupName = serviceEffectGroupName(service);
  const stem = effectApiStem(service);
  const servicePrefix = effectApiPrefix(service);

  return `export const ${markerSchemaExport} = Schema.Struct({
  appId: Schema.String,
  packageName: Schema.String,
  version: Schema.String,
  build: Schema.String,
  deployProfile: Schema.String,
  surface: Schema.String,
});

export const ${schemaExport} = Schema.Struct({
  id: Schema.String,
  marker: ${markerSchemaExport},
  title: Schema.String,
});

export const ${readinessSchemaExport} = Schema.Struct({
  checks: Schema.Struct({
    effectBff: Schema.Literal('ready'),
    moduleFederation: Schema.Literal('ready'),
    ssr: Schema.Literal('ready'),
    translations: Schema.Literal('ready'),
  }),
  marker: ${markerSchemaExport},
  status: Schema.Literal('ready'),
  versionSkew: Schema.Literal('none'),
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
      HttpApiEndpoint.get('readiness', '/effect/${stem}/readiness', {
        success: ${readinessSchemaExport},
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
  readiness: {
    operationId: '${apiName}:${groupName}:readiness',
    routePath: '/effect/${stem}/readiness',
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
  readinessPath: '${servicePrefix}/effect/${stem}/readiness',
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
  service: { id: string; effectApi?: WorkspaceEffectApi },
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
      .handle('readiness', () =>
        Effect.succeed({
          checks: {
            effectBff: 'ready' as const,
            moduleFederation: 'ready' as const,
            ssr: 'ready' as const,
            translations: 'ready' as const,
          },
          marker: ultramodernApiMarker,
          status: 'ready' as const,
          versionSkew: 'none' as const,
        }).pipe(
          Effect.withSpan('ultramodern.effect.${groupName}.readiness', {
            attributes: operationAttributes(${groupName}OperationContexts.readiness),
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
  const readinessName = `get${toPascalCase(stem)}Readiness`;
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

export function ${readinessName}(
  options: ${clientOptionsName} = {},
) {
  return runEffectRequest(
    ${createClientName}({
      ...options,
      operationContext:
        options.operationContext ?? ${groupName}OperationContexts.readiness,
    }),
  ).then(client =>
    runEffectRequest(client.${groupName}.readiness({})),
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
  createCheckout,
  createCheckoutClient,
  getCheckout,
  getCheckoutReadiness,
  listCheckout,
  type CheckoutClientOptions,
} from '${packageName(scope, 'checkout')}/effect/client';

export {
  createDecide,
  createDecideClient,
  getDecide,
  getDecideReadiness,
  listDecide,
  type DecideClientOptions,
} from '${packageName(scope, 'decide')}/effect/client';

export {
  createExplore,
  createExploreClient,
  getExplore,
  getExploreReadiness,
  listExplore,
  type ExploreClientOptions,
} from '${packageName(scope, 'explore')}/effect/client';
`;
}

function toPascalCase(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function createEffectReadinessContract(app: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}): JsonValue {
  const stem = effectApiStem(app);
  return {
    endpoint: `/effect/${stem}/readiness`,
    marker: {
      ui: 'ultramodernUiMarker',
      api: 'ultramodernApiMarker',
      skew: 'none',
    },
    checks: ['moduleFederation', 'ssr', 'translations', 'effectBff'],
  };
}

function createEffectRequestContextContract(): JsonValue {
  return {
    propagatedHeaders: [
      'accept-language',
      'authorization',
      'traceparent',
      'x-correlation-id',
      'x-tenant-id',
      'x-ultramodern-env',
      'x-vertical-version-id',
    ],
    source: 'shell-to-vertical-effect-client',
  };
}

function createEffectDomainOperations(app: {
  id: string;
  effectApi?: WorkspaceEffectApi;
}): JsonValue {
  const stem = effectApiStem(app);
  const group = serviceEffectGroupName(app);
  const basePath = `/effect/${stem}`;

  if (stem === 'checkout') {
    return {
      cartSnapshot: {
        client: 'listCheckout',
        method: 'GET',
        path: basePath,
        resource: 'cart',
        owner: app.id,
      },
      cartMutation: {
        client: 'createCheckout',
        method: 'POST',
        path: basePath,
        resource: 'cart-line',
        owner: app.id,
      },
      orderConfirmation: {
        client: 'getCheckout',
        method: 'GET',
        path: `${basePath}/:id`,
        resource: 'order',
        owner: app.id,
      },
    };
  }

  if (stem === 'decide') {
    return {
      productDetail: {
        client: 'getDecide',
        method: 'GET',
        path: `${basePath}/:id`,
        resource: 'product-detail',
        owner: app.id,
      },
      configurationDraft: {
        client: 'createDecide',
        method: 'POST',
        path: basePath,
        resource: 'configuration',
        owner: app.id,
      },
      productList: {
        client: 'listDecide',
        method: 'GET',
        path: basePath,
        resource: 'products',
        owner: app.id,
      },
    };
  }

  return {
    recommendationFeed: {
      client: `list${toPascalCase(stem)}`,
      method: 'GET',
      path: basePath,
      resource: 'recommendations',
      owner: app.id,
    },
    recommendationDetail: {
      client: `get${toPascalCase(serviceEffectErrorStem(app))}`,
      method: 'GET',
      path: `${basePath}/:id`,
      resource: 'recommendation',
      owner: app.id,
    },
    recommendationCreate: {
      client: `create${toPascalCase(serviceEffectErrorStem(app))}`,
      method: 'POST',
      path: basePath,
      resource: group,
      owner: app.id,
    },
  };
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
      readiness: createEffectReadinessContract(app),
      requestContext: createEffectRequestContextContract(),
      domainOperations: createEffectDomainOperations(app),
    },
  };
}

function createTopology(scope: string): JsonValue {
  return {
    schemaVersion: 1,
    id: 'ultramodern-superapp-workspace-reference-topology',
    description:
      'Generated UltraModern workspace skeleton with full-stack vertical ownership.',
    preset: 'presetUltramodern',
    shell: {
      id: shellApp.id,
      kind: 'shell',
      package: packageName(scope, shellApp.packageSuffix),
      verticalRefs: shellApp.verticalRefs,
      moduleFederation: {
        role: 'host',
        name: shellApp.mfName,
        remotes: createModuleFederationRemoteContracts(shellApp),
        ssr: true,
        sharedContractVersion: 'mf-ssr-contract-v1',
      },
      cloudflare: createCloudflareDeployContract(scope, shellApp),
      ownership: shellApp.ownership,
    },
    verticals: verticalApps.map(vertical => ({
      id: vertical.id,
      kind: vertical.kind,
      domain: vertical.domain,
      package: packageName(scope, vertical.packageSuffix),
      path: vertical.directory,
      moduleFederation: {
        role: 'remote',
        name: vertical.mfName,
        manifestUrl: `http://localhost:${vertical.port}/mf-manifest.json`,
        exposes: Object.keys(vertical.exposes ?? {}),
        ...(vertical.verticalRefs?.length
          ? {
              verticalRefs: vertical.verticalRefs,
              remotes: createModuleFederationRemoteContracts(vertical),
            }
          : {}),
        ssr: true,
        fallbackTelemetryEvent: 'modernjs:mv-runtime-parity',
        sharedContractVersion: 'mf-ssr-contract-v1',
      },
      ...(effectApiTopologyMetadata(vertical)
        ? { api: effectApiTopologyMetadata(vertical) }
        : {}),
      cloudflare: createCloudflareDeployContract(scope, vertical),
      ownership: vertical.ownership,
    })),
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
      ...verticalApps,
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
      [shellApp, ...verticalApps].map(app => [app.id, app.port]),
    ),
    manifests: Object.fromEntries(
      verticalApps.map(remote => [
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
      readiness: {
        method: 'GET',
        path: `/effect/${stem}/readiness`,
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
      assetPrefix: {
        envFallbackOrder: [
          'MODERN_PUBLIC_SITE_URL',
          createCloudflarePublicUrlEnv(app),
          app.portEnv,
        ],
        defaultLocalhostPort: app.port,
      },
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

function cssLayerName(app: WorkspaceApp): string {
  if (app.kind === 'shell') {
    return 'ultramodern-shell-base';
  }
  return `ultramodern-vertical-${app.domain ?? app.id}`;
}

function cssRole(app: WorkspaceApp): string {
  if (app.kind === 'shell') {
    return 'shell-base-overlay';
  }
  return 'vertical-css';
}

function cssClassPrefix(app: WorkspaceApp): string {
  return `${tailwindPrefixForApp(app)}:`;
}

function createCssDedupeContract(scope: string): JsonValue {
  return {
    strategy: 'shared-token-package-plus-css-content-hash',
    sharedPackage: packageName(scope, 'shared-design-tokens'),
    sharedLayers: ['ultramodern-shared-tokens'],
    runtimeLoad: 'once-per-content-hash',
    duplicateBaseStylesAllowed: false,
  };
}

function createCssSsrContract(app: WorkspaceApp): JsonValue {
  return {
    cloudflare: true,
    firstPaintRequired: true,
    linkEmission: 'modern-ssr-css-assets',
    verticalCss:
      app.kind === 'shell'
        ? 'host-preloads-shell-and-shared-css'
        : 'federated-manifest-owned-css',
  };
}

function createAppCssFederationContract(
  scope: string,
  app: WorkspaceApp,
): JsonValue {
  const ownedLayers =
    app.kind === 'shell'
      ? ['ultramodern-shell-base', 'ultramodern-shell-overlay']
      : [cssLayerName(app)];

  return {
    owner: {
      id: app.id,
      package: packageName(scope, app.packageSuffix),
      team: app.ownership.team,
    },
    role: cssRole(app),
    rootSelector: `[data-app-id="${app.id}"]`,
    classPrefix: cssClassPrefix(app),
    layers: {
      shared: ['ultramodern-shared-tokens'],
      owned: ownedLayers,
      imports:
        app.kind === 'shell'
          ? ['ultramodern-shared-tokens']
          : ['ultramodern-shared-tokens'],
    },
    entrypoints: {
      layoutImport: 'src/routes/layout.tsx',
      css: ['src/routes/index.css'],
      ...(app.kind !== 'shell'
        ? { federationEntry: 'src/federation-entry.tsx' }
        : {}),
    },
    assets: {
      shared: [`${packageName(scope, 'shared-design-tokens')}/tokens.css`],
      owned: ['src/routes/index.css'],
      emittedBy: 'modern-rspack-css-extraction',
      contentHash: true,
    },
    dedupe: createCssDedupeContract(scope),
    ssr: createCssSsrContract(app),
  };
}

function createCssFederationContract(scope: string): JsonValue {
  return {
    schemaVersion: 1,
    sharedDesignTokens: {
      owner: {
        id: 'shared-design-tokens',
        package: packageName(scope, 'shared-design-tokens'),
        team: 'super-app-platform',
      },
      role: 'shared-design-tokens',
      rootSelector: ':root',
      classPrefix: '--um-',
      layers: {
        owned: ['ultramodern-shared-tokens'],
      },
      entrypoints: {
        css: ['packages/shared-design-tokens/src/tokens.css'],
        typescript: ['packages/shared-design-tokens/src/index.ts'],
      },
      assets: {
        exports: ['./tokens.css'],
        css: ['packages/shared-design-tokens/src/tokens.css'],
      },
      dedupe: createCssDedupeContract(scope),
      ssr: {
        cloudflare: true,
        firstPaintRequired: true,
        importedByApps: true,
      },
    },
    ownershipRules: {
      shell: ['base', 'overlay'],
      verticals: ['vertical-css'],
      forbiddenVerticalLayers: [
        'ultramodern-shell-base',
        'ultramodern-shell-overlay',
      ],
    },
  };
}

function createStylingContract(
  scope: string,
  app: WorkspaceApp,
  enableTailwind: boolean,
): JsonValue {
  return {
    tailwind: enableTailwind,
    ...(enableTailwind
      ? {
          postcssPlugins: ['@tailwindcss/postcss'],
          prefix: tailwindPrefixForApp(app),
          source: '..',
          sourceMode: 'source(none)',
        }
      : {}),
    federation: createAppCssFederationContract(scope, app),
  };
}

function createAppGeneratedContract(
  scope: string,
  app: WorkspaceApp,
  apps: WorkspaceApp[],
  enableTailwind: boolean,
): JsonValue {
  const appWithResolvedRefs =
    app.kind === 'shell'
      ? {
          ...app,
          verticalRefs: apps
            .filter(candidate => candidate.kind !== 'shell')
            .map(candidate => candidate.id),
        }
      : app;
  const consumedRemotes = createModuleFederationRemoteContracts(
    appWithResolvedRefs,
    apps,
  );

  return {
    id: app.id,
    package: packageName(scope, app.packageSuffix),
    path: app.directory,
    kind: app.kind,
    config: createAppConfigContract(app),
    styling: createStylingContract(scope, app, enableTailwind),
    deploy: {
      target: 'cloudflare',
      cloudflare: createCloudflareDeployContract(scope, app),
      worker: {
        name: createCloudflareWorkerName(scope, app),
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
      backend: {
        enabled: true,
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
      reactI18next: false,
      languages: ['en', 'cs'],
      fallbackLanguage: 'en',
      namespace: appI18nNamespace(app),
      namespaces: [appI18nNamespace(app), 'translation'],
      publicDir: ['./locales', './assets'],
      localisedUrls: createLocalisedUrlsMap(app),
      resourceOwnership: {
        ownerAppId: app.id,
        source: 'route-owned',
        staticJson: `./locales/{lng}/${appI18nNamespace(app)}.json`,
      },
    },
    routes: {
      source: 'route-owned',
      metadataExport: './src/routes/ultramodern-route-metadata',
      localisedUrls: createLocalisedUrlsMap(app),
      owned: createRouteOwnedI18nPaths(app),
      generatedRouteMap: true,
      manualOverrides: [],
    },
    moduleFederation: {
      name: app.mfName,
      ...(appWithResolvedRefs.verticalRefs?.length
        ? {
            verticalRefs: appWithResolvedRefs.verticalRefs,
            remotes: consumedRemotes,
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
            readiness: createEffectReadinessContract(app),
            requestContext: createEffectRequestContextContract(),
            domainOperations: createEffectDomainOperations(app),
            ...createEffectOperationContract(app),
          },
        }
      : {}),
  };
}

function createGeneratedContract(
  scope: string,
  apps: WorkspaceApp[] = [shellApp, ...verticalApps],
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
    cssFederation: createCssFederationContract(scope),
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
        'Canonical shell, full-stack verticals, shared packages, and topology skeleton.',
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
        '.codex/**',
        '.github/**',
        '.gitignore',
        '.mise.toml',
        '.modernjs/**',
        'AGENTS.md',
        'README.md',
        'apps/**',
        'packages/**',
        'lefthook.yml',
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
        'path-boundary-policy',
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
        'pnpm install',
        'pnpm run ultramodern:check',
      ],
    },
  };
}

function createAssertMfTypesScript(
  remotes: WorkspaceApp[] = verticalApps,
): string {
  return `import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const generatedContractPath = path.join(
  root,
  '.modernjs/ultramodern-generated-contract.json',
);
const generatedContract = fs.existsSync(generatedContractPath)
  ? JSON.parse(fs.readFileSync(generatedContractPath, 'utf-8'))
  : undefined;
const defaultAppDirs = ${JSON.stringify(
    remotes.map(remote => remote.directory),
    null,
    2,
  )};

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(\`Usage:
  node scripts/assert-mf-types.mjs [app-dir...]

Checks that every Module Federation remote with exposed modules emitted a non-empty dist/@mf-types.zip archive and uses the workspace TypeScript compiler.
\`);
  process.exit(0);
}

const candidateDirs = args;
const appDirs = candidateDirs.length
  ? candidateDirs
  : fs.existsSync(path.join(root, 'module-federation.config.ts'))
    ? ['.']
    : defaultAppDirs;

for (const appDir of appDirs) {
  const configPath = path.join(root, appDir, 'module-federation.config.ts');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      \`Missing Module Federation config: \${path.relative(root, configPath)}\`,
    );
  }

  const contractEntry = generatedContract?.apps?.find(
    app => app.path === appDir.replace(/\\\\/g, '/'),
  );
  if (
    contractEntry &&
    contractEntry.moduleFederation?.dts?.compilerInstance !==
      '--package typescript -- tsc'
  ) {
    throw new Error(
      \`Module Federation DTS must use the workspace TypeScript compiler: \${appDir}\`,
    );
  }

  if (contractEntry && contractEntry.moduleFederation?.exposes?.length === 0) {
    continue;
  }

  const typesArchivePath = path.join(root, appDir, 'dist/@mf-types.zip');
  if (!fs.existsSync(typesArchivePath)) {
    throw new Error(
      \`Missing Module Federation DTS archive: \${path.relative(root, typesArchivePath)}\`,
    );
  }

  const stats = fs.statSync(typesArchivePath);
  if (stats.size === 0) {
    throw new Error(
      \`Empty Module Federation DTS archive: \${path.relative(root, typesArchivePath)}\`,
    );
  }
}
`;
}

function createWorkspaceValidationScript(
  scope: string,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = verticalApps,
): string {
  const verticals = remotes.filter(appHasEffectApi).map(remote => ({
    id: remote.id,
    domain: remote.domain,
    stem: remote.effectApi.stem,
    group: serviceEffectGroupName(remote),
    path: remote.directory,
    mfName: remote.mfName,
    apiPrefix: remote.effectApi.prefix,
    tailwindPrefix: tailwindPrefixForApp(remote),
    packageName: packageName(scope, remote.packageSuffix),
    exposes: Object.keys(remote.exposes ?? {}),
    componentPaths: Object.keys(remote.exposes ?? {})
      .map(expose => remoteComponentOutputPath(remote, expose))
      .filter((componentPath): componentPath is string =>
        Boolean(componentPath),
      ),
    namespace: appI18nNamespace(remote),
    routePagePaths: createRouteOwnedI18nPaths(remote)
      .filter(route => route.canonicalPath !== '/')
      .map(route => createRoutePageFilePath(remote, route.canonicalPath)),
    localisedUrls: createLocalisedUrlsMap(remote),
    verticalRefs: remote.verticalRefs ?? [],
  }));
  const shellNamespace = appI18nNamespace(shellApp);
  const oldRemotePaths = ['apps/remotes'];

  return `import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageScope = '${scope}';
const expectedPnpmVersion = '${PNPM_VERSION}';
const tailwindEnabled = ${JSON.stringify(enableTailwind)};
const fullStackVerticals = ${JSON.stringify(verticals, null, 2)};
const shellNamespace = ${JSON.stringify(shellNamespace)};
const oldRemotePaths = ${JSON.stringify(oldRemotePaths, null, 2)};

const readText = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf-8');
const readJson = relativePath => JSON.parse(readText(relativePath));
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};
const assertExists = relativePath => {
  assert(fs.existsSync(path.join(root, relativePath)), \`Missing \${relativePath}\`);
};
const assertNotExists = relativePath => {
  assert(!fs.existsSync(path.join(root, relativePath)), \`Unexpected \${relativePath}\`);
};
const expectedWorkerName = packageSuffix => \`\${packageScope}-\${packageSuffix}\`.slice(0, 63);

const activePnpmVersion = execFileSync('pnpm', ['--version'], {
  cwd: root,
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

assert(
  activePnpmVersion === expectedPnpmVersion,
  \`Generated workspace requires pnpm \${expectedPnpmVersion}; active pnpm is \${activePnpmVersion}. Run mise install, then rerun pnpm from the activated shell.\`,
);

const requiredPaths = [
  'AGENTS.md',
  '.gitignore',
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'oxlint.config.ts',
  'oxfmt.config.ts',
  '.github/renovate.json',
  '.github/workflows/ultramodern-workspace-gates.yml',
  '.agents/skills-lock.json',
  '.agents/agent-reference-repos.json',
  '.agents/rstackjs-agent-skills-LICENSE',
  'topology/reference-topology.json',
  'topology/ownership.json',
  'topology/local-overlays/development.json',
  '.modernjs/ultramodern-workspace-template-manifest.json',
  '.modernjs/ultramodern-package-source.json',
  '.modernjs/ultramodern-generated-contract.json',
  'scripts/assert-mf-types.mjs',
  'scripts/bootstrap-agent-skills.mjs',
  'scripts/proof-cloudflare-version.mjs',
  'scripts/setup-agent-reference-repos.mjs',
  'apps/shell-super-app/package.json',
  'apps/shell-super-app/modern.config.ts',
  'apps/shell-super-app/module-federation.config.ts',
  'apps/shell-super-app/src/modern-app-env.d.ts',
  'apps/shell-super-app/src/modern.runtime.ts',
  'apps/shell-super-app/src/effect/recommendations-client.ts',
  'apps/shell-super-app/locales/en/translation.json',
  \`apps/shell-super-app/locales/en/\${shellNamespace}.json\`,
  'apps/shell-super-app/locales/cs/translation.json',
  \`apps/shell-super-app/locales/cs/\${shellNamespace}.json\`,
  'apps/shell-super-app/src/routes/index.css',
  'apps/shell-super-app/src/routes/layout.tsx',
  'apps/shell-super-app/src/routes/ultramodern-route-metadata.ts',
  'apps/shell-super-app/src/routes/[lang]/page.tsx',
  'packages/shared-contracts/src/index.ts',
  'packages/shared-design-tokens/src/index.ts',
  'packages/shared-design-tokens/src/tokens.css',
  'packages/shared-effect-api/src/index.ts',
];

for (const vertical of fullStackVerticals) {
  requiredPaths.push(
    \`\${vertical.path}/package.json\`,
    \`\${vertical.path}/modern.config.ts\`,
    \`\${vertical.path}/module-federation.config.ts\`,
    \`\${vertical.path}/api/effect/index.ts\`,
    \`\${vertical.path}/shared/effect/api.ts\`,
    \`\${vertical.path}/src/effect/\${vertical.stem}-client.ts\`,
    \`\${vertical.path}/src/modern-app-env.d.ts\`,
    \`\${vertical.path}/src/modern.runtime.ts\`,
    \`\${vertical.path}/src/federation-entry.tsx\`,
    ...vertical.componentPaths,
    \`\${vertical.path}/locales/en/translation.json\`,
    \`\${vertical.path}/locales/en/\${vertical.namespace}.json\`,
    \`\${vertical.path}/locales/cs/translation.json\`,
    \`\${vertical.path}/locales/cs/\${vertical.namespace}.json\`,
    \`\${vertical.path}/src/routes/index.css\`,
    \`\${vertical.path}/src/routes/layout.tsx\`,
    \`\${vertical.path}/src/routes/ultramodern-route-metadata.ts\`,
    \`\${vertical.path}/src/routes/[lang]/page.tsx\`,
    ...vertical.routePagePaths,
  );
}

if (tailwindEnabled) {
  requiredPaths.push(
    'apps/shell-super-app/postcss.config.mjs',
    'apps/shell-super-app/tailwind.config.ts',
    ...fullStackVerticals.flatMap(vertical => [
      \`\${vertical.path}/postcss.config.mjs\`,
      \`\${vertical.path}/tailwind.config.ts\`,
    ]),
  );
}

for (const requiredPath of requiredPaths) {
  assertExists(requiredPath);
}
for (const oldRemotePath of oldRemotePaths) {
  assertNotExists(oldRemotePath);
}
assertNotExists('services/service-recommendations-effect');

const rootPackage = readJson('package.json');
const packageSource = readJson('.modernjs/ultramodern-package-source.json');
const generatedContract = readJson('.modernjs/ultramodern-generated-contract.json');
const topology = readJson('topology/reference-topology.json');
const ownership = readJson('topology/ownership.json');
const overlay = readJson('topology/local-overlays/development.json');

assert(rootPackage.private === true, 'Root package must be private');
assert(rootPackage.packageManager === \`pnpm@\${expectedPnpmVersion}\`, 'Root must pin pnpm');
assert(rootPackage.modernjs?.preset === 'presetUltramodern', 'Root must declare presetUltramodern');
assert(rootPackage.modernjs?.packageSource?.config === './.modernjs/ultramodern-package-source.json', 'Root must point at package source metadata');
assert(rootPackage.modernjs?.packageSource?.strategy === packageSource.strategy, 'Root package source strategy must match metadata');
assert(packageSource.strategy === 'workspace' || packageSource.strategy === 'install', 'Package source strategy must be workspace or install');
assert(packageSource.generatedWorkspacePackages?.specifier === 'workspace:*', 'Generated workspace packages must keep workspace:* links');
assert(
  rootPackage.scripts?.build ===
    'pnpm -r --filter "./verticals/*" run build && pnpm --filter "./apps/shell-super-app" run build && pnpm ultramodern:assert-mf-types',
  'Root build script must build verticals before shell',
);
assert(rootPackage.scripts?.['ultramodern:check'] === 'node ./scripts/validate-ultramodern-workspace.mjs', 'Root must expose ultramodern:check');
assert(rootPackage.scripts?.['ultramodern:assert-mf-types'] === 'node ./scripts/assert-mf-types.mjs', 'Root must expose ultramodern:assert-mf-types');
assert(rootPackage.scripts?.['cloudflare:deploy']?.includes('run cloudflare:deploy'), 'Root must expose cloudflare:deploy');
assert(rootPackage.scripts?.['cloudflare:proof'] === 'node ./scripts/proof-cloudflare-version.mjs --out .codex/reports/cloudflare-version-proof/public-url-proof.json', 'Root must expose cloudflare:proof');
assert(rootPackage.scripts?.['skills:install'] === 'node ./scripts/bootstrap-agent-skills.mjs', 'Root must expose skills:install');
assert(rootPackage.scripts?.['skills:check'] === 'node ./scripts/bootstrap-agent-skills.mjs --check', 'Root must expose skills:check');
assert(rootPackage.scripts?.postinstall === 'node ./scripts/bootstrap-agent-skills.mjs && (git rev-parse --is-inside-work-tree >/dev/null 2>&1 && lefthook install || true) && node ./scripts/setup-agent-reference-repos.mjs', 'Root postinstall must bootstrap agent skills and hooks before reference repositories');

const expectedAppIds = ['shell-super-app', ...fullStackVerticals.map(vertical => vertical.id)];
assert(
  JSON.stringify(generatedContract.apps?.map(app => app.id)) === JSON.stringify(expectedAppIds),
  'Generated contract must contain shell plus the Tractor full-stack verticals',
);
assert(generatedContract.cssFederation?.sharedDesignTokens?.owner?.id === 'shared-design-tokens', 'CSS federation must declare shared design token ownership');
assert(generatedContract.cssFederation?.sharedDesignTokens?.role === 'shared-design-tokens', 'CSS federation must mark shared-design-tokens as token owner');
assert(generatedContract.cssFederation?.sharedDesignTokens?.rootSelector === ':root', 'Shared design tokens must declare their root selector');
assert(generatedContract.cssFederation?.sharedDesignTokens?.classPrefix === '--um-', 'Shared design tokens must declare their CSS custom property prefix');
assert(generatedContract.cssFederation?.sharedDesignTokens?.layers?.owned?.includes('ultramodern-shared-tokens'), 'Shared design tokens must own the shared token CSS layer');
assert(generatedContract.cssFederation?.sharedDesignTokens?.entrypoints?.css?.includes('packages/shared-design-tokens/src/tokens.css'), 'Shared design tokens must declare their CSS entrypoint');
assert(generatedContract.cssFederation?.sharedDesignTokens?.assets?.exports?.includes('./tokens.css'), 'Shared design tokens must export their CSS asset');
assert(generatedContract.cssFederation?.sharedDesignTokens?.dedupe?.duplicateBaseStylesAllowed === false, 'Shared design token CSS must be deduplicated');
assert(generatedContract.cssFederation?.sharedDesignTokens?.ssr?.firstPaintRequired === true, 'Shared design token CSS must be required for SSR first paint');

const shellPackage = readJson('apps/shell-super-app/package.json');
const expectedZephyrDependencies = Object.fromEntries(
  fullStackVerticals.map(vertical => [
    vertical.domain,
    \`\${vertical.packageName}@workspace:*\`,
  ]),
);
assert(
  JSON.stringify(shellPackage['zephyr:dependencies']) ===
    JSON.stringify(expectedZephyrDependencies),
  'Shell Zephyr dependencies must reference every Tractor vertical package',
);
const shellContract = generatedContract.apps?.find(app => app.id === 'shell-super-app');
assert(shellContract?.deploy?.cloudflare?.workerName === expectedWorkerName('shell-super-app'), 'Shell Cloudflare workerName is incorrect');
assert(shellContract?.deploy?.cloudflare?.publicUrlEnv === 'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP', 'Shell Cloudflare public URL env is incorrect');
assert(topology.shell?.cloudflare?.workerName === expectedWorkerName('shell-super-app'), 'Shell topology Cloudflare workerName is incorrect');
assert(shellContract?.styling?.federation?.owner?.id === 'shell-super-app', 'Shell CSS federation owner is missing');
assert(shellContract?.styling?.federation?.role === 'shell-base-overlay', 'Shell must own base and overlay CSS');
assert(shellContract?.styling?.federation?.rootSelector === '[data-app-id="shell-super-app"]', 'Shell CSS root selector is incorrect');
assert(shellContract?.styling?.federation?.classPrefix === 'shell:', 'Shell CSS class prefix is incorrect');
assert(shellContract?.styling?.federation?.layers?.owned?.includes('ultramodern-shell-base'), 'Shell must own the base CSS layer');
assert(shellContract?.styling?.federation?.layers?.owned?.includes('ultramodern-shell-overlay'), 'Shell must own the overlay CSS layer');
assert(shellContract?.styling?.federation?.entrypoints?.css?.includes('src/routes/index.css'), 'Shell CSS entrypoint is missing');
assert(shellContract?.styling?.federation?.assets?.shared?.some(asset => asset.endsWith('/shared-design-tokens/tokens.css')), 'Shell must import the shared design token CSS asset');
assert(shellContract?.styling?.federation?.dedupe?.duplicateBaseStylesAllowed === false, 'Shell CSS contract must forbid duplicated base styles');
assert(shellContract?.styling?.federation?.ssr?.firstPaintRequired === true, 'Shell CSS must be required for SSR first paint');
assert(
  topology.shell?.verticalRefs?.join(',') === fullStackVerticals.map(vertical => vertical.id).join(','),
  'Topology shell verticalRefs must match Tractor verticals',
);
assert(topology.verticals?.length === fullStackVerticals.length, 'Topology must contain only Tractor verticals');
assert(!('remotes' in topology), 'Topology must not expose legacy remotes; use verticals');
assert(!('effectServices' in topology), 'Default APIs must be vertical-owned, not effectServices');

for (const vertical of fullStackVerticals) {
  const packageJson = readJson(\`\${vertical.path}/package.json\`);
  assert(packageJson.name === vertical.packageName, \`\${vertical.id} package name is incorrect\`);
  assert(packageJson.scripts?.['cloudflare:deploy'] === 'MODERNJS_DEPLOY=cloudflare modern deploy', \`\${vertical.id} must expose cloudflare:deploy\`);
  assert(packageJson.scripts?.['cloudflare:proof']?.includes(\`--app \${vertical.id}\`), \`\${vertical.id} must expose cloudflare:proof\`);
  assert(packageJson.dependencies?.['@modern-js/plugin-bff'], \`\${vertical.id} must depend on plugin-bff\`);
  assert(packageJson.exports?.['./effect/client'] === \`./src/effect/\${vertical.stem}-client.ts\`, \`\${vertical.id} must export its Effect client\`);
  assert(packageJson.exports?.['./shared/effect/api'] === './shared/effect/api.ts', \`\${vertical.id} must export its Effect API contract\`);
  const expectedVerticalZephyrDependencies = Object.fromEntries(
    fullStackVerticals
      .filter(candidate => vertical.verticalRefs.includes(candidate.id))
      .map(candidate => [
        candidate.domain,
        \`\${candidate.packageName}@workspace:*\`,
      ]),
  );
  assert(
    JSON.stringify(packageJson['zephyr:dependencies']) ===
      JSON.stringify(expectedVerticalZephyrDependencies),
    \`\${vertical.id} Zephyr dependencies must match declared vertical refs\`,
  );

  const contractEntry = generatedContract.apps?.find(app => app.id === vertical.id);
  assert(contractEntry?.path === vertical.path, \`\${vertical.id} generated contract path is incorrect\`);
  assert(contractEntry?.kind === 'vertical', \`\${vertical.id} generated contract kind is incorrect\`);
  assert(contractEntry?.deploy?.cloudflare?.workerName === expectedWorkerName(vertical.id), \`\${vertical.id} Cloudflare workerName is incorrect\`);
  assert(contractEntry?.deploy?.cloudflare?.publicUrlEnv === \`ULTRAMODERN_PUBLIC_URL_\${vertical.id.replace(/-/g, '_').toUpperCase()}\`, \`\${vertical.id} Cloudflare public URL env is incorrect\`);
  assert(contractEntry?.deploy?.cloudflare?.routes?.effectReadiness === \`\${vertical.apiPrefix}/effect/\${vertical.stem}/readiness\`, \`\${vertical.id} Cloudflare proof readiness route is incorrect\`);
  assert(contractEntry?.moduleFederation?.name === vertical.mfName, \`\${vertical.id} MF name is incorrect\`);
  assert(JSON.stringify(contractEntry?.moduleFederation?.exposes) === JSON.stringify(vertical.exposes), \`\${vertical.id} MF exposes are incorrect\`);
  assert(contractEntry?.moduleFederation?.dts?.compilerInstance === '--package typescript -- tsc', \`\${vertical.id} must keep mandatory DTS compiler\`);
  assert(JSON.stringify(contractEntry?.moduleFederation?.verticalRefs ?? []) === JSON.stringify(vertical.verticalRefs), \`\${vertical.id} MF verticalRefs are incorrect\`);
  assert(
    JSON.stringify((contractEntry?.moduleFederation?.remotes ?? []).map(remote => remote.id)) ===
      JSON.stringify(vertical.verticalRefs),
    \`\${vertical.id} MF consumed verticals are incorrect\`,
  );
  assert(contractEntry?.effect?.prefix === vertical.apiPrefix, \`\${vertical.id} Effect API prefix is incorrect\`);
  assert(contractEntry?.effect?.group === vertical.group, \`\${vertical.id} Effect group is incorrect\`);
  assert(contractEntry?.effect?.readiness?.endpoint === \`/effect/\${vertical.stem}/readiness\`, \`\${vertical.id} readiness endpoint is incorrect\`);
  assert(contractEntry?.effect?.operations?.readiness?.path === \`/effect/\${vertical.stem}/readiness\`, \`\${vertical.id} readiness operation is missing\`);
  assert(contractEntry?.effect?.requestContext?.propagatedHeaders?.includes('traceparent'), \`\${vertical.id} trace context propagation is missing\`);
  assert(Object.keys(contractEntry?.effect?.domainOperations ?? {}).length >= 3, \`\${vertical.id} domain operations are missing\`);
  assert(contractEntry?.i18n?.languages?.includes('en') && contractEntry?.i18n?.languages?.includes('cs'), \`\${vertical.id} must declare i18n languages\`);
  assert(contractEntry?.i18n?.namespace === vertical.namespace, \`\${vertical.id} i18n namespace is incorrect\`);
  assert(
    JSON.stringify(contractEntry?.i18n?.localisedUrls) === JSON.stringify(vertical.localisedUrls),
    \`\${vertical.id} localisedUrls must come from route metadata\`,
  );
  assert(contractEntry?.routes?.source === 'route-owned', \`\${vertical.id} routes must be route-owned\`);
  assert(contractEntry?.routes?.metadataExport === './src/routes/ultramodern-route-metadata', \`\${vertical.id} route metadata export is incorrect\`);
  assert(contractEntry?.styling?.federation?.owner?.id === vertical.id, \`\${vertical.id} CSS federation owner is missing\`);
  assert(contractEntry?.styling?.federation?.role === 'vertical-css', \`\${vertical.id} must own only vertical CSS\`);
  assert(contractEntry?.styling?.federation?.rootSelector === \`[data-app-id="\${vertical.id}"]\`, \`\${vertical.id} CSS root selector is incorrect\`);
  assert(contractEntry?.styling?.federation?.classPrefix === \`\${vertical.domain}:\`, \`\${vertical.id} CSS class prefix is incorrect\`);
  assert(contractEntry?.styling?.federation?.layers?.owned?.includes(\`ultramodern-vertical-\${vertical.domain}\`), \`\${vertical.id} vertical CSS layer is missing\`);
  assert(!contractEntry?.styling?.federation?.layers?.owned?.includes('ultramodern-shell-base'), \`\${vertical.id} must not own shell base CSS\`);
  assert(contractEntry?.styling?.federation?.entrypoints?.federationEntry === 'src/federation-entry.tsx', \`\${vertical.id} CSS contract must include federation entry\`);
  assert(contractEntry?.styling?.federation?.assets?.shared?.some(asset => asset.endsWith('/shared-design-tokens/tokens.css')), \`\${vertical.id} must import shared design token CSS\`);
  assert(contractEntry?.styling?.federation?.dedupe?.runtimeLoad === 'once-per-content-hash', \`\${vertical.id} CSS dedupe strategy is incorrect\`);
  assert(contractEntry?.styling?.federation?.ssr?.verticalCss === 'federated-manifest-owned-css', \`\${vertical.id} SSR CSS loading contract is incorrect\`);

  const topologyEntry = topology.verticals?.find(verticalEntry => verticalEntry.id === vertical.id);
  assert(topologyEntry?.kind === 'vertical', \`\${vertical.id} topology kind is incorrect\`);
  assert(topologyEntry?.package === vertical.packageName, \`\${vertical.id} topology package is incorrect\`);
  assert(topologyEntry?.cloudflare?.workerName === expectedWorkerName(vertical.id), \`\${vertical.id} topology Cloudflare workerName is incorrect\`);
  assert(topologyEntry?.moduleFederation?.name === vertical.mfName, \`\${vertical.id} topology MF name is incorrect\`);
  assert(JSON.stringify(topologyEntry?.moduleFederation?.exposes) === JSON.stringify(vertical.exposes), \`\${vertical.id} topology exposes are incorrect\`);
  assert(JSON.stringify(topologyEntry?.moduleFederation?.verticalRefs ?? []) === JSON.stringify(vertical.verticalRefs), \`\${vertical.id} topology verticalRefs are incorrect\`);
  assert(topologyEntry?.api?.effect?.bff?.prefix === vertical.apiPrefix, \`\${vertical.id} topology API prefix is incorrect\`);
  assert(topologyEntry?.api?.effect?.serverEntry === \`\${vertical.path}/api/effect/index.ts\`, \`\${vertical.id} topology server entry is incorrect\`);
  assert(topologyEntry?.api?.effect?.readiness?.endpoint === \`/effect/\${vertical.stem}/readiness\`, \`\${vertical.id} topology readiness endpoint is incorrect\`);
  assert(Object.keys(topologyEntry?.api?.effect?.domainOperations ?? {}).length >= 3, \`\${vertical.id} topology domain operations are missing\`);

  assert(ownership.owners?.some(owner => owner.id === vertical.id && owner.path === vertical.path), \`\${vertical.id} ownership entry is missing\`);
  assert(overlay.ports?.[vertical.id], \`\${vertical.id} development port is missing\`);
  assert(overlay.manifests?.[vertical.id]?.includes('/mf-manifest.json'), \`\${vertical.id} development manifest is missing\`);
  assert(overlay.apis?.[vertical.id]?.endsWith(vertical.apiPrefix), \`\${vertical.id} development API URL is missing\`);
}

console.log('UltraModern workspace scaffold validated');
`;
}

function createCloudflareVersionProofScript(): string {
  return `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const contractPath = path.join(
  workspaceRoot,
  '.modernjs/ultramodern-generated-contract.json',
);
const defaultOut = path.join(
  workspaceRoot,
  '.codex/reports/cloudflare-version-proof/public-url-proof.json',
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const parsed = {
    appId: undefined,
    out: defaultOut,
    requirePublicUrls: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--app') {
      parsed.appId = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      parsed.out = argv[index + 1];
      index += 1;
    } else if (arg === '--require-public-urls') {
      parsed.requirePublicUrls = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(\`Unknown argument: \${arg}\`);
    }
  }

  return parsed;
}

function printHelp() {
  process.stdout.write(\`Usage:
  node scripts/proof-cloudflare-version.mjs [--app explore] [--out evidence.json] [--require-public-urls]

Set each app's public URL using the contract env key, for example:
  ULTRAMODERN_PUBLIC_URL_EXPLORE=https://explore.example.workers.dev
\`);
}

function joinUrl(baseUrl, routePath) {
  return new URL(routePath, baseUrl.endsWith('/') ? baseUrl : \`\${baseUrl}/\`);
}

function normalizeUrlWithTrailingSlash(url) {
  return url.endsWith('/') ? url : \`\${url}/\`;
}

async function fetchText(url) {
  const response = await fetch(url);
  return {
    ok: response.ok,
    status: response.status,
    accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
    contentType: response.headers.get('content-type'),
    body: await response.text(),
  };
}

function parseMaybeJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function markerFromJson(value) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  if (value.marker && typeof value.marker.build === 'string') {
    return value.marker.build;
  }
  if (typeof value.build === 'string') {
    return value.build;
  }
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const marker = markerFromJson(item);
        if (marker) {
          return marker;
        }
      }
    } else {
      const marker = markerFromJson(nested);
      if (marker) {
        return marker;
      }
    }
  }
  return undefined;
}

function extractUiMarker(html) {
  return html.match(/data-build-marker=["']([^"']+)["']/u)?.[1];
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function validateApp(app, publicUrl) {
  const cloudflare = app.deploy?.cloudflare;
  const routes = cloudflare?.routes ?? {};
  const evidence = {
    appId: app.id,
    publicUrl,
    workerName: cloudflare?.workerName,
    publicUrlEnv: cloudflare?.publicUrlEnv,
    assertions: [],
  };

  const ssrRoute = routes.ssr ?? '/en';
  const ssr = await fetchText(joinUrl(publicUrl, ssrRoute));
  evidence.assertions.push({
    type: 'ssr',
    route: ssrRoute,
    status: ssr.ok ? 'pass' : 'fail',
    statusCode: ssr.status,
  });
  assert(ssr.ok, \`\${app.id} SSR route returned HTTP \${ssr.status}\`);

  const uiMarker = extractUiMarker(ssr.body);
  evidence.assertions.push({
    type: 'ui-marker',
    expected: app.marker?.build,
    actual: uiMarker,
    status: uiMarker === app.marker?.build ? 'pass' : 'fail',
  });
  assert(uiMarker === app.marker?.build, \`\${app.id} UI marker mismatch\`);

  const cssRootSelector = app.styling?.federation?.rootSelector;
  const expectedAppId = cssRootSelector?.match(/data-app-id="([^"]+)"/u)?.[1];
  evidence.assertions.push({
    type: 'css-root-marker',
    expected: cssRootSelector,
    status:
      expectedAppId && ssr.body.includes(\`data-app-id="\${expectedAppId}"\`)
        ? 'pass'
        : 'fail',
  });
  assert(
    expectedAppId && ssr.body.includes(\`data-app-id="\${expectedAppId}"\`),
    \`\${app.id} SSR response is missing CSS root marker \${cssRootSelector}\`,
  );

  const manifestRoute = routes.mfManifest ?? '/mf-manifest.json';
  const manifest = await fetchText(joinUrl(publicUrl, manifestRoute));
  const manifestJson = parseMaybeJson(manifest.body);
  evidence.assertions.push({
    type: 'mf-manifest',
    route: manifestRoute,
    status: manifest.ok ? 'pass' : 'fail',
    statusCode: manifest.status,
  });
  assert(
    manifest.ok,
    \`\${app.id} MF manifest returned HTTP \${manifest.status}\`,
  );
  evidence.assertions.push({
    type: 'mf-manifest-cors',
    route: manifestRoute,
    actual: manifest.accessControlAllowOrigin,
    status: manifest.accessControlAllowOrigin === '*' ? 'pass' : 'fail',
  });
  assert(
    manifest.accessControlAllowOrigin === '*',
    \`\${app.id} MF manifest is missing Cloudflare CORS headers\`,
  );
  const expectedPublicPath = normalizeUrlWithTrailingSlash(publicUrl);
  const manifestPublicPath = manifestJson?.metaData?.publicPath;
  evidence.assertions.push({
    type: 'mf-manifest-public-path',
    expected: expectedPublicPath,
    actual: manifestPublicPath,
    status: manifestPublicPath === expectedPublicPath ? 'pass' : 'fail',
  });
  assert(
    manifestPublicPath === expectedPublicPath,
    \`\${app.id} MF manifest publicPath must resolve remote assets from \${expectedPublicPath}\`,
  );

  const localeRoute = routes.locale ?? \`/locales/en/\${app.i18n?.namespace}.json\`;
  const locale = await fetchText(joinUrl(publicUrl, localeRoute));
  const localeJson = parseMaybeJson(locale.body);
  evidence.assertions.push({
    type: 'i18n-marker',
    namespace: app.i18n?.namespace,
    route: localeRoute,
    status:
      locale.ok &&
      localeJson &&
      Object.hasOwn(localeJson, app.i18n?.namespace)
        ? 'pass'
        : 'fail',
    statusCode: locale.status,
  });
  assert(locale.ok, \`\${app.id} locale JSON returned HTTP \${locale.status}\`);
  evidence.assertions.push({
    type: 'i18n-cors',
    route: localeRoute,
    actual: locale.accessControlAllowOrigin,
    status: locale.accessControlAllowOrigin === '*' ? 'pass' : 'fail',
  });
  assert(
    locale.accessControlAllowOrigin === '*',
    \`\${app.id} locale JSON is missing Cloudflare CORS headers\`,
  );
  assert(
    localeJson && Object.hasOwn(localeJson, app.i18n?.namespace),
    \`\${app.id} locale JSON is missing namespace \${app.i18n?.namespace}\`,
  );

  if (routes.effectReadiness) {
    const readiness = await fetchText(joinUrl(publicUrl, routes.effectReadiness));
    const readinessJson = parseMaybeJson(readiness.body);
    const apiMarker = markerFromJson(readinessJson);
    evidence.assertions.push({
      type: 'api-marker',
      route: routes.effectReadiness,
      expected: app.marker?.build,
      actual: apiMarker,
      status: readiness.ok && apiMarker === app.marker?.build ? 'pass' : 'fail',
      statusCode: readiness.status,
    });
    assert(
      readiness.ok,
      \`\${app.id} Effect readiness returned HTTP \${readiness.status}\`,
    );
    assert(apiMarker === app.marker?.build, \`\${app.id} API marker mismatch\`);
  }

  return evidence;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const contract = readJson(contractPath);
  const apps = args.appId
    ? contract.apps.filter(app => app.id === args.appId)
    : contract.apps;
  assert(apps.length > 0, \`No generated app matched \${args.appId}\`);

  const results = [];
  const skipped = [];
  for (const app of apps) {
    const publicUrlEnv = app.deploy?.cloudflare?.publicUrlEnv;
    const publicUrl = publicUrlEnv && process.env[publicUrlEnv];
    if (!publicUrl) {
      const skippedEntry = {
        appId: app.id,
        status: args.requirePublicUrls ? 'fail' : 'skipped',
        publicUrlEnv,
        reason: 'public URL environment variable is not set',
      };
      skipped.push(skippedEntry);
      if (args.requirePublicUrls) {
        throw new Error(\`\${app.id} requires \${publicUrlEnv}\`);
      }
      continue;
    }
    results.push(await validateApp(app, publicUrl));
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: results.length > 0 ? 'pass' : 'skipped',
    contractPath,
    results,
    skipped,
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, \`\${JSON.stringify(report, null, 2)}\\n\`);
  process.stdout.write(
    \`[cloudflare-version-proof] \${report.status}: \${args.out}\\n\`,
  );
  return 0;
}

main().then(
  exitCode => {
    process.exitCode = exitCode;
  },
  error => {
    process.stderr.write(\`[cloudflare-version-proof] \${error.message}\\n\`);
    process.exitCode = 1;
  },
);
`;
}

function writeGeneratedWorkspaceScripts(
  targetDir: string,
  scope: string,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = verticalApps,
) {
  writeFileReplacing(
    targetDir,
    'scripts/assert-mf-types.mjs',
    createAssertMfTypesScript(),
  );
  writeFileReplacing(
    targetDir,
    'scripts/validate-ultramodern-workspace.mjs',
    createWorkspaceValidationScript(scope, enableTailwind, remotes),
  );
  writeFileReplacing(
    targetDir,
    'scripts/proof-cloudflare-version.mjs',
    createCloudflareVersionProofScript(),
  );
}

function writeApp(
  targetDir: string,
  scope: string,
  app: WorkspaceApp,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
) {
  const writeAppFile = (relativePath: string, content: string) => {
    writeFile(targetDir, `${app.directory}/${relativePath}`, content);
  };

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
    createAppEnvDts(app),
  );
  writeFile(
    targetDir,
    `${app.directory}/src/ultramodern-build.ts`,
    createUltramodernBuildModule(scope, app),
  );
  writeFile(
    targetDir,
    `${app.directory}/src/routes/ultramodern-route-metadata.ts`,
    createRouteMetadataModule(app),
  );
  writeFile(
    targetDir,
    `${app.directory}/modern.config.ts`,
    createAppModernConfig(scope, app),
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
    `${app.directory}/locales/en/${appI18nNamespace(app)}.json`,
    createAppLocaleMessages(app, 'en'),
  );
  writeJson(
    targetDir,
    `${app.directory}/locales/cs/translation.json`,
    createAppLocaleMessages(app, 'cs'),
  );
  writeJson(
    targetDir,
    `${app.directory}/locales/cs/${appI18nNamespace(app)}.json`,
    createAppLocaleMessages(app, 'cs'),
  );
  writeFile(
    targetDir,
    `${app.directory}/src/routes/index.css`,
    createAppStyles(enableTailwind, scope, app),
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
  writeAppFile('src/routes/layout.tsx', createLayout(app.id));
  for (const [relativePath, content] of Object.entries(
    commerceAssetsForApp(app),
  )) {
    writeFile(targetDir, `${app.directory}/${relativePath}`, content);
  }
  writeAppFile(
    'src/routes/[lang]/page.tsx',
    app.kind === 'shell' ? createShellPage() : createRemotePage(app),
  );
  for (const route of createRouteOwnedI18nPaths(app)) {
    if (route.canonicalPath === '/' || app.kind === 'shell') {
      continue;
    }

    writeFile(
      targetDir,
      createRoutePageFilePath(app, route.canonicalPath),
      createRouteAliasPage(route.canonicalPath),
    );
  }

  if (app.kind === 'shell') {
    writeAppFile(
      'src/routes/vertical-components.tsx',
      createShellRemoteComponents(scope),
    );
    writeAppFile('src/routes/shell-frame.tsx', createShellFrameComponent());
    writeAppFile(
      'src/routes/boundary-overlay.tsx',
      createShellBoundaryOverlay(),
    );
    writeFile(
      targetDir,
      `${app.directory}/src/effect/recommendations-client.ts`,
      createShellEffectClient(scope),
    );
    writeAppFile(
      'src/routes/[lang]/tractors/page.tsx',
      createShellTractorsPage(),
    );
    writeAppFile('src/routes/[lang]/stores/page.tsx', createShellStoresPage());
    writeAppFile(
      'src/routes/[lang]/tractors/[slug]/page.tsx',
      createShellProductPage(),
    );
    writeAppFile('src/routes/[lang]/cart/page.tsx', createShellCartPage());
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

  if (app.kind === 'vertical') {
    writeAppFile('src/federation-entry.tsx', createRemoteEntry(app));
    if (app.id === 'decide') {
      writeAppFile(
        'src/components/vertical-components.tsx',
        createDecideRemoteComponents(scope, app),
      );
    }
    if (app.id === 'checkout') {
      writeFile(
        targetDir,
        `${app.directory}/src/cart-store.ts`,
        createCheckoutCartStore(),
      );
    }
    for (const expose of Object.keys(app.exposes ?? {})) {
      const outputPath = remoteComponentOutputPath(app, expose);

      if (outputPath) {
        writeAppFile(
          outputPath.slice(app.directory.length + 1),
          createRemoteExposeComponent(app, expose),
        );
      }
    }
  }

  if (app.kind === 'horizontal-design-system') {
    writeAppFile('src/components/button.tsx', createDesignButton(app));
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
  service,
) {
  const tw = createTw(tailwindPrefixForService(service));
  const writeServiceFile = (relativePath: string, content: string) => {
    writeFile(targetDir, `${service.directory}/${relativePath}`, content);
  };

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
  writeServiceFile(
    'src/routes/page.tsx',
    `export default function ${toPascalCase(service.id)}Home() {
  return (
    <main className="${tw('min-h-screen bg-um-canvas px-4 py-6 text-um-foreground sm:px-8')}">
      <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}">
        <h1 className="${tw('text-3xl font-black')}">${service.id} Effect service</h1>
      </section>
    </main>
  );
}
`,
  );
  writeFile(
    targetDir,
    `${service.directory}/src/routes/index.css`,
    createServiceStyles(enableTailwind, scope, service),
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
  if (sharedPackage.id === 'shared-design-tokens') {
    writeFile(
      targetDir,
      `${sharedPackage.directory}/src/tokens.css`,
      createSharedDesignTokensCss(),
    );
  }
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
    'packages/shared-design-tokens/src/tokens.css',
    createSharedDesignTokensCss(),
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

function appendEffectSharedApiContract(targetDir: string, service) {
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

function existingTailwindEnabled(workspaceRoot: string): boolean {
  const contractPath = path.join(workspaceRoot, GENERATED_CONTRACT_PATH);
  if (!fs.existsSync(contractPath)) {
    return true;
  }
  const contract = readJsonFile(contractPath);
  const apps =
    isRecord(contract) && Array.isArray(contract.apps) ? contract.apps : [];
  const shell = apps.find(
    (app: unknown): app is Record<string, JsonValue> =>
      isRecord(app) && app.id === shellApp.id,
  );
  return shell?.styling && isRecord(shell.styling)
    ? shell.styling.tailwind !== false
    : true;
}

function assertValidVerticalName(name: string): string {
  const normalized = toKebabCase(name);
  if (!normalized || normalized !== name) {
    throw new Error(
      `Invalid Vertical name "${name}". Use lowercase kebab-case.`,
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

function verticalTopologyEntry(
  scope: string,
  vertical: WorkspaceApp,
): JsonValue {
  return {
    id: vertical.id,
    kind: vertical.kind,
    domain: vertical.domain,
    package: packageName(scope, vertical.packageSuffix),
    path: vertical.directory,
    moduleFederation: {
      role: 'remote',
      name: vertical.mfName,
      manifestUrl: `http://localhost:${vertical.port}/mf-manifest.json`,
      exposes: Object.keys(vertical.exposes ?? {}),
      ...(vertical.verticalRefs?.length
        ? {
            verticalRefs: vertical.verticalRefs,
            remotes: createModuleFederationRemoteContracts(vertical),
          }
        : {}),
      ssr: true,
      fallbackTelemetryEvent: 'modernjs:mv-runtime-parity',
      sharedContractVersion: 'mf-ssr-contract-v1',
    },
    ...(effectApiTopologyMetadata(vertical)
      ? { api: effectApiTopologyMetadata(vertical) }
      : {}),
    cloudflare: createCloudflareDeployContract(scope, vertical),
    ownership: vertical.ownership,
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

function verticalsFromTopology(
  topology: Record<string, any>,
  ports: Record<string, unknown>,
) {
  return (topology.verticals ?? []).map((vertical: any) => {
    const domain = vertical.domain ?? String(vertical.id);
    const packageSuffix = vertical.package?.split('/').at(-1) ?? domain;
    const effectApi = vertical.api?.effect
      ? ({
          stem:
            typeof vertical.api.effect.basePath === 'string'
              ? (vertical.api.effect.basePath
                  .split('/')
                  .filter(Boolean)
                  .at(-1) ?? domain)
              : domain,
          prefix: vertical.api.effect.bff?.prefix ?? `/${domain}-api`,
          consumedBy: Array.isArray(vertical.api.effect.consumedBy)
            ? vertical.api.effect.consumedBy
            : [shellApp.id, vertical.id],
        } satisfies WorkspaceEffectApi)
      : undefined;

    return {
      id: vertical.id,
      directory:
        typeof vertical.path === 'string'
          ? vertical.path
          : `verticals/${domain}`,
      packageSuffix,
      displayName: vertical.displayName ?? `${toPascalCase(domain)} Vertical`,
      kind: 'vertical',
      domain,
      portEnv: '',
      port: typeof ports[vertical.id] === 'number' ? ports[vertical.id] : 0,
      mfName:
        vertical.moduleFederation?.name ?? `vertical${toPascalCase(domain)}`,
      ...(Array.isArray(vertical.moduleFederation?.exposes)
        ? {
            exposes: Object.fromEntries(
              vertical.moduleFederation.exposes.map((expose: string) => [
                expose,
                '',
              ]),
            ),
          }
        : {}),
      ...(Array.isArray(vertical.moduleFederation?.verticalRefs)
        ? { verticalRefs: vertical.moduleFederation.verticalRefs }
        : Array.isArray(vertical.moduleFederation?.remotes)
          ? {
              verticalRefs: vertical.moduleFederation.remotes
                .map((entry: any) => entry.id)
                .filter((id: unknown): id is string => typeof id === 'string'),
            }
          : {}),
      ...(effectApi ? { effectApi } : {}),
      ownership: vertical.ownership ?? createNeutralOwnership(vertical.id),
    };
  }) as WorkspaceApp[];
}

export function addUltramodernVertical(options: AddUltramodernVerticalOptions) {
  const name = assertValidVerticalName(options.name);
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
  const enableTailwind =
    options.enableTailwind ?? existingTailwindEnabled(options.workspaceRoot);
  const port = nextAvailablePort(overlay.ports);

  const vertical = createVerticalDescriptor(name, port);
  assertCanCreate(options.workspaceRoot, vertical.directory);
  if (
    (topology.verticals ?? []).some((entry: any) => entry.id === vertical.id)
  ) {
    throw new Error(`Topology already contains ${vertical.id}`);
  }
  if (Object.values(overlay.ports).includes(vertical.port)) {
    throw new Error(`Development port ${vertical.port} is already in use`);
  }

  writeApp(
    options.workspaceRoot,
    scope,
    vertical,
    packageSource,
    enableTailwind,
  );
  topology.shell ??= {};
  topology.shell.verticalRefs ??= [];
  topology.shell.verticalRefs.push(vertical.id);
  topology.shell.moduleFederation ??= {};
  topology.shell.moduleFederation.remotes ??= [];
  topology.shell.moduleFederation.remotes.push({
    id: vertical.id,
    name: vertical.mfName,
    manifestUrl: `http://localhost:${vertical.port}/mf-manifest.json`,
  });
  topology.verticals ??= [];
  topology.verticals.push(verticalTopologyEntry(scope, vertical));
  ownership.owners ??= [];
  ownership.owners.push(ownershipEntry(scope, vertical));
  overlay.ports[vertical.id] = vertical.port;
  overlay.manifests ??= {};
  overlay.manifests[vertical.id] =
    `http://localhost:${vertical.port}/mf-manifest.json`;
  overlay.apis ??= {};
  overlay.apis[vertical.id] =
    `http://localhost:${vertical.port}${effectApiPrefix(vertical)}`;
  writeJsonFile(topologyPath, topology as JsonValue);
  writeJsonFile(ownershipPath, ownership as JsonValue);
  writeJsonFile(overlayPath, overlay as JsonValue);
  const updatedVerticals = verticalsFromTopology(topology, overlay.ports);
  assertUniqueTailwindPrefixes([shellApp, ...updatedVerticals]);
  writeJsonFile(
    path.join(options.workspaceRoot, GENERATED_CONTRACT_PATH),
    createGeneratedContract(
      scope,
      [
        {
          ...shellApp,
          verticalRefs: updatedVerticals.map(vertical => vertical.id),
        },
        ...updatedVerticals,
      ],
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
    createShellModuleFederationConfig(updatedVerticals),
  );
  if (!fs.existsSync(shellConfigPath)) {
    throw new Error('Shell Module Federation config was not regenerated');
  }
  writeGeneratedWorkspaceScripts(
    options.workspaceRoot,
    scope,
    enableTailwind,
    updatedVerticals,
  );
  addShellZephyrDependency(options.workspaceRoot, scope, vertical);
  addShellWorkspaceDependency(options.workspaceRoot, scope, vertical);
  addRootDevScript(options.workspaceRoot, scope, vertical.packageSuffix, name);
}

export function generateUltramodernWorkspace(
  options: UltramodernWorkspaceOptions,
) {
  const scope = toPackageScope(options.packageName);
  const packageSource = resolvePackageSource(options);
  const enableTailwind = options.enableTailwind !== false;
  assertUniqueTailwindPrefixes([shellApp, ...verticalApps]);
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
    createGeneratedContract(scope, [shellApp, ...verticalApps], enableTailwind),
  );

  writeApp(options.targetDir, scope, shellApp, packageSource, enableTailwind);
  for (const remote of verticalApps) {
    writeApp(options.targetDir, scope, remote, packageSource, enableTailwind);
  }
  writeSharedPackages(options.targetDir, scope, packageSource);
  writeGeneratedWorkspaceScripts(options.targetDir, scope, enableTailwind);
}

export const ultramodernWorkspaceVersions = {
  tanstackRouter: TANSTACK_ROUTER_VERSION,
  moduleFederation: MODULE_FEDERATION_VERSION,
  tailwind: TAILWIND_VERSION,
  tailwindPostcss: TAILWIND_POSTCSS_VERSION,
};
