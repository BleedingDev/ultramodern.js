import assert from 'node:assert/strict';
import yaml from 'js-yaml';
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

  const document = yaml.load(createZeropsYaml('acme', [app])) as {
    zerops: Array<Record<string, any>>;
  };
  const [service] = document.zerops;

  assert.equal(service.setup, "catalog 'quoted' app");
  assert.equal(
    service.deploy.readinessCheck.httpGet.path,
    "/catalog api/catalog 'stem'/readiness",
  );
  assert.equal(
    service.run.start,
    "cd '.zerops/runtime/catalog '\\''quoted'\\'' app' && npm run serve",
  );
  assert.equal(service.build.buildCommands.length, 1);
  const materialize = service.build.buildCommands[0]
    .split('\n')
    .find((command: string) => command.includes('zerops:materialize'));
  assert.equal(
    materialize,
    "~/.local/bin/mise exec -- pnpm run zerops:materialize -- --app 'catalog '\\''quoted'\\'' app' --package '@acme/catalog '\\''quoted'\\'' pkg' --package-dir 'verticals/catalog '\\''quoted'\\'''",
  );
});
