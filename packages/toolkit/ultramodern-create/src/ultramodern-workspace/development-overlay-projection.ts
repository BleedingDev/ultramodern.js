import {
  preserveUnknownProjectionFields,
  reconcileGeneratedOverlayUrls,
} from '../ultramodern-tooling/config';
import { rpcPath } from './api/rpc';
import { createServerExecutionOverlay } from './backend-federation';
import { createDevelopmentOverlay } from './contracts';
import { createDeliveryUnitRecord } from './delivery-unit';
import {
  appEmitsBrowserUi,
  appHasApi,
  resolveApiPrefix,
  resolveApiProtocol,
} from './descriptors';
import type { WorkspaceApp } from './types';

/** Preserve authored overlay data while projecting one newly added unit. */
export function projectAddedVerticalDevelopmentOverlay(
  scope: string,
  existing: Record<string, any>,
  existingVerticals: WorkspaceApp[],
  vertical: WorkspaceApp,
): Record<string, any> {
  const overlay = structuredClone(existing);
  const projected = createDevelopmentOverlay(
    scope,
    existingVerticals,
  ) as Record<string, any>;
  Object.assign(
    overlay,
    reconcileGeneratedOverlayUrls(overlay, projected, projected),
  );
  overlay.serverExecution = preserveUnknownProjectionFields(
    overlay.serverExecution,
    projected.serverExecution,
  );
  overlay.ports[vertical.id] = vertical.port;
  overlay.manifests ??= {};
  if (appEmitsBrowserUi(vertical))
    overlay.manifests[vertical.id] =
      `http://localhost:${vertical.port}/mf-manifest.json`;
  else delete overlay.manifests[vertical.id];
  if (appHasApi(vertical)) {
    overlay.serverExecution ??= {};
    overlay.serverExecution[vertical.id] = createServerExecutionOverlay(
      scope,
      vertical,
    );
    overlay.apis ??= {};
    overlay.apis[vertical.id] = `http://localhost:${vertical.port}${
      resolveApiProtocol(vertical) === 'rpc'
        ? rpcPath(vertical)
        : resolveApiPrefix(vertical)
    }`;
  }
  return overlay;
}

export function projectAddedShellDevelopmentOverlay(
  existing: Record<string, any>,
  shell: WorkspaceApp,
): Record<string, any> {
  const overlay = structuredClone(existing);
  overlay.ports[shell.id] = shell.port;
  return overlay;
}

/** Final discovery changes identity fields, never authored endpoint policy. */
export function projectResolvedDevelopmentOverlay(
  scope: string,
  existing: Record<string, any>,
  apps: readonly WorkspaceApp[],
): Record<string, any> {
  const overlay = structuredClone(existing);
  for (const app of apps) {
    if (!appHasApi(app)) continue;
    const execution = overlay.serverExecution?.[app.id];
    if (
      !execution ||
      typeof execution !== 'object' ||
      Array.isArray(execution) ||
      !execution.deliveryUnit ||
      typeof execution.deliveryUnit !== 'object' ||
      Array.isArray(execution.deliveryUnit) ||
      !execution.node?.expected ||
      typeof execution.node.expected !== 'object' ||
      Array.isArray(execution.node.expected)
    )
      throw new Error(
        `Resolved development overlay requires the authored execution identity for ${app.id}.`,
      );
    const record = createDeliveryUnitRecord(scope, app);
    const expected = {
      unitId: record.unitId,
      buildMarker: record.buildMarker,
    };
    Object.assign(execution.deliveryUnit, expected);
    Object.assign(execution.node.expected, expected);
  }
  return overlay;
}
