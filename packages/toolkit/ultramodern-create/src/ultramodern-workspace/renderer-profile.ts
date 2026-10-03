import { resolveRendererProfile } from '@modern-js/ultramodern-app-tools';
import { ULTRAMODERN_PACKAGE_PINS } from './policy';
import type {
  ApplicationRenderer,
  RendererGenerationProfile,
  WorkspaceApp,
  WorkspaceRenderer,
} from './types';
import { NODE_VERSION, TYPESCRIPT_VERSION } from './versions';

export function isApplicationRenderer(
  value: unknown,
): value is ApplicationRenderer {
  return value === 'react' || value === 'solid' || value === 'octane';
}

export function resolveWorkspaceRenderer(app: WorkspaceApp): WorkspaceRenderer {
  if (app.surfaceProfile === 'api-only') {
    if (
      app.rendererIdentity ||
      app.rendererIdentities ||
      app.rendererProfile ||
      app.routerBindings ||
      app.rendererGenerationProfile ||
      app.rendererCapabilities
    ) {
      throw new Error(
        `Headless unit ${app.id} cannot carry a UI renderer identity.`,
      );
    }
    return 'none';
  }
  if (!isApplicationRenderer(app.renderer)) {
    throw new Error(
      `Application ${app.id} requires a renderer resolved from modern.config.`,
    );
  }
  return app.renderer;
}

/** Metadata-only selection. It never imports a renderer runtime or compiler. */
export function getRendererGenerationProfile(
  renderer: ApplicationRenderer,
): RendererGenerationProfile {
  if (!isApplicationRenderer(renderer)) {
    throw new Error(
      `Unsupported renderer ${String(renderer)}. Expected react, solid or octane.`,
    );
  }
  const selected = resolveRendererProfile(renderer);
  const profile = {
    renderer: selected.renderer,
    protocolVersion: selected.protocolVersion,
    compiler: { ...selected.compiler },
    hydration: { ...selected.hydration },
    router: { ...selected.router },
  };
  if (renderer === 'react') {
    return {
      renderer,
      profile,
      sourceExtension: '.tsx',
      jsxImportSource: 'react',
      nodeVersion: NODE_VERSION,
      dependencies: { ...ULTRAMODERN_PACKAGE_PINS.appDependencies },
      devDependencies: {
        '@types/react':
          ULTRAMODERN_PACKAGE_PINS.appDevDependencies['@types/react'],
        '@types/react-dom':
          ULTRAMODERN_PACKAGE_PINS.appDevDependencies['@types/react-dom'],
      },
      capabilities: {
        ssr: true,
        streaming: true,
        workers: selected.capabilities.worker,
        federation: selected.capabilities.moduleFederation,
        rsc: selected.capabilities.rsc,
      },
    };
  }
  const dependencies: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(selected.dependencies).filter(
        ([name]) => !name.startsWith('@modern-js/'),
      ),
    ),
    [profile.router.coreName]: profile.router.coreVersion,
  };
  if (renderer === 'solid') {
    dependencies['solid-js'] = profile.hydration.version;
    dependencies['@solidjs/signals'] = profile.hydration.version;
  }
  return {
    renderer,
    profile,
    sourceExtension: '.tsx',
    jsxImportSource: selected.jsxImportSource,
    nodeVersion: NODE_VERSION,
    dependencies,
    devDependencies: {
      [profile.compiler.name]: profile.compiler.version,
      ...(renderer === 'solid'
        ? { '@solidjs/babel-plugin': profile.compiler.version }
        : { typescript: TYPESCRIPT_VERSION }),
    },
    capabilities: {
      ssr: true,
      streaming: true,
      workers: selected.capabilities.worker,
      federation: selected.capabilities.moduleFederation,
      rsc: selected.capabilities.rsc,
    },
  };
}

export function resolveAppGenerationProfile(
  app: WorkspaceApp,
): RendererGenerationProfile | undefined {
  const renderer = resolveWorkspaceRenderer(app);
  if (renderer === 'none') return undefined;
  const profile = getRendererGenerationProfile(renderer);
  const existing = app.rendererProfile;
  const selected = profile.profile;
  if (
    existing &&
    (existing.renderer !== selected.renderer ||
      existing.protocolVersion !== selected.protocolVersion ||
      existing.compiler.name !== selected.compiler.name ||
      existing.compiler.version !== selected.compiler.version ||
      existing.hydration.name !== selected.hydration.name ||
      existing.hydration.version !== selected.hydration.version ||
      existing.router.name !== selected.router.name ||
      existing.router.version !== selected.router.version ||
      existing.router.coreName !== selected.router.coreName ||
      existing.router.coreVersion !== selected.router.coreVersion)
  ) {
    throw new Error(
      `Application ${app.id} renderer profile disagrees with the selected compiler/runtime/router tuple.`,
    );
  }
  return profile;
}

export function appSupportsFederation(app: WorkspaceApp): boolean {
  return resolveAppGenerationProfile(app)?.capabilities.federation ?? false;
}
