"use strict";
const __rslib_import_meta_url__ = /*#__PURE__*/ function() {
    return 'undefined' == typeof document ? new (require('url'.replace('', ''))).URL('file:' + __filename).href : document.currentScript && document.currentScript.src || new URL('main.js', document.baseURI).href;
}();
var __webpack_require__ = {};
(()=>{
    __webpack_require__.n = (module)=>{
        var getter = module && module.__esModule ? ()=>module['default'] : ()=>module;
        __webpack_require__.d(getter, {
            a: getter
        });
        return getter;
    };
})();
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
    DIRNAME: ()=>DIRNAME,
    IMAGE_LOADER: ()=>IMAGE_LOADER,
    LOADER: ()=>LOADER,
    SHARED_STORE: ()=>SHARED_STORE
});
const external_node_path_namespaceObject = require("node:path");
var external_node_path_default = /*#__PURE__*/ __webpack_require__.n(external_node_path_namespaceObject);
const external_node_url_namespaceObject = require("node:url");
const DIRNAME = external_node_path_default().dirname((0, external_node_url_namespaceObject.fileURLToPath)(__rslib_import_meta_url__));
const SHARED_STORE = external_node_path_default().resolve(DIRNAME, './shared/store');
const LOADER = external_node_path_default().resolve(DIRNAME, './loader');
const IMAGE_LOADER = external_node_path_default().resolve(DIRNAME, './shared/image-loader');
exports.DIRNAME = __webpack_exports__.DIRNAME;
exports.IMAGE_LOADER = __webpack_exports__.IMAGE_LOADER;
exports.LOADER = __webpack_exports__.LOADER;
exports.SHARED_STORE = __webpack_exports__.SHARED_STORE;
for(var __webpack_i__ in __webpack_exports__)if (-1 === [
    "DIRNAME",
    "IMAGE_LOADER",
    "LOADER",
    "SHARED_STORE"
].indexOf(__webpack_i__)) exports[__webpack_i__] = __webpack_exports__[__webpack_i__];
Object.defineProperty(exports, '__esModule', {
    value: true
});
