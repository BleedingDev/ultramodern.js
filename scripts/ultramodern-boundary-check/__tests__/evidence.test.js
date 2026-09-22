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
