"use strict";
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
    default: ()=>loader,
    raw: ()=>raw
});
const external_node_assert_namespaceObject = require("node:assert");
var external_node_assert_default = /*#__PURE__*/ __webpack_require__.n(external_node_assert_namespaceObject);
const external_knitwork_namespaceObject = require("knitwork");
const external_image_js_namespaceObject = require("./image.js");
const external_logger_js_namespaceObject = require("./logger.js");
const constants_js_namespaceObject = require("./shared/constants.js");
const THUMBNAIL_SIZE = 8;
async function process(content) {
    const opts = this.getOptions();
    const assetRequest = `${this.resource}.webpack[asset/resource]!=!${this.resource}`;
    const url = await this.importModule(assetRequest, {
        publicPath: ''
    });
    external_logger_js_namespaceObject.logger.debug(`Loaded asset resource module: ${url}`);
    external_node_assert_default()('string' == typeof url, 'Expected image source to be a string');
    const image = await external_image_js_namespaceObject.Image.create(content);
    const { width, height } = image.size();
    let thumbnail;
    if (false !== opts.thumbnail) {
        const scale = THUMBNAIL_SIZE / Math.max(width, height);
        thumbnail = {
            url: '',
            width: Math.round(width * scale),
            height: Math.round(height * scale)
        };
        external_logger_js_namespaceObject.logger.debug(`Creating thumbnail: ${thumbnail.width}x${thumbnail.height}`);
        image.resize(thumbnail);
        const buf = await image.toBuffer();
        thumbnail.url = `data:image/jpeg;base64,${buf.toString('base64')}`;
        external_logger_js_namespaceObject.logger.debug(`Created thumbnail: ${thumbnail.url}`);
    }
    const imageModuleTempl = (0, external_knitwork_namespaceObject.genObjectFromRaw)({
        url: `__webpack_public_path__ + ${(0, external_knitwork_namespaceObject.genString)(url)}`,
        width: width,
        height: height,
        thumbnail: thumbnail && (0, external_knitwork_namespaceObject.genObjectFromValues)(thumbnail, '  ')
    });
    const exportStmtTempl = `export default ${imageModuleTempl};`;
    external_logger_js_namespaceObject.logger.debug('Output image module template:', exportStmtTempl);
    return exportStmtTempl;
}
function loader(content) {
    const callback = this.async();
    external_logger_js_namespaceObject.logger.debug(`${constants_js_namespaceObject.PACKAGE_NAME} loader is processing: ${this.request}`);
    process.call(this, content).then((content)=>callback(null, content)).catch((err)=>callback(err));
}
const raw = true;
exports["default"] = __webpack_exports__["default"];
exports.raw = __webpack_exports__.raw;
for(var __webpack_i__ in __webpack_exports__)if (-1 === [
    "default",
    "raw"
].indexOf(__webpack_i__)) exports[__webpack_i__] = __webpack_exports__[__webpack_i__];
Object.defineProperty(exports, '__esModule', {
    value: true
});
