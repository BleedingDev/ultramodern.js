#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 26 || (major === 26 && minor < 7)) {
  console.error(
    `UltraModern.js requires Node.js >=26.7.0; detected v${process.versions.node}.`,
  );
  process.exit(1);
}

const { version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
process.env.MODERN_JS_VERSION ??= version;

const { run } = await import('../dist/esm-node/native-composition/cli.mjs');
try {
  await run({ version });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
