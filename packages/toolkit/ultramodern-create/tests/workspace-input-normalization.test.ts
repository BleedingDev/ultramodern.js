import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readUltramodernWorkspaceInputs } from '../src/ultramodern-tooling/config';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-canonical-inputs-'));
  const write = (relative: string, content: string | object) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  };
  write('package.json', {
    name: 'app',
    devDependencies: { '@modern-js/ultramodern-create': 'workspace:*' },
  });
  write('apps/shell/package.json', {
    name: '@app/shell',
    modernjs: { appId: 'shell' },
  });
  write('verticals/party-registry/package.json', {
    name: '@app/party-registry',
    modernjs: { appId: 'party-registry' },
  });
  const topology = {
    schemaVersion: 1,
    shell: {
      id: 'shell',
      kind: 'shell',
      path: 'apps/shell',
      package: '@app/shell',
      verticalRefs: [],
      consumerChoice: 'keep',
    },
    verticals: [
      {
        id: 'party-registry',
        kind: 'vertical',
        path: 'verticals/party-registry',
        package: '@app/party-registry',
        moduleFederation: {
          name: 'partyRegistry',
          exposes: ['./PageContacts'],
        },
      },
    ],
    consumerTopology: { keep: true },
  };
  const overlay = {
    schemaVersion: 1,
    ports: { shell: 3120, 'party-registry': 3121 },
    consumerOverlay: { host: 'consumer.example' },
  };
  write('topology/reference-topology.json', topology);
  write('topology/local-overlays/development.json', overlay);
  write(
    'verticals/party-registry/module-federation.config.ts',
    `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
export default createModuleFederationConfig({ name: 'partyRegistry', exposes: { './PageContacts': './src/federation/page-contacts.tsx' } });`,
  );
  write(
    'verticals/party-registry/src/federation/page-contacts.tsx',
    'export default function PageContacts() {}',
  );
  write(
    'apps/shell/modern.config.ts',
    'throw new Error("application config must not execute during discovery")',
  );
  return { root, topology, overlay };
}

test('canonical reader preserves authored topology and explicit composition without evaluating app config', () => {
  const { root, topology, overlay } = fixture();
  try {
    const before = fs.readFileSync(
      path.join(root, 'topology/reference-topology.json'),
      'utf8',
    );
    const view = readUltramodernWorkspaceInputs(root);
    assert.equal(view.primaryShell.id, 'shell');
    assert.deepEqual(view.primaryShell.verticalRefs, []);
    assert.equal(view.primaryShell.port, 3120);
    assert.equal(view.raw.topology.shell.consumerChoice, 'keep');
    assert.deepEqual(
      view.raw.topology.consumerTopology,
      topology.consumerTopology,
    );
    assert.deepEqual(view.raw.overlay.consumerOverlay, overlay.consumerOverlay);
    assert.equal(
      fs.readFileSync(
        path.join(root, 'topology/reference-topology.json'),
        'utf8',
      ),
      before,
    );
    assert.equal(
      fs.existsSync(path.join(root, '.modernjs/ultramodern.json')),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('custom Module Federation expose path is read from native config', () => {
  const { root } = fixture();
  try {
    const expose = () =>
      readUltramodernWorkspaceInputs(root).verticals[0].exposes?.[
        './PageContacts'
      ];
    assert.equal(expose(), './src/federation/page-contacts.tsx');
    fs.rmSync(
      path.join(
        root,
        'verticals/party-registry/src/federation/page-contacts.tsx',
      ),
    );
    assert.equal(expose(), './src/federation/page-contacts.tsx');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
