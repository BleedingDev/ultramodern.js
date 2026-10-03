const compiler = require('@solidjs/compiler');

module.exports = function compileNativeSolid(source) {
  const { server } = this.getOptions();
  const filename = this.resourcePath;
  const lazy = compiler.transformLazy(source, { filename, sourceMap: false });
  return compiler.transform(lazy.code, {
    filename,
    moduleName: '@solidjs/web',
    generate: server ? 'ssr' : 'dom',
    hydratable: true,
    dev: false,
    sourceMap: false,
  }).code;
};
