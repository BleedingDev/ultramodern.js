import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { format } from 'oxfmt';
import {
  discoverModuleFederationConfigs,
  validateModuleFederationTypes,
} from '../src/ultramodern-workspace/mf-validation';
import { inspectModuleFederationConfigSource } from '../src/ultramodern-workspace/mf-validation/inspect';

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
  target: 'cloudflare' | 'node' = 'node',
) {
  const archivePath = path.join(
    workspaceRoot,
    appDir,
    target === 'cloudflare'
      ? 'dist-cloudflare/@mf-types.zip'
      : 'dist/@mf-types.zip',
  );
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
  writeJson(workspaceRoot, 'topology/reference-topology.json', {
    shell: {
      id: 'contract-remote',
      moduleFederation: { exposes: ['./Widget'] },
      path: 'apps/contract-remote',
    },
    verticals: [],
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
  writeJson(workspaceRoot, 'topology/reference-topology.json', {
    shell: {
      id: 'custom',
      moduleFederation: { exposes: [] },
      path: 'apps/custom',
    },
    verticals: [],
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

test('validates Cloudflare DTS archives independently from Node output', () => {
  const workspaceRoot = createWorkspace({
    'apps/remote/module-federation.config.ts': mfConfig(),
  });
  writeMfTypesArchive(workspaceRoot, 'apps/remote');

  assertThrowsWithMessage(
    () =>
      validateModuleFederationTypes({ workspaceRoot, target: 'cloudflare' }),
    /Missing Module Federation DTS archive: apps\/remote\/dist-cloudflare\/@mf-types\.zip/u,
  );

  writeMfTypesArchive(
    workspaceRoot,
    'apps/remote',
    'cloudflare-zip-bytes',
    'cloudflare',
  );
  assert.doesNotThrow(() =>
    validateModuleFederationTypes({ workspaceRoot, target: 'cloudflare' }),
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

  assert.deepEqual(validateModuleFederationTypes({ workspaceRoot }).apps, [
    {
      appDir: 'apps/host',
      configPath: 'apps/host/module-federation.config.ts',
      dts: {
        compilerInstance: 'effect-tsgo',
        tsConfigPath: './tsconfig.mf-types.json',
      },
      exposePaths: {},
      exposes: [],
      hostOnlyNoExposes: true,
    },
  ]);
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

  assert.deepEqual(validateModuleFederationTypes({ workspaceRoot }).apps, [
    {
      appDir: 'apps/host',
      configPath: 'apps/host/module-federation.config.ts',
      dts: {
        compilerInstance: undefined,
        tsConfigPath: './tsconfig.mf-types.json',
      },
      exposePaths: {},
      exposes: [],
      hostOnlyNoExposes: true,
    },
  ]);
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

test('source inspector permits dts:false only with zero frontend exposes', () => {
  const inspect = (source: string) =>
    inspectModuleFederationConfigSource(
      source,
      'verticals/api',
      'module-federation.config.ts',
    );
  assert.deepEqual(
    inspect(
      '// @ultramodern-mf no-exposes\nexport default { dts: false, exposes: {} };',
    ).dts,
    {},
  );
  assertThrowsWithMessage(
    () =>
      inspect(
        'export default { dts: false, exposes: { "./Page": "./page.tsx" } };',
      ),
    /DTS cannot be disabled for exposed app/u,
  );
  assertThrowsWithMessage(
    () => inspect('export default { dts: false, exposes: dynamic() };'),
    /Cannot statically extract/u,
  );
  assertThrowsWithMessage(
    () =>
      inspect(
        '// createModuleFederationConfig({ exposes: {} });\nexport /* actual */\n default { /* properties */ dts: false, exposes: ["./Page", /* trailing */] };',
      ),
    /DTS cannot be disabled/u,
  );
});

test('MF proof accepts explicit API-only intent but keeps exposed-app archives mandatory', () => {
  const appDir = 'apps/api';
  const workspaceRoot = createWorkspace({
    [`${appDir}/module-federation.config.ts`]:
      '// @ultramodern-mf no-exposes\nexport default { dts: false, exposes: {} };',
  });
  try {
    const validate = () =>
      validateModuleFederationTypes({ workspaceRoot, appDirs: [appDir] });
    assert.equal(validate().hostOnlyAppCount, 1);
    const configPath = path.join(
      workspaceRoot,
      appDir,
      'module-federation.config.ts',
    );
    fs.writeFileSync(configPath, 'export default { dts: false, exposes: {} };');
    assertThrowsWithMessage(
      validate,
      /without an explicit host-only\/no-exposes declaration/u,
    );
    fs.writeFileSync(configPath, mfConfig());
    assertThrowsWithMessage(validate, /Missing Module Federation DTS archive/u);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
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

test('MF inspection follows the default export instead of comments, strings or unused factory calls', () => {
  const realConfig = mfConfig().replace(
    /dts: \{[\s\S]*?\n {2}\},/u,
    'dts: false,',
  );
  const decoys = [
    '// createModuleFederationConfig({ dts: false, exposes: {} });\n',
    '/* export default { exposes: {} }; createModuleFederationConfig({}); */\n',
    'const example = "createModuleFederationConfig({ exposes: {} })";\n',
    'const unused = createModuleFederationConfig({ exposes: {} });\n',
  ];
  for (const decoy of decoys) {
    assertThrowsWithMessage(
      () =>
        inspectModuleFederationConfigSource(
          decoy + realConfig,
          'apps/remote',
          'module-federation.config.ts',
        ),
      /DTS cannot be disabled/u,
    );
    assertThrowsWithMessage(
      () =>
        inspectModuleFederationConfigSource(
          '// ultramodern-mf: host-only\n' + decoy + mfConfig(),
          'apps/remote',
          'module-federation.config.ts',
        ),
      /declaration conflicts with actual exposes/u,
    );
  }
  assert.equal(
    inspectModuleFederationConfigSource(
      'const example = "ultramodern-mf: host-only"; export default { exposes: {} };',
      'apps/host',
      'module-federation.config.ts',
    ).hostOnlyNoExposes,
    false,
  );
});

test('MF inspection tolerates property comments, export line breaks and native formatter choices', async () => {
  const source = mfConfig({
    exposes: "[/* first */ './Widget', /* last */] as const",
  })
    .replace('export default', 'export /* declaration */\n default')
    .replace('dts: {', '/* DTS ownership */ dts: /* settings */ {')
    .replace(
      'compilerInstance: tsgoCompilerInstance',
      'compilerInstance: (tsgoCompilerInstance as string)',
    )
    .replace(
      "tsConfigPath: './tsconfig.mf-types.json'",
      "tsConfigPath: ('./tsconfig.mf-types.json' satisfies string)",
    );
  const expected = inspectModuleFederationConfigSource(
    mfConfig({ exposes: "['./Widget']" }),
    'apps/remote',
    'module-federation.config.ts',
  );
  assert.deepEqual(
    inspectModuleFederationConfigSource(
      source,
      'apps/remote',
      'module-federation.config.ts',
    ),
    expected,
  );
  for (const printWidth of [80, 120, 160]) {
    for (const singleQuote of [false, true]) {
      for (const trailingComma of ['all', 'none'] as const) {
        const formatted = await format('module-federation.config.ts', source, {
          printWidth,
          singleQuote,
          trailingComma,
        });
        assert.deepEqual(
          inspectModuleFederationConfigSource(
            formatted.code,
            'apps/remote',
            'module-federation.config.ts',
          ),
          expected,
        );
      }
    }
  }
});

test('MF inspection resolves typed constants and imported factory aliases', () => {
  const imports = [
    "import { createModuleFederationConfig as defineConfig } from '@module-federation/modern-js-v3';",
    "import * as mf from '@module-federation/modern-js-v3';",
  ];
  for (const [index, declaration] of imports.entries()) {
    const source = `${declaration}
const options = ({ exposes: { './Widget': './widget.tsx' } } satisfies Record<string, unknown>);
const config = ${index === 0 ? 'defineConfig' : 'mf.createModuleFederationConfig'}(options);
const exported = config;
export { exported as default };
`;
    assert.deepEqual(
      inspectModuleFederationConfigSource(
        source,
        'apps/remote',
        'module-federation.config.ts',
      ).exposes,
      ['./Widget'],
    );
  }
});

test('MF inspection fails closed on dynamic, ambiguous and mutated config expressions', () => {
  const unsupported = [
    'export default { ...base };',
    'export default { [key]: {} };',
    'export default { get exposes() { return {}; } };',
    'export default { exposes };',
    'export default { exposes: {}, exposes: {} };',
    'export default { exposes: ["./Widget", ...rest] };',
    'export default { exposes: ["./Widget", ,] };',
    `export default { exposes: \`./\${name}\` };`,
    'export default { exposes: dynamic() };',
    'let config = {}; export default config;',
    'const a = b; const b = a; export default a;',
    'const config = {}; config.exposes = dynamic(); export default config;',
    'const config = {}; mutate(config); export default config;',
    'const config = {}; export default config; export default {};',
    "import { createModuleFederationConfig } from './untrusted'; export default createModuleFederationConfig({});",
    'function createModuleFederationConfig(value) { return value; } export default createModuleFederationConfig({});',
    'export default { exposes: {} ',
  ];
  for (const source of unsupported) {
    assert.throws(
      () =>
        inspectModuleFederationConfigSource(
          source,
          'apps/remote',
          'module-federation.config.ts',
        ),
      undefined,
      source,
    );
  }
});
