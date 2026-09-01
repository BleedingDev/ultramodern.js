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
    ipxImageLoader: ()=>ipxImageLoader,
    applyImageLoader: ()=>applyImageLoader,
    default: ()=>image_loader
});
const external_ufo_namespaceObject = require("ufo");
const external_constants_js_namespaceObject = require("./constants.js");
function applyImageLoader(options) {
    const { loader, src, quality, width } = options;
    const url = loader({
        src,
        quality,
        width
    });
    return url;
}
let ipxImageLoaderBasename = external_constants_js_namespaceObject.DEFAULT_IPX_BASENAME;
if ('string' == typeof __RSBUILD_IMAGE_IPX_ASSET_PREFIX__) ipxImageLoaderBasename = __RSBUILD_IMAGE_IPX_ASSET_PREFIX__;
const ipxImageLoader = ({ src, width, quality })=>{
    const params = {
        f: 'auto',
        w: width.toString(),
        q: quality.toString()
    };
    const paramsStr = Object.entries(params).map(([k, v])=>`${k}_${v}`).join(',');
    const parsedSrc = (0, external_ufo_namespaceObject.parseURL)(src);
    parsedSrc.pathname = (0, external_ufo_namespaceObject.joinURL)(ipxImageLoaderBasename, paramsStr, parsedSrc.pathname);
    return (0, external_ufo_namespaceObject.stringifyParsedURL)(parsedSrc);
};
const image_loader = ipxImageLoader;
exports.applyImageLoader = __webpack_exports__.applyImageLoader;
exports["default"] = __webpack_exports__["default"];
exports.ipxImageLoader = __webpack_exports__.ipxImageLoader;
for(var __webpack_i__ in __webpack_exports__)if (-1 === [
    "applyImageLoader",
    "default",
    "ipxImageLoader"
].indexOf(__webpack_i__)) exports[__webpack_i__] = __webpack_exports__[__webpack_i__];
Object.defineProperty(exports, '__esModule', {
    value: true
});
