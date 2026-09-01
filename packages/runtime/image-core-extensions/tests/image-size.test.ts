import { imageSize } from '../src/image-size/index';
import { HEIF } from '../src/image-size/types/heif';
import { ICNS } from '../src/image-size/types/icns';
import { JP2 } from '../src/image-size/types/jp2';
import { findBox, readUInt32BE } from '../src/image-size/types/utils';

const textEncoder = new TextEncoder();

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function ascii(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value);
  return bytes;
}

function box(
  name: string,
  payload = new Uint8Array(),
  size: 'normal' | 'extended' | 'zero' = 'normal',
): Uint8Array {
  if (size === 'zero') {
    return concat(u32(0), ascii(name), payload);
  }
  if (size === 'extended') {
    return concat(
      u32(1),
      ascii(name),
      u64(BigInt(16 + payload.length)),
      payload,
    );
  }
  return concat(u32(8 + payload.length), ascii(name), payload);
}

function heif(
  properties: Uint8Array,
  options: {
    extended?: boolean;
    outsideMeta?: Uint8Array;
  } = {},
): Uint8Array {
  const size = options.extended ? 'extended' : 'normal';
  const ftyp = box('ftyp', concat(ascii('avif'), u32(0)), size);
  const ipco = box('ipco', properties, size);
  const iprp = box('iprp', ipco, size);
  const meta = box(
    'meta',
    concat(u32(0), options.outsideMeta ? new Uint8Array() : iprp),
    size,
  );
  return concat(ftyp, meta, options.outsideMeta ?? new Uint8Array());
}

function ispe(width: number, height: number, extended = false): Uint8Array {
  return box(
    'ispe',
    concat(u32(0), u32(width), u32(height)),
    extended ? 'extended' : 'normal',
  );
}

function clap(width: number, height: number): Uint8Array {
  return box(
    'clap',
    concat(
      u32(width),
      u32(1),
      u32(height),
      u32(1),
      u32(0),
      u32(1),
      u32(0),
      u32(1),
    ),
  );
}

function jp2(header: Uint8Array, extended = false): Uint8Array {
  const size = extended ? 'extended' : 'normal';
  return concat(
    box('jP  ', Uint8Array.from([0x0d, 0x0a, 0x87, 0x0a]), size),
    box('ftyp', concat(ascii('jp2 '), u32(0), ascii('jp2 ')), size),
    box('jp2h', header, size),
  );
}

function ihdr(width: number, height: number, extended = false): Uint8Array {
  return box(
    'ihdr',
    concat(u32(height), u32(width)),
    extended ? 'extended' : 'normal',
  );
}

describe('bounds-safe image metadata parsing', () => {
  it('limits numeric reads to a typed-array subview', () => {
    const backing = Uint8Array.from([0xaa, 0xbb, 0, 0, 0, 7, 0xcc]);
    const fullView = new Uint8Array(backing.buffer, 2, 4);
    const emptyView = new Uint8Array(backing.buffer, 2, 0);

    expect(readUInt32BE(fullView)).toBe(7);
    expect(() => readUInt32BE(emptyView)).toThrow(RangeError);
  });

  it('parses a complete nonzero-offset PNG view but never borrows hidden bytes', () => {
    const png = concat(
      Uint8Array.from([0x89]),
      ascii('PNG\r\n\x1a\n'),
      u32(13),
      ascii('IHDR'),
      u32(7),
      u32(9),
    );
    const backing = new Uint8Array(png.length + 10).fill(0xa5);
    backing.set(png, 5);

    expect(imageSize(new Uint8Array(backing.buffer, 5, png.length))).toEqual({
      height: 9,
      type: 'png',
      width: 7,
    });

    const truncated = new Uint8Array(backing.buffer, 5, png.length - 1);
    expect(() => imageSize(truncated)).toThrow(RangeError);
    expect(() => imageSize(Uint8Array.from(truncated))).toThrow(RangeError);
  });

  it('supports valid normal, zero-to-parent-end, and extended ISO boxes', () => {
    const normal = box('free');
    const zero = box('last', Uint8Array.of(1, 2), 'zero');
    const extended = box('wide', Uint8Array.of(3, 4), 'extended');
    const input = concat(normal, extended, zero);

    expect(findBox(input, 'free', 0)).toMatchObject({
      headerSize: 8,
      offset: 0,
      size: 8,
    });
    expect(findBox(input, 'wide', 0)).toMatchObject({
      headerSize: 16,
      offset: 8,
      size: 18,
    });
    expect(findBox(input, 'last', 0)).toMatchObject({
      headerSize: 8,
      offset: 26,
      size: 10,
    });
  });

  it.each([
    concat(u32(1), ascii('wide')),
    concat(u32(1), ascii('wide'), u64(15n)),
    concat(u32(1), ascii('wide'), u64(24n), Uint8Array.of(1)),
    concat(u32(1), ascii('wide'), u64(BigInt(Number.MAX_SAFE_INTEGER) + 1n)),
  ])('rejects malformed ISO extended-size boxes', input => {
    expect(findBox(input, 'wide', 0)).toBeUndefined();
  });

  it('never finds a box outside the declared parent extent', () => {
    const inside = box('free');
    const outside = box('want');
    const input = concat(inside, outside);

    expect(findBox(input, 'want', 0, inside.length)).toBeUndefined();
  });

  it('ignores truncated EXIF metadata and continues to a valid JPEG frame', () => {
    const input = concat(
      Uint8Array.of(0xff, 0xd8, 0xff, 0xe1),
      u16(18),
      ascii('Exif\0\0'),
      Uint8Array.of(0x4d, 0x4d, 0, 0x2a),
      u32(8),
      u16(1),
      Uint8Array.of(0xff, 0xc0),
      u16(11),
      Uint8Array.of(8),
      u16(9),
      u16(7),
      Uint8Array.of(1, 1, 0x11, 0),
    );

    expect(imageSize(input)).toEqual({ height: 9, type: 'jpg', width: 7 });
  });

  it('reads JPEG orientation from the TIFF-declared IFD offset', () => {
    const exif = concat(
      ascii('Exif\0\0'),
      Uint8Array.of(0x4d, 0x4d, 0, 0x2a),
      u32(16),
      new Uint8Array(8),
      u16(1),
      Uint8Array.of(0x01, 0x12, 0, 3),
      u32(1),
      Uint8Array.of(0, 6, 0, 0),
    );
    const input = concat(
      Uint8Array.of(0xff, 0xd8, 0xff, 0xe1),
      u16(exif.length + 2),
      exif,
      Uint8Array.of(0xff, 0xc0),
      u16(11),
      Uint8Array.of(8),
      u16(9),
      u16(7),
      Uint8Array.of(1, 1, 0x11, 0),
    );

    expect(imageSize(input)).toEqual({
      height: 9,
      orientation: 6,
      type: 'jpg',
      width: 7,
    });
  });

  it('accepts legal JPEG marker fill before a frame header', () => {
    const input = Uint8Array.of(
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      2,
      0xff,
      0xff,
      0xc0,
      0,
      11,
      8,
      0,
      9,
      0,
      7,
      1,
      1,
      0x11,
      0,
    );

    expect(imageSize(input)).toEqual({ height: 9, type: 'jpg', width: 7 });
  });
});

describe('HEIF bounds', () => {
  it('parses normal and extended box trees using their actual header sizes', () => {
    expect(HEIF.calculate(heif(ispe(7, 9)))).toMatchObject({
      height: 9,
      width: 7,
    });
    expect(
      HEIF.calculate(heif(ispe(11, 13, true), { extended: true })),
    ).toMatchObject({
      height: 13,
      width: 11,
    });
  });

  it('applies a structurally valid clean-aperture box', () => {
    expect(
      HEIF.calculate(heif(concat(ispe(10, 12), clap(7, 9)))),
    ).toMatchObject({
      height: 9,
      width: 7,
    });
  });

  it('rejects an undersized ispe instead of reading following bytes', () => {
    expect(() =>
      HEIF.calculate(heif(concat(box('ispe'), u32(7), u32(9)))),
    ).toThrow('Invalid HEIF, no sizes found');
  });

  it('does not search for iprp outside the declared meta box', () => {
    const escapedIprp = box('iprp', box('ipco', ispe(7, 9)));
    expect(() =>
      HEIF.calculate(heif(new Uint8Array(), { outsideMeta: escapedIprp })),
    ).toThrow('Invalid HEIF, no ipco box found');
  });

  it('ignores a clap whose declared extent crosses its ipco parent', () => {
    const malformedClap = concat(u32(128), ascii('clap'), clap(5, 6).slice(8));
    expect(
      HEIF.calculate(heif(concat(ispe(10, 12), malformedClap))),
    ).toMatchObject({ height: 12, width: 10 });
  });
});

describe('JP2 bounds', () => {
  it('rejects a forged JP2 signature payload', () => {
    const input = concat(
      box('jP  ', new Uint8Array(4)),
      box('ftyp', concat(ascii('jp2 '), u32(0), ascii('jp2 '))),
    );

    expect(JP2.validate(input)).toBe(false);
  });

  it('parses normal and extended ihdr boxes inside jp2h', () => {
    expect(JP2.calculate(jp2(ihdr(7, 9)))).toEqual({ height: 9, width: 7 });
    expect(JP2.calculate(jp2(ihdr(11, 13, true), true))).toEqual({
      height: 13,
      width: 11,
    });
  });

  it('rejects an ihdr sibling outside jp2h', () => {
    expect(() =>
      JP2.calculate(concat(jp2(new Uint8Array()), ihdr(7, 9))),
    ).toThrow('Unsupported JPEG 2000 format');
  });

  it('rejects a short ihdr instead of reading following bytes', () => {
    expect(() =>
      JP2.calculate(jp2(concat(box('ihdr'), u32(9), u32(7)))),
    ).toThrow('Unsupported JPEG 2000 format');
  });
});

describe('ICNS bounds', () => {
  it('preserves a valid zero-payload icon entry', () => {
    const input = concat(ascii('icns'), u32(16), ascii('ic07'), u32(8));
    expect(ICNS.calculate(input)).toEqual({ height: 128, width: 128 });
  });

  it.each([
    concat(ascii('icns'), u32(32), ascii('ic07'), u32(8)),
    concat(ascii('icns'), u32(16), ascii('ic07'), u32(32)),
    concat(ascii('icns'), u32(12), ascii('ic07'), u32(8)),
    concat(ascii('icns'), u32(16), ascii('ic07'), u32(7)),
  ])('rejects truncated files and entries outside declared extents', input => {
    expect(() => ICNS.calculate(input)).toThrow(TypeError);
  });
});
