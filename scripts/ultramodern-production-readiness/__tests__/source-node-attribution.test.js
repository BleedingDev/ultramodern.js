const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const attributionModule = import(
  '../published-create-proof/source-node-attribution.mjs'
);

function fixture() {
  const projectDir = '/retained/work-31/ultramodern-ci-superapp';
  const applicationSourceRevision = 'f4fd1d3b149bad5457e4365c0939e06e57a2bca7';
  const verticalIds = [
    'analytics',
    'billing',
    'compliance',
    'finance',
    'inventory',
    'logistics',
    'orders',
    'people',
    'procurement',
    'support',
  ];
  const apps = [...verticalIds, 'custom-shell'].map(id => ({
    id,
    path: id === 'custom-shell' ? 'apps/custom-shell' : `verticals/${id}`,
    kind: id === 'custom-shell' ? 'shell' : 'vertical',
    buildScript: `pnpm --dir ../.. exec ultramodern-create ultramodern public-surface --app ${id} --target dist --sync-route-metadata && ultramodern build && pnpm --dir ../.. exec ultramodern-create ultramodern public-surface --app ${id} --target dist && cross-env MODERNJS_DEPLOY=node ultramodern deploy --skip-build`,
  }));
  const rootBuildScript =
    'ultramodern-create ultramodern typecheck --build packages/shared-contracts/tsconfig.json && ultramodern-create ultramodern typecheck --build packages/shared-design-tokens/tsconfig.json && pnpm -r --filter "./verticals/*" run build && pnpm --filter "./apps/custom-shell" run build && pnpm mf:types && pnpm performance:readiness';
  const lines = [
    '[registry] seed start',
    '[registry] seed end (31985ms)',
    `Initialized empty Git repository in ${projectDir}/.git/`,
    '[main (root-commit) f4fd1d3] test: snapshot generated ERP-10 application source',
    `$ ${rootBuildScript}`,
    'Scope: 10 of 14 workspace projects',
  ];
  // Native pnpm output is interleaved across concurrent app commands.
  for (const batch of [apps.slice(0, 4), apps.slice(4, 8), apps.slice(8, 10)]) {
    for (const app of batch)
      lines.push(`${app.path} build$ ${app.buildScript}`);
    for (const app of batch) {
      lines.push(`${app.path} build: ready   built in 1.56s (server)`);
      lines.push(`${app.path} build: ready   built in 3.96s (client)`);
      lines.push(`${app.path} build: Static directory: .output/static`);
      lines.push(
        `${app.path} build: You can preview this build by node .output/index`,
      );
    }
    for (const app of [...batch].reverse())
      lines.push(`${app.path} build: Done`);
  }
  lines.push(
    `$ ${apps[10].buildScript}`,
    'ready   built in 0.33s (server)',
    'ready   built in 1.02s (client)',
    'Static directory: .output/static',
    'You can preview this build by node .output/index',
    '$ ultramodern-create ultramodern mf-types',
    '$ ultramodern-create ultramodern performance-readiness',
    'UltraModern performance configuration validation reported',
    '[ultramodern-browser-smoke] inventory release envelope has an unsupported release envelope schema.',
    `Command failed: node /repository/run-browser-smoke.mjs --project-dir ${projectDir} --platform node`,
  );
  return {
    options: { projectDir, applicationSourceRevision, rootBuildScript, apps },
    logText: `${lines.join('\n')}\n`,
  };
}

test('attributes eleven native Node chains without claiming acceptance statuses', async () => {
  const { parsePriorNodeBuildAttribution } = await attributionModule;
  const { options, logText } = fixture();
  const result = parsePriorNodeBuildAttribution(logText, options);
  assert.equal(result.commands.length, 11);
  assert.equal(
    result.applicationSourceRevision,
    options.applicationSourceRevision,
  );
  assert.equal(result.projectDirectory, options.projectDir);
  assert.deepEqual(result.rootBuild, {
    command: options.rootBuildScript,
    line: 5,
  });
  assert.deepEqual(
    result.commands.map(command => command.appId),
    options.apps.map(app => app.id),
  );
  for (const command of result.commands) {
    assert.equal(
      command.command,
      options.apps.find(app => app.id === command.appId).buildScript,
    );
    assert.ok(command.startLine < command.outputLines[0].line);
    assert.ok(command.outputLines[1].line < command.completedBy.line);
    assert.equal(Object.hasOwn(command, 'status'), false);
  }
  assert.equal(result.commands[0].completedBy.kind, 'pnpm-done');
  assert.equal(result.commands[10].completedBy.kind, 'subsequent-root-command');
});

test('normalizes ANSI and CRLF without changing source line numbers', async () => {
  const { parsePriorNodeBuildAttribution } = await attributionModule;
  const { options, logText } = fixture();
  const colored = logText
    .split('\n')
    .map(line => `\u001b[32m${line}\u001b[0m`)
    .join('\r\n');
  assert.deepEqual(
    parsePriorNodeBuildAttribution(colored, options),
    parsePriorNodeBuildAttribution(logText, options),
  );
});

test('rejects missing Done and compilation-only output', async () => {
  const { parsePriorNodeBuildAttribution } = await attributionModule;
  const { options, logText } = fixture();
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(
        logText.replace('verticals/inventory build: Done\n', ''),
        options,
      ),
    /inventory terminal Done/u,
  );
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(
        logText.replace(
          'verticals/inventory build: Static directory: .output/static\n',
          '',
        ),
        options,
      ),
    /inventory static-directory/u,
  );
});

test('rejects duplicate command and completion evidence', async () => {
  const { parsePriorNodeBuildAttribution } = await attributionModule;
  const { options, logText } = fixture();
  const start = `verticals/inventory build$ ${options.apps[4].buildScript}\n`;
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(
        logText.replace(start, `${start}${start}`),
        options,
      ),
    /inventory command/u,
  );
  const done = 'verticals/inventory build: Done\n';
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(
        logText.replace(done, `${done}${done}`),
        options,
      ),
    /inventory terminal Done/u,
  );
});

test('requires shell completion through the subsequent root command', async () => {
  const { parsePriorNodeBuildAttribution } = await attributionModule;
  const { options, logText } = fixture();
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(
        logText.replace('$ ultramodern-create ultramodern mf-types\n', ''),
        options,
      ),
    /shell must complete/u,
  );
  const changedRoot = options.rootBuildScript.replace(
    '&& pnpm mf:types',
    '; pnpm mf:types',
  );
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(logText, {
        ...options,
        rootBuildScript: changedRoot,
      }),
    /root build must reach/u,
  );
});

test('rejects another project, source revision or app script', async () => {
  const { parsePriorNodeBuildAttribution } = await attributionModule;
  const { options, logText } = fixture();
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(logText, {
        ...options,
        projectDir: '/retained/other-project',
      }),
    /different project/u,
  );
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(logText, {
        ...options,
        applicationSourceRevision: 'a'.repeat(40),
      }),
    /snapshot revision/u,
  );
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(
        logText.replace(
          'public-surface --app inventory --target dist --sync-route-metadata',
          'public-surface --app inventory --target stale --sync-route-metadata',
        ),
        options,
      ),
    /inventory logged build script/u,
  );
});

test('rejects failed or premature commands before the browser boundary', async () => {
  const { parsePriorNodeBuildAttribution } = await attributionModule;
  const { options, logText } = fixture();
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(
        logText.replace(
          'verticals/inventory build: Done',
          'verticals/inventory build: Error: deploy failed\nverticals/inventory build: Done',
        ),
        options,
      ),
    /build failed at line/u,
  );
  const premature = logText.replace(
    'verticals/inventory build: Done',
    '[ultramodern-browser-smoke] premature browser start\nverticals/inventory build: Done',
  );
  assert.throws(
    () => parsePriorNodeBuildAttribution(premature, options),
    /inventory terminal Done/u,
  );
});

test('rejects reversed evidence and unexpected app coverage', async () => {
  const { parsePriorNodeBuildAttribution } = await attributionModule;
  const { options, logText } = fixture();
  const start = `verticals/inventory build$ ${options.apps[4].buildScript}`;
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(
        logText
          .replace(start, `verticals/inventory build: Done\n${start}`)
          .replace(
            'verticals/inventory build: Done\nverticals/procurement build$',
            'verticals/procurement build$',
          ),
        options,
      ),
    /inventory terminal Done|Done precedes/u,
  );
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(
        logText.replace(
          'Scope: 10 of 14 workspace projects',
          'verticals/foreign build: Done',
        ),
        options,
      ),
    /unexpected app/u,
  );
  assert.throws(
    () =>
      parsePriorNodeBuildAttribution(logText, {
        ...options,
        apps: options.apps.slice(1),
      }),
    /ten verticals and one shell/u,
  );
});

test('reads a regular log and binds its original bytes', async t => {
  const { readPriorNodeBuildAttribution } = await attributionModule;
  const { options, logText } = fixture();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'source-node-attribution-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logPath = path.join(root, 'prior.log');
  fs.writeFileSync(logPath, logText);
  const result = readPriorNodeBuildAttribution(logPath, options);
  assert.deepEqual(
    { path: result.path, sha256: result.sha256, byteLength: result.byteLength },
    {
      path: logPath,
      sha256: crypto.createHash('sha256').update(logText).digest('hex'),
      byteLength: Buffer.byteLength(logText),
    },
  );
  assert.equal(result.attribution.commands.length, 11);
  assert.equal(result.text, logText);
  assert.equal(
    crypto.createHash('sha256').update(result.text).digest('hex'),
    result.sha256,
  );
  const alias = path.join(root, 'alias.log');
  fs.symlinkSync(logPath, alias);
  assert.throws(
    () => readPriorNodeBuildAttribution(alias, options),
    /regular non-symlink/u,
  );
  assert.throws(
    () => readPriorNodeBuildAttribution(root, options),
    /regular non-symlink/u,
  );
  const oversized = path.join(root, 'oversized.log');
  fs.writeFileSync(oversized, '');
  fs.truncateSync(oversized, 16 * 1024 * 1024 + 1);
  assert.throws(
    () => readPriorNodeBuildAttribution(oversized, options),
    /size bound/u,
  );
  const invalidUtf8 = path.join(root, 'invalid.log');
  fs.writeFileSync(invalidUtf8, Buffer.from([0xc3, 0x28]));
  assert.throws(
    () => readPriorNodeBuildAttribution(invalidUtf8, options),
    /encoded data|encoding/u,
  );
});

function cloudflareFixture() {
  const { options } = fixture();
  options.apps = options.apps.map(app => ({
    ...app,
    buildScript: `pnpm --dir ../.. exec ultramodern-create ultramodern public-surface --app ${app.id} --target cloudflare-dist --sync-route-metadata && cross-env MODERNJS_DEPLOY=cloudflare ultramodern build && pnpm --dir ../.. exec ultramodern-create ultramodern public-surface --app ${app.id} --target cloudflare-dist && cross-env MODERNJS_DEPLOY=cloudflare ultramodern deploy --skip-build && ultramodern-create ultramodern cloudflare-output-verify --app ${app.id}`,
  }));
  options.rootBuildScript =
    'ultramodern-create ultramodern typecheck --build packages/shared-contracts/tsconfig.json && ultramodern-create ultramodern typecheck --build packages/shared-design-tokens/tsconfig.json && pnpm -r --filter "./verticals/*" run cloudflare:build && pnpm --filter "./apps/custom-shell" run cloudflare:build && pnpm mf:types --target cloudflare && pnpm cloudflare-output:verify && pnpm cloudflare:ssr-proof';
  const lines = [
    `$ ${options.rootBuildScript}`,
    'Scope: 10 of 14 workspace projects',
  ];
  for (const batch of [
    options.apps.slice(0, 4),
    options.apps.slice(4, 8),
    options.apps.slice(8, 10),
  ]) {
    for (const app of batch)
      lines.push(`${app.path} cloudflare:build$ ${app.buildScript}`);
    for (const app of batch) {
      for (const environment of ['server', 'workerSSR', 'client']) {
        lines.push(
          `${app.path} cloudflare:build: ready   built in 1.02s (${environment})`,
        );
      }
      lines.push(
        `${app.path} cloudflare:build: [ultramodern] Cloudflare output verified: ${app.id}`,
      );
    }
    for (const app of [...batch].reverse())
      lines.push(`${app.path} cloudflare:build: Done`);
  }
  lines.push(
    `$ ${options.apps[10].buildScript}`,
    'ready   built in 0.32s (server)',
    'ready   built in 0.74s (workerSSR)',
    'ready   built in 0.99s (client)',
    'warn    Build warnings:',
    'ready   built in 0.39s (server)',
    'ready   built in 0.65s (workerSSR)',
    'ready   built in 0.90s (client)',
    'error   Error: [ultramodern-release-envelope] UI-only application emitted an undeclared API/backend artifact.',
    '[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @fixture/custom-shell@0.1.0 cloudflare:build failed',
    'Command failed: pnpm cloudflare:build',
  );
  return { options, logText: `${lines.join('\n')}\n` };
}

test('attributes ten verified Cloudflare remotes and a failed compiled shell without aggregate pass', async () => {
  const { parsePriorCloudflareBuildAttribution } = await attributionModule;
  const { options, logText } = cloudflareFixture();
  const result = parsePriorCloudflareBuildAttribution(logText, options);
  assert.equal(result.commands.length, 10);
  assert.equal(
    result.applicationSourceRevision,
    options.applicationSourceRevision,
  );
  assert.equal(result.projectDirectory, options.projectDir);
  assert.deepEqual(result.rootBuild, {
    command: options.rootBuildScript,
    line: 1,
  });
  assert.equal(result.shellAttempt.command, options.apps[10].buildScript);
  assert.equal(result.shellAttempt.compilerLines.length, 6);
  assert.match(
    result.shellAttempt.failure.text,
    /undeclared API\/backend artifact/u,
  );
  assert.equal(Object.hasOwn(result, 'passed'), false);
  assert.equal(Object.hasOwn(result.shellAttempt, 'completedBy'), false);
  for (const command of result.commands) {
    assert.equal(command.completedBy.kind, 'pnpm-done');
    assert.ok(command.startLine < command.outputLines[0].line);
    assert.ok(command.outputLines[0].line < command.completedBy.line);
  }
  const colored = logText
    .split('\n')
    .map(line => `\u001b[32m${line}\u001b[0m`)
    .join('\r\n');
  assert.deepEqual(
    parsePriorCloudflareBuildAttribution(colored, options),
    result,
  );
});

test('Cloudflare compilation alone cannot replace Done or output verification', async () => {
  const { parsePriorCloudflareBuildAttribution } = await attributionModule;
  const { options, logText } = cloudflareFixture();
  assert.throws(
    () =>
      parsePriorCloudflareBuildAttribution(
        logText.replace('verticals/inventory cloudflare:build: Done\n', ''),
        options,
      ),
    /inventory Cloudflare terminal Done/u,
  );
  assert.throws(
    () =>
      parsePriorCloudflareBuildAttribution(
        logText.replace(
          'verticals/inventory cloudflare:build: [ultramodern] Cloudflare output verified: inventory\n',
          '',
        ),
        options,
      ),
    /inventory Cloudflare output verification/u,
  );
});

test('Cloudflare attribution rejects duplicate, unexpected or changed remote commands', async () => {
  const { parsePriorCloudflareBuildAttribution } = await attributionModule;
  const { options, logText } = cloudflareFixture();
  const start = `verticals/inventory cloudflare:build$ ${options.apps[4].buildScript}\n`;
  assert.throws(
    () =>
      parsePriorCloudflareBuildAttribution(
        logText.replace(start, `${start}${start}`),
        options,
      ),
    /inventory Cloudflare command/u,
  );
  const done = 'verticals/inventory cloudflare:build: Done\n';
  assert.throws(
    () =>
      parsePriorCloudflareBuildAttribution(
        logText.replace(done, `${done}${done}`),
        options,
      ),
    /inventory Cloudflare terminal Done/u,
  );
  assert.throws(
    () =>
      parsePriorCloudflareBuildAttribution(
        logText.replace(
          'Scope: 10 of 14 workspace projects',
          'verticals/foreign cloudflare:build: Done',
        ),
        options,
      ),
    /unexpected Cloudflare remote/u,
  );
  assert.throws(
    () =>
      parsePriorCloudflareBuildAttribution(
        logText.replace(
          'cloudflare-output-verify --app inventory',
          'cloudflare-output-verify --app foreign',
        ),
        options,
      ),
    /inventory logged Cloudflare script/u,
  );
});

test('Cloudflare attribution rejects early failures and shell completion claims', async () => {
  const { parsePriorCloudflareBuildAttribution } = await attributionModule;
  const { options, logText } = cloudflareFixture();
  assert.throws(
    () =>
      parsePriorCloudflareBuildAttribution(
        logText.replace(
          'verticals/inventory cloudflare:build: Done',
          'verticals/inventory cloudflare:build: Error: deploy failed\nverticals/inventory cloudflare:build: Done',
        ),
        options,
      ),
    /Cloudflare remote build failed/u,
  );
  assert.throws(
    () =>
      parsePriorCloudflareBuildAttribution(
        logText.replace(
          'ready   built in 0.32s (server)',
          'Error: early shell failure\nready   built in 0.32s (server)',
        ),
        options,
      ),
    /shell failed before/u,
  );
  assert.throws(
    () =>
      parsePriorCloudflareBuildAttribution(
        `${logText}$ ultramodern-create ultramodern mf-types --target cloudflare\n`,
        options,
      ),
    /cannot reach a subsequent root command/u,
  );
  const classifier =
    'error   Error: [ultramodern-release-envelope] UI-only application emitted an undeclared API/backend artifact.\n';
  assert.throws(
    () =>
      parsePriorCloudflareBuildAttribution(
        logText.replace(classifier, `${classifier}${classifier}`),
        options,
      ),
    /classifier failure must occur exactly once/u,
  );
  assert.throws(
    () =>
      parsePriorCloudflareBuildAttribution(
        logText.replace(/ready {3}built in 0\.[0-9]+s \(workerSSR\)\n/gu, ''),
        options,
      ),
    /compilation evidence/u,
  );
});

test('Cloudflare reader preserves genuine raw text for durable parser replay', async t => {
  const {
    parsePriorCloudflareBuildAttribution,
    readPriorCloudflareBuildAttribution,
  } = await attributionModule;
  const { options, logText } = cloudflareFixture();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'cloudflare-attribution-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logPath = path.join(root, 'prior.log');
  fs.writeFileSync(logPath, logText);
  const result = readPriorCloudflareBuildAttribution(logPath, options);
  assert.equal(result.text, logText);
  assert.equal(result.byteLength, Buffer.byteLength(result.text));
  assert.equal(
    result.sha256,
    crypto.createHash('sha256').update(result.text).digest('hex'),
  );
  assert.deepEqual(
    result.attribution,
    parsePriorCloudflareBuildAttribution(result.text, options),
  );
});
