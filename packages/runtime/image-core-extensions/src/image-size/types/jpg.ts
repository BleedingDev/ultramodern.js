// NOTE: we only support baseline and progressive JPGs here
// due to the structure of the loader class, we only get a buffer
// with a maximum size of 4096 bytes. so if the SOF marker is outside
// if this range we can't detect the file size correctly.

import type { IImage, ISize } from './interface';
import { readUInt, readUInt16BE, toHexString } from './utils';

const EXIF_MARKER = '45786966';
const APP1_DATA_SIZE_BYTES = 2;
const EXIF_HEADER_BYTES = 6;
const TIFF_BYTE_ALIGN_BYTES = 2;
const BIG_ENDIAN_BYTE_ALIGN = '4d4d';
const LITTLE_ENDIAN_BYTE_ALIGN = '4949';

// Each entry is exactly 12 bytes
const IDF_ENTRY_BYTES = 12;
const NUM_DIRECTORY_ENTRIES_BYTES = 2;

function isEXIF(input: Uint8Array): boolean {
  return toHexString(input, 2, 6) === EXIF_MARKER;
}

function extractSize(input: Uint8Array, index: number): ISize {
  return {
    height: readUInt16BE(input, index),
    width: readUInt16BE(input, index + 2),
  };
}

function extractOrientation(exifBlock: Uint8Array, isBigEndian: boolean) {
  const tiffHeaderEnd = EXIF_HEADER_BYTES + 8;
  if (tiffHeaderEnd > exifBlock.length) {
    return;
  }

  const idfOffset = readUInt(exifBlock, 32, EXIF_HEADER_BYTES + 4, isBigEndian);
  const offset = EXIF_HEADER_BYTES + idfOffset;

  if (
    idfOffset < 8 ||
    offset + NUM_DIRECTORY_ENTRIES_BYTES > exifBlock.length
  ) {
    return;
  }

  const idfDirectoryEntries = readUInt(exifBlock, 16, offset, isBigEndian);

  for (
    let directoryEntryNumber = 0;
    directoryEntryNumber < idfDirectoryEntries;
    directoryEntryNumber++
  ) {
    const start =
      offset +
      NUM_DIRECTORY_ENTRIES_BYTES +
      directoryEntryNumber * IDF_ENTRY_BYTES;
    const end = start + IDF_ENTRY_BYTES;

    // Skip on corrupt EXIF blocks
    if (end > exifBlock.length) {
      return;
    }

    const block = exifBlock.slice(start, end);
    const tagNumber = readUInt(block, 16, 0, isBigEndian);

    // 0x0112 (decimal: 274) is the `orientation` tag ID
    if (tagNumber === 274) {
      const dataFormat = readUInt(block, 16, 2, isBigEndian);
      if (dataFormat !== 3) {
        return;
      }

      // unsinged int has 2 bytes per component
      // if there would more than 4 bytes in total it's a pointer
      const numberOfComponents = readUInt(block, 32, 4, isBigEndian);
      if (numberOfComponents !== 1) {
        return;
      }

      return readUInt(block, 16, 8, isBigEndian);
    }
  }
}

function validateExifBlock(input: Uint8Array, index: number) {
  // Skip APP1 Data Size
  const exifBlock = input.slice(APP1_DATA_SIZE_BYTES, index);

  // Consider byte alignment
  const byteAlign = toHexString(
    exifBlock,
    EXIF_HEADER_BYTES,
    EXIF_HEADER_BYTES + TIFF_BYTE_ALIGN_BYTES,
  );

  // Ignore Empty EXIF. Validate byte alignment
  const isBigEndian = byteAlign === BIG_ENDIAN_BYTE_ALIGN;
  const isLittleEndian = byteAlign === LITTLE_ENDIAN_BYTE_ALIGN;

  if (isBigEndian || isLittleEndian) {
    return extractOrientation(exifBlock, isBigEndian);
  }
}

export const JPG: IImage = {
  validate: input => toHexString(input, 0, 2) === 'ffd8',

  calculate(input) {
    let offset = 2;
    let orientation: number | undefined;
    while (offset < input.length) {
      if (input[offset] !== 0xff) {
        throw new TypeError('Corrupt JPG, expected marker');
      }

      while (offset < input.length && input[offset] === 0xff) {
        offset++;
      }
      if (offset >= input.length) {
        break;
      }

      const marker = input[offset++];
      if (
        marker === 0x01 ||
        marker === 0xd8 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) {
        break;
      }

      if (offset + 2 > input.length) {
        throw new TypeError('Corrupt JPG, truncated segment length');
      }
      const segmentLength = readUInt16BE(input, offset);
      const segmentEnd = offset + segmentLength;
      if (segmentLength < 2 || segmentEnd > input.length) {
        throw new TypeError('Corrupt JPG, invalid segment length');
      }

      const segment = input.subarray(offset, segmentEnd);
      if (marker === 0xe1 && isEXIF(segment)) {
        orientation = validateExifBlock(segment, segmentLength);
      }

      // 0xFFC0 is baseline standard(SOF)
      // 0xFFC1 is baseline optimized(SOF)
      // 0xFFC2 is progressive(SOF2)
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        if (segmentLength < 7) {
          throw new TypeError('Corrupt JPG, truncated frame header');
        }
        const size = extractSize(input, offset + 3);

        // TODO: is orientation=0 a valid answer here?
        if (!orientation) {
          return size;
        }

        return {
          height: size.height,
          orientation,
          width: size.width,
        };
      }

      offset = segmentEnd;
    }

    throw new TypeError('Invalid JPG, no size found');
  },
};
