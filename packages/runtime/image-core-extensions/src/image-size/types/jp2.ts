import type { IImage } from './interface';
import { findBox, readUInt32BE, toUTF8String } from './utils';

export const JP2: IImage = {
  validate(input) {
    const signature = findBox(input, 'jP  ', 0);
    if (!signature || signature.offset !== 0) return false;

    const ftyp = findBox(input, 'ftyp', signature.end);
    if (!ftyp || ftyp.end - ftyp.contentOffset < 4) return false;
    return (
      toUTF8String(input, ftyp.contentOffset, ftyp.contentOffset + 4) === 'jp2 '
    );
  },

  calculate(input) {
    const jp2h = findBox(input, 'jp2h', 0);
    const ihdr = jp2h
      ? findBox(input, 'ihdr', jp2h.contentOffset, jp2h.end)
      : undefined;

    if (ihdr && ihdr.end - ihdr.contentOffset >= 8) {
      return {
        height: readUInt32BE(input, ihdr.contentOffset),
        width: readUInt32BE(input, ihdr.contentOffset + 4),
      };
    }
    throw new TypeError('Unsupported JPEG 2000 format');
  },
};
