import { createUltramodernBuildArtifact } from '@modern-js/backend-federation-contracts';
import { createDeliveryUnitRecord } from '../delivery-unit';
import { appEmitsBrowserUi, appHasApi } from '../descriptors';
import { rendererMetadataProjection } from '../renderer-identity';
import type { WorkspaceApp } from '../types';

export function createUltramodernBuildArtifactJson(
  scope: string,
  app: WorkspaceApp,
): string {
  const record = createDeliveryUnitRecord(scope, app);
  const projection = rendererMetadataProjection({
    ...app,
    deliveryUnit: record,
  });
  if (projection.renderer !== 'none' && !projection.routerBindings) {
    throw new Error(
      `Application ${app.id} requires router bindings captured from modern.config before its UI artifact is written.`,
    );
  }
  const artifact = createUltramodernBuildArtifact(
    record,
    projection.renderer === 'none'
      ? {}
      : {
          ui: {
            identity: projection.rendererIdentity!,
            profile: projection.rendererProfile!,
            routerBindings: projection.routerBindings!,
          },
        },
  );
  return `${JSON.stringify(
    {
      ...artifact,
      deliveryUnit: { ...record, ...artifact.deliveryUnit },
      surfaces: {
        api: { ...record, ...artifact.surfaces.api },
        ...(artifact.surfaces.ui
          ? { ui: { ...record, ...artifact.surfaces.ui } }
          : {}),
      },
    },
    null,
    2,
  )}\n`;
}

export function createUltramodernBuildModule(
  _scope: string,
  app: WorkspaceApp,
  includeUiMarker = appEmitsBrowserUi(app),
): string {
  return `import buildArtifact = require('./ultramodern-build.json');
import { resolveUltramodernBuildArtifact } from '@modern-js/backend-federation-contracts';

declare const ULTRAMODERN_BUILD_MARKER: string;
declare const ULTRAMODERN_SOURCE_REVISION: string;

const ultramodernBuildArtifact = resolveUltramodernBuildArtifact(buildArtifact, {
  buildMarker: () => ULTRAMODERN_BUILD_MARKER,
  sourceRevision: () => ULTRAMODERN_SOURCE_REVISION,
});

export const ultramodernDeliveryUnit = ultramodernBuildArtifact.deliveryUnit;
${
  includeUiMarker
    ? `const ultramodernUiSurface = ultramodernBuildArtifact.surfaces.ui;
if (!ultramodernUiSurface) {
  throw new Error(${JSON.stringify(`Application ${app.id} requires a UI build identity.`)});
}
export const ultramodernUiMarker = ultramodernUiSurface;
`
    : ''
}${app.kind !== 'shell' && appHasApi(app) ? 'export const ultramodernApiMarker = ultramodernBuildArtifact.surfaces.api;\n' : ''}`;
}

export function createUltramodernBuildReexportModule(
  app: WorkspaceApp,
  includeUiMarker = appEmitsBrowserUi(app),
): string {
  const names = ['ultramodernDeliveryUnit'];
  if (includeUiMarker) names.push('ultramodernUiMarker');
  if (app.kind !== 'shell' && appHasApi(app))
    names.push('ultramodernApiMarker');
  return `export { ${names.join(', ')} } from '../shared/ultramodern-build';\n`;
}
