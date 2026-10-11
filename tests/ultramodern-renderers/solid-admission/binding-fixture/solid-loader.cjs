module.exports = function compile(source) {
  const { compilerPath, server } = this.getOptions();
  const compiler = require(compilerPath);
  const filename = this.resourcePath;
  const lazy = compiler.transformLazy(source, { filename, sourceMap: false });
  return compiler.transform(lazy.code, {
    filename,
    moduleName: '@solidjs/web',
    generate: server ? 'ssr' : 'dom',
    hydratable: true,
    sourceMap: false,
  }).code;
};
