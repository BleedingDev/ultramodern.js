import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addUltramodernVertical } from '../src/ultramodern-workspace';
import { createWorkspace, snapshotWorkspace } from './helpers/workspace-kit';

const ultramodernConfigPath = '.modernjs/ultramodern.json';
const topologyPath = 'topology/reference-topology.json';
const ownershipPath = 'topology/ownership.json';
const overlayPath = 'topology/local-overlays/development.json';

function createWorkspaceWithCatalog() {
  const workspace = createWorkspace('preflight-workspace', {
    tempPrefix: 'um-vertical-preflight-',
  });
  addUltramodernVertical({
    workspaceRoot: workspace.workspaceDir,
    name: 'catalog',
    modernVersion: '3.2.1',
  });
  return workspace;
}

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

function expectAddVerticalFailureLeavesWorkspaceUnchanged(
  workspaceDir: string,
  expectedError: RegExp,
) {
  const before = snapshotWorkspace(workspaceDir);

  assert.throws(
    () =>
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        name: 'checkout',
        modernVersion: '3.2.1',
      }),
    expectedError,
  );
  assert.deepEqual(snapshotWorkspace(workspaceDir), before);
}

type VerticalPatch = {
  id?: string;
  domain?: string;
  packageName?: string;
  verticalPath?: string;
  mfName?: string;
  port?: number;
  apiPrefix?: string;
};

function addExistingTopologyVertical(
  workspaceDir: string,
  patch: VerticalPatch,
) {
  const topology = readJson(workspaceDir, topologyPath);
  const overlay = readJson(workspaceDir, overlayPath);
  const id = patch.id ?? 'inventory';
  const domain = patch.domain ?? id;
  const verticalPath = patch.verticalPath ?? `verticals/${id}`;
  const port = patch.port ?? 4102;

  topology.verticals.push({
    id,
    kind: 'vertical',
    domain,
    package: patch.packageName ?? `@preflight-workspace/${id}`,
    path: verticalPath,
    moduleFederation: {
      role: 'remote',
      name: patch.mfName ?? 'verticalInventory',
      manifestUrl: `http://localhost:${port}/mf-manifest.json`,
      exposes: ['./Route', './Widget'],
      ssr: true,
      sharedContractVersion: 'mf-ssr-contract-v1',
    },
    api: {
      runtime: 'effect',
      bff: {
        prefix: patch.apiPrefix ?? `/${id}-api`,
      },
    },
  });
  overlay.ports[id] = port;
  writeJson(workspaceDir, topologyPath, topology);
  writeJson(workspaceDir, overlayPath, overlay);
}

test('add-vertical normalizes stale shell refs for the new vertical', () => {
  const { tempRoot, workspaceDir } = createWorkspace('preflight-workspace', {
    tempPrefix: 'um-vertical-preflight-',
  });

  try {
    const topology = readJson(workspaceDir, topologyPath);
    topology.shell.verticalRefs.push('catalog');
    topology.shell.moduleFederation.remotes.push({
      id: 'catalog',
      name: 'verticalCatalog',
      manifestUrl: 'http://localhost:4101/mf-manifest.json',
    });
    writeJson(workspaceDir, topologyPath, topology);

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const updatedTopology = readJson(workspaceDir, topologyPath);
    assert.deepEqual(updatedTopology.shell.verticalRefs, ['catalog']);
    assert.deepEqual(updatedTopology.shell.moduleFederation.remotes, [
      {
        id: 'catalog',
        name: 'verticalCatalog',
        manifestUrl: 'http://localhost:4101/mf-manifest.json',
      },
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preflight rejects invalid fresh vertical input before writes', () => {
  const { tempRoot, workspaceDir } = createWorkspace('preflight-workspace', {
    tempPrefix: 'um-vertical-preflight-',
  });

  try {
    const before = snapshotWorkspace(workspaceDir);
    assert.throws(
      () =>
        addUltramodernVertical({
          workspaceRoot: workspaceDir,
          name: 'Catalog',
          modernVersion: '3.2.1',
        }),
      /Invalid Vertical name "Catalog"/,
    );
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preflight requires compact config fixtures', () => {
  const nonObject = createWorkspace('preflight-workspace', {
    tempPrefix: 'um-vertical-preflight-',
  });
  const missingCompact = createWorkspace('preflight-workspace', {
    tempPrefix: 'um-vertical-preflight-',
  });

  try {
    writeJson(nonObject.workspaceDir, ultramodernConfigPath, []);
    expectAddVerticalFailureLeavesWorkspaceUnchanged(
      nonObject.workspaceDir,
      /UltraModern workspace file must contain a JSON object: .*ultramodern\.json/,
    );

    fs.rmSync(path.join(missingCompact.workspaceDir, ultramodernConfigPath));
    writeJson(
      missingCompact.workspaceDir,
      '.modernjs/ultramodern-generated-contract.json',
      {
        apps: [],
      },
    );
    writeJson(
      missingCompact.workspaceDir,
      '.modernjs/ultramodern-package-source.json',
      {
        schemaVersion: 1,
        strategy: 'install',
        modernPackages: {
          specifier: '3.2.0-ultramodern.108',
          aliases: {
            '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
          },
        },
      },
    );
    expectAddVerticalFailureLeavesWorkspaceUnchanged(
      missingCompact.workspaceDir,
      /Missing UltraModern workspace file: .*ultramodern\.json/,
    );
  } finally {
    fs.rmSync(nonObject.tempRoot, { recursive: true, force: true });
    fs.rmSync(missingCompact.tempRoot, { recursive: true, force: true });
  }
});

test.each([
  {
    label: 'duplicate app IDs',
    mutate: (workspaceDir: string) =>
      addExistingTopologyVertical(workspaceDir, { id: 'catalog' }),
    error: /Duplicate app id "catalog"/,
  },
  {
    label: 'duplicate package suffixes',
    mutate: (workspaceDir: string) =>
      addExistingTopologyVertical(workspaceDir, {
        packageName: '@preflight-workspace/catalog',
      }),
    error: /Duplicate package suffix "catalog"/,
  },
  {
    label: 'duplicate output paths',
    mutate: (workspaceDir: string) =>
      addExistingTopologyVertical(workspaceDir, {
        verticalPath: 'verticals/catalog',
      }),
    error: /Duplicate output path "verticals\/catalog"/,
  },
  {
    label: 'duplicate Module Federation names',
    mutate: (workspaceDir: string) =>
      addExistingTopologyVertical(workspaceDir, {
        mfName: 'verticalCatalog',
      }),
    error: /Duplicate Module Federation name "verticalCatalog"/,
  },
  {
    label: 'duplicate development ports',
    mutate: (workspaceDir: string) =>
      addExistingTopologyVertical(workspaceDir, {
        port: 4101,
      }),
    error: /Duplicate development port "4101"/,
  },
  {
    label: 'duplicate API prefixes',
    mutate: (workspaceDir: string) =>
      addExistingTopologyVertical(workspaceDir, {
        apiPrefix: '/catalog-api',
      }),
    error: /Duplicate API prefix "\/catalog-api"/,
  },
  {
    label: 'duplicate manifest environment names',
    mutate: (workspaceDir: string) =>
      addExistingTopologyVertical(workspaceDir, {
        domain: 'catalog',
        apiPrefix: '/inventory-api',
      }),
    error: /Duplicate manifest environment name "VERTICAL_CATALOG_MF_MANIFEST"/,
  },
  {
    label: 'unsafe normalized existing descriptors',
    mutate: (workspaceDir: string) => {
      const topology = readJson(workspaceDir, topologyPath);
      topology.verticals[0].path = '../outside';
      writeJson(workspaceDir, topologyPath, topology);
    },
    error: /Unsafe output path for catalog: \.\.\/outside/,
  },
  {
    label: 'duplicate Tailwind prefixes',
    mutate: (workspaceDir: string) =>
      addExistingTopologyVertical(workspaceDir, {
        id: 'cat-alog',
        domain: 'cat-alog',
        packageName: '@preflight-workspace/cat-alog',
        verticalPath: 'verticals/cat-alog',
        mfName: 'verticalCatAlog',
        apiPrefix: '/cat-alog-api',
      }),
    error: /Tailwind prefix catalog for cat-alog collides with catalog/,
  },
])('preflight rejects invalid existing workspace state: $label', entry => {
  const { tempRoot, workspaceDir } = createWorkspaceWithCatalog();

  try {
    entry.mutate(workspaceDir);
    expectAddVerticalFailureLeavesWorkspaceUnchanged(workspaceDir, entry.error);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preflight verifies mutable contract collections are JSON objects or arrays', () => {
  const topologyNotObject = createWorkspace('preflight-workspace', {
    tempPrefix: 'um-vertical-preflight-',
  });
  const topologyVerticalsNotArray = createWorkspace('preflight-workspace', {
    tempPrefix: 'um-vertical-preflight-',
  });
  const ownershipNotArray = createWorkspace('preflight-workspace', {
    tempPrefix: 'um-vertical-preflight-',
  });
  const overlayPortsNotObject = createWorkspace('preflight-workspace', {
    tempPrefix: 'um-vertical-preflight-',
  });

  try {
    writeJson(topologyNotObject.workspaceDir, topologyPath, []);
    expectAddVerticalFailureLeavesWorkspaceUnchanged(
      topologyNotObject.workspaceDir,
      /UltraModern workspace file must contain a JSON object: .*reference-topology\.json/,
    );

    const topology = readJson(
      topologyVerticalsNotArray.workspaceDir,
      topologyPath,
    );
    topology.verticals = {};
    writeJson(topologyVerticalsNotArray.workspaceDir, topologyPath, topology);
    expectAddVerticalFailureLeavesWorkspaceUnchanged(
      topologyVerticalsNotArray.workspaceDir,
      /topology\.verticals in .*reference-topology\.json must be a JSON array/,
    );

    const ownership = readJson(ownershipNotArray.workspaceDir, ownershipPath);
    ownership.owners = {};
    writeJson(ownershipNotArray.workspaceDir, ownershipPath, ownership);
    expectAddVerticalFailureLeavesWorkspaceUnchanged(
      ownershipNotArray.workspaceDir,
      /ownership\.owners in .*ownership\.json must be a JSON array/,
    );

    const overlay = readJson(overlayPortsNotObject.workspaceDir, overlayPath);
    overlay.ports = [];
    writeJson(overlayPortsNotObject.workspaceDir, overlayPath, overlay);
    expectAddVerticalFailureLeavesWorkspaceUnchanged(
      overlayPortsNotObject.workspaceDir,
      /overlay\.ports in .*development\.json must be a JSON object/,
    );
  } finally {
    fs.rmSync(topologyNotObject.tempRoot, { recursive: true, force: true });
    fs.rmSync(topologyVerticalsNotArray.tempRoot, {
      recursive: true,
      force: true,
    });
    fs.rmSync(ownershipNotArray.tempRoot, { recursive: true, force: true });
    fs.rmSync(overlayPortsNotObject.tempRoot, {
      recursive: true,
      force: true,
    });
  }
});
