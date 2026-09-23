import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runSyncDeliveryUnit } from '../src/ultramodern-workspace/delivery-unit-sync';
import { createWorkspace, snapshotWorkspace } from './helpers/workspace-kit';

test('sync-delivery-unit rejects missing canonical topology before writing', () => {
  const { tempRoot, workspaceDir } = createWorkspace('strict-dispatch', {
    tempPrefix: 'um-strict-dispatch-sync-',
  });
  try {
    fs.rmSync(path.join(workspaceDir, 'topology/reference-topology.json'));
    const before = snapshotWorkspace(workspaceDir);
    assert.throws(
      () =>
        runSyncDeliveryUnit([], {
          workspaceRoot: workspaceDir,
          invocationCwd: workspaceDir,
        }),
      /reference-topology\.json|ENOENT/u,
    );
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
