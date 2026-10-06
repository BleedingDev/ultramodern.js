import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire, findPackageJSON } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pluginImageRequire = createRequire(
  path.resolve(
    __dirname,
    '../../../../packages/runtime/plugin-image/package.json',
  ),
);
const rsbuildImageEntry = pluginImageRequire.resolve('@rsbuild-image/core');
const imageSizeEntry = createRequire(rsbuildImageEntry).resolve('image-size');
const imageSizePackageJson = findPackageJSON(
  'image-size',
  pathToFileURL(rsbuildImageEntry),
);
// 2.0.3 is the first upstream release that terminates on malformed box
// lengths; anything older can spin forever inside the image core sidecar.
const MINIMUM_IMAGE_SIZE_VERSION = [2, 0, 3] as const;
// Each case parses untrusted bytes in a throwaway child so an unbounded parse
// loop surfaces as a deterministic failure instead of hanging the suite. A
// healthy child finishes in ~60ms; the bound only has to be small enough to
// stay well inside the runner's per-test timeout.
const CHILD_TIMEOUT_MS = 5_000;

function hex(value: string): readonly number[] {
  return [...Buffer.from(value.replaceAll(/\s/g, ''), 'hex')];
}

function compareVersions(
  actual: readonly number[],
  minimum: readonly number[],
): number {
  for (let index = 0; index < minimum.length; index += 1) {
    const difference = (actual[index] ?? 0) - minimum[index];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

const jxlContainerPrefix = `
  0000000c4a584c200d0a870a
  00000014667479706a786c20000000006a786c20
`;

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
] as const;

type ChildResult =
  | { outcome: 'parsed'; result: { height: unknown; width: unknown } }
  | { errorName: string; outcome: 'rejected' };

const malformedInputs = [
  {
    bytes: hex(`
      00000010667479706176696600000000
      000000306d65746100000000
      0000002469707270
      0000001c6970636f
      0000000069737065000000000000000700000009
    `),
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
    name: 'HEIF ispe box extending beyond ipco',
  },
  {
    bytes: hex('69636e73000000106963303700000000'),
    name: 'zero-length ICNS entry',
  },
  {
    bytes: hex(`${jxlContainerPrefix} 000000086a786c70`),
    name: 'undersized JXL partial-stream box',
  },
  {
    bytes: hex(`
      0000000c6a5020200d0a870a
      00000014667479706a703220000000006a703220
      000000046a703268
      00000010696864720000000900000007
    `),
    name: 'undersized JP2 header box',
  },
  {
    bytes: hex(`
      0000000c6a5020200d0a870a
      00000014667479706a703220000000006a703220
      000000186a703268
      00000004696864720000000900000007
    `),
    name: 'undersized JP2 image-header box',
  },
  {
    bytes: hex('ffd8ffe00000'),
    name: 'zero-length JPEG segment',
  },
  {
    bytes: hex('ffd8ffe00001'),
    name: 'one-byte JPEG segment',
  },
] as const;

function parseBufferInChild(bytes: readonly number[]): ChildResult {
  const source = `
    const { imageSize } = require(${JSON.stringify(imageSizeEntry)});
    let output;
    try {
      const { height, width } = imageSize(Uint8Array.from(${JSON.stringify(bytes)}));
      output = { outcome: 'parsed', result: { height, width } };
    } catch (error) {
      output = {
        outcome: 'rejected',
        errorName: error instanceof Error ? error.name : typeof error,
      };
    }
    process.stdout.write(JSON.stringify(output));
  `;
  const execution = spawnSync(process.execPath, ['--eval', source], {
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
  });

  expect(execution.error).toBeUndefined();
  expect(execution.signal).toBeNull();
  expect(execution.status).toBe(0);
  expect(execution.stderr).toBe('');

  return JSON.parse(execution.stdout) as ChildResult;
}

function expectBoundedDimension(value: unknown): void {
  expect(Number.isSafeInteger(value)).toBe(true);
  expect(value as number).toBeGreaterThanOrEqual(0);
}

describe('image-size resolved by @rsbuild-image/core', () => {
  it('is at least the release that terminates on malformed boxes', () => {
    const { version } = JSON.parse(
      readFileSync(imageSizePackageJson as string, 'utf8'),
    ) as { version: string };
    const actual = version.split(/[.+-]/).slice(0, 3).map(Number);

    expect(
      compareVersions(actual, MINIMUM_IMAGE_SIZE_VERSION),
      `image-size ${version} predates ${MINIMUM_IMAGE_SIZE_VERSION.join('.')}; raise the image-size range of @rsbuild-image/core`,
    ).toBeGreaterThanOrEqual(0);
  });

  it.each(malformedInputs)('terminates on $name', ({ bytes }) => {
    const actual = parseBufferInChild(bytes);

    if (actual.outcome === 'rejected') {
      expect(actual.errorName).toMatch(/Error$/);
    } else {
      expectBoundedDimension(actual.result.width);
      expectBoundedDimension(actual.result.height);
    }
  });

  it.each(validImages)('preserves valid $name parsing', fixture => {
    const { imageSize } = createRequire(__filename)(imageSizeEntry);

    expect(imageSize(Uint8Array.from(fixture.bytes))).toEqual(fixture.expected);
  });

  it('preserves valid PNG parsing from a nonzero-byte-offset view', () => {
    const { imageSize } = createRequire(__filename)(imageSizeEntry);
    const png = readFileSync(path.resolve(__dirname, '../src/routes/crab.png'));
    const padded = Buffer.alloc(png.length + 32, 0xa5);
    png.copy(padded, 17);
    const view = new Uint8Array(
      padded.buffer,
      padded.byteOffset + 17,
      png.length,
    );

    expect(imageSize(view)).toMatchObject({
      height: 1281,
      type: 'png',
      width: 1920,
    });
  });
});
