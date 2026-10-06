const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  collectLedgerEvidence,
  measureRule5Changes,
  parseLedgerEvidenceRows,
  renderLedgerEvidence,
  validateLedgerEvidenceForFile,
} = require('../divergence');
const { scanUpstreamOwnedForkImports } = require('../checker');

const entry = {
  path: 'packages/runtime/src/index.ts',
  owner: 'bleedingdev',
  reason: 'Preserve the native extension seam.',
  dispositions: ['inline-patch'],
};
const document = (entries = [entry]) =>
  `<!-- fork-evidence:v1 -->\n\`\`\`json\n${JSON.stringify({ schemaVersion: 1, entries })}\n\`\`\`\n<!-- /fork-evidence:v1 -->\n<!-- fork-evidence:table -->\n<!-- /fork-evidence:table -->\n`;
const legacy =
  '| Upstream-owned path | Owner | Reason | Disposition |\n| --- | --- | --- | --- |\n' +
  `| \`${entry.path}\` | ${entry.owner} | ${entry.reason} | \`inline-patch\` |\n`;
const git = (root, ...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const fixture = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init');
  git(root, 'config', 'user.email', 'fixture@example.test');
  git(root, 'config', 'user.name', 'Fixture');
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const commit = () => {
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'fixture');
    return git(root, 'rev-parse', 'HEAD');
  };
  return { root, write, commit };
};

const observedDivergence = () => {
  const child = require('node:child_process');
  const filename = require.resolve('../divergence');
  const savedModule = require.cache[filename];
  const savedSpawn = child.spawnSync;
  const calls = [];
  let fault;
  delete require.cache[filename];
  child.spawnSync = (command, args, options) => {
    const call = { command, args, root: options.cwd };
    if (command === 'git') {
      calls.push(call);
      const failure = fault?.(call);
      if (failure) return failure;
    }
    return savedSpawn(command, args, options);
  };
  let api;
  try {
    api = require(filename);
  } finally {
    child.spawnSync = savedSpawn;
    delete require.cache[filename];
    if (savedModule) require.cache[filename] = savedModule;
  }
  return {
    ...api,
    calls,
    setFault: value => {
      fault = value;
    },
  };
};

const historyFixture = t => {
  const repo = fixture(t);
  repo.write('packages/native/src/index.ts', 'export const native = true;\n');
  const base = repo.commit();
  const files = ['packages/native/src/gone.ts', 'packages/native/src/old.ts'];
  for (const file of files) repo.write(file, 'export const value = 1;\n');
  repo.commit();
  fs.rmSync(path.join(repo.root, files[0]));
  git(repo.root, 'mv', files[1], 'packages/native/src/renamed.ts');
  const head = repo.commit();
  return { ...repo, base, head, files };
};
const snapshotFor = (api, repo) =>
  api.createDivergenceSnapshot({
    baseRef: repo.base,
    upstreamRef: repo.base,
    pathspec: ['packages'],
    files: repo.files.map(file => ({ file, hunks: 1, changedLines: 1 })),
  });
const ancestryCalls = (api, ancestor, descendant, root) =>
  api.calls.filter(
    call =>
      call.args[1] === 'merge-base' &&
      call.args[2] === '--is-ancestor' &&
      call.args[3] === ancestor &&
      call.args[4] === descendant &&
      (!root || call.root === fs.realpathSync.native(root)),
  );
const historyCalls = (api, file, root) =>
  api.calls.filter(
    call =>
      call.args[1] === 'log' &&
      call.args.at(-1) === file &&
      (!root || call.root === fs.realpathSync.native(root)),
  );

test('one divergence operation reuses exact Git evidence, retaining deleted and renamed identities', t => {
  const repo = historyFixture(t);
  const api = observedDivergence();
  const snapshot = snapshotFor(api, repo);
  const validate = (input = snapshot, root = repo.root) =>
    api.validateDivergenceAllowlist(input, {
      rootDir: root,
      identityRef: repo.head,
    });
  api.runDivergenceOperation(() => {
    assert.deepEqual(validate(), validate());
    assert.equal(ancestryCalls(api, repo.base, repo.head, repo.root).length, 1);
    for (const file of repo.files) {
      const [call] = historyCalls(api, file, repo.root);
      assert.equal(historyCalls(api, file, repo.root).length, 1);
      assert.deepEqual(call.args, [
        '--literal-pathspecs',
        'log',
        '--format=',
        '--name-only',
        '-z',
        '-m',
        '--no-renames',
        repo.base + '..' + repo.head,
        '--',
        file,
      ]);
    }
    assert.throws(
      () => validate({ ...snapshot, totalChangedLines: 99 }),
      /mismatch/,
    );
    for (const file of [
      'packages/native/src/Old.ts',
      'packages/native/src/old.ts/nested',
      'packages/native/src',
    ]) {
      const invalid = api.createDivergenceSnapshot({
        baseRef: repo.base,
        upstreamRef: repo.base,
        pathspec: ['packages'],
        files: [{ file, hunks: 1, changedLines: 1 }],
      });
      assert.throws(() => validate(invalid), /neither a canonical/);
      assert.equal(historyCalls(api, file, repo.root).length, 1);
    }
    const other = fixture(t);
    git(other.root, 'fetch', repo.root, repo.head);
    git(other.root, 'reset', '--hard', 'FETCH_HEAD');
    assert.deepEqual(validate(snapshot, other.root), snapshot);
    assert.equal(
      ancestryCalls(api, repo.base, repo.head, other.root).length,
      1,
    );
    for (const file of repo.files)
      assert.equal(historyCalls(api, file, other.root).length, 1);
  });
});

test('divergence operations resolve moved refs freshly and discard evidence on every exit', t => {
  const repo = historyFixture(t);
  const api = observedDivergence();
  const snapshot = snapshotFor(api, repo);
  const validate = () =>
    api.validateDivergenceAllowlist(snapshot, {
      rootDir: repo.root,
      identityRef: 'HEAD',
    });
  validate();
  validate();
  assert.equal(
    historyCalls(api, repo.files[0]).length,
    2,
    'direct API invocations are independent',
  );
  api.calls.length = 0;
  assert.throws(
    () =>
      api.runDivergenceOperation(() => {
        validate();
        throw new Error('callback failed');
      }),
    /callback failed/,
  );
  validate();
  assert.equal(historyCalls(api, repo.files[0]).length, 2);
  api.calls.length = 0;
  assert.throws(
    () =>
      api.runDivergenceOperation(() => {
        validate();
        return Promise.resolve();
      }),
    /must be synchronous/,
  );
  validate();
  assert.equal(historyCalls(api, repo.files[0]).length, 2);
  api.calls.length = 0;
  api.runDivergenceOperation(() => {
    validate();
    git(repo.root, 'commit', '--allow-empty', '-m', 'move HEAD');
    const moved = git(repo.root, 'rev-parse', 'HEAD');
    validate();
    assert.notEqual(moved, repo.head);
    assert.equal(ancestryCalls(api, repo.base, repo.head).length, 1);
    assert.equal(ancestryCalls(api, repo.base, moved).length, 1);
    assert.equal(historyCalls(api, repo.files[0]).length, 2);
    assert.equal(
      api.calls.filter(
        call =>
          call.args[1] === 'rev-parse' && call.args.at(-1) === 'HEAD^{commit}',
      ).length,
      2,
    );
  });
  validate();
  assert.equal(
    historyCalls(api, repo.files[0]).length,
    3,
    'a fresh operation cannot retain previous evidence',
  );
});

test('failed ancestry and Git history queries never populate operation evidence', t => {
  const repo = historyFixture(t);
  const api = observedDivergence();
  const snapshot = snapshotFor(api, repo);
  const validate = () =>
    api.validateDivergenceAllowlist(snapshot, {
      rootDir: repo.root,
      identityRef: repo.head,
    });
  for (const kind of ['ancestry', 'history', 'spawn']) {
    api.calls.length = 0;
    let failures = 1;
    api.setFault(call => {
      const matches =
        kind === 'ancestry'
          ? call.args[1] === 'merge-base' &&
            call.args[3] === repo.base &&
            call.args[4] === repo.head
          : call.args[1] === 'log' && call.args.at(-1) === repo.files[0];
      if (!matches || failures === 0) return undefined;
      failures -= 1;
      return kind === 'spawn'
        ? { error: new Error('simulated Git spawn failure') }
        : { status: 1, stdout: '', stderr: 'simulated Git query failure' };
    });
    api.runDivergenceOperation(() => {
      assert.throws(
        validate,
        kind === 'ancestry'
          ? /identity target does not incorporate/
          : /simulated Git/,
      );
      assert.deepEqual(validate(), validate());
      assert.equal(
        ancestryCalls(api, repo.base, repo.head).length,
        kind === 'ancestry' ? 2 : 1,
      );
      assert.equal(
        historyCalls(api, repo.files[0]).length,
        kind === 'ancestry' ? 1 : 2,
      );
    });
    api.setFault(undefined);
    validate();
    assert.equal(
      historyCalls(api, repo.files[0]).length,
      kind === 'ancestry' ? 2 : 3,
    );
  }
});

test('strict current data rejects Markdown-only, malformed schema and policy smuggling', () => {
  assert.throws(() => parseLedgerEvidenceRows(legacy), /exactly one/);
  for (const update of [
    { path: 'packages/**/index.ts' },
    { path: 'packages/runtime/{a,b}.ts' },
    { owner: '\u200b' },
    { owner: '<!-- hidden -->' },
    { owner: '**<b></b>**' },
    { reason: '****' },
    { reason: 'n/a' },
    { dispositions: ['inline-patch extra'] },
    { dispositions: ['inline-patch', 'inline-patch'] },
    { extra: true },
  ])
    assert.throws(() =>
      parseLedgerEvidenceRows(document([{ ...entry, ...update }])),
    );
  assert.throws(
    () => parseLedgerEvidenceRows(document() + document()),
    /exactly one/,
  );
  assert.throws(
    () =>
      parseLedgerEvidenceRows(
        document().replace('"schemaVersion":1', '"schemaVersion":2'),
      ),
    /schema/,
  );
  const formatted = document([
    { ...entry, reason: ' Preserve  the native\n extension seam. ' },
  ]);
  assert.equal(
    parseLedgerEvidenceRows(formatted)[0].key,
    parseLedgerEvidenceRows(document())[0].key,
  );
  const rendered = renderLedgerEvidence(
    document([{ ...entry, reason: 'a | <b> `c`' }]),
  );
  assert.match(rendered, /a &#124; c/);
  assert.equal(renderLedgerEvidence(rendered), rendered);
});

test('historical migration does not launder old rows; only one changed semantic row authorizes', t => {
  const { root, write, commit } = fixture(t);
  write('FORK-DIVERGENCE.md', legacy);
  const base = commit();
  write('FORK-DIVERGENCE.md', document());
  let head = commit();
  let evidence = collectLedgerEvidence({
    rootDir: root,
    mergeBaseRef: base,
    headRef: head,
  });
  assert.equal(evidence.rows.length, 0);
  assert.match(
    validateLedgerEvidenceForFile({ evidence, file: entry.path }),
    /requires/,
  );
  const structuredBase = head;
  write(
    'FORK-DIVERGENCE.md',
    document([
      {
        ...entry,
        owner: `_${entry.owner}_`,
        reason: `**${entry.reason}** <!-- no new review -->`,
      },
    ]),
  );
  head = commit();
  for (const mergeBaseRef of [base, structuredBase]) {
    evidence = collectLedgerEvidence({
      rootDir: root,
      mergeBaseRef,
      headRef: head,
    });
    assert.equal(
      evidence.rows.length,
      0,
      'formatting grants no historical or structured evidence rights',
    );
    assert.match(
      validateLedgerEvidenceForFile({ evidence, file: entry.path }),
      /requires/,
    );
  }
  write(
    'FORK-DIVERGENCE.md',
    document([{ ...entry, reason: 'Review the changed implementation.' }]),
  );
  head = commit();
  evidence = collectLedgerEvidence({
    rootDir: root,
    mergeBaseRef: base,
    headRef: head,
  });
  assert.equal(
    validateLedgerEvidenceForFile({ evidence, file: entry.path }),
    null,
  );
  write(
    'FORK-DIVERGENCE.md',
    document([
      { ...entry, reason: 'One reason.' },
      { ...entry, reason: 'Another reason.' },
    ]),
  );
  head = commit();
  evidence = collectLedgerEvidence({
    rootDir: root,
    mergeBaseRef: base,
    headRef: head,
  });
  assert.match(
    validateLedgerEvidenceForFile({ evidence, file: entry.path }),
    /ambiguous/,
  );
});

test('every sidecar is fork-owned, so deleting one (even an empty file) is no Rule 5 change', t => {
  const { root, write, commit } = fixture(t);
  write(entry.path, 'export const value = "native";\n');
  const base = commit();
  write('packages/sidecar/vendored/package.json', '{}\n');
  write('packages/sidecar/vendored/dist/empty.mjs', '');
  const before = commit();
  fs.rmSync(path.join(root, 'packages/sidecar'), { recursive: true });
  const head = commit();
  assert.deepEqual(
    measureRule5Changes({
      rootDir: root,
      auditedBaseRef: base,
      upstreamRef: base,
      mergeBaseRef: before,
      headRef: head,
      pathspec: ['packages'],
    }),
    [],
  );
});

test('import and Rule 5 ownership survive renames; equal metrics do not count as shrink', t => {
  const { root, write, commit } = fixture(t);
  const stable =
    'export const preservedNativeOne = 1;\nexport const preservedNativeTwo = 2;\nexport const preservedNativeThree = 3;\n';
  write(entry.path, stable + 'export const value = "native";\n');
  const base = commit();
  write(entry.path, stable + 'export const value = "fork-a";\n');
  const before = commit();
  write(entry.path, stable + 'export const value = "fork-b";\n');
  let head = commit();
  const changes = () =>
    measureRule5Changes({
      rootDir: root,
      auditedBaseRef: base,
      upstreamRef: base,
      mergeBaseRef: before,
      headRef: head,
      pathspec: ['packages'],
    });
  assert.equal(changes()[0].genuineShrink, false);
  const renamed = 'packages/runtime/src/renamed.ts';
  git(root, 'mv', entry.path, renamed);
  head = commit();
  const [change] = changes();
  assert.equal(change.file, entry.path);
  assert.equal(change.renamed, true);
  assert.equal(change.genuineShrink, false);
  write(renamed, stable + 'import "@modern-js/plugin-tanstack";\n');
  assert.equal(
    scanUpstreamOwnedForkImports({ rootDir: root, baseRef: base }).violations[0]
      .file,
    renamed,
  );
  head = commit();
  assert.equal(
    scanUpstreamOwnedForkImports({
      rootDir: root,
      baseRef: base,
      headRef: head,
    }).violations[0].file,
    renamed,
  );
});

test('native request ownership preserves policy, alias, unknown-file and symlink rejection', t => {
  const { root, write, commit } = fixture(t);
  const {
    DEFAULT_BASE_REF,
    isNativeCreateRequestPackage,
  } = require('../checker');
  const repository = path.resolve(__dirname, '../../..');
  const packageRoot = 'packages/server/create-request';
  const files = git(
    repository,
    'ls-tree',
    '-r',
    '--name-only',
    DEFAULT_BASE_REF,
    '--',
    `${packageRoot}/src`,
    `${packageRoot}/package.json`,
  ).split('\n');
  for (const file of files)
    write(file, git(repository, 'show', `${DEFAULT_BASE_REF}:${file}`));
  write(entry.path, 'export const native = true;');
  const baseRef = commit();
  for (const file of fs.readdirSync(
    path.join(repository, packageRoot, 'src'),
  )) {
    write(
      `${packageRoot}/src/${file}`,
      fs.readFileSync(path.join(repository, packageRoot, 'src', file), 'utf8'),
    );
  }
  const manifest = fs.readFileSync(
    path.join(repository, packageRoot, 'package.json'),
    'utf8',
  );
  write(`${packageRoot}/package.json`, manifest);
  const check = () => isNativeCreateRequestPackage({ rootDir: root, baseRef });
  assert.equal(check(), true);
  const imports = () =>
    scanUpstreamOwnedForkImports({
      rootDir: root,
      baseRef,
      files: [entry.path],
    });
  write(
    entry.path,
    "export { createRequest } from '@modern-js/create-request';",
  );
  assert.equal(imports().violations.length, 0);
  for (const reference of [
    "import * as request from '@modern-js/create-request';",
    "import('@modern-js/create-request');",
    "import { createRequest } from '@modern-js/create-request/src/node';",
  ]) {
    write(entry.path, reference);
    assert.equal(imports().violations.length, 1);
  }
  const source = `${packageRoot}/src/node.ts`;
  const original = fs.readFileSync(path.join(root, source), 'utf8');
  write(source, original + '\nconst policy = { ["identityBinding"]: true };');
  assert.equal(check(), false);
  write(source, original);
  const aliased = JSON.parse(manifest);
  aliased.dependencies.qs = 'npm:some-fork-policy@1';
  write(`${packageRoot}/package.json`, JSON.stringify(aliased));
  assert.equal(check(), false);
  write(`${packageRoot}/package.json`, manifest);
  write(`${packageRoot}/src/unreviewed.ts`, 'export const policy = true;');
  assert.equal(check(), false);
  fs.rmSync(path.join(root, packageRoot, 'src/unreviewed.ts'));
  fs.rmSync(path.join(root, source));
  fs.symlinkSync('browser.ts', path.join(root, source));
  assert.equal(check(), false);
});
