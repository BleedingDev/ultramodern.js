#!/usr/bin/env node
/**
 * Proves that THIS package's own `dist/` carries the PR459 parser hardening.
 *
 * Every entry point is resolved by absolute path inside this directory, never through the
 * monorepo's resolution chain, so a pass says nothing about pnpm `patchedDependencies` and
 * everything about the artifact that would actually be published.
 *
 * Mirrors a representative subset of
 * tests/integration/image-component/tests/image-size-security.test.ts (lines 319-418):
 * the public buffer parser, the public file parser, the direct per-format handler, the aggregate
 * handler registry, a valid-image regression per format, and the bounded ISO-BMFF box semantics --
 * each across both the CommonJS and the ES-module distribution.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const distRoot = path.join(packageRoot, 'dist');

/** A healthy child finishes in ~60ms; this only has to be small enough to catch an unbounded loop. */
const CHILD_BUDGET_MS = 5_000;
/** Whole-run wall clock ceiling, asserted at the end. */
const RUN_BUDGET_MS = 240_000;

const moduleKinds = /** @type {const} */ (['commonjs', 'module']);

function hex(value) {
  return [...Buffer.from(value.replaceAll(/\s/g, ''), 'hex')];
}

const jxlContainerPrefix = `
  0000000c4a584c200d0a870a
  00000014667479706a786c20000000006a786c20
`;

/** One valid image per hardened format: the hardening must not regress good input. */
const validImages = [
  {
    bytes: hex(`
      00000010667479706176696600000000
      000000306d65746100000000
      0000002469707270
      0000001c6970636f
      0000001469737065000000000000000700000009
    `),
    expected: { height: 9, type: 'avif', width: 7 },
    name: 'HEIF',
  },
  {
    bytes: hex('69636e73000000106963303700000008'),
    expected: { height: 128, type: 'icns', width: 128 },
    name: 'ICNS',
  },
  {
    bytes: hex(`${jxlContainerPrefix} 0000000c6a786c63ff0a0100`),
    expected: { height: 8, type: 'jxl', width: 8 },
    name: 'JXL',
  },
  {
    bytes: hex(`
      0000000c6a5020200d0a870a
      00000014667479706a703220000000006a703220
      000000186a703268
      00000010696864720000000900000007
    `),
    expected: { height: 9, type: 'jp2', width: 7 },
    name: 'JP2',
  },
  {
    bytes: hex('ffd8ffe00002ffc000070800090007'),
    expected: { height: 9, type: 'jpg', width: 7 },
    name: 'JPEG',
  },
];

/** Untrusted inputs that drove an unbounded parse before PR459. */
const securityCases = [
  {
    bytes: hex(`
      00000010667479706176696600000000
      000000306d65746100000000
      0000002469707270
      0000001c6970636f
      0000000069737065000000000000000700000009
    `),
    expected: { height: 9, outcome: 'parsed', width: 7 },
    imageType: 'heif',
    name: 'terminal size-zero HEIF ispe box',
  },
  {
    bytes: hex(`
      00000010667479706176696600000000
      000000306d65746100000000
      0000002469707270
      0000001c6970636f
      0000000069737065000000000000000700000009
      0000000866726565
    `),
    expected: { outcome: 'rejected' },
    imageType: 'heif',
    name: 'HEIF ispe box extending beyond ipco',
  },
  {
    bytes: hex('69636e73000000106963303700000000'),
    expected: { outcome: 'rejected' },
    imageType: 'icns',
    name: 'zero-length ICNS entry',
  },
  {
    bytes: hex(`${jxlContainerPrefix} 000000086a786c70`),
    expected: { outcome: 'rejected' },
    imageType: 'jxl',
    name: 'undersized JXL partial-stream box',
  },
  {
    bytes: hex(`
      0000000c6a5020200d0a870a
      00000014667479706a703220000000006a703220
      000000046a703268
      00000010696864720000000900000007
    `),
    expected: { outcome: 'rejected' },
    imageType: 'jp2',
    name: 'undersized JP2 header box',
  },
  {
    bytes: hex(`
      0000000c6a5020200d0a870a
      00000014667479706a703220000000006a703220
      000000186a703268
      00000004696864720000000900000007
    `),
    expected: { outcome: 'rejected' },
    imageType: 'jp2',
    name: 'undersized JP2 image-header box',
  },
  {
    bytes: hex('ffd8ffe00000'),
    expected: {
      errorMessage: 'Corrupt JPG, invalid segment length',
      outcome: 'rejected',
    },
    imageType: 'jpg',
    name: 'zero-length JPEG segment',
  },
  {
    bytes: hex('ffd8ffe00001'),
    expected: {
      errorMessage: 'Corrupt JPG, invalid segment length',
      outcome: 'rejected',
    },
    imageType: 'jpg',
    name: 'one-byte JPEG segment',
  },
];

const handlerExport = {
  heif: 'HEIF',
  icns: 'ICNS',
  jp2: 'JP2',
  jpg: 'JPG',
  jxl: 'JXL',
};

const extensionFor = moduleKind => (moduleKind === 'module' ? 'mjs' : 'cjs');

function distributionEntry(moduleKind, name) {
  return path.join(distRoot, `${name}.${extensionFor(moduleKind)}`);
}

function typeEntry(moduleKind, imageType) {
  return path.join(
    distRoot,
    'types',
    `${imageType}.${extensionFor(moduleKind)}`,
  );
}

function loadModuleSource(moduleKind, entry) {
  return moduleKind === 'module'
    ? `await import(${JSON.stringify(pathToFileURL(entry).href)})`
    : `createRequire(import.meta.url)(${JSON.stringify(entry)})`;
}

function loadModule(moduleKind, entry) {
  return moduleKind === 'module'
    ? import(pathToFileURL(entry).href)
    : createRequire(import.meta.url)(entry);
}

let failures = 0;
let checks = 0;
let slowestChildMs = 0;

function check(label, body) {
  checks += 1;
  try {
    body();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${label}`);
    console.log(
      `       ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function checkAsync(label, body) {
  checks += 1;
  try {
    await body();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${label}`);
    console.log(
      `       ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Parses untrusted bytes in a throwaway child so an unbounded loop surfaces as a deterministic
 * timeout instead of hanging this script, and so the parse is timed on its own wall clock.
 */
function runInChild(operation) {
  const source = `
    import { createRequire } from 'node:module';
    try {
      const result = await (${operation})();
      process.stdout.write(JSON.stringify({ outcome: 'parsed', result }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        outcome: 'rejected',
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : typeof error,
      }));
    }
  `;

  const startedAt = Date.now();
  const execution = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', source],
    { encoding: 'utf8', timeout: CHILD_BUDGET_MS },
  );
  const elapsedMs = Date.now() - startedAt;
  slowestChildMs = Math.max(slowestChildMs, elapsedMs);

  // Bounded-time assertion: a parse that spins is killed by `timeout` and reports a signal.
  assert.equal(
    execution.error,
    undefined,
    `child failed or exceeded ${CHILD_BUDGET_MS}ms: ${execution.error?.message}`,
  );
  assert.equal(
    execution.signal,
    null,
    `child killed by ${execution.signal} (unbounded parse?)`,
  );
  assert.equal(
    execution.status,
    0,
    `child exited ${execution.status}: ${execution.stderr}`,
  );
  assert.equal(
    execution.stderr,
    '',
    `child wrote to stderr: ${execution.stderr}`,
  );
  assert.ok(
    elapsedMs < CHILD_BUDGET_MS,
    `parse took ${elapsedMs}ms, over the ${CHILD_BUDGET_MS}ms budget`,
  );

  return JSON.parse(execution.stdout);
}

function expectSecurityOutcome(actual, expected) {
  assert.equal(
    actual.outcome,
    expected.outcome,
    `expected ${expected.outcome}, got ${actual.outcome}`,
  );
  if (expected.outcome === 'parsed') {
    assert.equal(actual.result.width, expected.width);
    assert.equal(actual.result.height, expected.height);
  } else {
    assert.match(actual.errorName, /Error$/);
    if (expected.errorMessage) {
      assert.equal(actual.errorMessage, expected.errorMessage);
    }
  }
}

function parseBufferInChild(moduleKind, bytes) {
  return runInChild(`async () => {
    const { imageSize } = ${loadModuleSource(moduleKind, distributionEntry(moduleKind, 'index'))};
    return imageSize(Uint8Array.from(${JSON.stringify(bytes)}));
  }`);
}

function parseFileInChild(moduleKind, bytes) {
  const ownedRoot = mkdtempSync(
    path.join(tmpdir(), 'bleedingdev-image-size-verify-'),
  );
  const imagePath = path.join(ownedRoot, 'untrusted-image.bin');
  writeFileSync(imagePath, Uint8Array.from(bytes));
  try {
    const load = loadModuleSource(
      moduleKind,
      distributionEntry(moduleKind, 'fromFile'),
    );
    return runInChild(`async () => {
      const { imageSizeFromFile } = ${load};
      return imageSizeFromFile(${JSON.stringify(imagePath)});
    }`);
  } finally {
    rmSync(ownedRoot, { force: true, recursive: true });
  }
}

function parseWithHandlerInChild(moduleKind, imageType, bytes, aggregate) {
  const load = loadModuleSource(
    moduleKind,
    typeEntry(moduleKind, aggregate ? 'index' : imageType),
  );
  const selectHandler = aggregate
    ? `module.typeHandlers.get(${JSON.stringify(imageType)})`
    : `module.${handlerExport[imageType]}`;
  return runInChild(`async () => {
    const module = ${load};
    const handler = ${selectHandler};
    return handler.calculate(Uint8Array.from(${JSON.stringify(bytes)}));
  }`);
}

const runStartedAt = Date.now();
console.log(`@bleedingdev/image-size security verification`);
console.log(`distribution under test: ${distRoot}\n`);

for (const moduleKind of moduleKinds) {
  console.log(`[${moduleKind}] distribution`);

  for (const { bytes, expected, imageType, name } of securityCases) {
    check(`bounds the public buffer parser for ${name}`, () => {
      expectSecurityOutcome(parseBufferInChild(moduleKind, bytes), expected);
    });
    check(`bounds the public file parser for ${name}`, () => {
      expectSecurityOutcome(parseFileInChild(moduleKind, bytes), expected);
    });
    check(`bounds the direct handler for ${name}`, () => {
      expectSecurityOutcome(
        parseWithHandlerInChild(moduleKind, imageType, bytes, false),
        expected,
      );
    });
    check(`bounds the aggregate handler for ${name}`, () => {
      expectSecurityOutcome(
        parseWithHandlerInChild(moduleKind, imageType, bytes, true),
        expected,
      );
    });
  }

  for (const fixture of validImages) {
    await checkAsync(`preserves valid ${fixture.name} parsing`, async () => {
      const distribution = await loadModule(
        moduleKind,
        distributionEntry(moduleKind, 'index'),
      );
      assert.deepEqual(
        distribution.imageSize(Uint8Array.from(fixture.bytes)),
        fixture.expected,
      );
    });
  }

  await checkAsync('implements bounded ISO-BMFF box semantics', async () => {
    const { findBox } = await loadModule(
      moduleKind,
      typeEntry(moduleKind, 'utils'),
    );

    // A well-formed 8-byte box is found at its real offset.
    assert.deepEqual(
      findBox(
        Uint8Array.from(hex('00000008667265650000000866747970')),
        'ftyp',
        0,
      ),
      { name: 'ftyp', offset: 8, size: 8 },
    );
    // boxSize === 0 means "extends to end of input", not "advance by zero".
    assert.deepEqual(
      findBox(Uint8Array.from(hex('0000000066726565')), 'free', 0),
      {
        name: 'free',
        offset: 0,
        size: 8,
      },
    );
    // ...and searching past a terminal size-zero box terminates instead of spinning.
    assert.equal(
      findBox(Uint8Array.from(hex('0000000066726565')), 'ftyp', 0),
      undefined,
    );
    // boxSize === 1 (64-bit extended size) is rejected rather than misread.
    assert.equal(
      findBox(
        Uint8Array.from(hex('00000001667265650000000866747970')),
        'ftyp',
        0,
      ),
      undefined,
    );
    // A declared size smaller than the 8-byte header is rejected.
    assert.equal(
      findBox(Uint8Array.from(hex('0000000766726565')), 'free', 0),
      undefined,
    );
  });

  console.log('');
}

const runElapsedMs = Date.now() - runStartedAt;
assert.ok(
  runElapsedMs < RUN_BUDGET_MS,
  `verification took ${runElapsedMs}ms, over the ${RUN_BUDGET_MS}ms budget`,
);

console.log(
  `${checks - failures}/${checks} checks passed in ${runElapsedMs}ms ` +
    `(slowest parse ${slowestChildMs}ms, per-parse budget ${CHILD_BUDGET_MS}ms)`,
);

if (failures > 0) {
  console.error(
    `\n${failures} check(s) FAILED - this distribution is not hardened.`,
  );
  process.exit(1);
}
