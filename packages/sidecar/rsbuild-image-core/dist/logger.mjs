import * as __WEBPACK_EXTERNAL_MODULE_rslog__ from "rslog";
const logger = (0, __WEBPACK_EXTERNAL_MODULE_rslog__.createLogger)();
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
export { isDebug, logger };
