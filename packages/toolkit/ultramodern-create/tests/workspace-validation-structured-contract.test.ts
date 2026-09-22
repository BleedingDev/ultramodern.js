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
import { linkInstalledCompiler, runValidation } from './helpers/workspace-kit';

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

function generateWorkspace(workspaceDir: string, enableTailwind = true) {
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: path.basename(workspaceDir),
    modernVersion: '3.2.1',
    enableTailwind,
    packageSource: {
      strategy: 'workspace',
    },
  });
  addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: 'catalog',
    modernVersion: '3.2.1',
  });
  linkInstalledCompiler(workspaceDir);
}

function commandOutput(result: ReturnType<typeof runValidation>) {
  return `${result.stdout}\n${result.stderr}`;
}

function appendText(workspaceDir: string, relativePath: string, text: string) {
  fs.appendFileSync(path.join(workspaceDir, relativePath), text, 'utf-8');
}

function replaceText(
  workspaceDir: string,
  relativePath: string,
  current: string,
  replacement: string,
) {
  const absolutePath = path.join(workspaceDir, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf-8');
  fs.writeFileSync(absolutePath, source.replace(current, replacement), 'utf-8');
}

test('generated validator accepts equivalent structured JSON representations', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-contract-json-'));
  const workspaceDir = path.join(tempRoot, 'structured-contract');

  try {
    generateWorkspace(workspaceDir);

    const baseline = runValidation(workspaceDir);
    assert.equal(baseline.status, 0, commandOutput(baseline));

    const externalInvocation = spawnSync(
      process.execPath,
      [path.resolve(__dirname, '../bin/run.js'), 'ultramodern', 'validate'],
      {
        cwd: tempRoot,
        encoding: 'utf-8',
        env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: workspaceDir },
      },
    );
    assert.equal(
      externalInvocation.status,
      0,
      commandOutput(externalInvocation),
    );

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

test('maintained workspaces can own packages, routes, platform APIs, and deployment recipes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-maintained-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    generateWorkspace(workspaceDir);
    fs.rmSync(path.join(workspaceDir, 'CLAUDE.md'), { force: true });
    fs.renameSync(
      path.join(workspaceDir, '.github'),
      path.join(tempRoot, '.github'),
    );
    fs.mkdirSync(path.join(workspaceDir, 'apps/shell-super-app/api'));
    fs.writeFileSync(
      path.join(workspaceDir, 'apps/shell-super-app/api/index.ts'),
      'export {};\n',
    );
    fs.writeFileSync(path.join(workspaceDir, 'zerops.yaml'), 'zerops: []\n');
    const owned = {
      id: 'platform-services',
      package: '@workspace/platform-services',
      path: 'packages/platform-services',
    };
    fs.mkdirSync(path.join(workspaceDir, owned.path));
    writeJson(workspaceDir, `${owned.path}/package.json`, {
      name: owned.package,
      private: true,
    });
    writeJson(workspaceDir, `${owned.path}/tsconfig.json`, {
      extends: '../../tsconfig.base.json',
      files: [],
    });
    mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
      const cloudflare = value.topology.apps.find(
        (app: { id: string }) => app.id === 'catalog',
      ).deploy.cloudflare;
      delete cloudflare.routes.ssr;
      delete cloudflare.routes.locale;
    });
    mutateJson(workspaceDir, 'topology/reference-topology.json', value => {
      value.sharedPackages.push(owned);
      value.shell.authentication = { owner: 'platform-services' };
      delete value.verticals[0].api.domainOperations;
    });
    mutateJson(workspaceDir, 'topology/ownership.json', value => {
      value.owners.push(owned);
    });
    mutateJson(
      workspaceDir,
      'topology/local-overlays/development.json',
      value => {
        value.applicationModules = {};
      },
    );
    mutateJson(workspaceDir, 'tsconfig.json', value => {
      value.references.push({ path: owned.path });
    });
    mutateJson(workspaceDir, 'apps/shell-super-app/tsconfig.json', value => {
      value.include.push('api');
      value.references.push({ path: `../../${owned.path}` });
      value.references.reverse();
    });
    mutateJson(workspaceDir, 'package.json', value => {
      value.devDependencies['@modern-js/codesmith'] = '2.6.9';
    });
    const result = runValidation(workspaceDir);
    assert.equal(result.status, 0, commandOutput(result));
    mutateJson(workspaceDir, `${owned.path}/package.json`, value => {
      value.name = '@wrong/identity';
    });
    const invalid = runValidation(workspaceDir);
    assert.notEqual(invalid.status, 0);
    assert.match(commandOutput(invalid), /ownership package must match/);
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
      expected:
        /Unsupported UltraModern config schemaVersion 9 in .*ultramodern\.json\. Supported schema versions: 1\./,
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
          delete value.devDependencies['@modern-js/ultramodern-create'];
        });
      },
      expected:
        /Modern package cohort is missing @modern-js\/ultramodern-create/,
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
      expected:
        /Duplicate value "catalog" in workspace validation contract app cohort/,
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
        /Unknown remote vertical reference catalog for shell-super-app\. Available remotes: none\./,
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
      name: 'compact-remote-federation-drift',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
          value.topology.apps.find(
            (app: { id: string }) => app.id === 'catalog',
          ).moduleFederation.exposes = [];
        });
      },
      expected:
        /topology(?:\.apps\.catalog published surfaces|\/reference-topology\.json verticals\.catalog)/,
    },
    {
      name: 'primary-shell-identity-drift',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
          value.topology.apps[0].portEnv = 'UNSUPPORTED_SHELL_PORT';
        });
      },
      expected: /topology\.apps\.shell-super-app shell identity/,
    },
    {
      name: 'disabled-streaming-ssr',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
          value.topology.apps[0].moduleFederation.ssr = false;
        });
      },
      expected: /topology\.apps\.shell-super-app\.moduleFederation\.ssr/,
    },
    {
      name: 'missing-cloudflare-smoke-contract',
      mutate: workspaceDir => {
        mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
          const catalog = value.topology.apps.find(
            (app: { id?: string }) => app.id === 'catalog',
          );
          delete catalog.deploy.cloudflare.jsonSmokeChecks;
        });
      },
      expected:
        /MicroVertical contract self-check failed: \.modernjs\/ultramodern\.json topology/,
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
      fs.cpSync(baselineDir, workspaceDir, {
        recursive: true,
        filter: source => source !== path.join(baselineDir, 'node_modules'),
      });
      linkInstalledCompiler(workspaceDir);
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

test('generated validator checks active Tailwind wiring rather than unused dependencies', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-tailwind-policy-'),
  );
  try {
    for (const enabled of [true, false]) {
      const workspaceDir = path.join(tempRoot, `tailwind-${enabled}`);
      generateWorkspace(workspaceDir, enabled);
      const configPath = 'apps/shell-super-app/modern.config.ts';
      if (enabled) {
        replaceText(
          workspaceDir,
          configPath,
          '{ pluginTailwindcss }',
          '{ pluginTailwindcss as stylesPlugin }',
        );
        replaceText(
          workspaceDir,
          configPath,
          'pluginTailwindcss()',
          'stylesPlugin()',
        );
      } else {
        mutateJson(workspaceDir, 'apps/shell-super-app/package.json', value => {
          value.devDependencies['@rsbuild/plugin-tailwindcss'] = '2.0.4';
        });
        appendText(
          workspaceDir,
          configPath,
          "\nimport { pluginTailwindcss as unusedTailwind } from '@rsbuild/plugin-tailwindcss';\nconst unusedBuilderConfiguration = { builderPlugins: [unusedTailwind()] };\n",
        );
      }
      const consistent = runValidation(workspaceDir);
      assert.equal(consistent.status, 0, commandOutput(consistent));
      mutateJson(workspaceDir, '.modernjs/ultramodern.json', value => {
        value.features.tailwind = !enabled;
      });
      const inconsistent = runValidation(workspaceDir);
      assert.notEqual(inconsistent.status, 0, commandOutput(inconsistent));
      assert.match(
        commandOutput(inconsistent),
        enabled
          ? /policy\.features\.tailwind/
          : /Missing apps\/shell-super-app\/tailwind\.config\.ts/,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator enforces additional-shell ownership, build, and degraded cohorts', () => {
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
  ];

  try {
    generateMultiShellWorkspace(baselineDir);
    const baseline = runValidation(baselineDir);
    assert.equal(baseline.status, 0, commandOutput(baseline));

    for (const scenario of scenarios) {
      const workspaceDir = path.join(tempRoot, scenario.name);
      fs.cpSync(baselineDir, workspaceDir, {
        recursive: true,
        filter: source => source !== path.join(baselineDir, 'node_modules'),
      });
      linkInstalledCompiler(workspaceDir);
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
