import assert from 'node:assert/strict';
import type { WorkspaceApp } from '../src/ultramodern-workspace/types';
import { createZeropsYaml } from '../src/ultramodern-workspace/zerops';

const ownership = {
  team: 'platform',
  slack: '#platform',
  pagerDuty: 'platform',
  runbookRef: 'docs/runbook.md',
  adrRef: 'docs/adr.md',
  blastRadius: {
    tier: 'low',
    references: [],
  },
};

test('Zerops YAML quotes interpolated values with spaces and quotes', () => {
  const app: WorkspaceApp = {
    id: "catalog 'quoted' app",
    directory: "verticals/catalog 'quoted'",
    packageSuffix: "catalog 'quoted' pkg",
    displayName: 'Catalog',
    kind: 'vertical',
    portEnv: 'CATALOG_PORT',
    port: 3050,
    mfName: 'catalog',
    api: {
      prefix: '/catalog api',
      stem: "catalog 'stem'",
      consumedBy: [],
    },
    ownership,
  };

  const yaml = createZeropsYaml('acme', [app]);

  assert.match(yaml, /setup: 'catalog ''quoted'' app'/u);
  assert.ok(
    yaml.includes("--app 'catalog '\\''quoted'\\'' app'"),
    'app id should be shell-quoted in materialize command',
  );
  assert.ok(
    yaml.includes("--package '@acme/catalog '\\''quoted'\\'' pkg'"),
    'package name should be shell-quoted in materialize command',
  );
  assert.ok(
    yaml.includes("--package-dir 'verticals/catalog '\\''quoted'\\'''"),
    'package directory should be shell-quoted in materialize command',
  );
  assert.match(yaml, /path: '\/catalog api\/catalog ''stem''\/readiness'/u);
  assert.ok(
    yaml.includes("start: cd '.zerops/runtime/catalog '\\''quoted'\\'' app'"),
    'runtime start path should be shell-quoted',
  );
});
