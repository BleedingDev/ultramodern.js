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
    isDebug: ()=>isDebug,
    logger: ()=>logger
});
const external_rslog_namespaceObject = require("rslog");
const logger = (0, external_rslog_namespaceObject.createLogger)();
const isDebug = ()=>{
    if (!process.env.DEBUG) return false;
    const values = process.env.DEBUG.toLocaleLowerCase().split(',');
    return [
        'rsbuild:image',
        'rsbuild:*',
        '*'
    ].some((key)=>values.includes(key));
};
if (isDebug()) logger.level = 'verbose';
exports.isDebug = __webpack_exports__.isDebug;
exports.logger = __webpack_exports__.logger;
for(var __webpack_i__ in __webpack_exports__)if (-1 === [
    "isDebug",
    "logger"
].indexOf(__webpack_i__)) exports[__webpack_i__] = __webpack_exports__[__webpack_i__];
Object.defineProperty(exports, '__esModule', {
    value: true
});
