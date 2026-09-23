import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sharedPackages } from '../src/ultramodern-workspace/descriptors';
import {
  validateApiClientExports,
  validateApiOnlySourceSurface,
  validateBackendFederationEntrypoints,
  validateWorkspace,
} from '../src/ultramodern-workspace/validation/workspace';
import { createWorkspaceValidationContract } from '../src/ultramodern-workspace/workspace-validation-contract';
import { linkInstalledCompiler } from './helpers/workspace-kit';

function fixture(
  authoredSharedPackages = sharedPackages.map(pkg => ({
    id: pkg.id,
    path: pkg.directory,
    package: `test/${pkg.id}`,
  })),
) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-canonical-validation-'),
  );
  const scope = 'test';
  const contract = createWorkspaceValidationContract(
    scope,
    false,
    authoredSharedPackages,
  );
  const app = contract.apps[0];
  const write = (relative: string, value: unknown) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  write('package.json', { name: scope });
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - apps/*\n  - packages/*\n',
  );
  write('topology/reference-topology.json', {
    schemaVersion: 1,
    shell: {
      id: app.id,
      kind: app.kind,
      path: app.path,
      package: app.packageName,
      verticalRefs: [],
      deliveryUnit: {
        unitId: `${scope}/${app.id}`,
        packageName: app.packageName,
        buildMarker: 'marker',
      },
      cloudflare: {
        workerName: 'test-shell',
        publicUrlEnv: 'TEST_SHELL_URL',
        routes: { ssr: '/en' },
        security: {},
        qualityGates: {},
      },
    },
    verticals: [],
    sharedPackages: contract.sharedPackages.map(pkg => ({
      id: pkg.id,
      path: pkg.path,
      package: pkg.packageName,
    })),
  });
  write('topology/ownership.json', {
    schemaVersion: 1,
    owners: [
      { id: app.id, path: app.path, package: app.packageName },
      ...contract.sharedPackages.map(pkg => ({
        id: pkg.id,
        path: pkg.path,
        package: pkg.packageName,
      })),
    ],
  });
  write('topology/local-overlays/development.json', {
    schemaVersion: 1,
    ports: { [app.id]: 3020 },
  });
  write(`${app.path}/package.json`, {
    name: app.packageName,
    modernjs: { appId: app.id },
  });
  write(`${app.path}/shared/ultramodern-build.json`, {
    deliveryUnit: {
      unitId: `${scope}/${app.id}`,
      packageName: app.packageName,
      buildMarker: 'marker',
    },
  });
  for (const relative of ['modern.config.ts', 'src/modern.runtime.ts']) {
    const file = path.join(root, app.path, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export default {}');
  }
  for (const pkg of contract.sharedPackages)
    write(`${pkg.path}/package.json`, { name: pkg.packageName });
  linkInstalledCompiler(root);
  return { root, contract, write, app };
}

test('canonical workspace validates with retired consumer files absent', () => {
  const { root, contract } = fixture();
  try {
    validateWorkspace(root, contract);
    assert.equal(
      fs.existsSync(path.join(root, '.modernjs/ultramodern.json')),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(root, '.modernjs/release-cohort.json')),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('authored shared inventory validates custom package membership and identity', () => {
  const extra = {
    id: 'core-runtime',
    path: 'packages/core-runtime',
    package: '@test/core-runtime',
  };
  const { root, contract, write } = fixture([
    ...sharedPackages.map(pkg => ({
      id: pkg.id,
      path: pkg.directory,
      package: `test/${pkg.id}`,
    })),
    extra,
  ]);
  try {
    validateWorkspace(root, contract);
    write(`${extra.path}/package.json`, { name: '@test/wrong-runtime' });
    assert.throws(
      () => validateWorkspace(root, contract),
      /core-runtime shared package identity contradicts topology/,
    );
    write(`${extra.path}/package.json`, { name: extra.package });
    const topologyPath = path.join(root, 'topology/reference-topology.json');
    const topology = JSON.parse(fs.readFileSync(topologyPath, 'utf8'));
    write('topology/reference-topology.json', {
      ...topology,
      sharedPackages: topology.sharedPackages.slice(0, -1),
    });
    assert.throws(
      () => validateWorkspace(root, contract),
      /Shared package membership disagrees with canonical inputs/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('REST and RPC clients may use authored app-owned modules, with containment enforced', () => {
  const { root, app, write } = fixture();
  try {
    write(`${app.path}/src/api/rest-client.ts`, 'export {};');
    write(`${app.path}/lib/rpc-client.ts`, 'export {};');
    validateApiClientExports(root, app.path, app.id, {
      './api/client': './src/api/rest-client.ts',
      './api/rpc-client': './lib/rpc-client.ts',
    });
    validateApiOnlySourceSurface(root, {
      id: app.id,
      path: app.path,
      backendFederation: { versionBoundary: {} },
    });
    write(
      `${app.path}/src/routes/layout.tsx`,
      'export default function Layout() { return null; }',
    );
    assert.throws(
      () =>
        validateApiOnlySourceSurface(root, {
          id: app.id,
          path: app.path,
          backendFederation: { versionBoundary: {} },
        }),
      /Unexpected .*src\/routes\/layout.tsx for a api-only unit/,
    );
    assert.throws(
      () =>
        validateApiClientExports(root, app.path, app.id, {
          './api/client': './src/api/../../outside.ts',
        }),
      /app-owned source module/,
    );
    assert.throws(
      () =>
        validateApiClientExports(root, app.path, app.id, {
          './api/client': './src/api/missing.ts',
        }),
      /API client is missing/,
    );
    write(`${app.path}/lib/client.json`, '{}');
    assert.throws(
      () =>
        validateApiClientExports(root, app.path, app.id, {
          './api/client': './lib/client.json',
        }),
      /app-owned source module/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('backend federation requires its config and declared runtime entry, not a generated wrapper', () => {
  const { root, app, write } = fixture();
  try {
    write(`${app.path}/backend-federation.config.ts`, 'export default {};');
    write(`${app.path}/api/index.ts`, 'export default {};');
    write(
      `${app.path}/api/effect-api.ts`,
      'export { default } from "./index.ts";',
    );
    validateBackendFederationEntrypoints(root, app.path, app.id);
    fs.rmSync(path.join(root, app.path, 'api/effect-api.ts'));
    assert.throws(
      () => validateBackendFederationEntrypoints(root, app.path, app.id),
      /API surface is missing: .*api\/effect-api.ts/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('contradictory package and ownership identities fail', () => {
  const { root, contract, write, app } = fixture();
  try {
    write(`${app.path}/package.json`, {
      name: '@wrong/shell',
      modernjs: { appId: app.id },
    });
    assert.throws(
      () => validateWorkspace(root, contract),
      /package name contradicts topology/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing build stamp fails before installed dependency checks', () => {
  const { root, contract, app } = fixture();
  try {
    fs.rmSync(path.join(root, app.path, 'shared/ultramodern-build.json'));
    assert.throws(
      () => validateWorkspace(root, contract),
      /build stamp is missing/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing authored Cloudflare security fails validation', () => {
  const { root, contract, write, app } = fixture();
  try {
    const topologyPath = path.join(root, 'topology/reference-topology.json');
    const topology = JSON.parse(fs.readFileSync(topologyPath, 'utf8'));
    delete topology.shell.cloudflare.security;
    write('topology/reference-topology.json', topology);
    assert.throws(
      () => validateWorkspace(root, contract),
      /cloudflare.security must be an object/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installed framework version must match the native catalog request', () => {
  const { root, contract, write, app } = fixture();
  try {
    fs.writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\ncatalogs:\n  ultramodern:\n    "@modern-js/app-tools": "npm:@bleedingdev/app-tools@3.8.3"\n',
    );
    write(`${app.path}/package.json`, {
      name: app.packageName,
      modernjs: { appId: app.id },
      devDependencies: { '@modern-js/app-tools': 'catalog:ultramodern' },
    });
    write(`${app.path}/node_modules/@modern-js/app-tools/package.json`, {
      name: '@bleedingdev/app-tools',
      version: '3.8.2',
    });
    assert.throws(
      () => validateWorkspace(root, contract),
      /installed package identity\/version disagrees with the catalog/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
