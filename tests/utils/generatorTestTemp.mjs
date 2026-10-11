import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Keep generated installs isolated while using the runner's cached-store disk. */
export function generatorTestTempParent(
  repoRoot,
  runnerTemp = process.env.RUNNER_TEMP,
) {
  const source = runnerTemp === undefined ? 'os.tmpdir()' : 'RUNNER_TEMP';
  const candidate = runnerTemp === undefined ? os.tmpdir() : runnerTemp;
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
    throw new Error(`${source} must be an absolute directory path`);
  }

  let tempParent;
  try {
    tempParent = fs.realpathSync(candidate);
    if (!fs.statSync(tempParent).isDirectory()) {
      throw new Error('not a directory');
    }
    fs.accessSync(tempParent, fs.constants.W_OK);
  } catch (cause) {
    throw new Error(`${source} must be an existing writable directory`, {
      cause,
    });
  }

  const repository = fs.realpathSync(repoRoot);
  const relative = path.relative(repository, tempParent);
  if (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
  ) {
    throw new Error(`${source} must be outside the source repository`);
  }
  return tempParent;
}
