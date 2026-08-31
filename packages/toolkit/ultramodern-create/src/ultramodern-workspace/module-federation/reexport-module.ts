import {
  createUltramodernBuildArtifact,
  type DeliveryUnitRecord,
  ULTRAMODERN_BUILD_ARTIFACT_FILE,
} from '@modern-js/utils/universal';
import { createDeliveryUnitRecord } from '../delivery-unit';
import type { WorkspaceApp } from '../types';

function deliveryUnitRecordFor(scope: string, app: WorkspaceApp) {
  return app.deliveryUnit
    ? (app.deliveryUnit as unknown as DeliveryUnitRecord)
    : createDeliveryUnitRecord(scope, app);
}

export function createUltramodernBuildArtifactJson(
  scope: string,
  app: WorkspaceApp,
): string {
  const record = deliveryUnitRecordFor(scope, app);
  return `${JSON.stringify(createUltramodernBuildArtifact(record), null, 2)}\n`;
}

export function createUltramodernBuildModule(
  scope: string,
  app: WorkspaceApp,
): string {
  const record = deliveryUnitRecordFor(scope, app);
  return `declare const ULTRAMODERN_BUILD_MARKER: string;
declare const ULTRAMODERN_SOURCE_REVISION: string;

const ultramodernGeneratedBuildArtifact = ${JSON.stringify(
    createUltramodernBuildArtifact(record),
    null,
    2,
  )} as const;
const ultramodernBuildMarker =
  typeof ULTRAMODERN_BUILD_MARKER === 'string'
    ? ULTRAMODERN_BUILD_MARKER
    : ultramodernGeneratedBuildArtifact.deliveryUnit.buildMarker;
const ultramodernSourceRevision =
  typeof ULTRAMODERN_SOURCE_REVISION === 'string'
    ? ULTRAMODERN_SOURCE_REVISION
    : ultramodernGeneratedBuildArtifact.deliveryUnit.sourceRevision;
const ultramodernBuildArtifact = {
  ...ultramodernGeneratedBuildArtifact,
  deliveryUnit: {
    ...ultramodernGeneratedBuildArtifact.deliveryUnit,
    build: ultramodernBuildMarker,
    buildMarker: ultramodernBuildMarker,
    sourceRevision: ultramodernSourceRevision,
  },
  surfaces: {
    api: {
      ...ultramodernGeneratedBuildArtifact.surfaces.api,
      build: ultramodernBuildMarker,
      buildMarker: ultramodernBuildMarker,
      sourceRevision: ultramodernSourceRevision,
    },
    ui: {
      ...ultramodernGeneratedBuildArtifact.surfaces.ui,
      build: ultramodernBuildMarker,
      buildMarker: ultramodernBuildMarker,
      sourceRevision: ultramodernSourceRevision,
    },
  },
} as const;

export { ultramodernBuildArtifact };

export const ultramodernDeliveryUnit =
  ultramodernBuildArtifact.deliveryUnit;
export const ultramodernVerticalIdentity = ultramodernDeliveryUnit;
export const ultramodernUiMarker = ultramodernBuildArtifact.surfaces.ui;
export const ultramodernApiMarker = ultramodernBuildArtifact.surfaces.api;
`;
}

export function createUltramodernBuildReexportModule(): string {
  return `export {
  ultramodernBuildArtifact,
  ultramodernApiMarker,
  ultramodernDeliveryUnit,
  ultramodernUiMarker,
  ultramodernVerticalIdentity,
} from '../shared/ultramodern-build';
`;
}
