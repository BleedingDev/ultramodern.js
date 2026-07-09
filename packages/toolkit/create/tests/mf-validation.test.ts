import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverModuleFederationConfigs,
  validateModuleFederationTypes,
} from '../src/ultramodern-workspace/mf-validation';

type WorkspaceFiles = Record<string, string | Buffer>;

function createWorkspace(files: WorkspaceFiles = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-mf-'));

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(workspaceRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  return workspaceRoot;
}

function writeJson(
  workspaceRoot: string,
  relativePath: string,
  value: unknown,
) {
  const filePath = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function writeMfTypesArchive(
  workspaceRoot: string,
  appDir: string,
  content: string | Buffer = 'zip-bytes',
) {
  const archivePath = path.join(workspaceRoot, appDir, 'dist/@mf-types.zip');
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(archivePath, content);
}

function mfConfig({
  compilerInstance = 'tsgoCompilerInstance',
  exposes = "{ './Widget': './src/widget.tsx' }",
  hostOnly = false,
  includeExposes = true,
  tsConfigPath = "'./tsconfig.mf-types.json'",
}: {
  compilerInstance?: string;
  exposes?: string;
  hostOnly?: boolean;
  includeExposes?: boolean;
  tsConfigPath?: string;
} = {}) {
  return `${hostOnly ? '// ultramodern-mf: host-only\n' : ''}import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

export default createModuleFederationConfig({
  dts: {
    generateTypes: {
      compilerInstance: ${compilerInstance},
    },
    tsConfigPath: ${tsConfigPath},
  },
  ${includeExposes ? `exposes: ${exposes},` : ''}
  filename: 'remoteEntry.js',
  name: 'remote',
});
`;
}

function assertThrowsWithMessage(callback: () => unknown, message: RegExp) {
  assert.throws(
    callback,
    (error: unknown) => error instanceof Error && message.test(error.message),
  );
}

test('discovers Module Federation configs from generated metadata and app-root filesystem scanning', () => {
  const workspaceRoot = createWorkspace({
    'apps/contract-remote/module-federation.config.ts': mfConfig(),
    'apps/scanned-remote/module-federation.config.ts': mfConfig(),
  });
  writeJson(workspaceRoot, '.modernjs/ultramodern.json', {
    topology: {
      apps: [
        {
          id: 'contract-remote',
          moduleFederation: { exposes: ['./Widget'] },
          path: 'apps/contract-remote',
        },
      ],
    },
  });

  assert.deepEqual(
    discoverModuleFederationConfigs({ workspaceRoot }).map(
      config => config.appDir,
    ),
    ['apps/contract-remote', 'apps/scanned-remote'],
  );
});

test('validates real exposes even when the generated contract exposes are stale', () => {
  const workspaceRoot = createWorkspace({
    'apps/custom/module-federation.config.ts': mfConfig(),
  });
  writeJson(workspaceRoot, '.modernjs/ultramodern.json', {
    topology: {
      apps: [
        {
          id: 'custom',
          moduleFederation: {
            dts: {
              compilerInstance: 'effect-tsgo',
              tsConfigPath: './tsconfig.mf-types.json',
            },
            exposes: [],
          },
          path: 'apps/custom',
        },
      ],
    },
  });

  assertThrowsWithMessage(
    () => validateModuleFederationTypes({ workspaceRoot }),
    /Missing Module Federation DTS archive: apps\/custom\/dist\/@mf-types\.zip/u,
  );
});

test('rejects discovered configs that would validate zero exposed apps', () => {
  const workspaceRoot = createWorkspace({
    'apps/host/module-federation.config.ts': mfConfig({
      includeExposes: false,
    }),
  });

  assertThrowsWithMessage(
    () => validateModuleFederationTypes({ workspaceRoot }),
    /no exposes without an explicit host-only\/no-exposes declaration: apps\/host.*zero exposed apps/u,
  );
});

test('rejects exposed apps with the wrong DTS compiler instance', () => {
  const workspaceRoot = createWorkspace({
    'apps/remote/module-federation.config.ts': mfConfig({
      compilerInstance: "'typescript'",
    }),
  });
  writeMfTypesArchive(workspaceRoot, 'apps/remote');

  assertThrowsWithMessage(
    () => validateModuleFederationTypes({ workspaceRoot }),
    /compilerInstance must resolve "@effect\/tsgo" for apps\/remote/u,
  );
});

test('rejects exposed apps with the wrong DTS tsconfig path', () => {
  const workspaceRoot = createWorkspace({
    'apps/remote/module-federation.config.ts': mfConfig({
      tsConfigPath: "'./tsconfig.json'",
    }),
  });
  writeMfTypesArchive(workspaceRoot, 'apps/remote');

  assertThrowsWithMessage(
    () => validateModuleFederationTypes({ workspaceRoot }),
    /tsConfigPath must be "\.\/tsconfig\.mf-types\.json" for apps\/remote/u,
  );
});

test('rejects exposed apps without a DTS archive', () => {
  const workspaceRoot = createWorkspace({
    'apps/remote/module-federation.config.ts': mfConfig(),
  });

  assertThrowsWithMessage(
    () => validateModuleFederationTypes({ workspaceRoot }),
    /Missing Module Federation DTS archive: apps\/remote\/dist\/@mf-types\.zip/u,
  );
});

test('rejects exposed apps with an empty DTS archive', () => {
  const workspaceRoot = createWorkspace({
    'apps/remote/module-federation.config.ts': mfConfig(),
  });
  writeMfTypesArchive(workspaceRoot, 'apps/remote', Buffer.alloc(0));

  assertThrowsWithMessage(
    () => validateModuleFederationTypes({ workspaceRoot }),
    /Empty Module Federation DTS archive: apps\/remote\/dist\/@mf-types\.zip/u,
  );
});

test('allows an explicit host-only config with no exposes', () => {
  const workspaceRoot = createWorkspace({
    'apps/host/module-federation.config.ts': mfConfig({
      hostOnly: true,
      includeExposes: false,
    }),
  });

  assert.deepEqual(validateModuleFederationTypes({ workspaceRoot }), {
    apps: [
      {
        appDir: 'apps/host',
        configPath: 'apps/host/module-federation.config.ts',
        dts: {
          compilerInstance: 'effect-tsgo',
          tsConfigPath: './tsconfig.mf-types.json',
        },
        exposes: [],
        hostOnlyNoExposes: true,
      },
    ],
    configCount: 1,
    exposedAppCount: 0,
    hostOnlyAppCount: 1,
  });
});

test('allows a host-only config using consume-only DTS settings', () => {
  const workspaceRoot = createWorkspace({
    'apps/host/module-federation.config.ts': `// ultramodern-mf: host-only
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

export default createModuleFederationConfig({
  dts: {
    consumeTypes: true,
    generateTypes: false,
    tsConfigPath: './tsconfig.mf-types.json',
  },
  filename: 'remoteEntry.js',
  name: 'host',
});
`,
  });

  assert.deepEqual(validateModuleFederationTypes({ workspaceRoot }), {
    apps: [
      {
        appDir: 'apps/host',
        configPath: 'apps/host/module-federation.config.ts',
        dts: {
          compilerInstance: undefined,
          tsConfigPath: './tsconfig.mf-types.json',
        },
        exposes: [],
        hostOnlyNoExposes: true,
      },
    ],
    configCount: 1,
    exposedAppCount: 0,
    hostOnlyAppCount: 1,
  });
});

test('rejects an exposing app that uses the relaxed consume-only DTS shape', () => {
  const workspaceRoot = createWorkspace({
    'apps/remote/module-federation.config.ts': `import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

export default createModuleFederationConfig({
  dts: {
    consumeTypes: true,
    generateTypes: false,
    tsConfigPath: './tsconfig.mf-types.json',
  },
  exposes: { './Widget': './src/widget.tsx' },
  filename: 'remoteEntry.js',
  name: 'remote',
});
`,
  });

  assertThrowsWithMessage(
    () => validateModuleFederationTypes({ workspaceRoot }),
    /compilerInstance must resolve "@effect\/tsgo"/,
  );
});

test('rejects dynamic exposes without evaluating Module Federation config code', () => {
  const workspaceRoot = createWorkspace({
    'apps/dynamic/module-federation.config.ts': `import fs from 'node:fs';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

function getExposes() {
  fs.writeFileSync('config-was-executed.txt', 'unsafe');
  return { './Widget': './src/widget.tsx' };
}

export default createModuleFederationConfig({
  dts: {
    generateTypes: {
      compilerInstance: tsgoCompilerInstance,
    },
    tsConfigPath: './tsconfig.mf-types.json',
  },
  exposes: getExposes(),
  filename: 'remoteEntry.js',
  name: 'dynamic',
});
`,
  });

  assertThrowsWithMessage(
    () => validateModuleFederationTypes({ workspaceRoot }),
    /Cannot statically extract Module Federation exposes from apps\/dynamic\/module-federation\.config\.ts/u,
  );
  assert.equal(
    fs.existsSync(path.join(workspaceRoot, 'config-was-executed.txt')),
    false,
  );
});
