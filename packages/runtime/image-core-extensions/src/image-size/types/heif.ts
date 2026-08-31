import type { IImage, ISize } from './interface';
import { findBox, readUInt32BE, toUTF8String } from './utils';

const brandMap = {
  avif: 'avif',
  mif1: 'heif',
  msf1: 'heif',
  heic: 'heic',
  heix: 'heic',
  hevc: 'heic',
  hevx: 'heic',
} as const;

type HeifBrand = keyof typeof brandMap;

function readBrand(input: Uint8Array): HeifBrand | undefined {
  const ftyp = findBox(input, 'ftyp', 0);
  if (!ftyp || ftyp.end - ftyp.contentOffset < 4) return undefined;
  const brand = toUTF8String(input, ftyp.contentOffset, ftyp.contentOffset + 4);
  return brand in brandMap ? (brand as HeifBrand) : undefined;
}

function readCleanAperture(
  input: Uint8Array,
  offset: number,
): { width: number; height: number } | undefined {
  const widthNumerator = readUInt32BE(input, offset);
  const widthDenominator = readUInt32BE(input, offset + 4);
  const heightNumerator = readUInt32BE(input, offset + 8);
  const heightDenominator = readUInt32BE(input, offset + 12);
  if (widthDenominator === 0 || heightDenominator === 0) return undefined;

  const width = widthNumerator / widthDenominator;
  const height = heightNumerator / heightDenominator;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { height, width };
}

export const HEIF: IImage = {
  validate(input) {
    return readBrand(input) !== undefined;
  },

  calculate(input) {
    const meta = findBox(input, 'meta', 0);
    const metaContent = meta && meta.contentOffset + 4;
    const iprp =
      meta && metaContent !== undefined && metaContent <= meta.end
        ? findBox(input, 'iprp', metaContent, meta.end)
        : undefined;
    const ipco = iprp
      ? findBox(input, 'ipco', iprp.contentOffset, iprp.end)
      : undefined;

    if (!ipco) {
      throw new TypeError('Invalid HEIF, no ipco box found');
    }

    const brand = readBrand(input);
    const images: ISize[] = [];
    let offset = ipco.contentOffset;

    while (offset < ipco.end) {
      const ispe = findBox(input, 'ispe', offset, ipco.end);
      if (!ispe) break;
      if (ispe.end - ispe.contentOffset < 12) {
        offset = ispe.end;
        continue;
      }

      const rawWidth = readUInt32BE(input, ispe.contentOffset + 4);
      const rawHeight = readUInt32BE(input, ispe.contentOffset + 8);
      let width = rawWidth;
      let height = rawHeight;

      const nextIspe = findBox(input, 'ispe', ispe.end, ipco.end);
      const cleanAperture = findBox(input, 'clap', ispe.end, ipco.end);
      if (
        cleanAperture &&
        (!nextIspe || cleanAperture.offset < nextIspe.offset) &&
        cleanAperture.end - cleanAperture.contentOffset >= 32
      ) {
        const dimensions = readCleanAperture(
          input,
          cleanAperture.contentOffset,
        );
        if (dimensions) {
          ({ height, width } = dimensions);
        }
      }

      images.push({ height, width });
      offset = ispe.end;
    }

    if (images.length === 0) {
      throw new TypeError('Invalid HEIF, no sizes found');
    }

    return {
      height: images[0].height,
      width: images[0].width,
      type: brand ? brandMap[brand] : undefined,
      ...(images.length > 1 ? { images } : {}),
    };
  },
};
