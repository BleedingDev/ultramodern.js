import * as __WEBPACK_EXTERNAL_MODULE_node_path_c5b9b54f__ from "node:path";
import * as __WEBPACK_EXTERNAL_MODULE_ufo__ from "ufo";
import * as __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__ from "./logger.mjs";
import * as __WEBPACK_EXTERNAL_MODULE__resolved_mjs_76a39197__ from "./resolved.mjs";
import * as __WEBPACK_EXTERNAL_MODULE__shared_constants_mjs_76ea53b8__ from "./shared/constants.mjs";
import * as __WEBPACK_EXTERNAL_MODULE__utils_mjs_25ece7d1__ from "./utils.mjs";
class IPXNotFoundError extends Error {
    constructor(){
        super('Failed to load ipx module, try to install it by `pnpm add -D ipx` or leave the `ipx` option empty and setup any other image loader.');
        this.name = 'IPXNotFoundError';
    }
}
class LoaderOrIPXRequiredError extends Error {
    constructor(){
        super('You must enable the builtin `ipx` middleware or configure a custom `loader` file to use the image plugin.');
    }
}
async function loadIPXModule() {
    try {
        return await import("ipx");
    } catch (err) {
        if ((0, __WEBPACK_EXTERNAL_MODULE__utils_mjs_25ece7d1__.isModuleNotFoundError)(err)) throw new IPXNotFoundError();
        throw err;
    }
}
function createBundlerStorage(compiler) {
    const useOutputFileSystem = ()=>{
        if (!compiler.outputFileSystem) throw new Error('Unable to access compiler.outputFileSystem from IPX middleware');
        return compiler.outputFileSystem;
    };
    const resolveId = (id)=>__WEBPACK_EXTERNAL_MODULE_node_path_c5b9b54f__["default"].join(compiler.outputPath, id);
    return {
        name: 'rsbuild-image:bundler-ofs',
        getMeta (id) {
            const ofs = useOutputFileSystem();
            return new Promise((resolve, reject)=>{
                ofs.stat(resolveId(id), (err, res)=>{
                    if (err) reject(err);
                    else resolve(res);
                });
            });
        },
        getData (id) {
            const ofs = useOutputFileSystem();
            return new Promise((resolve, reject)=>{
                ofs.readFile(resolveId(id), (err, res)=>{
                    if (err) reject(err);
                    else resolve(res ? (0, __WEBPACK_EXTERNAL_MODULE__utils_mjs_25ece7d1__.scopedBuf)(res) : void 0);
                });
            });
        }
    };
}
function plugin_isDev(api) {
    let isDev;
    if ('string' == typeof api.context.action) isDev = 'dev' === api.context.action;
    else if ('command' in api.context) isDev = 'dev' === api.context.command;
    else {
        __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.warn('Unable to distinguish dev/prod environment');
        isDev = true;
    }
    return isDev;
}
const pluginImage = (options = {})=>({
        name: '@rsbuild-image/core',
        async setup (api) {
            const { densities, loading, placeholder, quality } = options;
            const { loader = __WEBPACK_EXTERNAL_MODULE__resolved_mjs_76a39197__.IMAGE_LOADER } = options;
            const serializable = {
                densities,
                loader,
                loading,
                placeholder,
                quality
            };
            api.modifyRsbuildConfig(async (config, { mergeRsbuildConfig })=>mergeRsbuildConfig(config, {
                    source: {
                        define: {
                            __INTERNAL_RSBUILD_IMAGE_OPTIONS__: JSON.stringify(serializable)
                        }
                    },
                    resolve: {
                        alias: (aliases)=>({
                                ...aliases,
                                '@rsbuild-image/core/image-loader': loader
                            })
                    }
                }));
            let compiler;
            api.onAfterCreateCompiler((params)=>{
                if (compiler) return;
                compiler = 'compilers' in params.compiler ? params.compiler.compilers[0] : params.compiler;
            });
            api.modifyRsbuildConfig(async (config, { mergeRsbuildConfig })=>{
                const ipx = plugin_isDev(api) ? options?.ipx : void 0;
                if (!ipx && !options?.loader) throw new LoaderOrIPXRequiredError();
                if (!ipx) return;
                const { createIPX, createIPXNodeServer } = await loadIPXModule();
                const { assetPrefix = __WEBPACK_EXTERNAL_MODULE__shared_constants_mjs_76ea53b8__.DEFAULT_IPX_BASENAME, ...ipxOptions } = ipx;
                return mergeRsbuildConfig(config, {
                    source: {
                        define: {
                            __RSBUILD_IMAGE_IPX_ASSET_PREFIX__: JSON.stringify(assetPrefix)
                        }
                    },
                    dev: {
                        setupMiddlewares: [
                            (middlewares)=>{
                                (0, __WEBPACK_EXTERNAL_MODULE__utils_mjs_25ece7d1__.invariant)(compiler, 'Compiler is not initialized while setup the IPX middleware');
                                const { distPath } = api.context;
                                (0, __WEBPACK_EXTERNAL_MODULE__utils_mjs_25ece7d1__.invariant)('string' == typeof distPath);
                                const { storage = createBundlerStorage(compiler), ...rest } = ipxOptions;
                                const ipx = createIPX({
                                    storage,
                                    ...rest
                                });
                                __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug(`Created IPX with local storage from ${distPath}`);
                                __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug(`Created IPX with assetPrefix ${assetPrefix}`);
                                const originalMiddleware = createIPXNodeServer(ipx);
                                middlewares.unshift((req, res, _next)=>{
                                    const next = ()=>{
                                        __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug(`IPX middleware incoming request: ${req.url}`);
                                        _next();
                                    };
                                    if (!req.url) return next();
                                    const newUrl = (0, __WEBPACK_EXTERNAL_MODULE_ufo__.withoutBase)(req.url, assetPrefix);
                                    if (newUrl === req.url) return next();
                                    req.url = newUrl;
                                    __WEBPACK_EXTERNAL_MODULE__logger_mjs_dfc7ebda__.logger.debug(`IPX middleware incoming request (accepted): ${req.url}`);
                                    return originalMiddleware(req, res);
                                });
                            }
                        ]
                    }
                });
            });
            api.modifyBundlerChain((chain)=>{
                const { thumbnail } = options ?? {};
                const loaderOptions = {
                    thumbnail
                };
                chain.module.rule('image-component-module').type("javascript/auto").resourceQuery(/\?image$/).use('image-component-loader').loader(__WEBPACK_EXTERNAL_MODULE__resolved_mjs_76a39197__.LOADER).options(loaderOptions);
            });
        }
    });
const src_plugin = pluginImage;
export { src_plugin as default, pluginImage };
