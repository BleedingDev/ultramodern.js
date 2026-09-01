"use strict";
var __webpack_require__ = {};
(()=>{
    __webpack_require__.d = (exports1, definition)=>{
        for(var key in definition)if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports1, key)) Object.defineProperty(exports1, key, {
            enumerable: true,
            get: definition[key]
        });
    };
})();
(()=>{
    __webpack_require__.o = (obj, prop)=>Object.prototype.hasOwnProperty.call(obj, prop);
})();
(()=>{
    __webpack_require__.r = (exports1)=>{
        if ('undefined' != typeof Symbol && Symbol.toStringTag) Object.defineProperty(exports1, Symbol.toStringTag, {
            value: 'Module'
        });
        Object.defineProperty(exports1, '__esModule', {
            value: true
        });
    };
})();
var __webpack_exports__ = {};
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
    anyBuf: ()=>anyBuf,
    invariant: ()=>invariant,
    isModuleNotFoundError: ()=>isModuleNotFoundError,
    scopedBuf: ()=>scopedBuf,
    str2buf: ()=>str2buf,
    str2u8: ()=>str2u8
});
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
exports.anyBuf = __webpack_exports__.anyBuf;
exports.invariant = __webpack_exports__.invariant;
exports.isModuleNotFoundError = __webpack_exports__.isModuleNotFoundError;
exports.scopedBuf = __webpack_exports__.scopedBuf;
exports.str2buf = __webpack_exports__.str2buf;
exports.str2u8 = __webpack_exports__.str2u8;
for(var __webpack_i__ in __webpack_exports__)if (-1 === [
    "anyBuf",
    "invariant",
    "isModuleNotFoundError",
    "scopedBuf",
    "str2buf",
    "str2u8"
].indexOf(__webpack_i__)) exports[__webpack_i__] = __webpack_exports__[__webpack_i__];
Object.defineProperty(exports, '__esModule', {
    value: true
});
