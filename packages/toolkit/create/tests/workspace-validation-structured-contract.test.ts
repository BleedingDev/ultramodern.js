import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernShell,
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

function generateMultiShellWorkspace(workspaceDir: string) {
  generateWorkspace(workspaceDir);
  addUltramodernShell({
    workspaceRoot: workspaceDir,
    name: 'admin',
    modernVersion: '3.2.1',
  });
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

function appendText(workspaceDir: string, relativePath: string, text: string) {
  fs.appendFileSync(path.join(workspaceDir, relativePath), text, 'utf-8');
}

function removeText(workspaceDir: string, relativePath: string, text: string) {
  const absolutePath = path.join(workspaceDir, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf-8');
  assert.ok(source.includes(text), `${relativePath} must contain ${text}`);
  fs.writeFileSync(absolutePath, source.replace(text, ''), 'utf-8');
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
    assert.match(
      validatorSource,
      /generatedSurfacePolicy: \{\s*schemaVersion: 1,/,
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

test('generated validator rejects every structured generated-surface anti-shim rule', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-surface-policy-'));
  const baselineDir = path.join(tempRoot, 'baseline');
  const scenarios: Array<{
    name: string;
    mutate: (workspaceDir: string) => void;
    expected: RegExp;
  }> = [
    {
      name: 'effect-diagnostics-suppression',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/src/routes/shell-frame.tsx',
          '\n// @effect-diagnostics suppress-next-line\n',
        );
      },
      expected:
        /generated surface policy effect-diagnostics-suppressions\.effect-diagnostics-directive/,
    },
    {
      name: 'zephyr-environment-gate',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, 'apps/shell-super-app/package.json', value => {
          value.scripts['zephyr:build'] =
            'ULTRAMODERN_ZEPHYR = false pnpm build';
        });
      },
      expected:
        /generated surface policy zephyr-gating\.ultramodern-zephyr-environment-gate/,
    },
    {
      name: 'bridge-router-disabled',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/module-federation.config.ts',
          '\nconst bridgeEscape = { enableBridgeRouter : false };\n',
        );
      },
      expected:
        /generated surface policy module-federation-bridge-escapes\.bridge-router-disabled/,
    },
    {
      name: 'dynamic-remote-type-hints-disabled',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/module-federation.config.ts',
          '\nconst typeHintsEscape = { disableDynamicRemoteTypeHints\n: true };\n',
        );
      },
      expected:
        /generated surface policy module-federation-bridge-escapes\.dynamic-remote-type-hints-disabled/,
    },
    {
      name: 'shared-exclude-plugin-tree-shaking',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/module-federation.config.ts',
          '\nconst treeShakingEscape = { treeShakingSharedExcludePlugins: [] };\n',
        );
      },
      expected:
        /generated surface policy module-federation-bridge-escapes\.shared-exclude-plugin-tree-shaking/,
    },
    {
      name: 'window-location-navigation',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/src/routes/shell-frame.tsx',
          "\nwindow . location . assign('/catalog');\n",
        );
      },
      expected:
        /generated surface policy shell-routing-native-navigation\.window-location-navigation/,
    },
    {
      name: 'synthetic-anchor-click-interception',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/src/routes/shell-frame.tsx',
          '\nconst intercepted = <a onClick={(event: Event) => event . preventDefault ()} />;\n',
        );
      },
      expected:
        /generated surface policy shell-routing-native-navigation\.synthetic-anchor-click-interception/,
    },
    {
      name: 'named-anchor-click-interception',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/src/routes/shell-frame.tsx',
          `
function interceptCatalogAnchor(event: Event) {
  event.preventDefault();
}
const namedIntercepted = (
  <a href="/catalog" onClick={interceptCatalogAnchor}>Catalog</a>
);
`,
        );
      },
      expected:
        /generated surface policy shell-routing-native-navigation\.synthetic-anchor-click-interception/,
    },
    {
      name: 'extracted-anchor-click-interception',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/src/routes/shell-frame.tsx',
          `
const generatedNavigation = { openCatalog: () => undefined };
const extractedIntercepted = (
  <a href="/catalog" onClick={generatedNavigation.openCatalog}>Catalog</a>
);
`,
        );
      },
      expected:
        /generated surface policy shell-routing-native-navigation\.synthetic-anchor-click-interception/,
    },
    {
      name: 'manual-module-federation-loading-wrapper',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/src/routes/vertical-components.imports.tsx',
          "\nloadRemote('@catalog/Panel');\n",
        );
      },
      expected:
        /generated surface policy module-federation-native-loading\.manual-module-federation-loading-wrapper/,
    },
    {
      name: 'direct-process-env-access',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/modern.config.ts',
          "\nconst legacyEnv = process . env ['LEGACY_VALUE'];\n",
        );
      },
      expected:
        /generated surface policy framework-config-api\.direct-process-env-access/,
    },
    {
      name: 'node-child-process-access',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/module-federation.config.ts',
          "\nimport { execFileSync } from 'node:child_process';\n",
        );
      },
      expected:
        /generated surface policy framework-config-api\.node-child-process-access/,
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

test('generated contract:check requires the isolated Module Federation DTS compiler API', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-dts-compiler-'));
  const baselineDir = path.join(tempRoot, 'baseline');
  const packageExtension = "  '@module-federation/dts-plugin@2.7.0':\n";
  const compilerDependency = '      typescript: npm:typescript@6.0.3\n';
  const scenarios: Array<{
    name: string;
    mutate: (workspaceDir: string) => void;
    expected: RegExp;
  }> = [
    {
      name: 'missing-package-extension',
      mutate: workspaceDir => {
        removeText(workspaceDir, 'pnpm-workspace.yaml', packageExtension);
      },
      expected:
        /must isolate the Module Federation DTS plugin on the supported TypeScript compiler API/,
    },
    {
      name: 'missing-compiler-dependency',
      mutate: workspaceDir => {
        removeText(workspaceDir, 'pnpm-workspace.yaml', compilerDependency);
      },
      expected:
        /must isolate the Module Federation DTS plugin on the supported TypeScript compiler API/,
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

test('generated validator enforces additional-shell ownership, build, degraded, and Zerops cohorts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-shell-cohort-'));
  const baselineDir = path.join(tempRoot, 'baseline');
  const scenarios: Array<{
    name: string;
    mutate: (workspaceDir: string) => void;
    expected: RegExp;
  }> = [
    {
      name: 'missing-owner',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
          delete value.shells[0].owner;
        });
      },
      expected: /complete additional-shell config record/,
    },
    {
      name: 'wrong-app-id',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, 'apps/shell-admin/package.json', value => {
          value.modernjs.appId = 'wrong-shell';
        });
      },
      expected:
        /generated app package manifest cohort|shell-admin package modernjs\.appId is incorrect/,
    },
    {
      name: 'wrong-build-marker',
      mutate: workspaceDir => {
        mutateJson(
          workspaceDir,
          'apps/shell-admin/shared/ultramodern-build.json',
          value => {
            value.deliveryUnit.buildMarker = 'wrong-marker';
          },
        );
      },
      expected: /shell-admin build marker is not participating/,
    },
    {
      name: 'wrong-degraded-identity',
      mutate: workspaceDir => {
        const sourcePath = path.join(
          workspaceDir,
          'apps/shell-admin/src/routes/vertical-components.tsx',
        );
        fs.writeFileSync(
          sourcePath,
          fs
            .readFileSync(sourcePath, 'utf-8')
            .replaceAll('shelladmin:text-red-900', 'shellsuperapp:text-red-900'),
          'utf-8',
        );
      },
      expected: /degraded fallback must report its own shell identity/,
    },
    {
      name: 'missing-zerops-service',
      mutate: workspaceDir => {
        const zeropsPath = path.join(workspaceDir, 'zerops.yaml');
        fs.writeFileSync(
          zeropsPath,
          fs
            .readFileSync(zeropsPath, 'utf-8')
            .replace("setup: 'shell-admin'", "setup: 'missing-shell'"),
          'utf-8',
        );
      },
      expected: /shell-admin must have a Zerops service/,
    },
  ];

  try {
    generateMultiShellWorkspace(baselineDir);
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
