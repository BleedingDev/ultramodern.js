import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const generatorBin = path.resolve(__dirname, '../bin/run.js');

type Invocation = {
  phase: 'start' | 'finish';
  appDirectory: string;
  cwd: string;
  call: number;
  pid: number;
};

// This explicit test provider verifies command orchestration. Native renderer
// generation and the real framework helper are tested by their owning suites.
function createRouteCommandFixture(failingApp?: string) {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-route-command-'),
    ),
  );
  const log = path.join(root, 'route-invocations.jsonl');
  const records = [
    { id: 'shell-react', path: 'apps/react', kind: 'shell', renderer: 'react' },
    {
      id: 'vertical-solid',
      path: 'verticals/solid',
      kind: 'vertical',
      renderer: 'solid',
    },
    {
      id: 'vertical-api',
      path: 'verticals/api',
      kind: 'vertical',
      renderer: 'none',
      surfaceProfile: 'api-only',
    },
    {
      id: 'shell-octane',
      path: 'apps/octane',
      kind: 'shell',
      renderer: 'octane',
    },
  ];
  try {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'route-command-test',
        private: true,
        devDependencies: { '@modern-js/ultramodern-create': 'workspace:*' },
      }),
    );
    for (const record of records) {
      const appDirectory = path.join(root, record.path);
      fs.mkdirSync(appDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(appDirectory, 'package.json'),
        JSON.stringify({ name: `@route-test/${record.id}`, version: '1.0.0' }),
      );
      fs.writeFileSync(
        path.join(appDirectory, 'modern.config.ts'),
        'throw new Error("The toolkit parent must not evaluate app config.");\n',
      );
      if (record.surfaceProfile === 'api-only') continue;
      const provider = path.join(
        appDirectory,
        'node_modules/@modern-js/ultramodern-app-tools',
      );
      fs.mkdirSync(provider, { recursive: true });
      fs.writeFileSync(
        path.join(provider, 'package.json'),
        JSON.stringify({
          name: '@route-test/cli-provider',
          version: '1.0.0',
          type: 'module',
          exports: { './cli': './cli.js' },
        }),
      );
      fs.writeFileSync(
        path.join(provider, 'cli.js'),
        `import fs from 'node:fs';
let call = 0;
export async function generateRouteArtifacts({ appDirectory }) {
  call += 1;
  const event = { appDirectory, cwd: process.cwd(), call, pid: process.pid };
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ ...event, phase: 'start' }) + '\\n');
  await new Promise(resolve => setTimeout(resolve, 20));
  ${record.id === failingApp ? 'throw new Error("owning route generation failed", { cause: new Error("native route diagnostic") });' : ''}
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ ...event, phase: 'finish' }) + '\\n');
}
`,
      );
    }
    fs.mkdirSync(path.join(root, 'topology/local-overlays'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, 'topology/reference-topology.json'),
      JSON.stringify({
        schemaVersion: 1,
        shell: records[0],
        verticals: records.slice(1, 3),
        shells: records.slice(3),
      }),
    );
    fs.writeFileSync(
      path.join(root, 'topology/local-overlays/development.json'),
      JSON.stringify({
        schemaVersion: 1,
        ports: Object.fromEntries(
          records.map((record, index) => [record.id, 3100 + index]),
        ),
      }),
    );
    return { root, log, records };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function runRoutes(root: string, args: string[] = []) {
  return spawnSync(
    process.execPath,
    [generatorBin, 'ultramodern', 'routes-generate', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CODESMITH_ENV: 'production' },
    },
  );
}

function readInvocations(log: string): Invocation[] {
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

test('routes command awaits each app-installed public helper once in an isolated process and skips headless apps', () => {
  const { root, log, records } = createRouteCommandFixture();
  try {
    const result = runRoutes(root);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const invocations = readInvocations(log);
    const uiRecords = records.filter(
      record => record.surfaceProfile !== 'api-only',
    );
    assert.deepEqual(
      invocations.map(invocation => [
        invocation.phase,
        path.relative(root, invocation.appDirectory),
      ]),
      uiRecords.flatMap(record => [
        ['start', record.path],
        ['finish', record.path],
      ]),
    );
    assert.ok(
      invocations.every(
        invocation =>
          invocation.call === 1 && invocation.cwd === invocation.appDirectory,
      ),
    );
    assert.equal(
      new Set(invocations.map(invocation => invocation.pid)).size,
      uiRecords.length,
    );
    for (const record of uiRecords) {
      assert.match(
        result.stdout,
        new RegExp(`Route artifacts generated: ${record.id}`, 'u'),
      );
    }
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /toolkit parent must not evaluate/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('routes command propagates an awaited helper failure with its cause and still processes later apps', () => {
  const { root, log } = createRouteCommandFixture('vertical-solid');
  try {
    const result = runRoutes(root);
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /Route generation failed: vertical-solid/u);
    assert.match(result.stderr, /native route diagnostic/u);
    assert.match(result.stdout, /Route artifacts generated: shell-octane/u);
    assert.deepEqual(
      readInvocations(log).map(invocation => invocation.phase),
      ['start', 'finish', 'start', 'start', 'finish'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('routes command selects one application and rejects absent or headless selectors before loading a helper', () => {
  const { root, log } = createRouteCommandFixture();
  try {
    for (const id of ['absent', 'vertical-api']) {
      const rejected = runRoutes(root, ['--app', id]);
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /No generated UltraModern app matched/u);
      assert.equal(fs.existsSync(log), false);
    }
    const selected = runRoutes(root, ['--app', 'shell-octane']);
    assert.equal(selected.status, 0, `${selected.stdout}${selected.stderr}`);
    assert.deepEqual(
      readInvocations(log).map(invocation =>
        path.relative(root, invocation.appDirectory),
      ),
      ['apps/octane', 'apps/octane'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('routes command validates all membership paths before dispatching any helper', () => {
  const { root, log } = createRouteCommandFixture();
  try {
    const topologyPath = path.join(root, 'topology/reference-topology.json');
    const topology = JSON.parse(fs.readFileSync(topologyPath, 'utf8'));
    topology.shells[0].path = '..';
    fs.writeFileSync(topologyPath, JSON.stringify(topology));
    const result = runRoutes(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsafe or duplicate path/u);
    assert.equal(fs.existsSync(log), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
