'use strict';

// lib/types/utils.ts
var decoder = new TextDecoder();
var toUTF8String = (input, start = 0, end = input.length) => decoder.decode(input.slice(start, end));
var getView = (input, offset) => new DataView(input.buffer, input.byteOffset + offset);
var readUInt32BE = (input, offset = 0) => getView(input, offset).getUint32(0, false);
var MIN_BOX_HEADER = 8;
function readBox(input, offset) {
  if (input.length - offset < MIN_BOX_HEADER) return;
  const boxSize = readUInt32BE(input, offset);
  if (boxSize === 0) {
    return {
      name: toUTF8String(input, offset + 4, offset + 8),
      offset,
      size: input.length - offset
    };
  }
  if (boxSize === 1) return;
  if (boxSize < MIN_BOX_HEADER) return;
  if (input.length - offset < boxSize) return;
  return {
    name: toUTF8String(input, offset + 4, offset + 8),
    offset,
    size: boxSize
  };
}
function findBox(input, boxName, startOffset) {
  let offset = startOffset;
  while (offset < input.length) {
    const box = readBox(input, offset);
    if (!box) break;
    if (box.name === boxName) return box;
    if (box.size < MIN_BOX_HEADER) break;
    const nextOffset = offset + box.size;
    if (nextOffset <= offset) break;
    offset = nextOffset;
  }
}

// lib/types/jp2.ts
var JP2 = {
  validate(input) {
    const boxType = toUTF8String(input, 4, 8);
    if (boxType !== "jP  ") return false;
    const ftypBox = findBox(input, "ftyp", 0);
    if (!ftypBox) return false;
    const brand = toUTF8String(input, ftypBox.offset + 8, ftypBox.offset + 12);
    return brand === "jp2 ";
  },
  calculate(input) {
    const jp2hBox = findBox(input, "jp2h", 0);
    const ihdrBox = jp2hBox && jp2hBox.size >= 8 && findBox(input, "ihdr", jp2hBox.offset + 8);
    if (ihdrBox && ihdrBox.size >= 8) {
      return {
        height: readUInt32BE(input, ihdrBox.offset + 8),
        width: readUInt32BE(input, ihdrBox.offset + 12)
      };
    }
    throw new TypeError("Unsupported JPEG 2000 format");
  }
};

exports.JP2 = JP2;
