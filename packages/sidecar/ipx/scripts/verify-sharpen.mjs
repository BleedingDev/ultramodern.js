#!/usr/bin/env node
/**
 * Verifies the Sharp 0.35 `sharpen` remap carried by this fork.
 *
 * Upstream ipx@3.1.1 calls `pipe.sharpen(sigma, flat, jagged)`. Sharp 0.35
 * removed the deprecated positional form (sharp/dist/operation.cjs `sharpen`
 * now only reads a plain object and otherwise falls back to sigma = -1), so the
 * positional call silently discarded the requested sigma. This fork maps the
 * IPX modifier arguments onto `{ sigma, m1, m2 }`.
 *
 * Run against a package directory whose runtime dependencies are resolvable
 * (the sidecar workspace itself after an install, or a sandbox copy with
 * symlinked node_modules):
 *
 *   node packages/sidecar/ipx/scripts/verify-sharpen.mjs [imageDir]
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distEntry = resolve(packageRoot, 'dist/index.mjs');

const imageDir = resolve(
  process.argv[2] ||
    resolve(packageRoot, '../../../tests/integration/image-component/src'),
);

if (!existsSync(distEntry)) {
  throw new Error(`missing dist entry: ${distEntry}`);
}
if (!existsSync(imageDir)) {
  throw new Error(`missing image directory: ${imageDir}`);
}

const { createIPX, ipxFSStorage } = await import(pathToFileURL(distEntry).href);

const imageFile = readdirSync(imageDir).find(name =>
  /\.(png|jpe?g)$/i.test(name),
);
if (!imageFile) {
  throw new Error(`no png/jpeg fixture found in ${imageDir}`);
}

const ipx = createIPX({ storage: ipxFSStorage({ dir: imageDir }) });

// NOTE: `s` is the IPX alias for `resize`, not for `sharpen`
// (dist/shared/ipx.CXJeaylD.mjs: `const s = resize;`). The sharpen modifier has
// no short alias, so it is always addressed as `sharpen`.
const cases = [
  { name: 'control f_png,w_50 (no sharpen)', modifiers: { f: 'png', w: '50' } },
  {
    name: 'sharpen (bare, sigma absent)',
    modifiers: { sharpen: '', f: 'png' },
  },
  { name: 'sharpen_2 (sigma only)', modifiers: { sharpen: '2', f: 'png' } },
  {
    name: 'sharpen_2_1_2 (sigma + flat + jagged)',
    modifiers: { sharpen: '2_1_2', f: 'png' },
  },
  {
    name: 'sharpen_abc (non-numeric, must not throw)',
    modifiers: { sharpen: 'abc', f: 'png' },
  },
];

let failures = 0;
for (const testCase of cases) {
  try {
    const { data } = await ipx(imageFile, testCase.modifiers).process();
    if (!data || data.length === 0) {
      failures += 1;
      console.error(`FAIL ${testCase.name}: empty buffer`);
      continue;
    }
    console.log(`ok   ${testCase.name}: ${data.length} bytes`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${testCase.name}: ${error?.message || error}`);
  }
}

// The remap must actually reach libvips: two different sigmas must produce
// different output, which the upstream positional call could not do under
// Sharp 0.35 (both collapse to the sigma = -1 mild-sharpen fallback).
try {
  const [low, high] = await Promise.all([
    ipx(imageFile, { sharpen: '0.5', f: 'png' }).process(),
    ipx(imageFile, { sharpen: '9', f: 'png' }).process(),
  ]);
  if (Buffer.from(low.data).equals(Buffer.from(high.data))) {
    failures += 1;
    console.error(
      'FAIL sigma is not reaching sharp: sharpen_0.5 and sharpen_9 are byte-identical',
    );
  } else {
    console.log(
      `ok   sigma reaches sharp: sharpen_0.5 ${low.data.length} bytes != sharpen_9 ${high.data.length} bytes`,
    );
  }
} catch (error) {
  failures += 1;
  console.error(`FAIL sigma differentiation: ${error?.message || error}`);
}

// `m1`/`m2` must reach sharp too. sharpen_2_1_2 intentionally matches sharp's
// own defaults (m1 = 1, m2 = 2), so compare against non-default flat/jagged.
try {
  const [defaults, tuned] = await Promise.all([
    ipx(imageFile, { sharpen: '2', f: 'png' }).process(),
    ipx(imageFile, { sharpen: '2_0_10', f: 'png' }).process(),
  ]);
  if (Buffer.from(defaults.data).equals(Buffer.from(tuned.data))) {
    failures += 1;
    console.error(
      'FAIL flat/jagged are not reaching sharp: sharpen_2 == sharpen_2_0_10',
    );
  } else {
    console.log(
      `ok   flat/jagged reach sharp: sharpen_2 ${defaults.data.length} bytes != sharpen_2_0_10 ${tuned.data.length} bytes`,
    );
  }
} catch (error) {
  failures += 1;
  console.error(`FAIL flat/jagged differentiation: ${error?.message || error}`);
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all sharpen checks passed');
