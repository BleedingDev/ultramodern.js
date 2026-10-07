import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const bracesCorrection = Object.freeze({
  id: 'GHSA-vfj7-8cjw-p6xm',
  package: 'braces',
  version: '3.0.3',
  correction: 'repository-braces-depth-bound',
  owner: 'bleedingdev',
  expires: '2026-11-06',
  patchPath: 'patches/braces@3.0.3.patch',
  patchSha256:
    'e14af28f138a243a283deed5e9f26275891ad6eedc02e964d8ec7ae7efc6783a',
  integrity:
    'sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==',
  tarball: 'https://registry.npmjs.org/braces/-/braces-3.0.3.tgz',
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function captureCorrectionSourceFiles(root, relativePaths) {
  const inspect = relativePath => {
    assert.ok(
      !path.isAbsolute(relativePath) &&
        !relativePath.split(/[\\/]/u).includes('..'),
      'correction source path must stay inside the repository',
    );
    const file = path.join(root, relativePath);
    assert.equal(
      fs.realpathSync(file),
      file,
      `correction source must be physical: ${relativePath}`,
    );
    const before = fs.lstatSync(file, { bigint: true });
    assert.ok(
      before.isFile(),
      `correction source must be a regular file: ${relativePath}`,
    );
    const identity = stat =>
      ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].map(key =>
        String(stat[key]),
      );
    const descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    let bytes;
    try {
      assert.deepEqual(
        identity(fs.fstatSync(descriptor, { bigint: true })),
        identity(before),
        `correction source changed while opening: ${relativePath}`,
      );
      bytes = fs.readFileSync(descriptor);
      assert.deepEqual(
        identity(fs.fstatSync(descriptor, { bigint: true })),
        identity(before),
        `correction source changed while reading: ${relativePath}`,
      );
    } finally {
      fs.closeSync(descriptor);
    }
    assert.deepEqual(
      identity(fs.lstatSync(file, { bigint: true })),
      identity(before),
      `correction source changed while reading: ${relativePath}`,
    );
    return {
      path: relativePath,
      sha256: sha256(bytes),
      identity: identity(before),
    };
  };
  const files = [...relativePaths].sort().map(inspect);
  return {
    files,
    assertUnchanged() {
      assert.deepEqual(
        files.map(entry => inspect(entry.path)),
        files,
        'braces correction source identity drift',
      );
    },
  };
}
const policyKeys = [
  'correction',
  'expires',
  'id',
  'owner',
  'package',
  'parents',
  'reason',
  'remediation',
  'version',
].sort();

export function assertBracesCorrectionPolicy(entry, now = new Date()) {
  assert.deepEqual(
    Object.keys(entry ?? {}).sort(),
    policyKeys,
    'braces correction policy must have the exact closed fields',
  );
  for (const field of [
    'id',
    'package',
    'version',
    'correction',
    'owner',
    'expires',
  ]) {
    assert.equal(
      entry[field],
      bracesCorrection[field],
      `braces correction ${field}`,
    );
  }
  assert.deepEqual(
    entry.parents,
    ['chokidar', 'micromatch'],
    'braces correction parents',
  );
  for (const field of ['reason', 'remediation']) {
    assert.ok(
      typeof entry[field] === 'string' && entry[field].trim().length > 0,
      `braces correction ${field} is required`,
    );
  }
  assert.ok(
    Number.isFinite(now.getTime()),
    'braces correction time is invalid',
  );
  assert.ok(
    now.toISOString().slice(0, 10) <= entry.expires,
    'braces correction expired',
  );
}

export function assertBracesCorrectionFindings(advisory) {
  assert.equal(
    advisory?.github_advisory_id,
    bracesCorrection.id,
    'braces correction advisory',
  );
  assert.equal(
    advisory.module_name,
    bracesCorrection.package,
    'braces correction package',
  );
  assert.ok(
    Array.isArray(advisory.findings) && advisory.findings.length > 0,
    'braces correction requires nonempty findings',
  );
  const paths = [];
  for (const finding of advisory.findings) {
    assert.equal(
      finding.version,
      bracesCorrection.version,
      'braces correction finding version',
    );
    assert.ok(
      Array.isArray(finding.paths) && finding.paths.length > 0,
      'braces correction requires nonempty finding paths',
    );
    for (const dependencyPath of finding.paths) {
      assert.ok(typeof dependencyPath === 'string', 'braces correction path');
      const chain = dependencyPath.split('>');
      assert.ok(
        chain.length >= 2 &&
          chain.every(part => part.length > 0) &&
          chain.at(-1) === 'braces' &&
          ['chokidar', 'micromatch'].includes(chain.at(-2)),
        'braces correction finding parent',
      );
      paths.push(dependencyPath);
    }
  }
  return [...new Set(paths)].sort();
}

function payloadFiles(directory) {
  const files = new Map();
  function visit(current) {
    for (const name of fs.readdirSync(current).sort()) {
      const entry = path.join(current, name);
      const stat = fs.lstatSync(entry);
      assert.ok(!stat.isSymbolicLink(), `braces reference symlink: ${entry}`);
      if (stat.isDirectory()) visit(entry);
      else {
        assert.ok(stat.isFile(), `braces reference non-file: ${entry}`);
        files.set(
          path.relative(directory, entry).split(path.sep).join('/'),
          fs.readFileSync(entry),
        );
      }
    }
  }
  visit(directory);
  return files;
}

export function assertBracesDepthRegressions(packageRoot) {
  const require = createRequire(path.join(packageRoot, 'package.json'));
  const braces = require(path.join(packageRoot, 'index.js'));
  const deepAst = depth => {
    let node = { type: 'root', nodes: [] };
    for (let index = 0; index < depth; index++)
      node = { type: 'root', nodes: [node] };
    return node;
  };
  const rejectDepth = error =>
    error instanceof SyntaxError &&
    error.message === 'AST nesting depth exceeds the maximum of 100';
  for (const [open, close] of [
    ['{', '}'],
    ['(', ')'],
  ]) {
    assert.doesNotThrow(() =>
      braces.parse(open.repeat(100) + 'x' + close.repeat(100)),
    );
    assert.throws(
      () => braces.parse(open.repeat(101) + 'x' + close.repeat(101)),
      rejectDepth,
    );
  }
  for (const method of ['compile', 'expand', 'stringify']) {
    assert.doesNotThrow(
      () => braces[method](deepAst(100)),
      `braces ${method} depth100`,
    );
    assert.throws(
      () => braces[method](deepAst(101)),
      rejectDepth,
      `braces ${method} depth101`,
    );
  }
  assert.deepEqual(braces.expand('file-{a,b}.js'), ['file-a.js', 'file-b.js']);
  return {
    packageRoot,
    parse: true,
    compile: true,
    expand: true,
    stringify: true,
    ordinaryExpansion: true,
  };
}

export function assertBracesArchiveIntegrity(bytes) {
  assert.equal(
    `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    bracesCorrection.integrity,
    'braces upstream archive integrity',
  );
}

async function authenticatedReference(patchBytes) {
  const response = await fetch(bracesCorrection.tarball, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `braces upstream fetch failed: ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(
      size <= 1024 * 1024,
      'braces upstream archive exceeds its size bound',
    );
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  assertBracesArchiveIntegrity(bytes);
  const scratch = fs.mkdtempSync(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'ultramodern-braces-reference-',
    ),
  );
  const cleanup = () => fs.rmSync(scratch, { recursive: true, force: true });
  const terminate = signal => {
    cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const interrupt = () => terminate('SIGINT');
  const stop = () => terminate('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', stop);
  try {
    const tarball = path.join(scratch, 'upstream.tgz');
    fs.writeFileSync(tarball, bytes);
    execFileSync('tar', ['-xzf', tarball, '-C', scratch], { stdio: 'pipe' });
    const packageRoot = path.join(scratch, 'package');
    const manifestBytes = fs.readFileSync(
      path.join(packageRoot, 'package.json'),
    );
    const manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.name, 'braces');
    assert.equal(manifest.version, '3.0.3');
    execFileSync(
      'patch',
      ['-p1', '-E', '--fuzz=0', '--batch', '--no-backup-if-mismatch'],
      {
        cwd: packageRoot,
        input: patchBytes,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    assert.deepEqual(
      fs.readFileSync(path.join(packageRoot, 'package.json')),
      manifestBytes,
      'braces reference must preserve its upstream manifest',
    );
    return payloadFiles(packageRoot);
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', stop);
    cleanup();
  }
}

export async function prepareRepositoryBracesCorrection({
  cwd,
  exception,
  now = new Date(),
}) {
  const root = fs.realpathSync(repositoryRoot);
  assert.equal(
    fs.realpathSync(cwd),
    root,
    'braces correction is restricted to its physical repository',
  );
  assertBracesCorrectionPolicy(exception, now);
  const sourcePaths = [
    'scripts/security/advisory-exceptions.json',
    'scripts/security/braces-correction.mjs',
    'scripts/security/braces-installed-graph.mjs',
    'scripts/security/advisory-gate.mjs',
    'scripts/ultramodern-supply/sidecars.json',
    'packages/toolkit/ultramodern-create/src/ultramodern-workspace/patch-inventory.ts',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    bracesCorrection.patchPath,
  ];
  const source = captureCorrectionSourceFiles(root, sourcePaths);
  const sourceFiles = source.files;
  const policy = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        sourcePaths.find(p => p.endsWith('advisory-exceptions.json')),
      ),
    ),
  );
  assert.deepEqual(
    policy.filter(entry => entry.id === bracesCorrection.id),
    [exception],
    'braces correction must be the committed repository policy',
  );
  const inventoryPath =
    'packages/toolkit/ultramodern-create/src/ultramodern-workspace/patch-inventory.ts';
  const inventorySha256 = sourceFiles.find(
    entry => entry.path === inventoryPath,
  ).sha256;
  const { default: inventory } = await import(
    `${new URL(`../../${inventoryPath}`, import.meta.url).href}?correction=${inventorySha256}`
  );
  const patch = inventory.find(entry => entry.packageName === 'braces');
  assert.ok(
    patch?.repository === true && patch.workspace === null,
    'braces correction requires its repository-only managed patch',
  );
  assert.equal(patch.version, bracesCorrection.version);
  assert.equal(patch.path, bracesCorrection.patchPath);
  assert.equal(patch.sha256, bracesCorrection.patchSha256);
  const patchBytes = fs.readFileSync(path.join(root, patch.path));
  assert.equal(
    sha256(patchBytes),
    bracesCorrection.patchSha256,
    'braces canonical patch integrity',
  );
  const recipes = JSON.parse(
    fs.readFileSync(
      path.join(root, 'scripts/ultramodern-supply/sidecars.json'),
    ),
  );
  const recipe = (Array.isArray(recipes) ? recipes : recipes.recipes).find(
    entry => entry.id === 'braces',
  );
  assert.equal(recipe?.upstream.name, 'braces');
  assert.equal(recipe.upstream.version, bracesCorrection.version);
  assert.equal(recipe.upstream.integrity, bracesCorrection.integrity);
  assert.equal(recipe.upstream.tarball, bracesCorrection.tarball);
  assert.deepEqual(recipe.patch, { inventory: 'braces@3.0.3' });
  assert.deepEqual(recipe.artifacts, ['*']);
  const referenceFiles = await authenticatedReference(patchBytes);
  const { inspectInstalledBracesGraph } = await import(
    './braces-installed-graph.mjs'
  );
  const graph = inspectInstalledBracesGraph({
    root,
    expectedIntegrity: bracesCorrection.integrity,
    patchSha256: bracesCorrection.patchSha256,
    referenceFiles,
  });
  const regressions = graph.targets.map(assertBracesDepthRegressions);
  const proof = {
    schemaVersion: 1,
    correction: bracesCorrection.correction,
    id: bracesCorrection.id,
    package: 'braces',
    version: '3.0.3',
    owner: exception.owner,
    reason: exception.reason,
    remediation: exception.remediation,
    expires: exception.expires,
    upstreamIntegrity: bracesCorrection.integrity,
    patchSha256: bracesCorrection.patchSha256,
    sourceFiles,
    identities: graph.identities,
    installedFiles: graph.digests,
    regressions,
  };
  const proofSha256 = sha256(JSON.stringify(proof));
  const assertUnchanged = () => {
    assertBracesCorrectionPolicy(exception);
    source.assertUnchanged();
    graph.assertUnchanged();
    assert.equal(
      sha256(JSON.stringify(proof)),
      proofSha256,
      'braces correction proof drift',
    );
  };
  assertUnchanged();
  return {
    proof: { ...proof, proofSha256 },
    assertUnchanged,
    acknowledges(advisory) {
      assertBracesCorrectionFindings(advisory);
      return true;
    },
  };
}
