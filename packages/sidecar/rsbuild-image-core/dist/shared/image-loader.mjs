import * as __WEBPACK_EXTERNAL_MODULE_ufo__ from "ufo";
import * as __WEBPACK_EXTERNAL_MODULE__constants_mjs_225410ff__ from "./constants.mjs";
function applyImageLoader(options) {
    const { loader, src, quality, width } = options;
    const url = loader({
        src,
        quality,
        width
    });
    return url;
}
let ipxImageLoaderBasename = __WEBPACK_EXTERNAL_MODULE__constants_mjs_225410ff__.DEFAULT_IPX_BASENAME;
if ('string' == typeof __RSBUILD_IMAGE_IPX_ASSET_PREFIX__) ipxImageLoaderBasename = __RSBUILD_IMAGE_IPX_ASSET_PREFIX__;
const ipxImageLoader = ({ src, width, quality })=>{
    const params = {
        f: 'auto',
        w: width.toString(),
        q: quality.toString()
    };
    const paramsStr = Object.entries(params).map(([k, v])=>`${k}_${v}`).join(',');
    const parsedSrc = (0, __WEBPACK_EXTERNAL_MODULE_ufo__.parseURL)(src);
    parsedSrc.pathname = (0, __WEBPACK_EXTERNAL_MODULE_ufo__.joinURL)(ipxImageLoaderBasename, paramsStr, parsedSrc.pathname);
    return (0, __WEBPACK_EXTERNAL_MODULE_ufo__.stringifyParsedURL)(parsedSrc);
};
const image_loader = ipxImageLoader;
export { applyImageLoader, image_loader as default, ipxImageLoader };
