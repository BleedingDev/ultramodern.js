"use strict";
var __webpack_modules__ = {
    sharp: function(module) {
        module.exports = import("sharp").then(function(module) {
            return module;
        });
    }
};
var __webpack_module_cache__ = {};
function __webpack_require__(moduleId) {
    var cachedModule = __webpack_module_cache__[moduleId];
    if (void 0 !== cachedModule) return cachedModule.exports;
    var module = __webpack_module_cache__[moduleId] = {
        exports: {}
    };
    __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
    return module.exports;
}
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
(()=>{
    __webpack_require__.r(__webpack_exports__);
    __webpack_require__.d(__webpack_exports__, {
        loadSharp: ()=>loadSharp,
        Image: ()=>Image,
        isRotatedOrientation: ()=>isRotatedOrientation
    });
    const external_image_size_namespaceObject = require("image-size");
    const external_buffer_js_namespaceObject = require("./buffer.js");
    const external_logger_js_namespaceObject = require("./logger.js");
    let _loadedSharp;
    const loadSharp = async ()=>{
        if (_loadedSharp) return _loadedSharp;
        external_logger_js_namespaceObject.logger.debug('Intend to load sharp package in first time');
        const mod = await Promise.resolve().then(__webpack_require__.bind(__webpack_require__, "sharp"));
        const ret = 'default' in mod ? mod.default : mod;
        if ((0, external_logger_js_namespaceObject.isDebug)()) external_logger_js_namespaceObject.logger.debug(`Successfully loaded sharp(${typeof ret}) with keys: ${Object.keys(ret).join(', ')}`);
        _loadedSharp = ret;
        return ret;
    };
    function isRotatedOrientation(type, orientation) {
        if (!orientation) return false;
        if (![
            'jpeg',
            'jpg'
        ].includes(type)) throw new Error('Unsupported image type');
        return [
            5,
            6,
            7,
            8
        ].includes(orientation);
    }
    class Image {
        buffer;
        sharp;
        _debugName;
        constructor(buffer, sharp){
            this.buffer = buffer;
            this.sharp = sharp;
        }
        static async create(buf) {
            if ((0, external_logger_js_namespaceObject.isDebug)()) external_logger_js_namespaceObject.logger.debug(`Intend to create a new image instance with buffer: ${(0, external_buffer_js_namespaceObject.inspectBuffer)(buf)}`);
            const sharp = await loadSharp();
            return new Image(buf, sharp(buf));
        }
        _size;
        size() {
            if (!this._size) {
                const { width, height } = (0, external_image_size_namespaceObject.imageSize)(this.buffer);
                this._size = {
                    width,
                    height
                };
            }
            const { width, height } = this._size;
            return {
                width,
                height
            };
        }
        resize(options) {
            const { width, height } = options;
            this._size ||= {
                ...this.size()
            };
            if (void 0 !== width) this._size.width = width;
            if (void 0 !== height) this._size.height = height;
            return this.sharp.resize(options);
        }
        thumbnail(options) {}
        format(format, options) {
            this.sharp.toFormat(format, options);
            return this;
        }
        toBuffer() {
            return this.sharp.toBuffer();
        }
        clone() {
            return new Image(this.buffer, this.sharp.clone());
        }
    }
})();
exports.Image = __webpack_exports__.Image;
exports.isRotatedOrientation = __webpack_exports__.isRotatedOrientation;
exports.loadSharp = __webpack_exports__.loadSharp;
for(var __webpack_i__ in __webpack_exports__)if (-1 === [
    "Image",
    "isRotatedOrientation",
    "loadSharp"
].indexOf(__webpack_i__)) exports[__webpack_i__] = __webpack_exports__[__webpack_i__];
Object.defineProperty(exports, '__esModule', {
    value: true
});
