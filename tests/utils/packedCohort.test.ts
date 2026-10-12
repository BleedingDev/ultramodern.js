import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bleedingdevOverrides,
  packedWorkspaceOverrides,
} from './generatedWorkspaceDependencies';
import { bleedingdevEdges, packTestSidecars } from './runWithPrerequisites.mjs';

const recipes: Array<{ fork: { name: string; version: string } }> = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../scripts/ultramodern-supply/sidecars.json'),
    'utf8',
  ),
);

test('the harness packs exactly the sidecars the release publishes', async () => {
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-test-sidecars-'),
  );
  try {
    const packed: Record<string, { tarball: string; version: string }> =
      await packTestSidecars(outputDir);
    expect(
      Object.fromEntries(
        Object.entries(packed).map(([name, { version }]) => [name, version]),
      ),
    ).toEqual(
      Object.fromEntries(recipes.map(({ fork }) => [fork.name, fork.version])),
    );
    for (const { tarball } of Object.values(packed)) {
      expect(fs.statSync(tarball).isFile()).toBe(true);
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}, 300_000);

test('npm aliases onto @bleedingdev resolve to packed tarballs by alias key', () => {
  const edges = bleedingdevEdges({
    dependencies: {
      '@module-federation/runtime': 'npm:@bleedingdev/mf-runtime@2.9.1',
      react: '19.2.0',
    },
    devDependencies: { '@bleedingdev/ipx': '3.2.2' },
  });
  expect(
    bleedingdevOverrides(edges, {
      '@bleedingdev/mf-runtime': {
        tarball: '/packed/mf-runtime.tgz',
        version: '2.9.1',
        integrity: '',
      },
      '@bleedingdev/ipx': {
        tarball: '/packed/ipx.tgz',
        version: '3.2.2',
        integrity: '',
      },
    }),
  ).toEqual({
    '@module-federation/runtime@npm:@bleedingdev/mf-runtime@2.9.1':
      'file:/packed/mf-runtime.tgz',
    '@bleedingdev/ipx@3.2.2': 'file:/packed/ipx.tgz',
  });
});

test('an unpacked @bleedingdev dependency names the supply manifest to fix', () => {
  const edges = bleedingdevEdges({
    dependencies: {
      '@module-federation/node': 'npm:@bleedingdev/mf-node@2.7.51',
    },
  });
  expect(() => bleedingdevOverrides(edges, {})).toThrow(
    'Add it to scripts/ultramodern-supply/sidecars.json / staged cohort',
  );
  expect(() =>
    bleedingdevOverrides(edges, {
      '@bleedingdev/mf-node': {
        tarball: '/packed/mf-node.tgz',
        version: '2.7.50',
        integrity: '',
      },
    }),
  ).toThrow('packed @bleedingdev/mf-node: 2.7.50');
});

test('generated workspace overrides install exact packed sidecars and preserve native sharp', () => {
  const overrides = {
    braces: 'npm:@bleedingdev/braces@3.0.4',
    'micromatch>braces': 'npm:@bleedingdev/braces@3.0.4',
    'braces@>=3.0.0 <3.0.4': 'npm:@bleedingdev/braces@3.0.4',
    'sharp@>=0.35.0 <0.35.5': '0.35.5',
  };
  expect(
    packedWorkspaceOverrides(overrides, {
      '@bleedingdev/braces': {
        tarball: '/packed/braces.tgz',
        version: '3.0.4',
        integrity: '',
      },
    }),
  ).toEqual({
    braces: 'file:/packed/braces.tgz',
    'micromatch>braces': 'file:/packed/braces.tgz',
    'braces@>=3.0.0 <3.0.4': 'file:/packed/braces.tgz',
    'sharp@>=0.35.0 <0.35.5': '0.35.5',
  });
  expect(overrides.braces).toBe('npm:@bleedingdev/braces@3.0.4');
});

test('workspace override transport rejects unavailable sidecars and version substitutions', () => {
  const overrides = { braces: 'npm:@bleedingdev/braces@3.0.4' };
  expect(() => packedWorkspaceOverrides(overrides, {})).toThrow(
    'Add it to scripts/ultramodern-supply/sidecars.json / staged cohort',
  );
  expect(() =>
    packedWorkspaceOverrides(overrides, {
      '@bleedingdev/braces': {
        tarball: '/packed/braces.tgz',
        version: '3.0.3',
        integrity: '',
      },
    }),
  ).toThrow('packed @bleedingdev/braces: 3.0.3');
});
