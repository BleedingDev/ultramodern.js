"use strict";
var __webpack_modules__ = {
    ipx: function(module) {
        module.exports = import("ipx").then(function(module) {
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
(()=>{
    __webpack_require__.r(__webpack_exports__);
    __webpack_require__.d(__webpack_exports__, {
        pluginImage: ()=>pluginImage,
        default: ()=>src_plugin
    });
    const external_node_path_namespaceObject = require("node:path");
    var external_node_path_default = /*#__PURE__*/ __webpack_require__.n(external_node_path_namespaceObject);
    const external_ufo_namespaceObject = require("ufo");
    const external_logger_js_namespaceObject = require("./logger.js");
    const external_resolved_js_namespaceObject = require("./resolved.js");
    const constants_js_namespaceObject = require("./shared/constants.js");
    const external_utils_js_namespaceObject = require("./utils.js");
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
            return await Promise.resolve().then(__webpack_require__.bind(__webpack_require__, "ipx"));
        } catch (err) {
            if ((0, external_utils_js_namespaceObject.isModuleNotFoundError)(err)) throw new IPXNotFoundError();
            throw err;
        }
    }
    function createBundlerStorage(compiler) {
        const useOutputFileSystem = ()=>{
            if (!compiler.outputFileSystem) throw new Error('Unable to access compiler.outputFileSystem from IPX middleware');
            return compiler.outputFileSystem;
        };
        const resolveId = (id)=>external_node_path_default().join(compiler.outputPath, id);
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
                        else resolve(res ? (0, external_utils_js_namespaceObject.scopedBuf)(res) : void 0);
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
            external_logger_js_namespaceObject.logger.warn('Unable to distinguish dev/prod environment');
            isDev = true;
        }
        return isDev;
    }
    const pluginImage = (options = {})=>({
            name: '@rsbuild-image/core',
            async setup (api) {
                const { densities, loading, placeholder, quality } = options;
                const { loader = external_resolved_js_namespaceObject.IMAGE_LOADER } = options;
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
                    const { assetPrefix = constants_js_namespaceObject.DEFAULT_IPX_BASENAME, ...ipxOptions } = ipx;
                    return mergeRsbuildConfig(config, {
                        source: {
                            define: {
                                __RSBUILD_IMAGE_IPX_ASSET_PREFIX__: JSON.stringify(assetPrefix)
                            }
                        },
                        dev: {
                            setupMiddlewares: [
                                (middlewares)=>{
                                    (0, external_utils_js_namespaceObject.invariant)(compiler, 'Compiler is not initialized while setup the IPX middleware');
                                    const { distPath } = api.context;
                                    (0, external_utils_js_namespaceObject.invariant)('string' == typeof distPath);
                                    const { storage = createBundlerStorage(compiler), ...rest } = ipxOptions;
                                    const ipx = createIPX({
                                        storage,
                                        ...rest
                                    });
                                    external_logger_js_namespaceObject.logger.debug(`Created IPX with local storage from ${distPath}`);
                                    external_logger_js_namespaceObject.logger.debug(`Created IPX with assetPrefix ${assetPrefix}`);
                                    const originalMiddleware = createIPXNodeServer(ipx);
                                    middlewares.unshift((req, res, _next)=>{
                                        const next = ()=>{
                                            external_logger_js_namespaceObject.logger.debug(`IPX middleware incoming request: ${req.url}`);
                                            _next();
                                        };
                                        if (!req.url) return next();
                                        const newUrl = (0, external_ufo_namespaceObject.withoutBase)(req.url, assetPrefix);
                                        if (newUrl === req.url) return next();
                                        req.url = newUrl;
                                        external_logger_js_namespaceObject.logger.debug(`IPX middleware incoming request (accepted): ${req.url}`);
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
                    chain.module.rule('image-component-module').type("javascript/auto").resourceQuery(/\?image$/).use('image-component-loader').loader(external_resolved_js_namespaceObject.LOADER).options(loaderOptions);
                });
            }
        });
    const src_plugin = pluginImage;
})();
exports["default"] = __webpack_exports__["default"];
exports.pluginImage = __webpack_exports__.pluginImage;
for(var __webpack_i__ in __webpack_exports__)if (-1 === [
    "default",
    "pluginImage"
].indexOf(__webpack_i__)) exports[__webpack_i__] = __webpack_exports__[__webpack_i__];
Object.defineProperty(exports, '__esModule', {
    value: true
});
