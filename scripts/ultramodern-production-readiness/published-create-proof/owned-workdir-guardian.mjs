import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pollIntervalMs = 250;
const workDirPrefix = 'ultramodern-release-acceptance-';
const [parentPidValue, workDirValue] = process.argv.slice(2);
const parentPid = Number.parseInt(parentPidValue, 10);
const workDir = path.resolve(workDirValue ?? '');
const temporaryRoot = path.resolve(os.tmpdir());

if (
  !Number.isSafeInteger(parentPid) ||
  parentPid <= 1 ||
  path.dirname(workDir) !== temporaryRoot ||
  !path.basename(workDir).startsWith(workDirPrefix)
) {
  process.exitCode = 2;
} else {
  const parentIsAlive = () => {
    try {
      process.kill(parentPid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const poll = setInterval(() => {
    if (!fs.existsSync(workDir)) {
      clearInterval(poll);
      return;
    }
    if (!parentIsAlive()) {
      fs.rmSync(workDir, { recursive: true, force: true });
      clearInterval(poll);
    }
  }, pollIntervalMs);
}
