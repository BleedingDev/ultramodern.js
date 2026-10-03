const compiler = require('@solidjs/compiler');
module.exports = function (source) {
  const { server, refresh } = this.getOptions();
  const filename = this.resourcePath;
  let code = compiler.transformLazy(source, {
    filename,
    sourceMap: false,
  }).code;
  if (refresh && !filename.includes('/node_modules/'))
    code = compiler.transformRefresh(code, {
      filename,
      bundler: 'standard',
      jsx: false,
      importSource: 'solid-js/refresh',
      fixRender: true,
      granular: true,
      sourceMap: false,
    }).code;
  return compiler.transform(code, {
    filename,
    moduleName: '@solidjs/web',
    generate: server ? 'ssr' : 'dom',
    hydratable: true,
    dev: refresh,
    sourceMap: false,
  }).code;
};
