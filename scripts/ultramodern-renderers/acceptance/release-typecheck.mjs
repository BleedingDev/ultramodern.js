#!/usr/bin/env node
// Type-checks one installed acceptance consumer with the compiler its installed
// framework selects. Usage (cwd = application root):
//   RELEASE_RENDERER=<renderer> RELEASE_EXTENSIONS_SPECIFIER=<pkg> \
//     node release-typecheck.mjs --project <tsconfig> [--noEmit]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

function parse(args) {
  let project = 'tsconfig.json';
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--project' || argument === '-p') project = args[++index];
    else if (argument === '--noEmit' || argument.startsWith('--pretty'))
      continue;
    else throw new Error(`Unsupported typecheck argument: ${argument}`);
  }
  return path.resolve(project);
}

function owningManifest(file) {
  let directory = path.dirname(fs.realpathSync(file));
  for (;;) {
    const candidate = path.join(directory, 'package.json');
    if (fs.existsSync(candidate))
      return {
        directory,
        value: JSON.parse(fs.readFileSync(candidate, 'utf8')),
      };
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `No package manifest owns ${file}`);
    directory = parent;
  }
}

function selectCompiler(renderer, appRoot) {
  const appRequire = createRequire(path.join(appRoot, 'package.json'));
  const app = JSON.parse(
    fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'),
  );
  if (renderer === 'octane') {
    const declared = { ...app.dependencies, ...app.devDependencies };
    const sdk = [
      '@modern-js/renderer-octane',
      '@bleedingdev/modern-js-renderer-octane',
    ].find(name => Object.hasOwn(declared, name));
    assert(sdk, 'Octane application must declare its renderer SDK');
    const manifestPath = appRequire.resolve(`${sdk}/package.json`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const bin =
      typeof manifest.bin === 'string'
        ? manifest.bin
        : manifest.bin?.['octane-tsc'];
    assert.equal(typeof bin, 'string', 'Octane SDK must declare octane-tsc');
    return {
      command: process.execPath,
      prefix: [path.resolve(path.dirname(manifestPath), bin)],
    };
  }
  const specifier = process.env.RELEASE_EXTENSIONS_SPECIFIER;
  assert(specifier, 'RELEASE_EXTENSIONS_SPECIFIER is required');
  const entry = appRequire.resolve(
    specifier.endsWith('/config') ? specifier : `${specifier}/config`,
  );
  const selector = createRequire(entry)(entry);
  assert.equal(
    typeof selector.resolveEffectTsgoCompiler,
    'function',
    `${owningManifest(entry).value.name} exposes no compiler selector`,
  );
  const command = selector.resolveEffectTsgoCompiler({
    from: path.join(appRoot, 'modern.config.ts'),
  });
  assert(
    typeof command === 'string' && path.isAbsolute(command),
    'Compiler selector returned no absolute executable',
  );
  return { command, prefix: [] };
}

const renderer = process.env.RELEASE_RENDERER;
assert(
  ['react', 'solid', 'octane'].includes(renderer),
  'RELEASE_RENDERER must name the selected renderer',
);
assert(
  !process.env.EFFECT_TSGO_BIN?.trim(),
  'EFFECT_TSGO_BIN would bypass the installed compiler selection',
);
const appRoot = fs.realpathSync(process.cwd());
const project = parse(process.argv.slice(2));
const { command, prefix } = selectCompiler(renderer, appRoot);
const result = spawnSync(
  command,
  [
    ...prefix,
    '--project',
    project,
    '--noEmit',
    '--pretty',
    'false',
    '--noCheck',
    'false',
    '--skipLibCheck',
    'false',
  ],
  { cwd: appRoot, stdio: 'inherit', timeout: 300_000 },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
