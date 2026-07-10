import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

const structuredMetadataPaths = [
  '.modernjs/ultramodern.json',
  'topology/reference-topology.json',
  'topology/ownership.json',
  'topology/local-overlays/development.json',
] as const;

function readJson(workspaceDir: string, relativePath: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  );
}

function writeJson(
  workspaceDir: string,
  relativePath: string,
  value: unknown,
  compact = false,
) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    compact ? JSON.stringify(value) : `${JSON.stringify(value, null, 2)}\n`,
    'utf-8',
  );
}

function mutateJson(
  workspaceDir: string,
  relativePath: string,
  mutate: (value: any) => void,
) {
  const value = readJson(workspaceDir, relativePath);
  mutate(value);
  writeJson(workspaceDir, relativePath, value);
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseObjectKeys);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseObjectKeys(entry)]),
    );
  }
  return value;
}

function generateWorkspace(workspaceDir: string) {
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: path.basename(workspaceDir),
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: {
      strategy: 'workspace',
    },
  });
  addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: 'catalog',
    modernVersion: '3.2.1',
  });
}

function runValidation(workspaceDir: string) {
  return spawnSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mts'],
    {
      cwd: workspaceDir,
      encoding: 'utf-8',
    },
  );
}

function commandOutput(result: ReturnType<typeof runValidation>) {
  return `${result.stdout}\n${result.stderr}`;
}

test('generated validator embeds one structured contract and ignores JSON representation', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-contract-json-'));
  const workspaceDir = path.join(tempRoot, 'structured-contract');

  try {
    generateWorkspace(workspaceDir);

    const validatorSource = fs.readFileSync(
      path.join(workspaceDir, 'scripts/validate-ultramodern-workspace.mts'),
      'utf-8',
    );
    assert.match(
      validatorSource,
      /const workspaceValidationContract = \{\s*schemaVersion: 1,/,
    );
    assert.match(
      validatorSource,
      /kind: 'modernjs\.ultramodern-workspace-validation-contract'/,
    );
    assert.doesNotMatch(
      validatorSource,
      /const ultramodernArgs = \['ultramodern', 'validate'/,
    );
    assert.doesNotMatch(
      validatorSource,
      /\{\{+workspaceValidationContractJson/,
    );

    const baseline = runValidation(workspaceDir);
    assert.equal(baseline.status, 0, commandOutput(baseline));

    for (const relativePath of [
      ...structuredMetadataPaths,
      'package.json',
      'apps/shell-super-app/package.json',
      'verticals/catalog/package.json',
    ]) {
      writeJson(
        workspaceDir,
        relativePath,
        reverseObjectKeys(readJson(workspaceDir, relativePath)),
        true,
      );
    }

    const reordered = runValidation(workspaceDir);
    assert.equal(reordered.status, 0, commandOutput(reordered));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator rejects schema, cohort, topology, policy, and legacy drift', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-contract-bad-'));
  const baselineDir = path.join(tempRoot, 'baseline');

  const scenarios: Array<{
    name: string;
    mutate: (workspaceDir: string) => void;
    expected: RegExp;
  }> = [
    {
      name: 'unknown-schema',
      mutate: workspaceDir => {
        for (const relativePath of structuredMetadataPaths) {
          mutateJson(workspaceDir, relativePath, value => {
            value.schemaVersion = 9;
          });
        }
      },
      expected: /Unsupported workspace metadata schemaVersion 9/,
    },
    {
      name: 'mixed-schema',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, 'topology/reference-topology.json', value => {
          value.schemaVersion = 2;
        });
      },
      expected: /Mixed workspace metadata schema versions/,
    },
    {
      name: 'missing-modern-package',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, 'package.json', value => {
          delete value.devDependencies['@modern-js/create'];
        });
      },
      expected: /Modern package cohort is missing @modern-js\/create/,
    },
    {
      name: 'duplicate-app',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
          const catalog = value.topology.apps.find(
            (app: { id?: string }) => app.id === 'catalog',
          );
          value.topology.apps.push(structuredClone(catalog));
        });
      },
      expected: /Duplicate id "catalog" in .*topology\.apps/,
    },
    {
      name: 'omitted-app-across-observed-metadata',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
          value.topology.apps = value.topology.apps.filter(
            (app: { id?: string }) => app.id !== 'catalog',
          );
          value.moduleFederation.apps = value.moduleFederation.apps.filter(
            (app: { id?: string }) => app.id !== 'catalog',
          );
          value.backendFederation.apps = value.backendFederation.apps.filter(
            (app: { id?: string }) => app.id !== 'catalog',
          );
        });
        mutateJson(workspaceDir, 'topology/reference-topology.json', value => {
          value.verticals = [];
          value.shell.verticalRefs = [];
          value.shell.moduleFederation.remotes = [];
        });
        mutateJson(workspaceDir, 'topology/ownership.json', value => {
          value.owners = value.owners.filter(
            (owner: { id?: string }) => owner.id !== 'catalog',
          );
        });
        mutateJson(
          workspaceDir,
          'topology/local-overlays/development.json',
          value => {
            for (const field of [
              'apis',
              'manifests',
              'ports',
              'serverExecution',
            ]) {
              delete value[field].catalog;
            }
          },
        );
      },
      expected:
        /MicroVertical contract self-check failed: \.modernjs\/ultramodern\.json topology\.apps cohort/,
    },
    {
      name: 'retired-metadata-file',
      mutate: workspaceDir => {
        writeJson(
          workspaceDir,
          '.modernjs/ultramodern-generated-contract.json',
          { schemaVersion: 1 },
        );
      },
      expected: /Unexpected \.modernjs\/ultramodern-generated-contract\.json/,
    },
    {
      name: 'stale-package-source-field',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
          value.packageSource.metadata = { schemaVersion: 1 };
        });
      },
      expected:
        /Stale legacy field \.modernjs\/ultramodern\.json\.packageSource\.metadata is forbidden/,
    },
    {
      name: 'semantic-policy-drift',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
          value.features.tailwind = false;
        });
      },
      expected:
        /MicroVertical contract self-check failed: \.modernjs\/ultramodern\.json policy/,
    },
    {
      name: 'structured-backend-proof-drift',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
          value.backendFederation.apps[0].executionSurfaces.node.remoteType =
            'commonjs';
        });
      },
      expected:
        /MicroVertical contract self-check failed: \.modernjs\/ultramodern\.json policy/,
    },
  ];

  try {
    generateWorkspace(baselineDir);
    const baseline = runValidation(baselineDir);
    assert.equal(baseline.status, 0, commandOutput(baseline));

    for (const scenario of scenarios) {
      const workspaceDir = path.join(tempRoot, scenario.name);
      fs.cpSync(baselineDir, workspaceDir, { recursive: true });
      scenario.mutate(workspaceDir);

      const result = runValidation(workspaceDir);
      const output = commandOutput(result);
      assert.notEqual(result.status, 0, `${scenario.name}\n${output}`);
      assert.match(output, scenario.expected, scenario.name);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
