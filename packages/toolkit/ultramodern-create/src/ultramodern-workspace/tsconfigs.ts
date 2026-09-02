import path from 'node:path';
import { appHasApi, resolveRemoteRefs, sharedPackages } from './descriptors';
import { effectDiagnostics } from './effect-diagnostics';
import { relativeRootFor } from './naming';
import type { JsonValue, WorkspaceApp } from './types';
export function createTsConfigBase(): JsonValue {
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
      allowImportingTsExtensions: true,
      allowJs: true,
      esModuleInterop: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      noPropertyAccessFromIndexSignature: true,
      noImplicitReturns: true,
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

function createTsBuildInfoFile(packageDir: string): string {
  const cacheKey = packageDir.replace(/[^a-zA-Z0-9._-]+/gu, '__');
  return `${relativeRootFor(packageDir)}/node_modules/.cache/tsgo/${cacheKey}.tsbuildinfo`;
}

function createTsDeclarationOutDir(packageDir: string): string {
  const cacheKey = packageDir.replace(/[^a-zA-Z0-9._-]+/gu, '__');
  return `${relativeRootFor(packageDir)}/node_modules/.cache/tsgo/declarations/${cacheKey}`;
}

function createReferences(
  packageDir: string,
  references: string[],
): JsonValue[] {
  return [...new Set(references)]
    .filter(reference => reference !== packageDir)
    .map(reference => ({
      path: path.relative(packageDir, reference).split(path.sep).join('/'),
    }));
}

type CreatePackageTsConfigOptions = {
  include?: string[];
  includeApi?: boolean;
  includeServer?: boolean;
  references?: string[];
  skipLibCheck?: boolean;
};

export function createPackageTsConfig(
  packageDir: string,
  options: CreatePackageTsConfigOptions | boolean = {},
): JsonValue {
  const resolvedOptions =
    typeof options === 'boolean' ? { includeApi: options } : options;
  const include = resolvedOptions.include ?? [
    'src',
    'locales/**/*.json',
    'package.json',
    'shared',
  ];
  if (resolvedOptions.includeServer) {
    include.push('server');
  }
  if (resolvedOptions.includeApi) {
    include.push('api');
  }
  const references = createReferences(
    packageDir,
    resolvedOptions.references ?? [],
  );
  const tsconfig: Record<string, JsonValue> = {
    extends: `${relativeRootFor(packageDir)}/tsconfig.base.json`,
    compilerOptions: {
      composite: true,
      declaration: true,
      declarationMap: false,
      emitDeclarationOnly: true,
      incremental: true,
      noEmit: false,
      ...(resolvedOptions.skipLibCheck ? { skipLibCheck: true } : {}),
      outDir: createTsDeclarationOutDir(packageDir),
      tsBuildInfoFile: createTsBuildInfoFile(packageDir),
    },
    include,
  };
  if (references.length > 0) {
    tsconfig.references = references;
  }
  return tsconfig;
}

export function createAppTsConfig(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): JsonValue {
  const remoteRefs =
    app.kind === 'shell' ? [] : resolveRemoteRefs(app, remotes);
  const references = [
    ...sharedPackages.map(sharedPackage => sharedPackage.directory),
    // Federation hosts resolve remote package exports directly to source.
    // Project references would require declaration output before host builds.
    ...remoteRefs.map(remote => remote.directory),
  ];
  return createPackageTsConfig(app.directory, {
    includeApi: appHasApi(app),
    includeServer: true,
    references,
    // Composed remotes import sibling source exports, so their application
    // checker traverses framework declaration dependencies outside app source.
    skipLibCheck: remoteRefs.length > 0,
  });
}

export function createAppMfTypesTsConfig(app: WorkspaceApp): JsonValue {
  const exposedFiles = Object.entries(app.exposes ?? {})
    .sort(([left], [right]) =>
      left === './Route' ? -1 : right === './Route' ? 1 : 0,
    )
    .map(([, exposePath]) => exposePath.replace(/^\.\//u, ''));

  return {
    extends: `${relativeRootFor(app.directory)}/tsconfig.base.json`,
    include: [...new Set([...exposedFiles, 'src/modern-app-env.d.ts'])],
    // The MF declaration compiler follows framework implementation types that
    // are not part of the exposed application surface. Application source is
    // still checked separately; composed apps use the same dependency boundary.
    compilerOptions: {
      skipLibCheck: true,
    },
  };
}

export function createSharedPackageTsConfig(packageDir: string): JsonValue {
  return createPackageTsConfig(packageDir, {
    include: ['src'],
  });
}

export function createRootTsConfig(apps: WorkspaceApp[] = []): JsonValue {
  return {
    files: [],
    references: [
      ...sharedPackages.map(sharedPackage => ({
        path: sharedPackage.directory,
      })),
      ...apps.map(app => ({ path: app.directory })),
    ],
  };
}
