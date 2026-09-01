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

// lib/types/heif.ts
var brandMap = {
  avif: "avif",
  mif1: "heif",
  msf1: "heif",
  // heif-sequence
  heic: "heic",
  heix: "heic",
  hevc: "heic",
  // heic-sequence
  hevx: "heic"
  // heic-sequence
};
var HEIF = {
  validate(input) {
    const boxType = toUTF8String(input, 4, 8);
    if (boxType !== "ftyp") return false;
    const ftypBox = findBox(input, "ftyp", 0);
    if (!ftypBox) return false;
    const brand = toUTF8String(input, ftypBox.offset + 8, ftypBox.offset + 12);
    return brand in brandMap;
  },
  calculate(input) {
    const metaBox = findBox(input, "meta", 0);
    const iprpBox = metaBox && findBox(input, "iprp", metaBox.offset + 12);
    const ipcoBox = iprpBox && findBox(input, "ipco", iprpBox.offset + 8);
    if (!ipcoBox) {
      throw new TypeError("Invalid HEIF, no ipco box found");
    }
    const type = toUTF8String(input, 8, 12);
    const images = [];
    let currentOffset = ipcoBox.offset + 8;
    const ipcoEnd = ipcoBox.offset + ipcoBox.size;
    while (currentOffset < ipcoEnd) {
      const ispeBox = findBox(input, "ispe", currentOffset);
      if (!ispeBox) break;
      if (ispeBox.size < 8) break;
      if (ispeBox.offset + ispeBox.size > ipcoEnd) break;
      const rawWidth = readUInt32BE(input, ispeBox.offset + 12);
      const rawHeight = readUInt32BE(input, ispeBox.offset + 16);
      const clapBox = findBox(input, "clap", currentOffset);
      let width = rawWidth;
      let height = rawHeight;
      if (clapBox && clapBox.offset < ipcoEnd && clapBox.size >= 8) {
        const cropRight = readUInt32BE(input, clapBox.offset + 12);
        width = rawWidth - cropRight;
      }
      images.push({ height, width });
      const nextOffset = ispeBox.offset + ispeBox.size;
      if (nextOffset <= currentOffset) break;
      currentOffset = nextOffset;
    }
    if (images.length === 0) {
      throw new TypeError("Invalid HEIF, no sizes found");
    }
    return {
      width: images[0].width,
      height: images[0].height,
      type,
      ...images.length > 1 ? { images } : {}
    };
  }
};

export { HEIF };
