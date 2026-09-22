import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeWorkspaceInputs,
  readUltramodernConfig,
  readUltramodernWorkspaceInputs,
  workspaceAppsFromToolingConfig,
} from '../src/ultramodern-tooling/config';
import { shellApp } from '../src/ultramodern-workspace/descriptors';
import { createWorkspaceValidationContract } from '../src/ultramodern-workspace/workspace-validation-contract';

function inputs() {
  return {
    config: {
      schemaVersion: 1,
      workspace: { packageScope: '@test', customWorkspaceChoice: true },
      customRoot: { deployment: 'consumer-owned' },
      topology: {
        apps: [
          {
            id: shellApp.id,
            kind: 'shell',
            path: 'apps/custom-shell',
            port: 3000,
            customApp: 'preserve',
            moduleFederation: { verticalRefs: ['orders'], customMf: true },
          },
          {
            id: 'orders',
            kind: 'vertical',
            path: 'verticals/orders',
            port: 3001,
            moduleFederation: { exposes: ['./Route'] },
          },
        ],
      },
      shells: [
        {
          id: 'shell-admin',
          name: 'admin',
          path: 'apps/admin',
          port: 3300,
          verticalRefs: [],
          customShell: { keep: true },
        },
      ],
    },
    topology: {
      shell: { verticalRefs: [], customComposition: 'preserve' },
      verticals: [
        {
          id: 'orders',
          path: 'verticals/orders',
          customTopologyField: true,
          moduleFederation: { exposes: ['./Route'], verticalRefs: [] },
        },
      ],
      customTopology: true,
    },
    overlay: {
      ports: { [shellApp.id]: 3120, orders: 3121 },
      customOverlay: { host: 'consumer.example' },
    },
  };
}

test('workspace reads retain unknown input fields without mutating consumer inputs', () => {
  const raw = inputs();
  const before = structuredClone(raw);
  const view = normalizeWorkspaceInputs('/workspace', raw);
  assert.equal(view.raw, raw);
  assert.deepEqual(view.primaryShell?.verticalRefs, []);
  assert.deepEqual(
    normalizeWorkspaceInputs('/workspace', raw, undefined, {
      primaryComposition: 'compact',
    }).primaryShell?.verticalRefs,
    ['orders'],
  );
  const emptyComposition = structuredClone(raw);
  emptyComposition.config.topology.apps[0].moduleFederation.verticalRefs = [];
  assert.deepEqual(
    normalizeWorkspaceInputs('/workspace', emptyComposition, undefined, {
      primaryComposition: 'compact',
    }).primaryShell?.verticalRefs,
    [],
  );
  assert.deepEqual(view.raw, before);
  assert.deepEqual(raw, before);
});

test('disk read exposes raw fields and leaves the existing config reader compatible', () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-normalization-'),
  );
  try {
    fs.mkdirSync(path.join(workspaceRoot, '.modernjs'));
    const raw = inputs();
    const configPath = path.join(workspaceRoot, '.modernjs/ultramodern.json');
    const bytes = `${JSON.stringify(raw.config)}\n`;
    fs.writeFileSync(configPath, bytes);
    const view = readUltramodernWorkspaceInputs(workspaceRoot, {
      topology: raw.topology,
      overlay: raw.overlay,
    });
    assert.deepEqual(view.raw.config, raw.config);
    assert.deepEqual(view.config, readUltramodernConfig(workspaceRoot));
    assert.equal(view.primaryShell?.port, 3120);
    assert.equal(fs.readFileSync(configPath, 'utf8'), bytes);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

function federationSurfaceWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-expose-'));
  const vertical = path.join(root, 'verticals/party-registry');
  const surface = path.join(vertical, 'src/federation/page-contacts.tsx');
  fs.mkdirSync(path.dirname(surface), { recursive: true });
  fs.writeFileSync(surface, 'export default function PageContacts() {}\n');
  fs.mkdirSync(path.join(root, '.modernjs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.modernjs/ultramodern.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspace: { packageScope: '@app' },
      topology: {
        apps: [
          {
            id: shellApp.id,
            kind: 'shell',
            path: 'apps/shell-super-app',
            moduleFederation: { verticalRefs: ['party-registry'] },
          },
          {
            id: 'party-registry',
            kind: 'vertical',
            path: 'verticals/party-registry',
            moduleFederation: { exposes: ['./PageContacts'] },
          },
        ],
      },
    }),
  );
  fs.writeFileSync(
    path.join(vertical, 'module-federation.config.ts'),
    `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
export default createModuleFederationConfig({
  name: 'verticalPartyRegistry',
  exposes: { './PageContacts': './src/federation/page-contacts.tsx' },
});
`,
  );
  return { root, surface };
}

test('the generated validator expects the surface the expose map declares', () => {
  const { root } = federationSurfaceWorkspace();
  try {
    // Remotes derived without a workspace root still carry the generator's
    // `src/components` guess; the emitted validator must not inherit it.
    const remotes = workspaceAppsFromToolingConfig(
      readUltramodernConfig(root),
    ).filter(app => app.kind === 'vertical');
    assert.equal(
      remotes[0]?.exposes?.['./PageContacts'],
      './src/components/page-contacts.tsx',
    );

    const contract = createWorkspaceValidationContract(
      '@app',
      false,
      remotes,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      root,
    );
    assert.equal(
      JSON.stringify(contract).includes(
        'verticals/party-registry/src/federation/page-contacts.tsx',
      ),
      true,
    );
    assert.equal(
      JSON.stringify(contract).includes(
        'verticals/party-registry/src/components/page-contacts.tsx',
      ),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('derives federated surface paths from the Module Federation config', () => {
  const { root, surface } = federationSurfaceWorkspace();
  try {
    const expose = () =>
      readUltramodernWorkspaceInputs(root).verticals[0]?.exposes?.[
        './PageContacts'
      ];
    // The surface the workspace actually exposes is the file validation
    // requires, wherever the vertical chose to keep it.
    assert.equal(expose(), './src/federation/page-contacts.tsx');
    assert.equal(
      fs.existsSync(path.join(root, 'verticals/party-registry', expose()!)),
      true,
    );

    // A declared surface that is not on disk still fails the existence gate.
    fs.rmSync(surface);
    assert.equal(expose(), './src/federation/page-contacts.tsx');
    assert.equal(
      fs.existsSync(path.join(root, 'verticals/party-registry', expose()!)),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
