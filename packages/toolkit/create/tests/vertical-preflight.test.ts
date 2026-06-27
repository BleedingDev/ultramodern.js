import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

const ultramodernConfigPath = '.modernjs/ultramodern.json';
const generatedContractPath = '.modernjs/ultramodern-generated-contract.json';
const packageSourcePath = '.modernjs/ultramodern-package-source.json';
const topologyPath = 'topology/reference-topology.json';
const ownershipPath = 'topology/ownership.json';
const overlayPath = 'topology/local-overlays/development.json';

function createWorkspace() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-vertical-preflight-'),
  );
  const workspaceDir = path.join(tempRoot, 'preflight-workspace');

  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: 'preflight-workspace',
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: {
      strategy: 'install',
      modernPackageVersion: '3.2.0-ultramodern.108',
    },
  });

  return { tempRoot, workspaceDir };
}

function createWorkspaceWithCatalog() {
  const workspace = createWorkspace();
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

function listFiles(root: string, dir = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, entryPath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function snapshotWorkspace(workspaceDir: string): Record<string, string> {
  return Object.fromEntries(
    listFiles(workspaceDir).map(relativePath => [
      relativePath,
      fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
    ]),
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
      fallbackTelemetryEvent: 'modernjs:mv-runtime-parity',
      sharedContractVersion: 'mf-ssr-contract-v1',
    },
    api: {
      effect: {
        bff: {
          prefix: patch.apiPrefix ?? `/${id}-api`,
        },
      },
    },
  });
  overlay.ports[id] = port;
  writeJson(workspaceDir, topologyPath, topology);
  writeJson(workspaceDir, overlayPath, overlay);
}

test('preflight rejects invalid fresh vertical input before writes', () => {
  const { tempRoot, workspaceDir } = createWorkspace();

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

test('preflight verifies compact config and legacy fallback fixtures', () => {
  const nonObject = createWorkspace();
  const legacyFallback = createWorkspace();

  try {
    writeJson(nonObject.workspaceDir, ultramodernConfigPath, []);
    expectAddVerticalFailureLeavesWorkspaceUnchanged(
      nonObject.workspaceDir,
      /UltraModern workspace file must contain a JSON object: .*ultramodern\.json/,
    );

    fs.rmSync(path.join(legacyFallback.workspaceDir, ultramodernConfigPath));
    writeJson(legacyFallback.workspaceDir, generatedContractPath, {
      apps: [],
    });
    writeJson(legacyFallback.workspaceDir, packageSourcePath, {
      schemaVersion: 1,
      strategy: 'install',
      modernPackages: {
        specifier: '3.2.0-ultramodern.108',
        aliases: {
          '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
        },
      },
    });
    addUltramodernVertical({
      workspaceRoot: legacyFallback.workspaceDir,
      name: 'checkout',
      modernVersion: '3.2.1',
    });
    const compactConfig = readJson(
      legacyFallback.workspaceDir,
      ultramodernConfigPath,
    );
    assert.equal(compactConfig.packageSource.strategy, 'install');
    assert.equal(
      compactConfig.packageSource.modernPackageVersion,
      '3.2.0-ultramodern.108',
    );
  } finally {
    fs.rmSync(nonObject.tempRoot, { recursive: true, force: true });
    fs.rmSync(legacyFallback.tempRoot, { recursive: true, force: true });
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
    label: 'duplicate Effect API prefixes',
    mutate: (workspaceDir: string) =>
      addExistingTopologyVertical(workspaceDir, {
        apiPrefix: '/catalog-api',
      }),
    error: /Duplicate Effect API prefix "\/catalog-api"/,
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
  const topologyNotObject = createWorkspace();
  const topologyVerticalsNotArray = createWorkspace();
  const ownershipNotArray = createWorkspace();
  const overlayPortsNotObject = createWorkspace();

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
