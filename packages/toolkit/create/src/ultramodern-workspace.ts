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

const TANSTACK_ROUTER_VERSION = '1.170.0';
const MODULE_FEDERATION_VERSION = '2.4.0';
const TYPESCRIPT_VERSION = '6.0.3';
const REACT_VERSION = '^19.2.6';
const REACT_DOM_VERSION = '^19.2.6';
const WORKSPACE_PACKAGE_VERSION = 'workspace:*';
const modernPackageNames = [
  '@modern-js/app-tools',
  '@modern-js/plugin-bff',
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
      './Widget': './src/components/CommerceWidget.tsx',
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
      './Widget': './src/components/IdentityWidget.tsx',
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
      './Button': './src/components/Button.tsx',
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
  };
}

function modernPackageVersion(packageSource: ResolvedPackageSource): string {
  return packageSource.strategy === 'install'
    ? packageSource.modernPackageVersion
    : WORKSPACE_PACKAGE_VERSION;
}

function appDependencies(
  scope: string,
  packageSource: ResolvedPackageSource,
): Record<string, string> {
  const modernVersion = modernPackageVersion(packageSource);
  return {
    '@modern-js/plugin-tanstack': modernVersion,
    '@modern-js/runtime': modernVersion,
    '@module-federation/modern-js-v3': MODULE_FEDERATION_VERSION,
    '@module-federation/runtime': MODULE_FEDERATION_VERSION,
    '@tanstack/react-router': TANSTACK_ROUTER_VERSION,
    [packageName(scope, 'shared-contracts')]: WORKSPACE_PACKAGE_VERSION,
    [packageName(scope, 'shared-design-tokens')]: WORKSPACE_PACKAGE_VERSION,
    react: REACT_VERSION,
    'react-dom': REACT_DOM_VERSION,
  };
}

function appDevDependencies(
  packageSource: ResolvedPackageSource,
): Record<string, string> {
  return {
    '@modern-js/app-tools': modernPackageVersion(packageSource),
    '@types/node': '^20',
    '@types/react': '^19.1.8',
    '@types/react-dom': '^19.1.6',
    typescript: TYPESCRIPT_VERSION,
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
      typecheck:
        'pnpm -r --filter ./apps/** --filter ./services/** --filter ./packages/** typecheck',
      'ultramodern:check': 'node ./scripts/validate-ultramodern-workspace.mjs',
      check: 'pnpm ultramodern:check',
    },
    engines: {
      node: '>=20',
      pnpm: '>=10.0.0',
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
      '@biomejs/biome': '1.9.4',
      typescript: TYPESCRIPT_VERSION,
    },
  };
}

function createTsConfigBase(scope: string): JsonValue {
  return {
    compilerOptions: {
      target: 'ES2022',
      lib: ['DOM', 'DOM.Iterable', 'ES2022'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'preserve',
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      baseUrl: '.',
      paths: Object.fromEntries(
        sharedPackages.map(sharedPackage => [
          packageName(scope, sharedPackage.id),
          [`${sharedPackage.directory}/src/index.ts`],
        ]),
      ),
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
    compilerOptions: {
      baseUrl: '.',
      paths: {
        '@/*': ['./src/*'],
        '@api/*': ['./api/*'],
        '@shared/*': ['./shared/*'],
      },
    },
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
      typecheck: 'tsgo --noEmit -p tsconfig.json',
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
  const modernVersion = modernPackageVersion(packageSource);
  return {
    private: true,
    name: packageName(scope, effectService.packageSuffix),
    version: '0.1.0',
    scripts: {
      dev: 'modern dev',
      build: 'modern build',
      serve: 'modern serve',
      typecheck: 'tsgo --noEmit -p tsconfig.json',
    },
    modernjs: {
      preset: 'presetUltramodern',
      role: 'effect-service',
      appId: effectService.id,
      topology: `${relativeRootFor(effectService.directory)}/topology/reference-topology.json`,
    },
    dependencies: {
      '@modern-js/runtime': modernVersion,
      [packageName(scope, 'shared-effect-api')]: WORKSPACE_PACKAGE_VERSION,
      react: REACT_VERSION,
      'react-dom': REACT_DOM_VERSION,
    },
    devDependencies: {
      '@modern-js/app-tools': modernVersion,
      '@modern-js/plugin-bff': modernVersion,
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
      typecheck: 'tsgo --noEmit -p tsconfig.json',
    },
    devDependencies: {
      typescript: TYPESCRIPT_VERSION,
    },
  };
}

function createAppModernConfig(app: WorkspaceApp): string {
  return `import { appTools, defineConfig, presetUltramodern } from '@modern-js/app-tools';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';

const appId = '${app.id}';
const port = Number(process.env.${app.portEnv} ?? ${app.port});

export default defineConfig(
  presetUltramodern(
    {
      server: {
        port,
        ssr: {
          mode: 'string',
          moduleFederationAppSSR: true,
        },
      },
      output: {
        polyfill: 'off',
        disableTsChecker: true,
        splitRouteChunks: false,
      },
      plugins: [
        appTools(),
        tanstackRouterPlugin(),
        moduleFederationPlugin(),
      ],
    },
    {
      appId,
      enableModuleFederationSSR: true,
      enableBffRequestId: true,
      enableTelemetryExporters: true,
      telemetryFailLoudStartup: false,
    },
  ),
);
`;
}

function createShellModuleFederationConfig(): string {
  return `import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const runtimeVersion = (
  require('@modern-js/runtime/package.json') as { version: string }
).version;
const reactVersion = (require('react/package.json') as { version: string })
  .version;
const reactDomVersion = (
  require('react-dom/package.json') as { version: string }
).version;

export default createModuleFederationConfig({
  name: '${shellApp.mfName}',
  dts: false,
  remotes: {
    commerce:
      process.env.REMOTE_COMMERCE_MF_MANIFEST ??
      'remoteCommerce@http://localhost:3021/mf-manifest.json',
    identity:
      process.env.REMOTE_IDENTITY_MF_MANIFEST ??
      'remoteIdentity@http://localhost:3022/mf-manifest.json',
    designSystem:
      process.env.REMOTE_DESIGN_SYSTEM_MF_MANIFEST ??
      'remoteDesignSystem@http://localhost:3023/mf-manifest.json',
  },
  shared: {
    react: {
      singleton: true,
      requiredVersion: reactVersion,
      treeShaking: false,
    },
    'react-dom': {
      singleton: true,
      requiredVersion: reactDomVersion,
      treeShaking: false,
    },
    '@tanstack/react-router': {
      singleton: true,
      requiredVersion: dependencies['@tanstack/react-router'],
      treeShaking: false,
    },
    '@modern-js/runtime': {
      singleton: true,
      requiredVersion: runtimeVersion,
      treeShaking: false,
    },
  },
});
`;
}

function createRemoteModuleFederationConfig(app: WorkspaceApp): string {
  const exposes = JSON.stringify(app.exposes ?? {}, null, 4).replace(
    /^/gm,
    '  ',
  );
  return `import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const runtimeVersion = (
  require('@modern-js/runtime/package.json') as { version: string }
).version;
const reactVersion = (require('react/package.json') as { version: string })
  .version;
const reactDomVersion = (
  require('react-dom/package.json') as { version: string }
).version;

export default createModuleFederationConfig({
  name: '${app.mfName}',
  dts: false,
  filename: 'remoteEntry.js',
  exposes: ${exposes},
  shared: {
    react: {
      singleton: true,
      requiredVersion: reactVersion,
      treeShaking: false,
    },
    'react-dom': {
      singleton: true,
      requiredVersion: reactDomVersion,
      treeShaking: false,
    },
    '@tanstack/react-router': {
      singleton: true,
      requiredVersion: dependencies['@tanstack/react-router'],
      treeShaking: false,
    },
    '@modern-js/runtime': {
      singleton: true,
      requiredVersion: runtimeVersion,
      treeShaking: false,
    },
  },
});
`;
}

function createServiceModernConfig(): string {
  return `import { appTools, defineConfig, presetUltramodern } from '@modern-js/app-tools';
import { bffPlugin } from '@modern-js/plugin-bff';

const appId = '${effectService.id}';
const port = Number(process.env.${effectService.portEnv} ?? ${effectService.port});

export default defineConfig(
  presetUltramodern(
    {
      server: {
        port,
      },
      bff: {
        prefix: '/recommendations-api',
        runtimeFramework: 'effect',
        effect: {
          openapi: {
            path: '/openapi.json',
          },
        },
      },
      plugins: [appTools(), bffPlugin()],
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

function createShellPage(): string {
  return `const remotes = [
  'remote-commerce',
  'remote-identity',
  'remote-design-system',
];

export default function ShellHome() {
  return (
    <main>
      <h1>UltraModern SuperApp Shell</h1>
      <p data-testid="ultramodern-preset">presetUltramodern workspace</p>
      <ul>
        {remotes.map(remote => (
          <li key={remote}>{remote}</li>
        ))}
      </ul>
    </main>
  );
}
`;
}

function createRemotePage(app: WorkspaceApp): string {
  return `export default function ${toPascalCase(app.id)}Home() {
  return (
    <main>
      <h1>${app.displayName}</h1>
      <p data-mf-role="${app.kind}">${app.domain ?? app.kind}</p>
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
  const componentName =
    app.id === 'remote-identity' ? 'IdentityWidget' : 'CommerceWidget';
  return `export { default } from './components/${componentName}';
`;
}

function createRemoteWidget(app: WorkspaceApp): string {
  const componentName =
    app.id === 'remote-identity' ? 'IdentityWidget' : 'CommerceWidget';
  return `export default function ${componentName}() {
  return (
    <section data-mf-remote="${app.id}">
      <h2>${app.displayName}</h2>
      <p>Owns the ${app.domain} vertical route surface.</p>
    </section>
  );
}
`;
}

function createDesignButton(): string {
  return `import { designTokens } from '../tokens';

export default function Button({ label = 'Design System Button' }: { label?: string }) {
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
    foreground: '#133225',
    accent: '#2f8f68',
  },
  radius: {
    control: '999px',
  },
} as const;
`;
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

export const recommendationsEffectApi = HttpApi.make(
  'RecommendationsEffectApi',
).add(
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
  (handlers: any) =>
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
  } = {
    packages: modernPackageNames,
    specifier: modernPackageVersion(packageSource),
  };

  if (packageSource.registry) {
    modernPackages.registry = packageSource.registry;
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
        '.modernjs/**',
        'README.md',
        'apps/**',
        'packages/**',
        'package.json',
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
        'template-manifest-retained',
      ],
      expectedCommands: [
        'pnpm install --ignore-scripts',
        'pnpm run ultramodern:check',
      ],
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
    "/// <reference types='@modern-js/app-tools/types' />\n",
  );
  writeFile(
    targetDir,
    `${app.directory}/modern.config.ts`,
    createAppModernConfig(app),
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
    `${app.directory}/src/routes/page.tsx`,
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
        ? 'IdentityWidget.tsx'
        : 'CommerceWidget.tsx';
    writeFile(
      targetDir,
      `${app.directory}/src/components/${widgetFile}`,
      createRemoteWidget(app),
    );
  }

  if (app.kind === 'horizontal-design-system') {
    writeFile(
      targetDir,
      `${app.directory}/src/components/Button.tsx`,
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
  preset: 'presetUltramodern',
  topology: 'topology/reference-topology.json',
  ownership: 'topology/ownership.json',
} as const;
`,
  );
  writeFile(
    targetDir,
    'packages/shared-design-tokens/src/index.ts',
    `export const sharedDesignTokens = {
  color: {
    surface: '#f6fbf7',
    foreground: '#133225',
    accent: '#2f8f68',
  },
} as const;
`,
  );
  writeFile(
    targetDir,
    'packages/shared-effect-api/src/index.ts',
    `export type Recommendation = {
  id: string;
  title: string;
};

export const recommendationsApiContract = {
  serviceId: '${effectService.id}',
  basePath: '/recommendations-api/effect/recommendations',
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
  writeJson(options.targetDir, 'tsconfig.base.json', createTsConfigBase(scope));
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
