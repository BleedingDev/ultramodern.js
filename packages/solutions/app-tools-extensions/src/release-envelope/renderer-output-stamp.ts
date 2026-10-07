import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  assertUltramodernBuildArtifact,
  formatBackendFederationValidationErrors,
  stampUltramodernBuildArtifactIdentity,
  ULTRAMODERN_BUILD_ARTIFACT_FILE,
  ULTRAMODERN_BUILD_ARTIFACT_PATH,
  type UltramodernBuildArtifact,
  type UltramodernBuildUiSurface,
  validateRendererIdentity,
  validateRendererProfile,
  validateRendererRouterBindings,
} from '@modern-js/backend-federation-contracts';

export type RendererBuildOutputContext = {
  appDirectory: string;
  distDirectory: string;
  entrypoints: readonly { entryName: string; isMainEntry?: boolean }[];
};

export type FinalizedRendererBuildOutput = {
  buildMarker: string;
  sourceRevision: string;
  ui: Pick<
    UltramodernBuildUiSurface,
    'rendererIdentity' | 'rendererProfile' | 'routerBindings'
  >;
};

export type RendererBuildOutputOptions = {
  resolveRendererBuild: (
    context: RendererBuildOutputContext,
  ) => Promise<FinalizedRendererBuildOutput>;
  /** Exact metadata producer selected by the owning renderer composition. */
  rendererBuildPlugin: string;
};

export const validateFinalizedRendererBuild = (
  output: FinalizedRendererBuildOutput,
  context: RendererBuildOutputContext,
  appId: string,
) => {
  const entryNames = context.entrypoints.map(entry => entry.entryName);
  const primary =
    context.entrypoints.find(entry => entry.isMainEntry) ??
    context.entrypoints[0];
  const errors = [
    ...validateRendererIdentity(output.ui.rendererIdentity).errors,
    ...validateRendererProfile(output.ui.rendererProfile).errors,
    ...validateRendererRouterBindings(
      output.ui.routerBindings,
      entryNames,
      'routerBindings',
    ).errors,
  ];
  if (errors.length)
    throw new Error(formatBackendFederationValidationErrors(errors));
  if (
    !primary ||
    new Set(entryNames).size !== entryNames.length ||
    context.entrypoints.filter(entry => entry.isMainEntry).length > 1 ||
    output.ui.rendererIdentity.entryName !== primary.entryName ||
    output.ui.rendererIdentity.appId !== appId ||
    output.ui.rendererIdentity.buildId !== output.buildMarker ||
    output.ui.rendererIdentity.renderer !== output.ui.rendererProfile.renderer
  )
    throw new Error(
      'Finalized renderer output conflicts with the actual application entries and release identity.',
    );
};

export const stampFinalizedRendererBuildArtifact = (
  artifact: UltramodernBuildArtifact,
  output: FinalizedRendererBuildOutput,
  context: RendererBuildOutputContext,
) => {
  assertUltramodernBuildArtifact(artifact);
  const ui = artifact.surfaces.ui;
  if (!ui)
    throw new Error(
      'Finalized renderer output requires a declared UI artifact',
    );
  validateFinalizedRendererBuild(output, context, artifact.deliveryUnit.appId);
  const drifted = [
    !isDeepStrictEqual(
      { ...ui.rendererIdentity, buildId: output.ui.rendererIdentity.buildId },
      output.ui.rendererIdentity,
    ) &&
      `rendererIdentity (captured entry ${ui.rendererIdentity.entryName}, built entry ${output.ui.rendererIdentity.entryName})`,
    !isDeepStrictEqual(ui.rendererProfile, output.ui.rendererProfile) &&
      'rendererProfile',
    !isDeepStrictEqual(ui.routerBindings, output.ui.routerBindings) &&
      `routerBindings (captured entries ${Object.keys(ui.routerBindings).join(', ')}, built entries ${Object.keys(output.ui.routerBindings).join(', ')})`,
  ].filter(Boolean);
  if (drifted.length)
    throw new Error(
      `Finalized renderer output conflicts with the captured application profile or router bindings: ${drifted.join('; ')} differ from ${ULTRAMODERN_BUILD_ARTIFACT_PATH}. After changing modern.config entries, renderer or router, recapture it with \`ultramodern-create ultramodern sync-delivery-unit\`.`,
    );
  const identity = {
    buildMarker: output.buildMarker,
    sourceRevision: output.sourceRevision,
  };
  const stamped = stampUltramodernBuildArtifactIdentity(artifact, identity);
  return stampUltramodernBuildArtifactIdentity(
    {
      ...stamped,
      surfaces: {
        ...stamped.surfaces,
        ui: { ...stamped.surfaces.ui!, ...output.ui },
      },
    },
    identity,
  );
};

async function writeOwnedArtifact(file: string, bytes: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const handle = await fs.open(temporary, 'wx');
    created = true;
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
  } finally {
    if (created) await fs.rm(temporary, { force: true });
  }
}

export async function emitRendererBuildArtifact(
  context: RendererBuildOutputContext,
  options: RendererBuildOutputOptions,
) {
  const source = path.join(
    context.appDirectory,
    ULTRAMODERN_BUILD_ARTIFACT_PATH,
  );
  const bytes = await fs.readFile(source).catch(error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!bytes) {
    const declaration = await fs
      .stat(source.replace(/\.json$/u, '.ts'))
      .catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
    if (declaration)
      throw new Error(
        'Generated UI artifact declaration is missing its build carrier',
      );
    return undefined;
  }
  const artifact: unknown = JSON.parse(bytes.toString('utf8'));
  assertUltramodernBuildArtifact(artifact);
  const finalized = await options.resolveRendererBuild(context);
  const stamped = stampFinalizedRendererBuildArtifact(
    artifact,
    finalized,
    context,
  );
  const serialized = `${JSON.stringify(stamped, null, 2)}\n`;
  for (const directory of [
    context.distDirectory,
    path.join(context.distDirectory, 'public'),
  ])
    await writeOwnedArtifact(
      path.join(directory, ULTRAMODERN_BUILD_ARTIFACT_FILE),
      serialized,
    );
  return stamped;
}

/** Stamp generated UI carriers after their actual compiler manifest is committed. */
export function rendererBuildArtifactStampPlugin(
  options: RendererBuildOutputOptions,
) {
  if (
    typeof options.rendererBuildPlugin !== 'string' ||
    !options.rendererBuildPlugin ||
    options.rendererBuildPlugin.trim() !== options.rendererBuildPlugin ||
    typeof options.resolveRendererBuild !== 'function'
  )
    throw new Error(
      'Renderer artifact stamping requires its owning metadata producer',
    );
  return {
    name: '@modern-js/renderer-build-artifact-stamp',
    pre: [options.rendererBuildPlugin],
    required: [options.rendererBuildPlugin],
    setup(api: {
      getAppContext(): RendererBuildOutputContext & { apiOnly?: boolean };
      onAfterBuild(handler: () => Promise<void>): void;
    }) {
      api.onAfterBuild(async () => {
        const context = api.getAppContext();
        if (context.apiOnly) return;
        await emitRendererBuildArtifact(context, options);
      });
    },
  };
}
