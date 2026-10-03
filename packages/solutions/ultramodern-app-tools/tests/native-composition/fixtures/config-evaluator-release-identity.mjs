import childProcess from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const {
  frameworkRoot,
  extensionsRoot,
  root,
  action,
  generationBuildMarker,
  unitId,
} = JSON.parse(process.argv[2]);
const owningRequire = createRequire(path.join(frameworkRoot, 'package.json'));
const publicCjsPath = owningRequire.resolve(
  '@modern-js/app-tools-extensions/release-identity',
);
const publicEsmURL = import.meta.resolve(
  '@modern-js/app-tools-extensions/release-identity',
);
if (
  publicCjsPath !== path.join(extensionsRoot, 'dist/cjs/release-identity.js') ||
  publicEsmURL !==
    pathToFileURL(
      path.join(extensionsRoot, 'dist/esm-node/release-identity.mjs'),
    ).href
)
  throw new Error(
    'Release identity did not resolve to its actual declared public entries',
  );
const initiallyCached = Boolean(owningRequire.cache[publicCjsPath]);
const bootstrapCjs = owningRequire(
  path.join(
    frameworkRoot,
    'dist/cjs/native-composition/config-evaluator/native-bootstrap.js',
  ),
);
await bootstrapCjs.initializeOwningReleaseIdentity();
const bootstrapEsm = await import(
  pathToFileURL(
    path.join(
      frameworkRoot,
      'dist/esm-node/native-composition/config-evaluator/native-bootstrap.mjs',
    ),
  ).href
);
process.env.MODERN_LIB_FORMAT = 'esm';
await bootstrapEsm.initializeOwningReleaseIdentity();
process.env.MODERN_LIB_FORMAT = 'cjs';
const nativeBinding = bootstrapCjs.initializeOwningConfigNativeBinding();
const entries = [
  owningRequire('@modern-js/app-tools-extensions/release-identity'),
  await import(publicEsmURL),
];
const { observeConfigSourceInputs } = owningRequire(
  path.join(
    frameworkRoot,
    'dist/cjs/native-composition/config-evaluator/observed-inputs.js',
  ),
);
const { captureConfigSourceSnapshot, assertConfigSourceSnapshotUnchanged } =
  owningRequire('@modern-js/ultramodern-app-tools/config-evaluator');
const git = (...args) =>
  childProcess
    .execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    .trim();
const errorValue = error => ({
  name: error.name,
  message: error.message,
  ...(error.code === undefined ? {} : { code: error.code }),
});
const capture = read => {
  try {
    return read();
  } catch (error) {
    return { error: errorValue(error) };
  }
};
function initializeGit() {
  git('init', '-q');
  git('config', 'user.name', 'Release Identity Fixture');
  git('config', 'user.email', 'release-identity@example.invalid');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'initial\n');
  git('add', 'tracked.txt');
  git('commit', '-qm', 'initial');
  return git('rev-parse', 'HEAD');
}
process.chdir(root);
async function phase(sourceRevision) {
  const read = entry =>
    capture(() =>
      entry.resolveUltramodernReleaseIdentity({
        generationBuildMarker,
        unitId,
        ...(sourceRevision === undefined ? {} : { sourceRevision }),
      }),
    );
  const original = entries.map(read);
  const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
  const observed = await observeConfigSourceInputs(
    snapshot,
    async () => entries.map(read),
    undefined,
    undefined,
    nativeBinding,
  );
  assertConfigSourceSnapshotUnchanged(snapshot);
  return {
    original,
    observed: observed.value,
    inputs: observed.consumedSourceInputs,
  };
}

let result;
if (action === 'live') {
  const first = initializeGit();
  const phases = [await phase()];
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'dirty\n');
  phases.push(await phase(first));
  git('add', 'tracked.txt');
  git('commit', '-qm', 'second');
  const second = git('rev-parse', 'HEAD');
  phases.push(await phase());
  result = { initiallyCached, heads: [first, second], phases };
} else if (action === 'nongit') {
  result = {
    phases: [
      await phase(),
      await phase('a'.repeat(64)),
      await phase('invalid'),
    ],
  };
} else if (action === 'mismatch') {
  const head = initializeGit();
  const phases = [await phase('b'.repeat(40))];
  process.env.ULTRAMODERN_SOURCE_REVISION = 'c'.repeat(40);
  phases.push(await phase('b'.repeat(40)));
  result = { head, phases };
} else if (action === 'authored') {
  const source = `const {exec,execFile,spawn}=require('node:child_process');module.exports={exec:()=>exec('never-run'),execFile:()=>execFile('never-run'),spawn:()=>spawn('never-run')};`;
  fs.writeFileSync(path.join(root, 'authored.cjs'), source);
  fs.writeFileSync(
    path.join(root, 'authored.mjs'),
    `import {exec,execFile,spawn} from 'node:child_process';export const calls={exec:()=>exec('never-run'),execFile:()=>execFile('never-run'),spawn:()=>spawn('never-run')};`,
  );
  const authoredRequire = createRequire(path.join(root, 'package.json'));
  const kinds = ['callback', 'cjs-module', 'esm-module'];
  const phases = [];
  for (const kind of kinds) {
    const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
    const attempts = [];
    let cachedValuePreserved;
    let error;
    try {
      await observeConfigSourceInputs(
        snapshot,
        async () => {
          let calls;
          if (kind === 'callback') {
            const { exec, execFile, spawn } = childProcess;
            calls = {
              exec: () => exec('never-run'),
              execFile: () => execFile('never-run'),
              spawn: () => spawn('never-run'),
            };
          } else if (kind === 'cjs-module') {
            calls = authoredRequire('./authored.cjs');
            cachedValuePreserved = authoredRequire('./authored.cjs') === calls;
          } else {
            const url = pathToFileURL(path.join(root, 'authored.mjs')).href;
            const module = await import(url);
            cachedValuePreserved = (await import(url)) === module;
            calls = module.calls;
          }
          for (let repeat = 0; repeat < 2; repeat++)
            for (const operation of ['exec', 'execFile', 'spawn'])
              attempts.push({ operation, ...capture(calls[operation]) });
        },
        undefined,
        undefined,
        nativeBinding,
      );
    } catch (failure) {
      error = errorValue(failure);
    }
    assertConfigSourceSnapshotUnchanged(snapshot);
    phases.push({ kind, attempts, error, cachedValuePreserved });
  }
  result = { kinds, phases };
} else throw new Error(`Unknown action ${action}`);
process.stdout.write(JSON.stringify(result));
