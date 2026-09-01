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
    arrayBufferToHex: ()=>arrayBufferToHex,
    inspectBuffer: ()=>inspectBuffer
});
const external_utils_js_namespaceObject = require("./utils.js");
function arrayBufferToHex(buf) {
    return Array.from(new Uint8Array(buf)).map((b)=>b.toString(16).padStart(2, '0')).join(' ');
}
function inspectBuffer(buf, length = 16) {
    const arrBuf = buf instanceof ArrayBuffer ? buf : (0, external_utils_js_namespaceObject.scopedBuf)(buf.buffer);
    if (!arrBuf) return null;
    const hex = arrayBufferToHex(arrBuf.slice(0, length));
    return `${hex} +${buf.byteLength - length} bytes`;
}
exports.arrayBufferToHex = __webpack_exports__.arrayBufferToHex;
exports.inspectBuffer = __webpack_exports__.inspectBuffer;
for(var __webpack_i__ in __webpack_exports__)if (-1 === [
    "arrayBufferToHex",
    "inspectBuffer"
].indexOf(__webpack_i__)) exports[__webpack_i__] = __webpack_exports__[__webpack_i__];
Object.defineProperty(exports, '__esModule', {
    value: true
});
