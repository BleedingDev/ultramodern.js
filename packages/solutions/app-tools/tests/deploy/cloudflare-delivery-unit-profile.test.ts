import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUltramodernBuildArtifact } from '@modern-js/utils/universal';
import {
  resolveTopologyDeliveryUnit,
  resolveWorkerDeliveryUnitStamp,
} from '../../src/plugins/deploy/platforms/cloudflare/delivery-unit';
import { verifyDeliveryUnitIdentity } from '../../src/plugins/deploy/platforms/cloudflare-output-verifier/identity';

const createDeliveryUnit = (appId: string) => ({
  appId,
  build: `build-${appId}`,
  buildMarker: `build-${appId}`,
  deployProfile: 'cloudflare-ssr-mf-effect-v1' as const,
  kind: 'microvertical-delivery-unit' as const,
  packageName: `@profile-test/${appId}`,
  schemaVersion: 1 as const,
  sourceRevision: 'profile-test-revision',
  unitId: `profile-test/${appId}`,
  version: '0.1.0',
});

it('stamps and verifies only the surfaces emitted by each topology profile', async () => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'cloudflare-delivery-profile-'),
  );
  const profiles = [
    { appId: 'catalog', expected: ['api'], profile: 'api-only' },
    { appId: 'marketing', expected: ['ui'], profile: 'ui-only' },
  ] as const;

  try {
    await fs.mkdir(path.join(workspaceRoot, '.modernjs'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, '.modernjs/ultramodern.json'),
      `${JSON.stringify({
        topology: {
          apps: profiles.map(({ appId, profile }) => ({
            id: appId,
            path: `verticals/${appId}`,
            surfaceProfile: profile,
            deliveryUnit: createDeliveryUnit(appId),
          })),
        },
      })}\n`,
    );

    for (const { appId, expected } of profiles) {
      const appDirectory = path.join(workspaceRoot, 'verticals', appId);
      await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
      await fs.writeFile(
        path.join(appDirectory, 'shared/ultramodern-build.json'),
        `${JSON.stringify(
          createUltramodernBuildArtifact(createDeliveryUnit(appId)),
        )}\n`,
      );

      const topology = await resolveTopologyDeliveryUnit(appDirectory);
      const worker = await resolveWorkerDeliveryUnitStamp(appDirectory);
      expect(Object.keys(topology?.surfaces ?? {})).toEqual(expected);
      expect(Object.keys(worker?.surfaces ?? {})).toEqual(expected);

      const issues: Parameters<typeof verifyDeliveryUnitIdentity>[0] = [];
      verifyDeliveryUnitIdentity(
        issues,
        { deliveryUnit: worker },
        'modern-worker-manifest.json',
        topology,
      );
      expect(issues).toEqual([]);
    }
  } finally {
    await fs.rm(workspaceRoot, { force: true, recursive: true });
  }
});

it('rejects a worker manifest that invents a UI surface for api-only', () => {
  const deliveryUnit = createDeliveryUnit('catalog');
  const api = { ...deliveryUnit, surface: 'api' as const };
  const ui = { ...deliveryUnit, surface: 'ui' as const };
  const topology = { ...deliveryUnit, surfaces: { api } };
  const issues: Parameters<typeof verifyDeliveryUnitIdentity>[0] = [];

  verifyDeliveryUnitIdentity(
    issues,
    { deliveryUnit: { ...deliveryUnit, surfaces: { api, ui } } },
    'modern-worker-manifest.json',
    topology,
  );

  expect(issues).toEqual([
    expect.objectContaining({
      code: 'delivery-unit-drift',
      message: expect.stringContaining('unexpected ui delivery-unit surface'),
    }),
  ]);
});
