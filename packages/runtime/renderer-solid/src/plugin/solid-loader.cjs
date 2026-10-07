const babel = require('@babel/core');
const compiler = require('@solidjs/compiler');
const { markerVisitor, resolveLazyModule } = require('./lazy-modules.cjs');

module.exports = async function solidLoader(source, inputMap) {
  const callback = this.async();
  const { projectRoot, server, isProd, sourceExtensions } = this.getOptions();
  const filename = this.resourcePath;
  const maps = [];
  const step = result => {
    if (!result || typeof result.code !== 'string') {
      throw new Error(
        `The native Solid compiler produced no code for ${filename}`,
      );
    }
    if (result.map)
      maps.unshift(
        typeof result.map === 'string' ? JSON.parse(result.map) : result.map,
      );
    return result.code;
  };
  try {
    const { default: remapping } = await import('@jridgewell/remapping');
    if (inputMap)
      maps.push(typeof inputMap === 'string' ? JSON.parse(inputMap) : inputMap);
    let code = step(
      compiler.transformLazy(source, { filename, sourceMap: true }),
    );
    code = step(
      babel.transformSync(code, {
        filename,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        parserOpts: { plugins: ['typescript', 'jsx'] },
        plugins: [
          () => ({
            visitor: markerVisitor((marker, specifier) => {
              const module = resolveLazyModule(
                filename,
                specifier,
                projectRoot,
                sourceExtensions,
              );
              this.addDependency(module.filename);
              marker.node.value = module.key;
            }),
          }),
        ],
      }),
    );
    const applicationSource =
      !filename.includes('/node_modules/') ||
      filename.includes('/node_modules/.modern-js/solid/');
    if (!server && !isProd && applicationSource) {
      code = step(
        compiler.transformRefresh(code, {
          filename,
          bundler: 'standard',
          importSource: 'solid-js/refresh',
          jsx: false,
          fixRender: true,
          granular: true,
          sourceMap: true,
        }),
      );
    }
    code = step(
      compiler.transform(code, {
        filename,
        moduleName: '@solidjs/web',
        generate: server ? 'ssr' : 'dom',
        hydratable: true,
        dev: !isProd,
        sourceMap: true,
      }),
    );
    const map = maps.length ? remapping(maps, () => null) : undefined;
    callback(null, code, map);
  } catch (error) {
    callback(error);
  }
};
