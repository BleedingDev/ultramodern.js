import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrateStrictEffect } from '../src/ultramodern-tooling/commands/migrate-strict-effect';
import { UnsupportedUltramodernConfigError } from '../src/ultramodern-tooling/config';
import { runSyncDeliveryUnit } from '../src/ultramodern-workspace/delivery-unit-sync';
import { createWorkspace, snapshotWorkspace } from './helpers/workspace-kit';

const ultramodernConfigPath = '.modernjs/ultramodern.json';

function readJson(workspaceDir: string, relativePath: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  );
}

function writeJson(workspaceDir: string, relativePath: string, value: unknown) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf-8',
  );
}

const configRejectionCases = [
  {
    label: 'missing schemaVersion',
    mutate: (config: Record<string, any>) => {
      delete config.schemaVersion;
    },
    error:
      /schemaVersion is required.*Versionless v1 configs are not supported/,
    issue: { field: 'schemaVersion', value: undefined, reason: 'missing' },
  },
  {
    label: 'non-integer schemaVersion',
    mutate: (config: Record<string, any>) => {
      config.schemaVersion = 1.5;
    },
    error: /schemaVersion 1\.5.*must be the integer 1/,
    issue: { field: 'schemaVersion', value: 1.5, reason: 'non-integer' },
  },
  {
    label: 'string schemaVersion',
    mutate: (config: Record<string, any>) => {
      config.schemaVersion = '1';
    },
    error: /schemaVersion "1".*must be the integer 1/,
    issue: { field: 'schemaVersion', value: '1', reason: 'non-integer' },
  },
  {
    label: 'unsupported integer schemaVersion',
    mutate: (config: Record<string, any>) => {
      config.schemaVersion = 2;
    },
    error: /(Unsupported|Invalid) UltraModern config schemaVersion 2/,
    issue: { field: 'schemaVersion', value: 2, reason: 'unsupported' },
  },
  {
    label: 'unsupported app kind',
    mutate: (config: Record<string, any>) => {
      config.topology.apps[0].kind = 'horizontal-remote';
    },
    error: /Unsupported UltraModern config app kind "horizontal-remote"/,
    issue: {
      field: 'topology.apps.kind',
      index: 0,
      value: 'horizontal-remote',
    },
  },
];

const strictDispatchEntryPoints = [
  {
    command: 'migrate-strict-effect',
    invoke: (workspaceDir: string) =>
      runMigrateStrictEffect(['--skip-install'], {
        workspaceRoot: workspaceDir,
        invocationCwd: workspaceDir,
      }),
  },
  {
    command: 'sync-delivery-unit',
    invoke: (workspaceDir: string) =>
      runSyncDeliveryUnit([], {
        workspaceRoot: workspaceDir,
        invocationCwd: workspaceDir,
      }),
  },
];

const matrix = strictDispatchEntryPoints.flatMap(entryPoint =>
  configRejectionCases.map(rejection => ({ entryPoint, rejection })),
);

test.each(
  matrix,
)('$entryPoint.command rejects $rejection.label before writes', ({
  entryPoint,
  rejection,
}) => {
  const { tempRoot, workspaceDir } = createWorkspace('strict-dispatch', {
    tempPrefix: 'um-strict-dispatch-',
  });

  try {
    const config = readJson(workspaceDir, ultramodernConfigPath);
    rejection.mutate(config);
    writeJson(workspaceDir, ultramodernConfigPath, config);
    const before = snapshotWorkspace(workspaceDir);

    assert.throws(
      () => entryPoint.invoke(workspaceDir),
      error => {
        const typedError = error as UnsupportedUltramodernConfigError;
        assert.equal(typedError.name, 'UnsupportedUltramodernConfigError');
        // Subset match: the issue may carry additional diagnostic fields
        // (e.g. reason) beyond the identity asserted here.
        for (const [key, value] of Object.entries(rejection.issue)) {
          assert.deepEqual(
            (typedError.issue as Record<string, unknown>)[key],
            value,
          );
        }
        assert.match(typedError.message, rejection.error);
        return true;
      },
    );
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
