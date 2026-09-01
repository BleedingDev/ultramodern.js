function isModuleNotFoundError(err) {
    return err instanceof Error && 'code' in err && ('ERR_MODULE_NOT_FOUND' === err.code || 'MODULE_NOT_FOUND' === err.code);
}
function invariant(condition, message) {
    if (!condition) throw new Error(message ?? 'Assertion error');
}
const textEncoder = new TextEncoder();
function str2u8(str) {
    return textEncoder.encode(str);
}
function str2buf(str) {
    const u8arr = str2u8(str);
    return u8arr.buffer;
}
function anyBuf(buf) {
    if ('string' == typeof buf) return str2buf(buf);
    if (Buffer.isBuffer(buf)) return buf.buffer;
    return buf;
}
function scopedBuf(buf) {
    const ret = anyBuf(buf);
    if (ret instanceof ArrayBuffer) return ret;
}
export { anyBuf, invariant, isModuleNotFoundError, scopedBuf, str2buf, str2u8 };
