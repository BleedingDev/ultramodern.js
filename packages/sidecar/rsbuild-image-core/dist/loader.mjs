import * as __WEBPACK_EXTERNAL_MODULE_node_assert_3e74d44e__ from "node:assert";
import * as __WEBPACK_EXTERNAL_MODULE_knitwork__ from "knitwork";
import * as __WEBPACK_EXTERNAL_MODULE__image_mjs_2101ad00__ from "./image.mjs";
import * as __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__ from "./logger.mjs";
import * as __WEBPACK_EXTERNAL_MODULE__shared_constants_mjs_76ea53b8__ from "./shared/constants.mjs";
const THUMBNAIL_SIZE = 8;
async function process(content) {
    const opts = this.getOptions();
    const assetRequest = `${this.resource}.webpack[asset/resource]!=!${this.resource}`;
    const url = await this.importModule(assetRequest, {
        publicPath: ''
    });
    __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug(`Loaded asset resource module: ${url}`);
    (0, __WEBPACK_EXTERNAL_MODULE_node_assert_3e74d44e__["default"])('string' == typeof url, 'Expected image source to be a string');
    const image = await __WEBPACK_EXTERNAL_MODULE__image_mjs_2101ad00__.Image.create(content);
    const { width, height } = image.size();
    let thumbnail;
    if (false !== opts.thumbnail) {
        const scale = THUMBNAIL_SIZE / Math.max(width, height);
        thumbnail = {
            url: '',
            width: Math.round(width * scale),
            height: Math.round(height * scale)
        };
        __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug(`Creating thumbnail: ${thumbnail.width}x${thumbnail.height}`);
        image.resize(thumbnail);
        const buf = await image.toBuffer();
        thumbnail.url = `data:image/jpeg;base64,${buf.toString('base64')}`;
        __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug(`Created thumbnail: ${thumbnail.url}`);
    }
    const imageModuleTempl = (0, __WEBPACK_EXTERNAL_MODULE_knitwork__.genObjectFromRaw)({
        url: `__webpack_public_path__ + ${(0, __WEBPACK_EXTERNAL_MODULE_knitwork__.genString)(url)}`,
        width: width,
        height: height,
        thumbnail: thumbnail && (0, __WEBPACK_EXTERNAL_MODULE_knitwork__.genObjectFromValues)(thumbnail, '  ')
    });
    const exportStmtTempl = `export default ${imageModuleTempl};`;
    __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug('Output image module template:', exportStmtTempl);
    return exportStmtTempl;
}
function loader(content) {
    const callback = this.async();
    __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug(`${__WEBPACK_EXTERNAL_MODULE__shared_constants_mjs_76ea53b8__.PACKAGE_NAME} loader is processing: ${this.request}`);
    process.call(this, content).then((content)=>callback(null, content)).catch((err)=>callback(err));
}
const raw = true;
export { loader as default, raw };
