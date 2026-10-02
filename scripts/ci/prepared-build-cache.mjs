import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const format = 1;
const storage = '.ci-build-cache';
const generatedTracked = new Set([
  'packages/runtime/plugin-runtime/static/modern-inline.js',
  'packages/runtime/plugin-runtime/static/modern-run-router-data-fn.js',
  'packages/runtime/plugin-runtime/static/modern-run-window-fn.js',
]);
const hash = value => createHash('sha256').update(value).digest('hex');
const gitFiles = root =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .sort();

function safePath(value) {
  return (
    typeof value === 'string' &&
    /^(packages|scripts)\//u.test(value) &&
    !/[\\:\0]/u.test(value) &&
    !value
      .split('/')
      .some(
        part =>
          !part || part === '.' || part === '..' || part === 'node_modules',
      )
  );
}

function fingerprint(root, file) {
  const location = path.join(root, file);
  const stat = fs.lstatSync(location);
  if (stat.isSymbolicLink()) {
    return {
      type: 'symlink',
      digest: hash(fs.readlinkSync(location)),
      mode: stat.mode & 0o777,
    };
  }
  if (!stat.isFile()) throw new Error(`Unsupported input file: ${file}`);
  return {
    type: 'file',
    digest: hash(fs.readFileSync(location)),
    mode: stat.mode & 0o777,
  };
}

export function buildInputs(root, environment = process.env, toolchain = {}) {
  // Hash tracked source content, rather than the commit: a tests-only PR can
  // reuse the exact prepared packages from its base. Root configuration and
  // every shared package/build script remain part of the identity.
  const files = gitFiles(root).filter(
    file =>
      !file.startsWith('tests/') && !file.startsWith('.github/workflows/'),
  );
  const inputs = Object.fromEntries(
    files.map(file => [file, fingerprint(root, file)]),
  );
  const runtime = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    pnpm:
      toolchain.pnpm ??
      execFileSync('pnpm', ['--version'], {
        cwd: root,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      }).trim(),
    environment: Object.fromEntries(
      [
        'CI',
        'NODE_ENV',
        'NODE_OPTIONS',
        'BROWSERSLIST_ENV',
        'SOURCE_DATE_EPOCH',
        'ULTRAMODERN_RELEASE_LANE',
        'SKIP_DTS',
      ].map(name => [name, environment[name] ?? '']),
    ),
    ...toolchain,
  };
  const key = `test-build-v${format}-${runtime.platform}-${runtime.arch}-${runtime.node}-${hash(JSON.stringify({ inputs, runtime }))}`;
  return { format, key, inputs, runtime };
}

function outputFiles(root) {
  const files = [];
  function visit(relative) {
    const directory = path.join(root, relative);
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        [
          'node_modules',
          '.git',
          '.nx',
          '.cache',
          '.rspress',
          '.test-tmp',
        ].includes(entry.name)
      )
        continue;
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else files.push(file);
    }
  }
  visit('packages');
  visit('scripts');
  return files.sort();
}

export function snapshotBuild(root, baseline) {
  const directory = path.join(root, storage, 'snapshot');
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  const outputs = {};
  for (const file of outputFiles(root)) {
    const entry = fingerprint(root, file);
    if (JSON.stringify(entry) === JSON.stringify(baseline.inputs[file]))
      continue;
    if (baseline.inputs[file] && !generatedTracked.has(file))
      throw new Error(`Build changed a tracked input file: ${file}`);
    if (entry.type !== 'file')
      throw new Error(`Build output must be a regular file: ${file}`);
    if (!safePath(file)) throw new Error(`Unsafe build output: ${file}`);
    outputs[file] = entry;
    const target = path.join(directory, 'files', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
    fs.chmodSync(target, entry.mode);
  }
  if (!Object.keys(outputs).length)
    throw new Error('Build produced no cacheable outputs');
  for (const file of Object.keys(baseline.inputs)) {
    if (!fs.existsSync(path.join(root, file)))
      throw new Error(`Build deleted an input file: ${file}`);
  }
  const manifest = {
    format,
    key: baseline.key,
    count: Object.keys(outputs).length,
    digest: hash(JSON.stringify(outputs)),
    outputs,
  };
  fs.writeFileSync(
    path.join(directory, 'manifest.json'),
    `${JSON.stringify(manifest)}\n`,
  );
  return manifest;
}

export function restoreBuild(root, expectedKey) {
  const directory = path.join(root, storage, 'snapshot');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.format !== format ||
    manifest.key !== expectedKey ||
    !manifest.outputs ||
    !Object.keys(manifest.outputs).length ||
    manifest.count !== Object.keys(manifest.outputs).length ||
    manifest.digest !== hash(JSON.stringify(manifest.outputs))
  ) {
    throw new Error('Prepared build cache identity or manifest is invalid');
  }
  // Validate every file before copying any. A partial or corrupt archive
  // falls back to the normal build without installing partial outputs.
  const destinations = new Set();
  for (const [file, expected] of Object.entries(manifest.outputs)) {
    if (!safePath(file) || expected.type !== 'file')
      throw new Error(`Unsafe cached output: ${file}`);
    const normalized = process.platform === 'win32' ? file.toLowerCase() : file;
    if (destinations.has(normalized))
      throw new Error(`Duplicate cached destination: ${file}`);
    destinations.add(normalized);
    let archiveParent = path.dirname(path.join(directory, 'files', file));
    while (archiveParent !== root) {
      if (fs.lstatSync(archiveParent).isSymbolicLink())
        throw new Error(`Symlink parent in cache archive: ${file}`);
      archiveParent = path.dirname(archiveParent);
    }
    const actual = fingerprint(path.join(directory, 'files'), file);
    if (
      actual.type !== 'file' ||
      actual.digest !== expected.digest ||
      actual.mode !== expected.mode
    )
      throw new Error(`Corrupt cached output: ${file}`);
    let parent = path.dirname(path.join(root, file));
    while (parent !== root) {
      if (fs.existsSync(parent) && !fs.lstatSync(parent).isDirectory())
        throw new Error(`Invalid parent for cached output: ${file}`);
      if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink())
        throw new Error(`Symlink parent for cached output: ${file}`);
      parent = path.dirname(parent);
    }
    if (
      fs.existsSync(path.join(root, file)) &&
      !fs.lstatSync(path.join(root, file)).isFile()
    )
      throw new Error(`Invalid destination for cached output: ${file}`);
    if (
      fs.existsSync(path.join(root, file)) &&
      fs.lstatSync(path.join(root, file)).isSymbolicLink()
    )
      throw new Error(`Symlink destination for cached output: ${file}`);
  }
  for (const [file, entry] of Object.entries(manifest.outputs)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(directory, 'files', file), target);
    fs.chmodSync(target, entry.mode);
  }
  return Object.keys(manifest.outputs).length;
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  else console.log(`${name}=${value}`);
}

function main() {
  const root = process.cwd();
  const command = process.argv[2];
  const inputPath = path.join(root, storage, 'inputs.json');
  if (command === 'key') {
    const inputs = buildInputs(root);
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.writeFileSync(inputPath, JSON.stringify(inputs));
    output('key', inputs.key);
  } else if (command === 'snapshot') {
    const baseline = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const manifest = snapshotBuild(root, baseline);
    console.log(
      `Prepared ${Object.keys(manifest.outputs).length} build output files`,
    );
  } else if (command === 'restore') {
    try {
      const baseline = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      console.log(
        `Restored ${restoreBuild(root, baseline.key)} validated build output files`,
      );
      output('cache-hit', 'true');
    } catch (error) {
      console.warn(`Prepared build cache unavailable: ${error.message}`);
      output('cache-hit', 'false');
    }
  } else
    throw new Error('Usage: prepared-build-cache.mjs key|snapshot|restore');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
