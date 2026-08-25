import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { yaml } from '@modern-js/utils';
import { runUltramodernToolingCli } from '../src/ultramodern-tooling/commands';
import { ensureBffEffectDependencies } from '../src/ultramodern-tooling/commands/migrate-strict-effect/package-cohort';
import {
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../src/ultramodern-tooling/config';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import {
  createAppMfTypesTsConfig,
  createAppTsConfig,
  createSharedPackageTsConfig,
} from '../src/ultramodern-workspace/package-json';
import {
  renderMinimumReleaseAgeExclude,
  ULTRAMODERN_WORKSPACE_POLICY,
} from '../src/ultramodern-workspace/policy';
import {
  DRIZZLE_ORM_VERSION,
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  MODULE_FEDERATION_VERSION,
  NODE_VERSION,
  OXFMT_VERSION,
  PNPM_VERSION,
  TANSTACK_ROUTER_CORE_VERSION,
  TYPESCRIPT_VERSION,
} from '../src/ultramodern-workspace/versions';

const retiredContractPath = '.modernjs/ultramodern-generated-contract.json';
const retiredPackageSourcePath = '.modernjs/ultramodern-package-source.json';

function readJson(workspaceDir: string, relativePath: string) {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  );
}

function writeJson(workspaceDir: string, relativePath: string, value: unknown) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function writeStandaloneEffectApi(workspaceDir: string) {
  fs.writeFileSync(
    path.join(workspaceDir, 'verticals/catalog/api/effect-api.ts'),
    `export const contract = { servicePrefix: '/catalog-api' };
export const runtime = { brand: 'test-effect-runtime' };
`,
    'utf-8',
  );
}

function scaffoldWorkspace(name: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-tooling-'));
  const workspaceDir = path.join(tempRoot, name);
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: name,
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: { strategy: 'workspace' },
  });
  return { tempRoot, workspaceDir };
}

function exists(workspaceDir: string, relativePath: string) {
  return fs.existsSync(path.join(workspaceDir, relativePath));
}

function writeRetiredRspackRscPatch(
  workspaceDir: string,
  relativePath: string,
) {
  const fixture = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../..',
      'tests/retired-rspack-rsc-0.0.3.patch.gz.base64',
    ),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    zlib.gunzipSync(Buffer.from(fixture.trim(), 'base64')),
  );
}

function readYaml(workspaceDir: string, relativePath: string) {
  return yaml.load(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  ) as Record<string, any>;
}

function writeYaml(
  workspaceDir: string,
  relativePath: string,
  value: Record<string, any>,
) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    yaml.dump(value, {
      lineWidth: -1,
      noCompatMode: true,
      noRefs: true,
      quotingType: "'",
    }),
    'utf-8',
  );
}

function replaceValuesForKey(
  value: unknown,
  key: string,
  replacement: unknown,
): number {
  if (Array.isArray(value)) {
    return value.reduce(
      (count, item) => count + replaceValuesForKey(item, key, replacement),
      0,
    );
  }
  if (value === null || typeof value !== 'object') {
    return 0;
  }
  let count = 0;
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) {
      (value as Record<string, unknown>)[entryKey] = replacement;
      count += 1;
    } else {
      count += replaceValuesForKey(entryValue, key, replacement);
    }
  }
  return count;
}

function valuesForKey(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => valuesForKey(item, key));
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  return Object.entries(value).flatMap(([entryKey, entryValue]) =>
    entryKey === key ? [entryValue] : valuesForKey(entryValue, key),
  );
}

type CommandRecord = {
  args: string[];
  command: string;
  cwd: string;
  env: {
    MODERNJS_DEPLOY?: string;
    ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS?: string;
    ULTRAMODERN_ZEPHYR?: string;
  };
};

function installCommandRecorder(tempRoot: string) {
  const binDir = path.join(tempRoot, 'command-recorder-bin');
  const logPath = path.join(tempRoot, 'command-recorder.jsonl');
  const recorderPath = path.join(binDir, 'record-command.cjs');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    recorderPath,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');

const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const record = {
  args,
  command,
  cwd: process.cwd(),
  env: {
    MODERNJS_DEPLOY: process.env.MODERNJS_DEPLOY,
    ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS:
      process.env.ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS,
    ULTRAMODERN_ZEPHYR: process.env.ULTRAMODERN_ZEPHYR,
  },
};
fs.appendFileSync(process.env.ULTRAMODERN_TEST_COMMAND_LOG, JSON.stringify(record) + '\\n');

if (command === 'pnpm') {
  const scriptName = args[0] === 'run' ? args[1] : args[0];
  if (scriptName && !scriptName.startsWith('-') && !['exec', 'install'].includes(scriptName)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    if (typeof manifest.scripts?.[scriptName] !== 'string') {
      process.exit(127);
    }
  }
}

const invocation = command + ':' + (args[0] === 'run' ? args[1] : args[0] ?? '');
if (process.env.ULTRAMODERN_TEST_FAIL_INVOCATION === invocation) {
  process.exit(Number(process.env.ULTRAMODERN_TEST_FAIL_CODE ?? 1));
}
`,
    'utf-8',
  );
  fs.chmodSync(recorderPath, 0o755);
  for (const command of ['modern', 'node', 'oxfmt', 'pnpm', 'wrangler']) {
    fs.symlinkSync(recorderPath, path.join(binDir, command));
  }
  return { binDir, logPath };
}

function runRecordedPackageScript(
  tempRoot: string,
  workspaceDir: string,
  packageDir: string,
  scriptName: string,
  options: { failCode?: number; failInvocation?: string } = {},
) {
  const { binDir, logPath } = installCommandRecorder(
    fs.mkdtempSync(path.join(tempRoot, 'command-run-')),
  );
  const cwd = path.join(workspaceDir, packageDir);
  const packageJson = readJson(
    workspaceDir,
    path.join(packageDir, 'package.json'),
  );
  const script = packageJson.scripts?.[scriptName];
  const result = spawnSync(
    typeof script === 'string' ? script : 'exit 127',
    [],
    {
      cwd,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        ULTRAMODERN_TEST_COMMAND_LOG: logPath,
        ...(options.failInvocation
          ? {
              ULTRAMODERN_TEST_FAIL_CODE: String(options.failCode ?? 1),
              ULTRAMODERN_TEST_FAIL_INVOCATION: options.failInvocation,
            }
          : {}),
      },
      shell: true,
    },
  );
  const records: CommandRecord[] = fs.existsSync(logPath)
    ? fs
        .readFileSync(logPath, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as CommandRecord)
    : [];
  return { records, result };
}

function recordedPnpmScripts(records: CommandRecord[]) {
  return records
    .filter(record => record.command === 'pnpm')
    .map(record =>
      record.args[0] === 'run' ? record.args[1] : record.args[0],
    );
}

function normalizedCommandTrace(records: CommandRecord[]) {
  return records.map(({ args, command, env }) => ({ args, command, env }));
}

function assertRecordedNodeTarget(
  record: CommandRecord | undefined,
  expectedBasename: string,
) {
  assert.ok(record, `expected node to execute ${expectedBasename}`);
  assert.equal(record.command, 'node');
  assert.equal(path.basename(record.args[0] ?? ''), expectedBasename);
  assert.equal(
    fs.existsSync(path.resolve(record.cwd, record.args[0] ?? '')),
    true,
    `${expectedBasename} must resolve to an existing executable script`,
  );
}

function assertGitIgnored(workspaceDir: string, relativePaths: string[]) {
  const initialized = spawnSync('git', ['init', '--quiet'], {
    cwd: workspaceDir,
    encoding: 'utf-8',
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(workspaceDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, 'ignore probe\n');
    const ignored = spawnSync(
      'git',
      ['check-ignore', '--quiet', '--', relativePath],
      { cwd: workspaceDir, encoding: 'utf-8' },
    );
    assert.equal(ignored.status, 0, `${relativePath} must be ignored by git`);
  }
}

test('migrate preserves consumer-owned check segments and rewrites migrated script refs', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-check-merge');

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const before = readJson(workspaceDir, 'package.json');
    before.scripts['content:validate'] = 'node ./scripts/content-validate.mjs';
    before.scripts.check = `${before.scripts.check} && pnpm content:validate && pnpm design-system:check`;
    before.scripts['design-system:check'] =
      'node ./scripts/design-system-check.mjs';
    before.scripts['ultramodern:assert-mf-types'] =
      'node ./scripts/assert-mf-types.mjs';
    writeJson(workspaceDir, 'package.json', before);
    fs.writeFileSync(
      path.join(workspaceDir, 'scripts/content-validate.mjs'),
      'export {};\n',
    );
    fs.writeFileSync(
      path.join(workspaceDir, 'scripts/design-system-check.mjs'),
      'export {};\n',
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const check = runRecordedPackageScript(
      tempRoot,
      workspaceDir,
      '.',
      'check',
    );
    assert.equal(check.result.status, 0, check.result.stderr);
    const invokedScripts = recordedPnpmScripts(check.records);
    const contentIndex = invokedScripts.indexOf('content:validate');
    const designSystemIndex = invokedScripts.indexOf('design-system:check');
    const performanceIndex = invokedScripts.indexOf('performance:readiness');
    assert.notEqual(contentIndex, -1);
    assert.notEqual(designSystemIndex, -1);
    assert.notEqual(performanceIndex, -1);
    assert.ok(contentIndex < designSystemIndex);
    assert.ok(designSystemIndex < performanceIndex);
    assert.equal(invokedScripts.at(-1), 'performance:readiness');
    assert.equal(invokedScripts.includes('node:proof'), false);

    for (const [scriptName, expectedTarget] of [
      ['content:validate', 'content-validate.mjs'],
      ['design-system:check', 'design-system-check.mjs'],
      ['ultramodern:assert-mf-types', 'assert-mf-types.mts'],
    ] as const) {
      const execution = runRecordedPackageScript(
        tempRoot,
        workspaceDir,
        '.',
        scriptName,
      );
      assert.equal(execution.result.status, 0, execution.result.stderr);
      assertRecordedNodeTarget(
        execution.records.find(record => record.command === 'node'),
        expectedTarget,
      );
    }

    const failedCheck = runRecordedPackageScript(
      tempRoot,
      workspaceDir,
      '.',
      'check',
      { failCode: 37, failInvocation: 'pnpm:content:validate' },
    );
    assert.equal(failedCheck.result.status, 37);
    const failedInvocations = recordedPnpmScripts(failedCheck.records);
    assert.equal(failedInvocations.includes('design-system:check'), false);
    assert.equal(failedInvocations.includes('performance:readiness'), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate removes the retired Module Federation TypeScript shim idempotently', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-mf-ts-shim');
  const workspacePath = path.join(workspaceDir, 'pnpm-workspace.yaml');

  try {
    const policy = yaml.load(fs.readFileSync(workspacePath, 'utf-8')) as Record<
      string,
      any
    >;
    policy.peerDependencyRules.allowedVersions[
      '@module-federation/dts-plugin>typescript'
    ] = '6.0.3';
    policy.peerDependencyRules.allowedVersions[
      '@module-federation/enhanced>typescript'
    ] = '6.0.3';
    policy.peerDependencyRules.allowedVersions['i18next>typescript'] = '6.0.3';
    policy.packageExtensions = {
      '@module-federation/dts-plugin@2.7.0': {
        dependencies: { typescript: 'npm:typescript@6.0.3' },
        peerDependencies: { typescript: '6.0.3' },
      },
      'consumer-owned-package@1.2.3': {
        dependencies: { consumer: '4.5.6' },
      },
    };
    fs.writeFileSync(workspacePath, yaml.dump(policy), 'utf-8');

    for (let run = 0; run < 2; run += 1) {
      assert.equal(
        await runUltramodernToolingCli(
          ['migrate-strict-effect', '--skip-install'],
          workspaceDir,
        ),
        0,
      );
    }

    const migratedPolicy = yaml.load(
      fs.readFileSync(workspacePath, 'utf-8'),
    ) as Record<string, any>;
    assert.equal(
      migratedPolicy.peerDependencyRules.allowedVersions[
        '@module-federation/dts-plugin>typescript'
      ],
      undefined,
    );
    assert.equal(
      migratedPolicy.peerDependencyRules.allowedVersions[
        '@module-federation/enhanced>typescript'
      ],
      undefined,
    );
    assert.equal(
      migratedPolicy.peerDependencyRules.allowedVersions['i18next>typescript'],
      undefined,
    );
    assert.equal(
      migratedPolicy.packageExtensions['@module-federation/dts-plugin@2.7.0'],
      undefined,
    );
    assert.deepEqual(
      migratedPolicy.packageExtensions['consumer-owned-package@1.2.3'],
      {
        dependencies: { consumer: '4.5.6' },
      },
    );

    migratedPolicy.packageExtensions = {
      '@module-federation/dts-plugin@2.8.0': {
        dependencies: { typescript: 'npm:typescript@6.0.3' },
      },
    };
    fs.writeFileSync(workspacePath, yaml.dump(migratedPolicy), 'utf-8');
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    const withoutExtensions = yaml.load(
      fs.readFileSync(workspacePath, 'utf-8'),
    ) as Record<string, any>;
    assert.equal(withoutExtensions.packageExtensions, undefined);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate recognizes previously generated Module Federation patch cohorts', async () => {
  for (const staleVersion of ['2.7.0', '2.8.0']) {
    const { tempRoot, workspaceDir } = scaffoldWorkspace(
      `tooling-mf-${staleVersion}-patch-cohort`,
    );
    const workspacePath = path.join(workspaceDir, 'pnpm-workspace.yaml');

    try {
      const policy = yaml.load(
        fs.readFileSync(workspacePath, 'utf-8'),
      ) as Record<string, any>;
      delete policy.patchedDependencies[
        `@module-federation/modern-js-v3@${MODULE_FEDERATION_VERSION}`
      ];
      delete policy.patchedDependencies[
        `@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}`
      ];
      policy.patchedDependencies[
        `@module-federation/modern-js-v3@${staleVersion}`
      ] = `patches/@module-federation__modern-js-v3@${staleVersion}.patch`;
      policy.patchedDependencies[
        `@module-federation/bridge-react@${staleVersion}`
      ] = `patches/@module-federation__bridge-react@${staleVersion}.patch`;
      fs.writeFileSync(workspacePath, yaml.dump(policy), 'utf-8');

      assert.equal(
        await runUltramodernToolingCli(
          ['migrate-strict-effect', '--skip-install'],
          workspaceDir,
        ),
        0,
      );

      const migratedPolicy = yaml.load(
        fs.readFileSync(workspacePath, 'utf-8'),
      ) as Record<string, any>;
      assert.equal(
        migratedPolicy.patchedDependencies[
          `@module-federation/modern-js-v3@${staleVersion}`
        ],
        undefined,
      );
      assert.equal(
        migratedPolicy.patchedDependencies[
          `@module-federation/bridge-react@${staleVersion}`
        ],
        undefined,
      );
      assert.equal(
        migratedPolicy.patchedDependencies[
          `@module-federation/modern-js-v3@${MODULE_FEDERATION_VERSION}`
        ],
        `patches/@module-federation__modern-js-v3@${MODULE_FEDERATION_VERSION}.patch`,
      );
      assert.equal(
        migratedPolicy.patchedDependencies[
          `@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}`
        ],
        `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
      );
      assert.equal(
        exists(workspaceDir, 'patches/effect-schema-error-type-id.patch'),
        true,
        'migration must preserve the active same-path Effect declaration patch',
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test('migrate retires the former generated Rspack RSC patch', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-retired-rspack-rsc-patch',
  );
  const workspacePath = path.join(workspaceDir, 'pnpm-workspace.yaml');
  const patchFile = '@react-server-dom-rspack@0.0.3.patch';
  const relativePatchPath = `patches/${patchFile}`;
  const selector = 'react-server-dom-rspack@0.0.3';

  try {
    const policy = yaml.load(fs.readFileSync(workspacePath, 'utf-8')) as Record<
      string,
      any
    >;
    policy.patchedDependencies[selector] = relativePatchPath;
    fs.writeFileSync(workspacePath, yaml.dump(policy), 'utf-8');
    writeRetiredRspackRscPatch(workspaceDir, relativePatchPath);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const migratedPolicy = yaml.load(
      fs.readFileSync(workspacePath, 'utf-8'),
    ) as Record<string, any>;
    assert.equal(migratedPolicy.patchedDependencies[selector], undefined);
    assert.equal(exists(workspaceDir, relativePatchPath), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate materializes the required TanStack router declaration patch', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-required-tanstack-router-patch',
  );
  const workspacePath = path.join(workspaceDir, 'pnpm-workspace.yaml');
  const patchFile = `@tanstack__router-core@${TANSTACK_ROUTER_CORE_VERSION}.patch`;
  const relativePatchPath = `patches/${patchFile}`;
  const selector = `@tanstack/router-core@${TANSTACK_ROUTER_CORE_VERSION}`;
  const canonicalPatch = fs.readFileSync(
    path.resolve(__dirname, '../template-workspace', relativePatchPath),
    'utf-8',
  );

  try {
    assert.equal(
      fs.readFileSync(path.join(workspaceDir, relativePatchPath), 'utf-8'),
      canonicalPatch,
      'fresh scaffolds must ship the canonical router-core declaration patch',
    );

    // Simulate a workspace created before the router-core 1.171.21 cohort:
    // no selector and no patch file on disk.
    const policy = yaml.load(fs.readFileSync(workspacePath, 'utf-8')) as Record<
      string,
      any
    >;
    delete policy.patchedDependencies[selector];
    fs.writeFileSync(workspacePath, yaml.dump(policy), 'utf-8');
    fs.rmSync(path.join(workspaceDir, relativePatchPath));

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const migratedPolicy = yaml.load(
      fs.readFileSync(workspacePath, 'utf-8'),
    ) as Record<string, any>;
    assert.equal(
      migratedPolicy.patchedDependencies[selector],
      relativePatchPath,
    );
    assert.equal(
      fs.readFileSync(path.join(workspaceDir, relativePatchPath), 'utf-8'),
      canonicalPatch,
      'migration must restore the canonical router-core declaration patch',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate preserves and rejects a consumer-modified retired Rspack RSC patch', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-modified-retired-rspack-rsc-patch',
  );
  const workspacePath = path.join(workspaceDir, 'pnpm-workspace.yaml');
  const patchFile = '@react-server-dom-rspack@0.0.3.patch';
  const relativePatchPath = `patches/${patchFile}`;
  const selector = 'react-server-dom-rspack@0.0.3';
  const patchPath = path.join(workspaceDir, relativePatchPath);

  try {
    const policy = yaml.load(fs.readFileSync(workspacePath, 'utf-8')) as Record<
      string,
      any
    >;
    policy.patchedDependencies[selector] = relativePatchPath;
    fs.writeFileSync(workspacePath, yaml.dump(policy), 'utf-8');
    writeRetiredRspackRscPatch(workspaceDir, relativePatchPath);
    fs.appendFileSync(patchPath, '\n# consumer-owned change\n', 'utf-8');

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      1,
    );

    const preservedPolicy = yaml.load(
      fs.readFileSync(workspacePath, 'utf-8'),
    ) as Record<string, any>;
    assert.equal(
      preservedPolicy.patchedDependencies[selector],
      relativePatchPath,
    );
    assert.equal(exists(workspaceDir, relativePatchPath), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

for (const [pathDescription, consumerPatchPath] of [
  [
    'through the canonical path',
    'patches/@react-server-dom-rspack@0.0.3.patch',
  ],
  [
    'through a dot-relative path',
    './patches/@react-server-dom-rspack@0.0.3.patch',
  ],
  [
    'through Windows separators',
    'patches\\@react-server-dom-rspack@0.0.3.patch',
  ],
] as const) {
  test(`migrate rejects a retired Rspack RSC patch still referenced by a consumer selector ${pathDescription}`, async () => {
    const { tempRoot, workspaceDir } = scaffoldWorkspace(
      'tooling-shared-retired-rspack-rsc-patch',
    );
    const workspacePath = path.join(workspaceDir, 'pnpm-workspace.yaml');
    const patchFile = '@react-server-dom-rspack@0.0.3.patch';
    const relativePatchPath = `patches/${patchFile}`;
    const frameworkSelector = 'react-server-dom-rspack@0.0.3';
    const consumerSelector = 'consumer-package@1.0.0';
    const patchPath = path.join(workspaceDir, relativePatchPath);

    try {
      const policy = yaml.load(
        fs.readFileSync(workspacePath, 'utf-8'),
      ) as Record<string, any>;
      policy.patchedDependencies[frameworkSelector] = relativePatchPath;
      policy.patchedDependencies[consumerSelector] = consumerPatchPath;
      fs.writeFileSync(workspacePath, yaml.dump(policy), 'utf-8');
      writeRetiredRspackRscPatch(workspaceDir, relativePatchPath);
      const originalWorkspace = fs.readFileSync(workspacePath);
      const originalPatch = fs.readFileSync(patchPath);

      assert.equal(
        await runUltramodernToolingCli(
          ['migrate-strict-effect', '--skip-install'],
          workspaceDir,
        ),
        1,
      );

      assert.deepEqual(fs.readFileSync(workspacePath), originalWorkspace);
      assert.deepEqual(fs.readFileSync(patchPath), originalPatch);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
}

test('migrate rejects patched dependency paths that escape the workspace', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-escaping-patch-path',
  );
  const workspacePath = path.join(workspaceDir, 'pnpm-workspace.yaml');
  const patchFile = '@react-server-dom-rspack@0.0.3.patch';
  const relativePatchPath = `patches/${patchFile}`;
  const patchPath = path.join(workspaceDir, relativePatchPath);

  try {
    const policy = yaml.load(fs.readFileSync(workspacePath, 'utf-8')) as Record<
      string,
      any
    >;
    policy.patchedDependencies['react-server-dom-rspack@0.0.3'] =
      relativePatchPath;
    policy.patchedDependencies['consumer-package@1.0.0'] =
      '../outside-workspace.patch';
    fs.writeFileSync(workspacePath, yaml.dump(policy), 'utf-8');
    writeRetiredRspackRscPatch(workspaceDir, relativePatchPath);
    const originalWorkspace = fs.readFileSync(workspacePath);
    const originalPatch = fs.readFileSync(patchPath);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      1,
    );
    assert.deepEqual(fs.readFileSync(workspacePath), originalWorkspace);
    assert.deepEqual(fs.readFileSync(patchPath), originalPatch);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate preserves a retired patch reached through a consumer symlink', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-symlinked-patch-path',
  );
  const workspacePath = path.join(workspaceDir, 'pnpm-workspace.yaml');
  const patchFile = '@react-server-dom-rspack@0.0.3.patch';
  const relativePatchPath = `patches/${patchFile}`;
  const patchPath = path.join(workspaceDir, relativePatchPath);
  const linkedPatchesPath = path.join(workspaceDir, 'consumer-patches');

  try {
    const policy = yaml.load(fs.readFileSync(workspacePath, 'utf-8')) as Record<
      string,
      any
    >;
    policy.patchedDependencies['react-server-dom-rspack@0.0.3'] =
      relativePatchPath;
    policy.patchedDependencies['consumer-package@1.0.0'] =
      `consumer-patches/${patchFile}`;
    fs.writeFileSync(workspacePath, yaml.dump(policy), 'utf-8');
    writeRetiredRspackRscPatch(workspaceDir, relativePatchPath);
    fs.symlinkSync(
      path.join(workspaceDir, 'patches'),
      linkedPatchesPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const originalWorkspace = fs.readFileSync(workspacePath);
    const originalPatch = fs.readFileSync(patchPath);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      1,
    );
    assert.deepEqual(fs.readFileSync(workspacePath), originalWorkspace);
    assert.deepEqual(fs.readFileSync(patchPath), originalPatch);
    assert.equal(
      fs.realpathSync(linkedPatchesPath),
      fs.realpathSync(path.dirname(patchPath)),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate keeps version fields consistent across the compact config', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-version-sync');

  try {
    const before = readJson(workspaceDir, '.modernjs/ultramodern.json');
    assert.equal(before.generator.version, '3.2.1');
    before.workspace.node.version = '26.3.0';
    before.workspace.node.engineRange = '>=24';
    before.workspace.packageManager.version = '11.9.0';
    writeJson(workspaceDir, '.modernjs/ultramodern.json', before);

    const rootPackageBefore = readJson(workspaceDir, 'package.json');
    rootPackageBefore.packageManager = 'pnpm@11.9.0';
    rootPackageBefore.engines = {
      node: '>=24',
      pnpm: '>=10',
    };
    writeJson(workspaceDir, 'package.json', rootPackageBefore);

    fs.writeFileSync(
      path.join(workspaceDir, '.mise.toml'),
      '[tools]\nnode = "26.3.0"\npnpm = "11.9.0"\n',
      'utf-8',
    );
    const workflow = readYaml(
      workspaceDir,
      '.github/workflows/ultramodern-workspace-gates.yml',
    );
    assert.ok(replaceValuesForKey(workflow, 'node-version', '26.3.0') > 0);
    writeYaml(
      workspaceDir,
      '.github/workflows/ultramodern-workspace-gates.yml',
      workflow,
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const after = readJson(workspaceDir, '.modernjs/ultramodern.json');
    assert.equal(after.packageSource.modernPackageVersion, 'workspace:*');
    assert.equal(
      after.generator.version,
      'workspace:*',
      'generator.version must track the migrated package source',
    );
    assert.equal(after.workspace.node.version, NODE_VERSION);
    assert.equal(after.workspace.node.engineRange, '>=26');
    assert.equal(after.workspace.packageManager.name, 'pnpm');
    assert.equal(after.workspace.packageManager.version, PNPM_VERSION);

    const rootPackageAfter = readJson(workspaceDir, 'package.json');
    assert.equal(rootPackageAfter.packageManager, `pnpm@${PNPM_VERSION}`);
    assert.equal(rootPackageAfter.engines.node, '>=26');
    assert.equal(rootPackageAfter.engines.pnpm, '>=11');
    assert.deepEqual(
      valuesForKey(
        readYaml(
          workspaceDir,
          '.github/workflows/ultramodern-workspace-gates.yml',
        ),
        'node-version',
      ),
      [NODE_VERSION],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('fresh shell-only workspace omits backend-federation and Zerops runtime surfaces', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-shell-only-fresh',
  );

  try {
    const check = runRecordedPackageScript(
      tempRoot,
      workspaceDir,
      '.',
      'check',
    );
    assert.equal(check.result.status, 0, check.result.stderr);
    const invokedScripts = recordedPnpmScripts(check.records);
    assert.equal(invokedScripts.includes('node:proof'), false);
    assert.equal(
      invokedScripts.includes('node:backend-federation:generate'),
      false,
    );
    for (const scriptName of [
      'node:proof',
      'node:backend-federation:generate',
      'zerops:materialize',
      'cloudflare:ssr-proof',
    ]) {
      assert.notEqual(
        runRecordedPackageScript(tempRoot, workspaceDir, '.', scriptName).result
          .status,
        0,
      );
    }
    assert.equal(
      exists(workspaceDir, 'scripts/generate-node-backend-federation.mts'),
      false,
    );
    assert.equal(
      exists(workspaceDir, 'scripts/proof-node-backend-federation.mts'),
      false,
    );
    assert.equal(
      exists(workspaceDir, 'scripts/materialize-zerops-runtime.mjs'),
      false,
    );
    assert.equal(exists(workspaceDir, 'scripts/proof-workerd-ssr.mts'), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate does not inject backend-federation gates into a shell-only workspace', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-shell-only');

  try {
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const check = runRecordedPackageScript(
      tempRoot,
      workspaceDir,
      '.',
      'check',
    );
    assert.equal(check.result.status, 0, check.result.stderr);
    const invokedScripts = recordedPnpmScripts(check.records);
    assert.equal(invokedScripts.includes('node:proof'), false);
    assert.equal(
      invokedScripts.includes('node:backend-federation:generate'),
      false,
    );
    assert.equal(invokedScripts.at(-1), 'performance:readiness');
    for (const scriptName of [
      'node:proof',
      'node:backend-federation:generate',
      'zerops:materialize',
      'cloudflare:ssr-proof',
    ]) {
      assert.notEqual(
        runRecordedPackageScript(tempRoot, workspaceDir, '.', scriptName).result
          .status,
        0,
      );
    }
    assert.equal(
      exists(workspaceDir, 'scripts/generate-node-backend-federation.mts'),
      false,
    );
    assert.equal(
      exists(workspaceDir, 'scripts/proof-node-backend-federation.mts'),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate reconciles backend federation config files with API metadata', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-api-cleanup');

  try {
    for (const name of ['catalog', 'checkout']) {
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        name,
        modernVersion: '3.2.1',
      });
    }

    const compactConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    const catalog = compactConfig.topology.apps.find(
      (app: Record<string, unknown>) => app.id === 'catalog',
    );
    delete catalog.api;
    writeJson(workspaceDir, '.modernjs/ultramodern.json', compactConfig);

    const referenceTopology = readJson(
      workspaceDir,
      'topology/reference-topology.json',
    );
    const referenceCatalog = referenceTopology.verticals.find(
      (vertical: Record<string, unknown>) => vertical.id === 'catalog',
    );
    delete referenceCatalog.api;
    writeJson(
      workspaceDir,
      'topology/reference-topology.json',
      referenceTopology,
    );

    for (const app of ['catalog', 'checkout']) {
      fs.writeFileSync(
        path.join(
          workspaceDir,
          'verticals',
          app,
          'backend-federation.config.ts',
        ),
        'stale\n',
      );
    }

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    assert.equal(
      exists(workspaceDir, 'verticals/catalog/backend-federation.config.ts'),
      false,
    );

    const checkout = workspaceAppsFromToolingConfig(
      readUltramodernConfig(workspaceDir),
    ).find(app => app.id === 'checkout');
    assert.ok(checkout);
    assert.ok(checkout.api);
    assert.equal(
      exists(workspaceDir, 'verticals/checkout/backend-federation.config.ts'),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate converges legacy backend federation entries across config and development overlay', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-backend-entry-convergence',
  );

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'explore',
      modernVersion: '3.2.1',
    });

    const developmentOverlay = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    const canonicalEntry =
      developmentOverlay.serverExecution.explore.node.containerEntry;
    const legacyEntry = canonicalEntry.replace(
      'backendRemoteEntry.cjs',
      'backendRemoteEntry.mjs',
    );
    developmentOverlay.serverExecution.explore.node.containerEntry =
      legacyEntry;
    developmentOverlay.consumerExtension = {
      retained: true,
    };
    writeJson(
      workspaceDir,
      'topology/local-overlays/development.json',
      developmentOverlay,
    );

    const backendConfigPath = 'verticals/explore/backend-federation.config.ts';
    fs.writeFileSync(
      path.join(workspaceDir, backendConfigPath),
      fs
        .readFileSync(path.join(workspaceDir, backendConfigPath), 'utf-8')
        .replace('backendRemoteEntry.cjs', 'backendRemoteEntry.mjs'),
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const migratedOverlay = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    assert.equal(
      migratedOverlay.serverExecution.explore.node.containerEntry,
      canonicalEntry,
    );
    assert.deepEqual(migratedOverlay.consumerExtension, {
      retained: true,
    });
    assert.equal(exists(workspaceDir, backendConfigPath), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate materializes every validator-required wrapper and rewires legacy scripts', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-legacy-scripts',
  );

  try {
    const legacyRenames = [
      'bootstrap-agent-skills',
      'setup-agent-reference-repos',
      'check-ultramodern-i18n-boundaries',
    ];
    for (const name of legacyRenames) {
      fs.renameSync(
        path.join(workspaceDir, `scripts/${name}.mts`),
        path.join(workspaceDir, `scripts/${name}.mjs`),
      );
    }
    const before = readJson(workspaceDir, 'package.json');
    before.scripts['skills:install'] =
      'node ./scripts/bootstrap-agent-skills.mjs';
    before.scripts['skills:check'] =
      'node ./scripts/bootstrap-agent-skills.mjs --check';
    before.scripts.postinstall =
      "oxfmt . '!repos/**' && node ./scripts/bootstrap-agent-skills.mjs --postinstall";
    before.scripts['agents:refs:install'] =
      'node ./scripts/setup-agent-reference-repos.mjs';
    before.scripts['i18n:boundaries'] =
      'node ./scripts/check-ultramodern-i18n-boundaries.mjs';
    writeJson(workspaceDir, 'package.json', before);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    for (const name of legacyRenames) {
      assert.equal(exists(workspaceDir, `scripts/${name}.mts`), true, name);
      assert.equal(exists(workspaceDir, `scripts/${name}.mjs`), false, name);
    }
    const expectations = [
      ['skills:install', 'bootstrap-agent-skills.mts', []],
      ['skills:check', 'bootstrap-agent-skills.mts', ['--check']],
      ['postinstall', 'bootstrap-agent-skills.mts', ['--postinstall']],
      ['agents:refs:install', 'setup-agent-reference-repos.mts', []],
      ['i18n:boundaries', 'check-ultramodern-i18n-boundaries.mts', []],
    ] as const;
    for (const [scriptName, target, expectedArgs] of expectations) {
      const execution = runRecordedPackageScript(
        tempRoot,
        workspaceDir,
        '.',
        scriptName,
      );
      assert.equal(execution.result.status, 0, execution.result.stderr);
      const nodeRecord = execution.records.find(
        record => record.command === 'node',
      );
      assertRecordedNodeTarget(nodeRecord, target);
      assert.deepEqual(nodeRecord?.args.slice(1), expectedArgs);
      if (scriptName === 'postinstall') {
        assert.deepEqual(
          execution.records.map(record => record.command),
          ['node', 'oxfmt'],
        );
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('backend federation proof skips runtime loading when no backend apps exist', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-proof-empty');

  try {
    assert.equal(
      await runUltramodernToolingCli(
        ['backend-federation-proof'],
        workspaceDir,
      ),
      0,
    );

    const report = readJson(
      workspaceDir,
      '.codex/reports/node-backend-federation-proof/proof.json',
    );
    assert.equal(report.status, 'skipped');
    assert.deepEqual(report.results, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('backend federation generator reads migrated app-level metadata', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-backend-mf');

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const compactConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    const catalog = compactConfig.topology.apps.find(
      (app: Record<string, unknown>) => app.id === 'catalog',
    ) as Record<string, any>;
    assert.equal(catalog.api.backendFederation, undefined);
    assert.equal(catalog.backendFederation.runtimeFramework, 'effect');
    writeStandaloneEffectApi(workspaceDir);

    assert.equal(
      await runUltramodernToolingCli(
        ['backend-federation-generate', '--app', 'catalog'],
        workspaceDir,
      ),
      0,
    );

    const manifest = readJson(
      workspaceDir,
      'verticals/catalog/dist/backend-mf-manifest.json',
    );
    assert.equal(manifest.version, '0.1.0');
    assert.match(manifest.buildVersion, /^[a-f0-9]{16}$/u);
    assert.equal(
      manifest.metaData.buildInfo.buildName,
      '@tooling-backend-mf/catalog',
    );
    assert.equal(
      manifest.metaData.buildInfo.buildVersion,
      manifest.buildVersion,
    );
    assert.equal(manifest.backendFederation.runtimeFramework, 'effect');
    assert.equal(
      manifest.backendFederation.contractVersion,
      'microvertical-server-effect-v1',
    );
    assert.equal(
      manifest.backendFederation.nodeAdapterVersion,
      'backend-mf-effect-v1',
    );
    assert.equal(manifest.backendFederation.expose, './effect-api');
    assert.deepEqual(
      manifest.exposes.map((expose: { name: string }) => expose.name),
      ['./effect-api'],
    );
    assert.equal(
      manifest.backendFederation.versionBoundary.packageName,
      '@tooling-backend-mf/catalog',
    );
    assert.equal(manifest.backendFederation.versionBoundary.version, '0.1.0');
    assert.equal(
      manifest.backendFederation.versionBoundary.buildVersion,
      manifest.buildVersion,
    );
    if (manifest.backendFederation.deliveryUnit) {
      assert.equal(
        manifest.backendFederation.deliveryUnit.kind,
        'microvertical-delivery-unit',
      );
      assert.equal(
        manifest.backendFederation.deliveryUnit.buildMarker,
        manifest.buildVersion,
      );
      assert.equal(
        manifest.backendFederation.versionBoundary.deliveryUnit.unitId,
        manifest.backendFederation.deliveryUnit.unitId,
      );
      assert.equal(
        manifest.backendFederation.versionBoundary.deliveryUnit.buildMarker,
        manifest.buildVersion,
      );
    }
    assert.equal(
      fs.existsSync(
        path.join(
          workspaceDir,
          'verticals/catalog/dist/backendRemoteEntry.cjs',
        ),
      ),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('backend federation proof rejects drifted delivery-unit stamps in the manifest', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-backend-mf-drift',
  );

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    writeStandaloneEffectApi(workspaceDir);

    assert.equal(
      await runUltramodernToolingCli(
        ['backend-federation-generate', '--app', 'catalog'],
        workspaceDir,
      ),
      0,
    );

    const manifestPath = path.join(
      workspaceDir,
      'verticals/catalog/dist/backend-mf-manifest.json',
    );
    const manifest = readJson(
      workspaceDir,
      'verticals/catalog/dist/backend-mf-manifest.json',
    );

    if (!manifest.backendFederation?.deliveryUnit) {
      // No delivery-unit stamp was generated for this workspace shape;
      // there is nothing to drift, so the negative case does not apply.
      return;
    }

    manifest.backendFederation.deliveryUnit.buildMarker = 'deadbeefdeadbeef';
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf-8',
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['backend-federation-proof'],
        workspaceDir,
      ),
      1,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern tooling config reads compact config and rejects retired metadata', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-config');

  try {
    const compact = readUltramodernConfig(workspaceDir);
    assert.equal(compact.source, 'compact');
    assert.equal(compact.workspace.packageScope, 'tooling-config');
    assert.equal(compact.packageSource?.strategy, 'workspace');
    assert.equal(compact.packageSource?.modernPackageVersion, 'workspace:*');
    assert.deepEqual(
      compact.topology.apps.map(app => app.id),
      ['shell-super-app'],
    );
    assert.equal(compact.topology.apps[0].moduleFederation?.role, 'host');
    assert.equal(
      fs.existsSync(path.join(workspaceDir, retiredContractPath)),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, retiredPackageSourcePath)),
      false,
    );

    const retiredMetadataWorkspaceDir = path.join(
      tempRoot,
      'retired-metadata-tooling-config',
    );
    fs.mkdirSync(path.join(retiredMetadataWorkspaceDir, '.modernjs'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(retiredMetadataWorkspaceDir, retiredPackageSourcePath),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          strategy: 'install',
          modernPackages: {
            specifier: '3.2.0-ultramodern.108',
            registry: 'https://registry.npmjs.org/',
            aliases: {
              '@modern-js/app-tools': '@bleedingdev/modern-js-app-tools',
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      path.join(retiredMetadataWorkspaceDir, retiredContractPath),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profile: 'cloudflare-ssr-mf-effect-v1',
          apps: [
            {
              id: 'shell-super-app',
              kind: 'shell',
              path: 'apps/shell-super-app',
              package: '@legacy-tooling-config/shell-super-app',
              styling: { tailwind: true },
              moduleFederation: {
                name: 'shellSuperApp',
                verticalRefs: [],
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    assert.throws(
      () => readUltramodernConfig(retiredMetadataWorkspaceDir),
      /Legacy UltraModern metadata detected/u,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate-strict-effect updates package cohort and direct API metadata', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-migrate');

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    const freshShellCloudflareBuild = runRecordedPackageScript(
      tempRoot,
      workspaceDir,
      'apps/shell-super-app',
      'cloudflare:build',
    );
    const freshCatalogCloudflareBuild = runRecordedPackageScript(
      tempRoot,
      workspaceDir,
      'verticals/catalog',
      'cloudflare:build',
    );
    assert.equal(
      freshShellCloudflareBuild.result.status,
      0,
      freshShellCloudflareBuild.result.stderr,
    );
    assert.equal(
      freshCatalogCloudflareBuild.result.status,
      0,
      freshCatalogCloudflareBuild.result.stderr,
    );

    const catalogEnglishLocale = readJson(
      workspaceDir,
      'verticals/catalog/locales/en/catalog.json',
    );
    catalogEnglishLocale.catalog.migrationPreserved = 'Preserved catalog copy';
    writeJson(
      workspaceDir,
      'verticals/catalog/locales/en/catalog.json',
      catalogEnglishLocale,
    );
    fs.writeFileSync(
      path.join(workspaceDir, 'apps/shell-super-app/src/modern.runtime.ts'),
      `import catalogResource from '../../../verticals/catalog/locales/en/catalog.json';

export default catalogResource;
`,
      'utf-8',
    );
    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    topology.description = 'Stale generated workspace description.';
    topology.sharedPackages[0].description =
      'Stale generated shared package description.';
    topology.shell.moduleFederation.remotes[0].alias = 'catalog';
    topology.shell.moduleFederation.remotes[0].manifestEnv =
      'VERTICAL_CATALOG_MF_MANIFEST';
    const catalog = topology.verticals.find(
      (vertical: Record<string, unknown>) => vertical.id === 'catalog',
    );
    catalog.deliveryUnit.buildMarker = 'stale-reference-marker';
    catalog.backendFederation.deliveryUnit.buildMarker =
      'stale-reference-marker';
    catalog.api = {
      ...catalog.api,
      effect: {
        stem: 'catalog',
        prefix: '/catalog-api',
        consumedBy: ['shell-super-app', 'catalog'],
      },
      bff: {
        prefix: '/catalog-api',
        strictEffectApproach: false,
      },
      contract: {
        export: './shared/effect/api',
        path: 'verticals/catalog/shared/effect/api.ts',
      },
      client: {
        export: './effect/client',
        path: 'verticals/catalog/src/effect/catalog-client.ts',
      },
      serverEntry: 'verticals/catalog/api/effect/index.ts',
    };
    delete catalog.api.runtime;
    catalog.api.backendFederation = {
      entry: 'verticals/catalog/api/backend-federation.ts',
    };
    catalog.backendFederation.entry =
      'verticals/catalog/api/backend-federation.ts';
    writeJson(workspaceDir, 'topology/reference-topology.json', topology);

    const compactConfigBefore = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const compactCatalog = compactConfigBefore.topology.apps.find(
      (app: Record<string, unknown>) => app.id === 'catalog',
    );
    compactCatalog.deliveryUnit.buildMarker = 'stale-compact-marker';
    compactCatalog.backendFederation.deliveryUnit.buildMarker =
      'stale-compact-marker';
    delete compactConfigBefore.tooling.wrappers.backendFederationProof;
    delete compactConfigBefore.backendFederation.apps[0].deliveryUnit;
    delete compactCatalog.api.runtime;
    compactCatalog.api.backendFederation = {
      entry: 'verticals/catalog/api/backend-federation.ts',
    };
    compactCatalog.backendFederation.entry =
      'verticals/catalog/api/backend-federation.ts';
    writeJson(workspaceDir, '.modernjs/ultramodern.json', compactConfigBefore);

    const ownershipBefore = readJson(workspaceDir, 'topology/ownership.json');
    const catalogOwner = ownershipBefore.owners.find(
      (owner: Record<string, unknown>) => owner.id === 'catalog',
    );
    catalogOwner.ownership.team = 'catalog-domain-team';
    catalogOwner.ownership.pagerDuty = 'pd-catalog-domain';
    writeJson(workspaceDir, 'topology/ownership.json', ownershipBefore);

    const rootPackageBefore = readJson(workspaceDir, 'package.json');
    delete rootPackageBefore.devDependencies['@typescript/native'];
    rootPackageBefore.devDependencies.typescript = '6.0.0';
    rootPackageBefore.devDependencies['drizzle-orm'] = DRIZZLE_ORM_VERSION;
    rootPackageBefore.devDependencies.oxfmt = '0.55.0';
    rootPackageBefore.scripts['cloudflare:build'] =
      `${rootPackageBefore.scripts['cloudflare:build']} && pnpm cloudflare-output:verify`;
    rootPackageBefore.scripts['node:proof'] =
      'node ./scripts/proof-node-backend-federation.mts';
    rootPackageBefore.scripts['cloudflare-output:verify'] =
      'node ./scripts/verify-cloudflare-output.mts';
    rootPackageBefore.scripts['node:backend-federation:generate'] =
      'node ./scripts/generate-node-backend-federation.mts';
    writeJson(workspaceDir, 'package.json', rootPackageBefore);

    for (const relativePath of [
      'scripts/generate-node-backend-federation.mts',
      'scripts/proof-node-backend-federation.mts',
      'scripts/verify-cloudflare-output.mts',
      'apps/shell-super-app/src/ultramodern-build.ts',
      'apps/shell-super-app/shared/ultramodern-build.json',
      'apps/shell-super-app/shared/ultramodern-build.ts',
      'verticals/catalog/api/backend-federation.ts',
      'verticals/catalog/src/ultramodern-build.ts',
      'verticals/catalog/shared/ultramodern-build.json',
      'verticals/catalog/shared/ultramodern-build.ts',
    ]) {
      fs.writeFileSync(path.join(workspaceDir, relativePath), 'stale\n');
    }
    fs.rmSync(
      path.join(workspaceDir, 'scripts/proof-node-backend-federation.mjs'),
      { force: true },
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        'verticals/catalog/src/routes/[lang]/_mf/fragment/widget/page.tsx',
      ),
      { force: true },
    );

    for (const packageFile of [
      'apps/shell-super-app/package.json',
      'verticals/catalog/package.json',
    ]) {
      const appId = packageFile.includes('shell-super-app')
        ? 'shell-super-app'
        : 'catalog';
      const packageJson = readJson(workspaceDir, packageFile);
      if (appId === 'catalog') {
        packageJson.scripts.build = packageJson.scripts.build.replace(
          'modern build',
          'modern build && node ../../scripts/generate-node-backend-federation.mts --app catalog',
        );
        packageJson.scripts['cloudflare:build'] = packageJson.scripts[
          'cloudflare:build'
        ].replace(
          'MODERNJS_DEPLOY=cloudflare modern build',
          'MODERNJS_DEPLOY=cloudflare modern build && node ../../scripts/generate-node-backend-federation.mts --app catalog --target dist-cloudflare',
        );
      }
      packageJson.scripts['cloudflare:build'] = packageJson.scripts[
        'cloudflare:build'
      ].replace(
        'MODERNJS_DEPLOY=cloudflare modern deploy --skip-build',
        'MODERNJS_DEPLOY=cloudflare modern deploy',
      );
      packageJson.scripts['cloudflare:build'] =
        `${packageJson.scripts['cloudflare:build']} && node ../../scripts/verify-cloudflare-output.mts --app ${appId}`;
      packageJson.scripts['cloudflare:deploy'] =
        `${packageJson.scripts['cloudflare:deploy']} --skip-build`;
      writeJson(workspaceDir, packageFile, packageJson);
    }

    const pnpmWorkspaceFile = path.join(workspaceDir, 'pnpm-workspace.yaml');
    const pnpmPolicy = yaml.load(
      fs.readFileSync(pnpmWorkspaceFile, 'utf-8'),
    ) as Record<string, any>;
    pnpmPolicy.peerDependencyRules.allowedVersions['@effect/vitest>effect'] =
      '4.0.0-beta.89';
    pnpmPolicy.overrides['@effect/vitest'] = '4.0.0-beta.89';
    pnpmPolicy.overrides.effect = '4.0.0-beta.89';
    delete pnpmPolicy.overrides['@effect/opentelemetry'];
    delete pnpmPolicy.patchedDependencies[`effect@${EFFECT_VERSION}`];
    pnpmPolicy.patchedDependencies['effect@4.0.0-beta.102'] =
      'patches/effect-schema-error-type-id.patch';
    delete pnpmPolicy.patchedDependencies[
      `@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}`
    ];
    delete pnpmPolicy.patchedDependencies[`drizzle-orm@${DRIZZLE_ORM_VERSION}`];
    pnpmPolicy.minimumReleaseAgeExclude = [
      ...pnpmPolicy.minimumReleaseAgeExclude,
      '@bleedingdev/modern-js-*',
      '@module-federation/*',
      '@typescript/typescript6@6.0.2',
      'i18next@26.3.1',
    ];
    pnpmPolicy.trustPolicyExclude = [
      'effect@4.0.0-beta.102',
      '@effect/opentelemetry@4.0.0-beta.102',
    ];
    fs.writeFileSync(
      pnpmWorkspaceFile,
      yaml.dump(pnpmPolicy, {
        lineWidth: -1,
        noCompatMode: true,
        noRefs: true,
        quotingType: "'",
      }),
      'utf-8',
    );
    fs.rmSync(
      path.join(workspaceDir, 'patches/effect-schema-error-type-id.patch'),
      {
        force: true,
      },
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
      ),
      {
        force: true,
      },
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        'patches/drizzle-orm-ts7-strict-declarations.patch',
      ),
      {
        force: true,
      },
    );

    const baseTsConfig = readJson(workspaceDir, 'tsconfig.base.json');
    baseTsConfig.compilerOptions.skipLibCheck = true;
    writeJson(workspaceDir, 'tsconfig.base.json', baseTsConfig);

    const gitignorePath = path.join(workspaceDir, '.gitignore');
    fs.writeFileSync(gitignorePath, 'consumer-cache/\n', 'utf-8');

    for (const sharedPackageDir of [
      'packages/shared-contracts',
      'packages/shared-design-tokens',
    ]) {
      writeJson(workspaceDir, `${sharedPackageDir}/tsconfig.json`, {
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          composite: true,
          incremental: true,
          tsBuildInfoFile: `../../node_modules/.cache/tsgo/${sharedPackageDir.replace(/[^a-zA-Z0-9._-]+/gu, '__')}.tsbuildinfo`,
        },
        include: ['src'],
      });
    }

    for (const appDir of ['apps/shell-super-app', 'verticals/catalog']) {
      const appTsConfig = readJson(workspaceDir, `${appDir}/tsconfig.json`);
      appTsConfig.include = [
        ...appTsConfig.include,
        'modern.config.ts',
        'module-federation.config.ts',
      ];
      writeJson(workspaceDir, `${appDir}/tsconfig.json`, appTsConfig);

      const mfTypesTsConfig = readJson(
        workspaceDir,
        `${appDir}/tsconfig.mf-types.json`,
      );
      mfTypesTsConfig.extends = './tsconfig.json';
      writeJson(
        workspaceDir,
        `${appDir}/tsconfig.mf-types.json`,
        mfTypesTsConfig,
      );

      fs.writeFileSync(
        path.join(workspaceDir, appDir, 'src/modern-app-env.d.ts'),
        `/// <reference types='@modern-js/app-tools/types' />

declare global {
  const ULTRAMODERN_SITE_URL: string;
}

declare module '*.svg' {}

declare module '*.css' {}
`,
        'utf-8',
      );
    }

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const compactConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    assert.equal(
      compactConfig.packageSource.modernPackageVersion,
      'workspace:*',
    );
    assert.equal(compactConfig.packageSource.aliasScope, undefined);
    assert.equal(compactConfig.packageSource.aliasPackageNamePrefix, undefined);
    const migratedIdentityCatalog = compactConfig.topology.apps.find(
      (app: Record<string, unknown>) => app.id === 'catalog',
    );
    const migratedIdentityTopology = readJson(
      workspaceDir,
      'topology/reference-topology.json',
    );
    const migratedTopologyIdentityCatalog =
      migratedIdentityTopology.verticals.find(
        (app: Record<string, unknown>) => app.id === 'catalog',
      );
    assert.equal(
      migratedIdentityTopology.description,
      'Generated UltraModern SuperApp shell that can grow by adding full-stack verticals.',
    );
    assert.equal(
      migratedIdentityTopology.sharedPackages[0].description,
      'Generated route, ownership, and topology contracts.',
    );
    assert.equal(
      migratedIdentityTopology.shell.moduleFederation.remotes[0].alias,
      undefined,
    );
    assert.equal(
      migratedIdentityTopology.shell.moduleFederation.remotes[0].manifestEnv,
      undefined,
    );
    const migratedOwnership = readJson(workspaceDir, 'topology/ownership.json');
    const migratedCatalogOwner = migratedOwnership.owners.find(
      (owner: Record<string, unknown>) => owner.id === 'catalog',
    );
    assert.equal(migratedCatalogOwner.ownership.team, 'catalog-domain-team');
    assert.equal(migratedCatalogOwner.ownership.pagerDuty, 'pd-catalog-domain');
    const migratedShellLocale = readJson(
      workspaceDir,
      'apps/shell-super-app/locales/en/shell.json',
    );
    assert.equal(
      migratedShellLocale.catalog.migrationPreserved,
      'Preserved catalog copy',
    );
    const migratedBuildArtifact = readJson(
      workspaceDir,
      'verticals/catalog/shared/ultramodern-build.json',
    );
    assert.equal(
      migratedIdentityCatalog.deliveryUnit.buildMarker,
      migratedBuildArtifact.deliveryUnit.buildMarker,
    );
    assert.equal(
      migratedTopologyIdentityCatalog.deliveryUnit.buildMarker,
      migratedBuildArtifact.deliveryUnit.buildMarker,
    );
    assert.equal(
      compactConfig.tooling.wrappers.backendFederationProof,
      'scripts/proof-node-backend-federation.mts',
    );
    assert.equal(
      compactConfig.backendFederation.apps[0].deliveryUnit.buildMarker,
      migratedBuildArtifact.deliveryUnit.buildMarker,
    );

    const rootPackage = readJson(workspaceDir, 'package.json');
    assert.equal(
      rootPackage.devDependencies['@modern-js/create'],
      'workspace:*',
    );
    assert.equal(rootPackage.devDependencies.typescript, TYPESCRIPT_VERSION);
    assert.equal(
      rootPackage.devDependencies['@typescript/native'],
      `npm:typescript@${TYPESCRIPT_VERSION}`,
    );
    assert.equal(rootPackage.devDependencies.oxfmt, OXFMT_VERSION);
    assert.equal(rootPackage.modernjs.packageSource.strategy, 'workspace');
    const rootCloudflareBuild = runRecordedPackageScript(
      tempRoot,
      workspaceDir,
      '.',
      'cloudflare:build',
    );
    assert.equal(
      rootCloudflareBuild.result.status,
      0,
      rootCloudflareBuild.result.stderr,
    );
    const rootCloudflareScripts = recordedPnpmScripts(
      rootCloudflareBuild.records,
    );
    assert.notEqual(
      rootCloudflareScripts.indexOf('cloudflare-output:verify'),
      -1,
    );
    assert.equal(rootCloudflareScripts.at(-1), 'cloudflare:ssr-proof');
    assert.equal(
      rootCloudflareBuild.records.every(
        record => record.env.ULTRAMODERN_ZEPHYR === undefined,
      ),
      true,
    );

    for (const [scriptName, expectedTarget] of [
      ['node:proof', 'proof-node-backend-federation.mts'],
      ['cloudflare-output:verify', 'verify-cloudflare-output.mts'],
      [
        'node:backend-federation:generate',
        'generate-node-backend-federation.mts',
      ],
      ['zerops:materialize', 'materialize-zerops-runtime.mjs'],
      ['cloudflare:ssr-proof', 'proof-workerd-ssr.mts'],
    ] as const) {
      const execution = runRecordedPackageScript(
        tempRoot,
        workspaceDir,
        '.',
        scriptName,
      );
      assert.equal(execution.result.status, 0, execution.result.stderr);
      assertRecordedNodeTarget(
        execution.records.find(record => record.command === 'node'),
        expectedTarget,
      );
    }

    const failedCloudflareBuild = runRecordedPackageScript(
      tempRoot,
      workspaceDir,
      '.',
      'cloudflare:build',
      { failCode: 29, failInvocation: 'pnpm:cloudflare-output:verify' },
    );
    assert.equal(failedCloudflareBuild.result.status, 29);
    assert.equal(
      recordedPnpmScripts(failedCloudflareBuild.records).includes(
        'cloudflare:ssr-proof',
      ),
      false,
    );
    for (const relativePath of [
      'scripts/generate-node-backend-federation.mts',
      'scripts/proof-node-backend-federation.mts',
      'scripts/verify-cloudflare-output.mts',
      'scripts/materialize-zerops-runtime.mjs',
      'scripts/proof-workerd-ssr.mts',
      'verticals/catalog/api/backend-federation.ts',
      'verticals/catalog/src/routes/[lang]/_mf/fragment/widget/page.tsx',
    ]) {
      assert.equal(fs.existsSync(path.join(workspaceDir, relativePath)), true);
    }
    assert.equal(
      exists(workspaceDir, 'scripts/proof-node-backend-federation.mjs'),
      false,
    );
    assert.equal(
      readJson(
        workspaceDir,
        'apps/shell-super-app/shared/ultramodern-build.json',
      ).deliveryUnit.appId,
      'shell-super-app',
    );
    assert.equal(
      readJson(workspaceDir, 'verticals/catalog/shared/ultramodern-build.json')
        .deliveryUnit.packageName,
      '@tooling-migrate/catalog',
    );
    const migratedTopologyCatalog = readJson(
      workspaceDir,
      'topology/reference-topology.json',
    ).verticals.find(
      (vertical: Record<string, unknown>) => vertical.id === 'catalog',
    );
    assert.equal(migratedTopologyCatalog.backendFederation.entry, undefined);
    assert.equal(migratedTopologyCatalog.api.backendFederation, undefined);
    const migratedCompactCatalog = compactConfig.topology.apps.find(
      (app: Record<string, unknown>) => app.id === 'catalog',
    );
    assert.equal(migratedCompactCatalog.backendFederation.entry, undefined);
    assert.equal(migratedCompactCatalog.api.backendFederation, undefined);
    assert.equal(migratedCompactCatalog.api.runtime, 'effect');
    const migratedPnpmPolicy = readYaml(workspaceDir, 'pnpm-workspace.yaml');
    assert.equal(
      migratedPnpmPolicy.peerDependencyRules.allowedVersions[
        '@effect/vitest>effect'
      ],
      EFFECT_VERSION,
    );
    assert.equal(
      migratedPnpmPolicy.overrides['@effect/vitest'],
      EFFECT_VITEST_VERSION,
    );
    assert.equal(migratedPnpmPolicy.overrides.effect, EFFECT_VERSION);
    assert.equal(
      migratedPnpmPolicy.overrides['@effect/opentelemetry'],
      EFFECT_VERSION,
    );
    assert.equal(
      migratedPnpmPolicy.patchedDependencies[
        `@module-federation/modern-js-v3@${MODULE_FEDERATION_VERSION}`
      ],
      `patches/@module-federation__modern-js-v3@${MODULE_FEDERATION_VERSION}.patch`,
    );
    assert.equal(
      migratedPnpmPolicy.patchedDependencies[
        `@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}`
      ],
      `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
    );
    assert.equal(
      migratedPnpmPolicy.patchedDependencies[`effect@${EFFECT_VERSION}`],
      'patches/effect-schema-error-type-id.patch',
    );
    assert.equal(
      migratedPnpmPolicy.patchedDependencies['effect@4.0.0-beta.102'],
      undefined,
    );
    assert.equal(
      migratedPnpmPolicy.patchedDependencies[
        `drizzle-orm@${DRIZZLE_ORM_VERSION}`
      ],
      'patches/drizzle-orm-ts7-strict-declarations.patch',
    );
    assert.deepEqual(
      migratedPnpmPolicy.minimumReleaseAgeExclude,
      renderMinimumReleaseAgeExclude({
        packageSource: {
          strategy: 'workspace',
          modernPackageVersion: 'workspace:*',
        },
      }),
    );
    assert.equal(
      migratedPnpmPolicy.minimumReleaseAgeExclude.some((selector: string) =>
        selector.startsWith('@bleedingdev/modern-js-'),
      ),
      false,
    );
    assert.equal(
      migratedPnpmPolicy.minimumReleaseAgeExclude.some((selector: string) =>
        selector.includes('*'),
      ),
      false,
    );
    assert.deepEqual(
      migratedPnpmPolicy.trustPolicyExclude,
      ULTRAMODERN_WORKSPACE_POLICY.pnpm.trustPolicyExclude,
    );
    assert.ok(
      fs.existsSync(
        path.join(workspaceDir, 'patches/effect-schema-error-type-id.patch'),
      ),
      'migrate-strict-effect must restore the generated Effect declaration patch',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
        ),
      ),
      'migrate-strict-effect must restore the generated Module Federation React bridge patch',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          'patches/drizzle-orm-ts7-strict-declarations.patch',
        ),
      ),
      'migrate-strict-effect must restore the generated Drizzle declaration patch',
    );

    const migratedBaseTsConfig = readJson(workspaceDir, 'tsconfig.base.json');
    assert.equal(
      migratedBaseTsConfig.compilerOptions.skipLibCheck,
      undefined,
      'migrate-strict-effect must remove generated skipLibCheck',
    );
    assertGitIgnored(workspaceDir, [
      '.mf/diagnostics.json',
      'apps/shell-super-app/.mf/diagnostics.json',
      'dist-cloudflare/index.js',
      '.output/server/index.js',
      'verticals/catalog/.output/server/index.js',
      'consumer-cache/preserved.txt',
    ]);

    const shellTsConfig = readJson(
      workspaceDir,
      'apps/shell-super-app/tsconfig.json',
    );
    assert.deepEqual(shellTsConfig.include, [
      'src',
      'locales/**/*.json',
      'package.json',
      'shared',
      'server',
    ]);

    const catalogTsConfig = readJson(
      workspaceDir,
      'verticals/catalog/tsconfig.json',
    );
    assert.deepEqual(catalogTsConfig.include, [
      'src',
      'locales/**/*.json',
      'package.json',
      'shared',
      'server',
      'api',
    ]);

    for (const sharedPackageDir of [
      'packages/shared-contracts',
      'packages/shared-design-tokens',
    ]) {
      assert.deepEqual(
        readJson(workspaceDir, `${sharedPackageDir}/tsconfig.json`),
        createSharedPackageTsConfig(sharedPackageDir),
      );
    }

    for (const appDir of ['apps/shell-super-app', 'verticals/catalog']) {
      const mfTypesTsConfig = readJson(
        workspaceDir,
        `${appDir}/tsconfig.mf-types.json`,
      );
      assert.equal(mfTypesTsConfig.extends, '../../tsconfig.base.json');

      assert.equal(
        exists(workspaceDir, `${appDir}/src/modern-app-env.d.ts`),
        true,
      );
    }

    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    assert.equal(
      shellPackage.dependencies['@modern-js/plugin-bff'],
      'workspace:*',
    );
    // plugin-bff declares both as optional peers, so migration has to add them
    // to whoever depends on plugin-bff. Without them the workspace resolves no
    // Effect at all and pnpm rejects the generated `effect@<version>` patch
    // entry with ERR_PNPM_UNUSED_PATCH.
    assert.equal(shellPackage.dependencies.effect, EFFECT_VERSION);
    assert.equal(
      shellPackage.dependencies['@effect/opentelemetry'],
      EFFECT_VERSION,
    );
    const migratedShellCloudflareBuild = runRecordedPackageScript(
      tempRoot,
      workspaceDir,
      'apps/shell-super-app',
      'cloudflare:build',
    );
    assert.equal(
      migratedShellCloudflareBuild.result.status,
      0,
      migratedShellCloudflareBuild.result.stderr,
    );
    assert.deepEqual(
      normalizedCommandTrace(migratedShellCloudflareBuild.records),
      normalizedCommandTrace(freshShellCloudflareBuild.records),
    );
    const shellAssetGeneration = migratedShellCloudflareBuild.records.find(
      record =>
        record.command === 'node' &&
        path.basename(record.args[0] ?? '') ===
          'generate-public-surface-assets.mts',
    );
    assertRecordedNodeTarget(
      shellAssetGeneration,
      'generate-public-surface-assets.mts',
    );
    assert.deepEqual(shellAssetGeneration?.args.slice(1), [
      '--app',
      'shell-super-app',
      '--target',
      'cloudflare-dist',
    ]);
    const shellCloudflareDeploy = migratedShellCloudflareBuild.records.find(
      record =>
        record.command === 'modern' &&
        record.env.MODERNJS_DEPLOY === 'cloudflare' &&
        record.args[0] === 'deploy',
    );
    assert.deepEqual(shellCloudflareDeploy?.args, ['deploy', '--skip-build']);
    assert.ok(
      migratedShellCloudflareBuild.records.indexOf(shellAssetGeneration!) <
        migratedShellCloudflareBuild.records.indexOf(shellCloudflareDeploy!),
    );

    const migratedCatalogCloudflareBuild = runRecordedPackageScript(
      tempRoot,
      workspaceDir,
      'verticals/catalog',
      'cloudflare:build',
    );
    assert.equal(
      migratedCatalogCloudflareBuild.result.status,
      0,
      migratedCatalogCloudflareBuild.result.stderr,
    );
    assert.deepEqual(
      normalizedCommandTrace(migratedCatalogCloudflareBuild.records),
      normalizedCommandTrace(freshCatalogCloudflareBuild.records),
    );
    const catalogAssetGeneration = migratedCatalogCloudflareBuild.records.find(
      record =>
        record.command === 'node' &&
        path.basename(record.args[0] ?? '') ===
          'generate-public-surface-assets.mts',
    );
    assertRecordedNodeTarget(
      catalogAssetGeneration,
      'generate-public-surface-assets.mts',
    );
    assert.deepEqual(catalogAssetGeneration?.args.slice(1), [
      '--app',
      'catalog',
      '--target',
      'cloudflare-dist',
    ]);
    const catalogCloudflareDeploy = migratedCatalogCloudflareBuild.records.find(
      record =>
        record.command === 'modern' &&
        record.env.MODERNJS_DEPLOY === 'cloudflare' &&
        record.args[0] === 'deploy',
    );
    assert.deepEqual(catalogCloudflareDeploy?.args, ['deploy', '--skip-build']);
    assert.equal(
      migratedCatalogCloudflareBuild.records.some(
        record =>
          path.basename(record.args[0] ?? '') ===
          'generate-node-backend-federation.mts',
      ),
      false,
    );

    const catalogNodeBuild = runRecordedPackageScript(
      tempRoot,
      workspaceDir,
      'verticals/catalog',
      'build',
    );
    assert.equal(
      catalogNodeBuild.result.status,
      0,
      catalogNodeBuild.result.stderr,
    );
    const catalogNodeAssets = catalogNodeBuild.records.find(
      record =>
        record.command === 'node' &&
        path.basename(record.args[0] ?? '') ===
          'generate-public-surface-assets.mts',
    );
    const catalogNodeDeploy = catalogNodeBuild.records.find(
      record =>
        record.command === 'modern' &&
        record.env.MODERNJS_DEPLOY === 'node' &&
        record.args[0] === 'deploy',
    );
    assertRecordedNodeTarget(
      catalogNodeAssets,
      'generate-public-surface-assets.mts',
    );
    assert.deepEqual(catalogNodeDeploy?.args, ['deploy', '--skip-build']);
    assert.ok(
      catalogNodeBuild.records.indexOf(catalogNodeAssets!) <
        catalogNodeBuild.records.indexOf(catalogNodeDeploy!),
    );
    assert.equal(
      catalogNodeBuild.records.some(
        record =>
          path.basename(record.args[0] ?? '') ===
          'generate-node-backend-federation.mts',
      ),
      false,
    );

    for (const packageDir of ['apps/shell-super-app', 'verticals/catalog']) {
      const deploy = runRecordedPackageScript(
        tempRoot,
        workspaceDir,
        packageDir,
        'cloudflare:deploy',
      );
      assert.equal(deploy.result.status, 0, deploy.result.stderr);
      const build = deploy.records.find(record => record.command === 'pnpm');
      assert.deepEqual(build?.args, ['run', 'cloudflare:build']);
      assert.equal(
        build?.env.ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS,
        'true',
      );
      const wrangler = deploy.records.find(
        record => record.command === 'wrangler',
      );
      assert.deepEqual(wrangler?.args, [
        'deploy',
        '--config',
        '.output/wrangler.json',
      ]);
      assert.ok(
        deploy.records.indexOf(build!) < deploy.records.indexOf(wrangler!),
      );
    }

    const migratedTopology = readJson(
      workspaceDir,
      'topology/reference-topology.json',
    );
    const migratedCatalog = migratedTopology.verticals.find(
      (vertical: Record<string, unknown>) => vertical.id === 'catalog',
    );
    assert.equal(migratedCatalog.api.effect, undefined);
    assert.equal(migratedCatalog.api.runtime, 'effect');
    assert.equal(migratedCatalog.api.bff.strictEffectApproach, true);
    assert.equal(
      migratedCatalog.api.serverEntry,
      'verticals/catalog/api/index.ts',
    );
    assert.equal(migratedCatalog.api.contract.export, './api');
    assert.equal(
      migratedCatalog.api.contract.path,
      'verticals/catalog/shared/api.ts',
    );
    assert.equal(migratedCatalog.api.client.export, './api/client');
    assert.equal(
      migratedCatalog.api.client.path,
      'verticals/catalog/src/api/catalog-client.ts',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate-strict-effect removes unused Drizzle declaration patches', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-no-drizzle');

  try {
    const policy = readYaml(workspaceDir, 'pnpm-workspace.yaml');
    policy.patchedDependencies[`drizzle-orm@${DRIZZLE_ORM_VERSION}`] =
      'patches/drizzle-orm-ts7-strict-declarations.patch';
    writeYaml(workspaceDir, 'pnpm-workspace.yaml', policy);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const migratedPolicy = readYaml(workspaceDir, 'pnpm-workspace.yaml');
    assert.equal(
      migratedPolicy.patchedDependencies[`drizzle-orm@${DRIZZLE_ORM_VERSION}`],
      undefined,
      'migrate-strict-effect must remove stale Drizzle patches when drizzle-orm is not installed',
    );
    assert.equal(
      fs.existsSync(
        path.join(
          workspaceDir,
          'patches/drizzle-orm-ts7-strict-declarations.patch',
        ),
      ),
      false,
      'migrate-strict-effect must remove the generated Drizzle patch file when it is unused',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern mf-types validates real Module Federation config files', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-mf');

  try {
    assert.equal(
      await runUltramodernToolingCli(
        ['mf-types', 'apps/shell-super-app'],
        workspaceDir,
      ),
      0,
    );

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    assert.equal(
      await runUltramodernToolingCli(
        ['mf-types', 'verticals/catalog'],
        workspaceDir,
      ),
      1,
      'remote exposes must require a non-empty DTS archive',
    );

    const archivePath = path.join(
      workspaceDir,
      'verticals/catalog/dist/@mf-types.zip',
    );
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, 'zip');

    assert.equal(
      await runUltramodernToolingCli(
        ['mf-types', 'verticals/catalog'],
        workspaceDir,
      ),
      0,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('compact UltraModern config maps component exposes to concrete DTS source files', () => {
  const apps = workspaceAppsFromToolingConfig({
    schemaVersion: 1,
    source: 'compact',
    sourcePath: '.modernjs/ultramodern.json',
    workspace: {
      packageScope: 'tooling-exposes',
    },
    features: {
      tailwind: true,
    },
    topology: {
      apps: [
        {
          id: 'shell-super-app',
          kind: 'shell',
          path: 'apps/shell-super-app',
          moduleFederation: {
            role: 'host',
            name: 'shellSuperApp',
            exposes: [],
            verticalRefs: ['catalog'],
          },
        },
        {
          id: 'catalog',
          kind: 'vertical',
          path: 'verticals/catalog',
          domain: 'catalog',
          moduleFederation: {
            role: 'remote',
            name: 'verticalCatalog',
            exposes: ['./ProductGrid', './Route', './Widget', './Custom'],
            exposePaths: {
              './Custom': './src/features/custom-surface.tsx',
            },
          },
          api: {
            stem: 'catalog',
            prefix: '/catalog-api',
            consumedBy: ['shell-super-app', 'catalog'],
          },
        },
      ],
    },
  });

  const catalog = apps.find(app => app.id === 'catalog');

  assert.deepEqual(catalog?.exposes, {
    './Custom': './src/features/custom-surface.tsx',
    './ProductGrid': './src/components/product-grid.tsx',
    './Route': './src/federation-entry.tsx',
    './Widget': './src/components/catalog-widget.tsx',
  });
  assert.deepEqual(
    (createAppMfTypesTsConfig(catalog!) as Record<string, unknown>).include,
    [
      'src/federation-entry.tsx',
      'src/components/product-grid.tsx',
      'src/components/catalog-widget.tsx',
      'src/features/custom-surface.tsx',
      'src/modern-app-env.d.ts',
    ],
    'custom expose order must keep the route entry first for MF DTS validation',
  );
});

test('generated app tsconfig uses sibling-relative vertical references', () => {
  const apps = workspaceAppsFromToolingConfig({
    schemaVersion: 1,
    source: 'compact',
    sourcePath: '.modernjs/ultramodern.json',
    workspace: {
      packageScope: 'tooling-references',
    },
    features: {
      tailwind: true,
    },
    topology: {
      apps: [
        {
          id: 'shell-super-app',
          kind: 'shell',
          path: 'apps/shell-super-app',
          moduleFederation: {
            role: 'host',
            verticalRefs: ['catalog', 'checkout'],
          },
        },
        {
          id: 'catalog',
          kind: 'vertical',
          path: 'verticals/catalog',
          moduleFederation: {
            role: 'remote',
            exposes: ['./Route'],
          },
          api: {
            stem: 'catalog',
            prefix: '/catalog-api',
            consumedBy: ['shell-super-app', 'catalog', 'checkout'],
          },
        },
        {
          id: 'checkout',
          kind: 'vertical',
          path: 'verticals/checkout',
          moduleFederation: {
            role: 'remote',
            exposes: ['./Route'],
            verticalRefs: ['catalog'],
          },
          api: {
            stem: 'checkout',
            prefix: '/checkout-api',
            consumedBy: ['shell-super-app', 'checkout'],
          },
        },
      ],
    },
  });
  const checkout = apps.find(app => app.id === 'checkout');
  const checkoutTsConfig = createAppTsConfig(
    checkout!,
    apps.filter(app => app.kind !== 'shell'),
  ) as Record<string, unknown>;
  assert.deepEqual(checkoutTsConfig.include, [
    'src',
    'locales/**/*.json',
    'package.json',
    'shared',
    'server',
    'api',
  ]);
  assert.deepEqual(checkoutTsConfig.references, [
    { path: '../../packages/shared-contracts' },
    { path: '../../packages/shared-design-tokens' },
    { path: '../catalog' },
  ]);
});

function fileMutationStamp(filePath: string) {
  const stat = fs.statSync(filePath);
  return {
    mode: stat.mode,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

function snapshotWorkspaceMetadata(
  root: string,
): Record<string, ReturnType<typeof fileMutationStamp>> {
  const tree: Record<string, ReturnType<typeof fileMutationStamp>> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        const relative = path.relative(root, absolute);
        tree[relative] = fileMutationStamp(absolute);
      }
    }
  };
  walk(root);
  return tree;
}

async function loadOxfmtConfig(workspaceDir: string, revision: string) {
  const workspaceNodeModules = path.join(workspaceDir, 'node_modules');
  if (!fs.existsSync(workspaceNodeModules)) {
    fs.symlinkSync(
      path.resolve(__dirname, '../../../..', 'node_modules'),
      workspaceNodeModules,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
  return (
    await import(
      `${pathToFileURL(path.join(workspaceDir, 'oxfmt.config.ts')).href}?revision=${revision}`
    )
  ).default as { ignorePatterns?: string[] };
}

function captureStdout<T>(run: () => T): { result: T; output: string } {
  const original = process.stdout.write.bind(process.stdout);
  let output = '';
  (process.stdout as NodeJS.WriteStream).write = ((chunk: unknown) => {
    output += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = run();
    return { result, output };
  } finally {
    process.stdout.write = original;
  }
}

test('UltraModern migrate synthesizes the compact config from legacy 3.2 metadata', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-legacy-trio');

  try {
    fs.rmSync(path.join(workspaceDir, '.modernjs/ultramodern.json'));

    writeJson(workspaceDir, retiredContractPath, {
      schemaVersion: 1,
      profile: 'cloudflare-ssr-mf-effect-v1',
      apps: [
        {
          id: 'shell-super-app',
          kind: 'shell',
          path: 'apps/shell-super-app',
          package: '@tooling-legacy-trio/shell-super-app',
          styling: { tailwind: true },
          moduleFederation: {
            name: 'shellSuperApp',
            role: 'host',
            verticalRefs: [],
          },
          i18n: { namespace: 'shell' },
        },
      ],
    });
    writeJson(workspaceDir, retiredPackageSourcePath, {
      schemaVersion: 1,
      strategy: 'workspace',
      modernPackages: {
        specifier: 'workspace:*',
      },
    });
    writeJson(workspaceDir, 'topology/local-overlays/development.json', {
      ports: { 'shell-super-app': 8080 },
    });

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    assert.equal(
      fs.existsSync(path.join(workspaceDir, '.modernjs/ultramodern.json')),
      true,
    );

    const config = readUltramodernConfig(workspaceDir);
    assert.equal(config.source, 'compact');
    assert.equal(config.packageSource?.aliasScope, undefined);
    assert.equal(config.packageSource?.aliasPackageNamePrefix, undefined);
    assert.equal(config.packageSource?.modernPackageVersion, 'workspace:*');

    const compactConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    assert.equal(compactConfig.packageSource.aliasScope, undefined);
    assert.equal(compactConfig.packageSource.aliasPackageNamePrefix, undefined);
    assert.equal(compactConfig.topology.apps[0].moduleFederation.role, 'host');
    assert.equal(compactConfig.topology.apps[0].port, 8080);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate --dry-run performs no filesystem mutations', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-dry-run');

  try {
    const before = snapshotWorkspaceMetadata(workspaceDir);

    const { result, output } = captureStdout(() =>
      runUltramodernToolingCli(
        ['migrate-strict-effect', '--dry-run'],
        workspaceDir,
      ),
    );
    assert.equal(await result, 0);

    const after = snapshotWorkspaceMetadata(workspaceDir);
    assert.deepEqual(after, before);
    assert.match(output, /\[dry-run\] would write/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate keeps generated gitignore rules idempotent', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-gitignore');

  try {
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    const gitignorePath = path.join(workspaceDir, '.gitignore');
    const afterFirstMigration = fs.readFileSync(gitignorePath);
    assertGitIgnored(workspaceDir, [
      '.output/server/index.js',
      'verticals/catalog/.output/server/index.js',
      '.modern-js/build.json',
      'apps/shell-super-app/.modern-js/build.json',
      'verticals/catalog/src/modern-tanstack/router.gen.ts',
      'apps/shell-super-app/.tsgo.app.resolved.json',
    ]);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    assert.deepEqual(
      fs.readFileSync(gitignorePath),
      afterFirstMigration,
      'a second migration must leave the ignore policy byte-identical',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate rejects duplicate pnpm mappings without writes', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-yaml-dedupe');

  try {
    const pnpmWorkspaceFile = path.join(workspaceDir, 'pnpm-workspace.yaml');
    const unquotedLine = `  effect@${EFFECT_VERSION}: patches/effect-schema-error-type-id.patch`;
    fs.writeFileSync(
      pnpmWorkspaceFile,
      fs
        .readFileSync(pnpmWorkspaceFile, 'utf-8')
        .replace(
          `  'effect@${EFFECT_VERSION}': patches/effect-schema-error-type-id.patch`,
          `${unquotedLine}\n${unquotedLine}`,
        ),
      'utf-8',
    );
    const rootPackageFile = path.join(workspaceDir, 'package.json');
    const duplicatePolicyStamp = fileMutationStamp(pnpmWorkspaceFile);
    const rootPackageStamp = fileMutationStamp(rootPackageFile);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      1,
    );

    assert.deepEqual(
      fileMutationStamp(pnpmWorkspaceFile),
      duplicatePolicyStamp,
    );
    assert.deepEqual(fileMutationStamp(rootPackageFile), rootPackageStamp);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate syncs oxfmt ignorePatterns and tolerates unparseable configs', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-oxfmt');

  try {
    const oxfmtPath = path.join(workspaceDir, 'oxfmt.config.ts');
    fs.writeFileSync(
      oxfmtPath,
      `import { defineConfig } from 'oxfmt';

export default defineConfig({
  ignorePatterns: [
    '.modernjs',
    '**/modern-tanstack/**',
  ],
  singleQuote: true,
});
`,
      'utf-8',
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const patched = await loadOxfmtConfig(workspaceDir, 'first');
    assert.deepEqual(patched.ignorePatterns, [
      '.modernjs',
      '**/modern-tanstack/**',
      '.output',
      '**/routeTree.gen.*',
    ]);

    const afterFirst = fileMutationStamp(oxfmtPath);
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    assert.deepEqual(fileMutationStamp(oxfmtPath), afterFirst);
    const second = await loadOxfmtConfig(workspaceDir, 'second');
    assert.deepEqual(second.ignorePatterns, patched.ignorePatterns);

    const unparseable = `import { defineConfig } from 'oxfmt';
import extra from './extra-ignores';

export default defineConfig({
  ignorePatterns: [...extra],
  singleQuote: true,
});
`;
    fs.writeFileSync(oxfmtPath, unparseable, 'utf-8');
    const unparseableStamp = fileMutationStamp(oxfmtPath);
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    assert.deepEqual(fileMutationStamp(oxfmtPath), unparseableStamp);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migration supplies the optional Effect peers to workspaces generated before plugin-bff dropped them', () => {
  // A workspace scaffolded before plugin-bff moved `effect` and
  // `@effect/opentelemetry` to optional peers declares neither, and nothing
  // else pulls Effect in. Migration has to add them, or the BFF lane has no
  // Effect to load and pnpm rejects the `effect@<version>` patch entry the
  // migration writes with ERR_PNPM_UNUSED_PATCH.
  const legacyApp = {
    dependencies: { '@modern-js/plugin-bff': '3.5.0-ultramodern.44' },
  };
  assert.equal(ensureBffEffectDependencies(legacyApp), true);
  assert.deepEqual(legacyApp.dependencies, {
    '@modern-js/plugin-bff': '3.5.0-ultramodern.44',
    '@effect/opentelemetry': EFFECT_VERSION,
    effect: EFFECT_VERSION,
  });

  // Already at the cohort version: nothing to change.
  assert.equal(ensureBffEffectDependencies(legacyApp), false);

  // Packages that do not depend on plugin-bff never gain an Effect dependency.
  const uiOnly = { dependencies: { react: '19.2.7' } };
  assert.equal(ensureBffEffectDependencies(uiOnly), false);
  assert.deepEqual(uiOnly.dependencies, { react: '19.2.7' });

  // The generated root carries plugin-bff in devDependencies.
  const root = {
    devDependencies: { '@modern-js/plugin-bff': '3.5.0-ultramodern.44' },
  };
  assert.equal(ensureBffEffectDependencies(root), true);
  assert.equal(root.devDependencies.effect, EFFECT_VERSION);
});
