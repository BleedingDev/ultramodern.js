import {
  createUltramodernBuildArtifact,
  ULTRAMODERN_BUILD_ARTIFACT_FILE,
} from '@modern-js/utils/universal';
import { createDeliveryUnitRecord } from '../delivery-unit';
import type { DeliveryUnitRecord } from '../delivery-unit-schema/types';
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
  return `const ultramodernBuildArtifact = ${JSON.stringify(
    createUltramodernBuildArtifact(record),
    null,
    2,
  )} as const;

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
