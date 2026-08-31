const decoder = new TextDecoder();

export const toUTF8String = (
  input: Uint8Array,
  start = 0,
  end = input.length,
) => decoder.decode(input.slice(start, end));

export const toHexString = (input: Uint8Array, start = 0, end = input.length) =>
  input
    .slice(start, end)
    .reduce((memo, value) => memo + `0${value.toString(16)}`.slice(-2), '');

function getView(input: Uint8Array, offset: number, byteLength: number) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset + byteLength > input.byteLength
  ) {
    throw new RangeError('Offset is outside the Uint8Array view');
  }
  return new DataView(input.buffer, input.byteOffset + offset, byteLength);
}

export const readInt16LE = (input: Uint8Array, offset = 0) =>
  getView(input, offset, 2).getInt16(0, true);

export const readUInt16BE = (input: Uint8Array, offset = 0) =>
  getView(input, offset, 2).getUint16(0, false);

export const readUInt16LE = (input: Uint8Array, offset = 0) =>
  getView(input, offset, 2).getUint16(0, true);

export const readUInt24LE = (input: Uint8Array, offset = 0) => {
  const view = getView(input, offset, 3);
  return view.getUint16(0, true) + (view.getUint8(2) << 16);
};

export const readInt32LE = (input: Uint8Array, offset = 0) =>
  getView(input, offset, 4).getInt32(0, true);

export const readUInt32BE = (input: Uint8Array, offset = 0) =>
  getView(input, offset, 4).getUint32(0, false);

export const readUInt32LE = (input: Uint8Array, offset = 0) =>
  getView(input, offset, 4).getUint32(0, true);

export const readUInt64 = (
  input: Uint8Array,
  offset: number,
  isBigEndian: boolean,
): bigint => getView(input, offset, 8).getBigUint64(0, !isBigEndian);

const methods = {
  readUInt16BE,
  readUInt16LE,
  readUInt32BE,
  readUInt32LE,
} as const;

type MethodName = keyof typeof methods;

export function readUInt(
  input: Uint8Array,
  bits: 16 | 32,
  offset = 0,
  isBigEndian = false,
): number {
  const endian = isBigEndian ? 'BE' : 'LE';
  return methods[`readUInt${bits}${endian}` as MethodName](input, offset);
}

const BOX_HEADER_SIZE = 8;
const EXTENDED_BOX_HEADER_SIZE = 16;

export interface ImageBox {
  name: string;
  offset: number;
  size: number;
  headerSize: 8 | 16;
  contentOffset: number;
  end: number;
}

function readBox(
  input: Uint8Array,
  offset: number,
  parentEnd: number,
): ImageBox | undefined {
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(parentEnd) ||
    offset < 0 ||
    parentEnd > input.length ||
    parentEnd - offset < BOX_HEADER_SIZE
  ) {
    return undefined;
  }

  const compactSize = readUInt32BE(input, offset);
  const name = toUTF8String(input, offset + 4, offset + 8);
  let headerSize: 8 | 16 = BOX_HEADER_SIZE;
  let size: number;

  if (compactSize === 0) {
    size = parentEnd - offset;
  } else if (compactSize === 1) {
    if (parentEnd - offset < EXTENDED_BOX_HEADER_SIZE) return undefined;
    const extendedSize = readUInt64(input, offset + 8, true);
    if (
      extendedSize < BigInt(EXTENDED_BOX_HEADER_SIZE) ||
      extendedSize > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return undefined;
    }
    headerSize = EXTENDED_BOX_HEADER_SIZE;
    size = Number(extendedSize);
  } else {
    if (compactSize < BOX_HEADER_SIZE) return undefined;
    size = compactSize;
  }

  const end = offset + size;
  if (!Number.isSafeInteger(end) || end > parentEnd || end <= offset) {
    return undefined;
  }

  return {
    contentOffset: offset + headerSize,
    end,
    headerSize,
    name,
    offset,
    size,
  };
}

export function findBox(
  input: Uint8Array,
  boxName: string,
  startOffset = 0,
  parentEnd = input.length,
): ImageBox | undefined {
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(parentEnd) ||
    startOffset < 0 ||
    parentEnd < startOffset ||
    parentEnd > input.length
  ) {
    return undefined;
  }

  let offset = startOffset;
  while (offset < parentEnd) {
    const box = readBox(input, offset, parentEnd);
    if (!box) return undefined;
    if (box.name === boxName) return box;
    offset = box.end;
  }
  return undefined;
}
