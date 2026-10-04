import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  rewriteSidecarConsumerAliases,
  sidecarAliasEntries,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/sidecars.mjs';

export const REACT_BASELINE_SUITES = Object.freeze([
  'integration/routes-tanstack-mf/test/index.test.ts',
  'integration/routes-tanstack-rsc/tests/index.test.ts',
  'integration/ssr/tests/useid.test.ts',
  'integration/ssr/tests/streaming.test.ts',
]);

const baselineInputs = Object.freeze([
  'tests/utils',
  'tests/rstest.config.mts',
  'tests/tsconfig.json',
  'tests/package.json',
  'tests/integration/routes-tanstack-mf',
  'tests/integration/routes-tanstack-rsc',
  'tests/integration/ssr/tests/useid.test.ts',
  'tests/integration/ssr/tests/streaming.test.ts',
  'tests/integration/ssr/fixtures/ssr-useid',
  'tests/integration/ssr/fixtures/streaming',
]);

const exactVersion =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*))*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/u;

function relativeInput(value) {
  assert.ok(
    typeof value === 'string' &&
      value.length > 0 &&
      !path.posix.isAbsolute(value) &&
      !value.includes('\\') &&
      !/[\0\r\n]/u.test(value) &&
      !value.startsWith(':') &&
      value
        .split('/')
        .every(part => part !== '' && part !== '.' && part !== '..'),
    `Invalid tracked React baseline input: ${String(value)}`,
  );
  assert.ok(
    !value
      .split('/')
      .some(
        part =>
          part === 'node_modules' ||
          part === 'dist' ||
          part.startsWith('dist-') ||
          part === 'build' ||
          part === 'coverage' ||
          part === '.cache' ||
          part === '.modern-js' ||
          part === '.modern',
      ),
    `React baseline input is a dependency or build output: ${value}`,
  );
  return value;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function ordinaryFile(root, relativePath, directories) {
  const parts = relativeInput(relativePath).split('/');
  let directory = root;
  assert.ok(
    fs.lstatSync(root).isDirectory(),
    `Expected ordinary directory: ${root}`,
  );
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    const stat = fs.lstatSync(directory);
    assert.ok(
      stat.isDirectory(),
      `Expected ordinary input directory: ${directory}`,
    );
    directories?.set(directory, stat);
  }
  const file = path.join(directory, parts.at(-1));
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile(), `Expected ordinary input file: ${file}`);
  return { file, stat };
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function trackedReactBaselineInputFiles(repoRoot, inputs) {
  assert.ok(
    Array.isArray(inputs) && inputs.length > 0,
    'React baseline inputs must be a nonempty path array',
  );
  const requested = inputs.map(relativeInput);
  const output = execFileSync(
    'git',
    ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...requested],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const files = new Set();
  for (const entry of output.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) [\da-f]+ 0\t([\s\S]+)$/u.exec(entry);
    assert.ok(
      match,
      `React baseline inputs must be ordinary tracked files: ${entry}`,
    );
    files.add(relativeInput(match[2]));
  }
  for (const input of requested) {
    assert.ok(
      [...files].some(file => file === input || file.startsWith(`${input}/`)),
      `React baseline input has no tracked files: ${input}`,
    );
  }
  return [...files].sort();
}

/** Copy only tracked authored inputs into a fresh consumer, preserving their bytes. */
export function stageReactBaselineInputs({
  repoRoot,
  workDir,
  inputs = baselineInputs,
}) {
  assert.ok(
    path.isAbsolute(repoRoot ?? '') && path.isAbsolute(workDir ?? ''),
    'React baseline staging requires absolute repository and work directory paths',
  );
  const sourceRoot = fs.realpathSync(repoRoot);
  const destinationRoot = path.join(
    fs.realpathSync(path.dirname(workDir)),
    path.basename(workDir),
  );
  assert.ok(
    !isWithin(sourceRoot, destinationRoot) &&
      !isWithin(destinationRoot, sourceRoot),
    'React baseline work directory must be separate from the source repository',
  );
  const directories = new Map();
  const sources = trackedReactBaselineInputFiles(sourceRoot, inputs).map(
    relativePath => ({
      relativePath,
      ...ordinaryFile(sourceRoot, relativePath, directories),
    }),
  );
  if (fs.existsSync(destinationRoot)) {
    assert.ok(
      fs.lstatSync(destinationRoot).isDirectory(),
      'React baseline work directory must be an ordinary directory',
    );
    assert.equal(
      fs.readdirSync(destinationRoot).length,
      0,
      'React baseline work directory must be fresh and empty',
    );
  } else {
    fs.mkdirSync(destinationRoot, { recursive: true });
  }
  const inputFiles = sources.map(({ relativePath, file, stat }) => {
    const destination = path.join(destinationRoot, relativePath);
    const expectedDigest = sha256(file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
    const digest = sha256(destination);
    assert.equal(
      digest,
      expectedDigest,
      `React baseline copy differs: ${relativePath}`,
    );
    fs.chmodSync(destination, stat.mode & 0o7777);
    fs.utimesSync(destination, stat.atime, stat.mtime);
    return Object.freeze({ relativePath, sha256: digest });
  });
  // Restore directory metadata after their entries have been created.
  for (const [directory, stat] of [...directories].sort(
    ([left], [right]) =>
      right.split(path.sep).length - left.split(path.sep).length,
  )) {
    const destination = path.join(
      destinationRoot,
      path.relative(sourceRoot, directory),
    );
    fs.chmodSync(destination, stat.mode & 0o7777);
    fs.utimesSync(destination, stat.atime, stat.mtime);
  }
  return Object.freeze({
    workDir: destinationRoot,
    testsDir: path.join(destinationRoot, 'tests'),
    inputFiles: Object.freeze(inputFiles),
    fixturePackagePaths: Object.freeze(
      inputFiles
        .filter(
          item =>
            item.relativePath.startsWith('tests/integration/') &&
            item.relativePath.endsWith('/package.json'),
        )
        .map(item => path.join(destinationRoot, item.relativePath)),
    ),
  });
}

/** Check copied inputs only; ordinary dependency and build additions are permitted. */
export function assertReactBaselineInputsUnchanged(
  stage,
  root = stage.workDir,
) {
  assert.ok(
    path.isAbsolute(root ?? '') && Array.isArray(stage.inputFiles),
    'React baseline input verification requires a stage and absolute root',
  );
  for (const input of stage.inputFiles) {
    assert.match(input.sha256, /^[\da-f]{64}$/u, 'Invalid staged input SHA256');
    const { file } = ordinaryFile(root, input.relativePath);
    assert.equal(
      sha256(file),
      input.sha256,
      `React baseline input changed: ${input.relativePath}`,
    );
  }
}

/** Pin canonical slots and maintained names using the verified publication mapping. */
export function createReactBaselineTransportOverrides(
  release,
  sidecars = release.sidecars?.packages ?? [],
) {
  assert.ok(
    Array.isArray(release.packages) && release.packages.length > 0,
    'React baseline transport requires actual release packages',
  );
  assert.ok(
    Array.isArray(sidecars),
    'React baseline sidecars must be an array',
  );
  const overrides = new Map();
  const add = (name, specifier) => {
    assert.ok(
      typeof name === 'string' &&
        name.length > 0 &&
        typeof specifier === 'string' &&
        specifier.length > 0,
      'React baseline transport requires package names and specifiers',
    );
    assert.ok(
      !overrides.has(name) || overrides.get(name) === specifier,
      `Conflicting React baseline transport mapping for ${name}`,
    );
    overrides.set(name, specifier);
  };
  for (const item of release.packages) {
    assert.match(
      item.version,
      exactVersion,
      'Framework transport version must be exact',
    );
    if (release.aliases !== undefined) {
      assert.equal(
        release.aliases[item.sourceName],
        item.targetName,
        `Framework alias differs from the verified release: ${item.sourceName}`,
      );
    }
    add(item.sourceName, `npm:${item.targetName}@${item.version}`);
    add(item.targetName, item.version);
  }
  const recipes = JSON.parse(
    fs.readFileSync(
      new URL('../../ultramodern-supply/sidecars.json', import.meta.url),
      'utf8',
    ),
  );
  const byName = new Map();
  const dependencies = {};
  for (const sidecar of sidecars) {
    assert.match(
      sidecar.version,
      exactVersion,
      'Sidecar transport version must be exact',
    );
    assert.ok(
      !byName.has(sidecar.name),
      `Duplicate React baseline sidecar: ${sidecar.name}`,
    );
    const recipe = recipes.find(item => item.fork.name === sidecar.name);
    assert.ok(recipe, `Sidecar has no owning canonical slot: ${sidecar.name}`);
    byName.set(sidecar.name, sidecar);
    dependencies[recipe.upstream.name] = '*';
    add(sidecar.name, sidecar.version);
  }
  const consumer = {
    name: 'ultramodern-react-baseline-transport',
    dependencies,
  };
  rewriteSidecarConsumerAliases(consumer, sidecars);
  if (Object.values(dependencies).some(specifier => specifier === '*')) {
    // The publisher admits image aliases only for its owning image consumer.
    rewriteSidecarConsumerAliases(
      { ...consumer, name: '@bleedingdev/modern-js-image' },
      sidecars,
    );
  }
  const covered = new Set();
  for (const entry of sidecarAliasEntries(consumer)) {
    const sidecar = byName.get(entry.target);
    assert.ok(
      sidecar,
      `Sidecar alias points outside the actual release: ${entry.target}`,
    );
    assert.equal(
      entry.version,
      sidecar.version,
      `Sidecar alias version differs: ${entry.target}`,
    );
    add(entry.dependencyName, entry.specifier);
    covered.add(entry.target);
  }
  for (const sidecar of sidecars) {
    assert.ok(
      covered.has(sidecar.name),
      `Sidecar has no owning transport alias: ${sidecar.name}`,
    );
  }
  return Object.freeze(
    Object.fromEntries(
      [...overrides].sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}
