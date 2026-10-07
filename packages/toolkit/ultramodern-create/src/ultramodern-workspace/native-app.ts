import { createShellApiClient } from './api';
import { writeAppApiFiles } from './api/write-app-api';
import { createAppStyles, createTailwindConfig } from './app-files';
import { appHasApi } from './descriptors';
import { writeFile, writeJson } from './fs-io';
import {
  createAppModernConfig,
  createBackendModuleFederationConfig,
  createUltramodernBuildArtifactJson,
  createUltramodernBuildModule,
  createUltramodernBuildReexportModule,
} from './module-federation';
import { createNativeFederationArtifacts } from './native-federation';
import { createAppPackage, createAppTsConfig } from './package-json';
import { resolveRendererGenerationAdapter } from './renderer-generations';
import {
  resolveAppGenerationProfile,
  resolveWorkspaceRenderer,
} from './renderer-profile';
import type { ResolvedPackageSource, WorkspaceApp } from './types';

export function writeNativeApp(
  targetDir: string,
  scope: string,
  app: WorkspaceApp,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
): void {
  const renderer = resolveWorkspaceRenderer(app);
  if (renderer === 'none') {
    throw new Error(
      `Native app emission requires a registered native template, found ${renderer}.`,
    );
  }
  const adapter = resolveRendererGenerationAdapter(renderer);
  if (adapter.kind !== 'native') {
    throw new Error(
      `Native app emission requires a registered native template, found ${renderer}.`,
    );
  }
  const generation = resolveAppGenerationProfile(app)!;
  const sources = adapter.generateAppSources({
    appId: app.id,
    title: app.displayName,
    entryName: app.rendererIdentity?.entryName ?? 'main',
    sourceExtension: generation.sourceExtension,
    jsxImportSource: generation.jsxImportSource,
    capabilities: {
      ssr: generation.capabilities.ssr,
      federation: generation.capabilities.federation,
    },
  });
  if (
    sources.sourceExtension !== generation.sourceExtension ||
    sources.jsxImportSource !== generation.jsxImportSource
  ) {
    throw new Error(
      `Renderer ${renderer} template does not match its selected compiler profile.`,
    );
  }
  const artifacts = [
    ...sources.artifacts,
    ...createNativeFederationArtifacts(scope, app, remotes),
  ];
  const paths = new Set<string>();
  for (const artifact of artifacts) {
    if (paths.has(artifact.path))
      throw new Error(
        `Native template ${app.id} has duplicate source ownership at ${artifact.path}.`,
      );
    paths.add(artifact.path);
  }
  // Validate all generated contracts before creating any application output.
  const manifest = createAppPackage(
    scope,
    app,
    packageSource,
    enableTailwind,
    remotes,
  );
  const tsconfig = createAppTsConfig(app, remotes);
  const config = createAppModernConfig(app, enableTailwind);
  const backendConfig = appHasApi(app)
    ? createBackendModuleFederationConfig(app)
    : undefined;
  const buildModule = createUltramodernBuildModule(scope, app);
  const buildJson = app.routerBindings
    ? createUltramodernBuildArtifactJson(scope, app)
    : undefined;
  const write = (relativePath: string, content: string) =>
    writeFile(targetDir, `${app.directory}/${relativePath}`, content);
  writeJson(targetDir, `${app.directory}/package.json`, manifest);
  writeJson(targetDir, `${app.directory}/tsconfig.json`, tsconfig);
  write('modern.config.ts', config);
  if (backendConfig) write('backend-federation.config.ts', backendConfig);
  write(
    'src/modern-app-env.d.ts',
    `/// <reference types="@modern-js/ultramodern-app-tools/types" />
/// <reference types="${generation.jsxImportSource}" />
`,
  );
  write('src/routes/index.css', createAppStyles(enableTailwind, scope, app));
  write('shared/ultramodern-build.ts', buildModule);
  if (buildJson) write('shared/ultramodern-build.json', buildJson);
  write('src/ultramodern-build.ts', createUltramodernBuildReexportModule(app));
  if (enableTailwind) write('tailwind.config.ts', createTailwindConfig());
  for (const artifact of artifacts) write(artifact.path, artifact.content);
  writeAppApiFiles({ targetDir, scope, resolvedApp: app, emitsUi: true });
  if (app.kind === 'shell' && remotes.some(appHasApi))
    write('src/api/vertical-clients.ts', createShellApiClient(scope, remotes));
}
