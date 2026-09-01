import * as __WEBPACK_EXTERNAL_MODULE__utils_mjs_25ece7d1__ from "./utils.mjs";
function arrayBufferToHex(buf) {
    return Array.from(new Uint8Array(buf)).map((b)=>b.toString(16).padStart(2, '0')).join(' ');
}
function inspectBuffer(buf, length = 16) {
    const arrBuf = buf instanceof ArrayBuffer ? buf : (0, __WEBPACK_EXTERNAL_MODULE__utils_mjs_25ece7d1__.scopedBuf)(buf.buffer);
    if (!arrBuf) return null;
    const hex = arrayBufferToHex(arrBuf.slice(0, length));
    return `${hex} +${buf.byteLength - length} bytes`;
}
export { arrayBufferToHex, inspectBuffer };
