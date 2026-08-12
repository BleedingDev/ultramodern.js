// Consumer: prepare-bleedingdev-packages.mjs direct CLI execution.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function isDirectRun(importMetaUrl) {
  return process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(importMetaUrl)
    : false;
}

export { isDirectRun };
