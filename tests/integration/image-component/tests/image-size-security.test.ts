import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pluginImageRequire = createRequire(
  path.resolve(
    __dirname,
    '../../../../packages/runtime/plugin-image/package.json',
  ),
);
const rsbuildImageEntry = pluginImageRequire.resolve('@rsbuild-image/core');
const imageSizeCjsEntry =
  createRequire(rsbuildImageEntry).resolve('image-size');
const imageSizeDist = path.dirname(imageSizeCjsEntry);
const moduleKinds = ['commonjs', 'module'] as const;
// Each case parses untrusted bytes in a throwaway child so an unbounded parse
// loop surfaces as a deterministic failure instead of hanging the suite. A
// healthy child finishes in ~60ms; the bound only has to be small enough to
// stay well inside the runner's per-test timeout.
const CHILD_TIMEOUT_MS = 5_000;

function hex(value: string): readonly number[] {
  return [...Buffer.from(value.replaceAll(/\s/g, ''), 'hex')];
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

type ImageType = 'heif' | 'icns' | 'jp2' | 'jpg' | 'jxl';
type ModuleKind = (typeof moduleKinds)[number];
type ChildResult =
  | {
      outcome: 'parsed';
      result: { height: number; type?: string; width: number };
    }
  | { errorMessage: string; errorName: string; outcome: 'rejected' };
type ExpectedOutcome =
  | { height: number; outcome: 'parsed'; width: number }
  | { errorMessage?: string; outcome: 'rejected' };
type SecurityCase = {
  bytes: readonly number[];
  expected: ExpectedOutcome;
  imageType: ImageType;
  name: string;
};

const securityCases: readonly SecurityCase[] = [
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
} as const;

function distributionEntry(
  moduleKind: ModuleKind,
  name: 'fromFile' | 'index',
): string {
  return path.join(
    imageSizeDist,
    `${name}.${moduleKind === 'module' ? 'mjs' : 'cjs'}`,
  );
}

function typeEntry(
  moduleKind: ModuleKind,
  imageType: ImageType | 'index' | 'utils',
): string {
  return path.join(
    imageSizeDist,
    'types',
    `${imageType}.${moduleKind === 'module' ? 'mjs' : 'cjs'}`,
  );
}

function loadModuleSource(moduleKind: ModuleKind, entry: string): string {
  return moduleKind === 'module'
    ? `await import(${JSON.stringify(pathToFileURL(entry).href)})`
    : `createRequire(import.meta.url)(${JSON.stringify(entry)})`;
}

async function loadModule(moduleKind: ModuleKind, entry: string) {
  return moduleKind === 'module'
    ? import(pathToFileURL(entry).href)
    : createRequire(import.meta.url)(entry);
}

function runInChild(operation: string): ChildResult {
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
  const execution = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', source],
    {
      encoding: 'utf8',
      timeout: CHILD_TIMEOUT_MS,
    },
  );

  expect(execution.error).toBeUndefined();
  expect(execution.signal).toBeNull();
  expect(execution.status).toBe(0);
  expect(execution.stderr).toBe('');

  return JSON.parse(execution.stdout) as ChildResult;
}

function parseBufferInChild(
  moduleKind: ModuleKind,
  bytes: readonly number[],
): ChildResult {
  const loadDistribution = loadModuleSource(
    moduleKind,
    distributionEntry(moduleKind, 'index'),
  );
  return runInChild(`async () => {
    const { imageSize } = ${loadDistribution};
    return imageSize(Uint8Array.from(${JSON.stringify(bytes)}));
  }`);
}

function parseFileInChild(
  moduleKind: ModuleKind,
  bytes: readonly number[],
): ChildResult {
  const ownedRoot = mkdtempSync(
    path.join(tmpdir(), 'modernjs-image-size-security-'),
  );
  const imagePath = path.join(ownedRoot, 'untrusted-image.bin');
  writeFileSync(imagePath, Uint8Array.from(bytes));

  try {
    const loadDistribution = loadModuleSource(
      moduleKind,
      distributionEntry(moduleKind, 'fromFile'),
    );
    return runInChild(`async () => {
      const { imageSizeFromFile } = ${loadDistribution};
      return imageSizeFromFile(${JSON.stringify(imagePath)});
    }`);
  } finally {
    rmSync(ownedRoot, { force: true, recursive: true });
  }
}

function parseWithHandlerInChild(
  moduleKind: ModuleKind,
  imageType: ImageType,
  bytes: readonly number[],
  aggregate: boolean,
): ChildResult {
  const loadHandler = loadModuleSource(
    moduleKind,
    typeEntry(moduleKind, aggregate ? 'index' : imageType),
  );
  const selectHandler = aggregate
    ? `module.typeHandlers.get(${JSON.stringify(imageType)})`
    : `module.${handlerExport[imageType]}`;
  return runInChild(`async () => {
    const module = ${loadHandler};
    const handler = ${selectHandler};
    return handler.calculate(Uint8Array.from(${JSON.stringify(bytes)}));
  }`);
}

function expectSecurityOutcome(
  actual: ChildResult,
  expected: ExpectedOutcome,
): void {
  expect(actual.outcome).toBe(expected.outcome);
  if (actual.outcome === 'parsed' && expected.outcome === 'parsed') {
    expect(actual.result).toMatchObject({
      height: expected.height,
      width: expected.width,
    });
  } else if (actual.outcome === 'rejected' && expected.outcome === 'rejected') {
    expect(actual.errorName).toMatch(/Error$/);
    if (expected.errorMessage) {
      expect(actual.errorMessage).toBe(expected.errorMessage);
    }
  }
}

describe.each(moduleKinds)('image-size %s distribution', moduleKind => {
  it.each(securityCases)('bounds the public buffer parser for $name', ({
    bytes,
    expected,
  }) => {
    expectSecurityOutcome(parseBufferInChild(moduleKind, bytes), expected);
  });

  it.each(securityCases)('bounds the public file parser for $name', ({
    bytes,
    expected,
  }) => {
    expectSecurityOutcome(parseFileInChild(moduleKind, bytes), expected);
  });

  it.each(securityCases)('bounds the direct handler for $name', ({
    bytes,
    expected,
    imageType,
  }) => {
    expectSecurityOutcome(
      parseWithHandlerInChild(moduleKind, imageType, bytes, false),
      expected,
    );
  });

  it.each(securityCases)('bounds the aggregate handler for $name', ({
    bytes,
    expected,
    imageType,
  }) => {
    expectSecurityOutcome(
      parseWithHandlerInChild(moduleKind, imageType, bytes, true),
      expected,
    );
  });

  it.each(validImages)('preserves valid $name parsing', async fixture => {
    const imageSizeModule = await loadModule(
      moduleKind,
      distributionEntry(moduleKind, 'index'),
    );

    expect(imageSizeModule.imageSize(Uint8Array.from(fixture.bytes))).toEqual(
      fixture.expected,
    );
  });

  it('implements bounded ISO-BMFF box semantics', async () => {
    const { findBox } = await loadModule(
      moduleKind,
      typeEntry(moduleKind, 'utils'),
    );

    expect(
      findBox(
        Uint8Array.from(hex('00000008667265650000000866747970')),
        'ftyp',
        0,
      ),
    ).toEqual({ name: 'ftyp', offset: 8, size: 8 });
    expect(
      findBox(Uint8Array.from(hex('0000000066726565')), 'free', 0),
    ).toEqual({ name: 'free', offset: 0, size: 8 });
    expect(
      findBox(Uint8Array.from(hex('0000000066726565')), 'ftyp', 0),
    ).toBeUndefined();
    expect(
      findBox(
        Uint8Array.from(hex('00000001667265650000000866747970')),
        'ftyp',
        0,
      ),
    ).toBeUndefined();
    expect(
      findBox(Uint8Array.from(hex('0000000766726565')), 'free', 0),
    ).toBeUndefined();
  });

  it('preserves valid PNG parsing from a nonzero-byte-offset view', async () => {
    const imageSizeModule = await loadModule(
      moduleKind,
      distributionEntry(moduleKind, 'index'),
    );
    const png = readFileSync(path.resolve(__dirname, '../src/routes/crab.png'));
    const padded = Buffer.alloc(png.length + 32, 0xa5);
    png.copy(padded, 17);
    const view = new Uint8Array(
      padded.buffer,
      padded.byteOffset + 17,
      png.length,
    );

    expect(imageSizeModule.imageSize(view)).toMatchObject({
      height: 1281,
      type: 'png',
      width: 1920,
    });
  });
});
