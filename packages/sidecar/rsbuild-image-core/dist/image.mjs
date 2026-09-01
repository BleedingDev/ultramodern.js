import * as __WEBPACK_EXTERNAL_MODULE_image_size_bc738ffb__ from "image-size";
import * as __WEBPACK_EXTERNAL_MODULE__buffer_mjs_74e34751__ from "./buffer.mjs";
import * as __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__ from "./logger.mjs";
let _loadedSharp;
const loadSharp = async ()=>{
    if (_loadedSharp) return _loadedSharp;
    __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug('Intend to load sharp package in first time');
    const mod = await import("sharp");
    const ret = 'default' in mod ? mod.default : mod;
    if ((0, __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.isDebug)()) __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug(`Successfully loaded sharp(${typeof ret}) with keys: ${Object.keys(ret).join(', ')}`);
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
        if ((0, __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.isDebug)()) __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug(`Intend to create a new image instance with buffer: ${(0, __WEBPACK_EXTERNAL_MODULE__buffer_mjs_74e34751__.inspectBuffer)(buf)}`);
        const sharp = await loadSharp();
        return new Image(buf, sharp(buf));
    }
    _size;
    size() {
        if (!this._size) {
            const { width, height } = (0, __WEBPACK_EXTERNAL_MODULE_image_size_bc738ffb__.imageSize)(this.buffer);
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
export { Image, isRotatedOrientation, loadSharp };
