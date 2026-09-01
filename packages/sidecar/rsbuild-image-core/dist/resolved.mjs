import * as __WEBPACK_EXTERNAL_MODULE_node_path_c5b9b54f__ from "node:path";
import * as __WEBPACK_EXTERNAL_MODULE_node_url_e96de089__ from "node:url";
const DIRNAME = __WEBPACK_EXTERNAL_MODULE_node_path_c5b9b54f__["default"].dirname((0, __WEBPACK_EXTERNAL_MODULE_node_url_e96de089__.fileURLToPath)(import.meta.url));
const SHARED_STORE = __WEBPACK_EXTERNAL_MODULE_node_path_c5b9b54f__["default"].resolve(DIRNAME, './shared/store');
const LOADER = __WEBPACK_EXTERNAL_MODULE_node_path_c5b9b54f__["default"].resolve(DIRNAME, './loader');
const IMAGE_LOADER = __WEBPACK_EXTERNAL_MODULE_node_path_c5b9b54f__["default"].resolve(DIRNAME, './shared/image-loader');
export { DIRNAME, IMAGE_LOADER, LOADER, SHARED_STORE };
