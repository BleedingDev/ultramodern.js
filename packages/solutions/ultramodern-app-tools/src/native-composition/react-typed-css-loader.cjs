const fs = require('node:fs');
const { createHash } = require('node:crypto');

const RECORD_KEY = 'ultramodernReactTypedCss';

function fileDigest(filename) {
  const descriptor = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile())
      throw new Error(
        `React typed CSS input is not a regular file: ${filename}`,
      );
    const digest = createHash('sha256')
      .update(fs.readFileSync(descriptor))
      .digest('hex');
    const after = fs.fstatSync(descriptor, { bigint: true });
    const named = fs.lstatSync(filename, { bigint: true });
    if (
      before.dev !== named.dev ||
      before.ino !== named.ino ||
      before.ctimeNs !== named.ctimeNs ||
      before.size !== after.size ||
      before.ctimeNs !== after.ctimeNs ||
      before.mode !== after.mode
    ) {
      throw new Error(
        `React typed CSS input changed while being read: ${filename}`,
      );
    }
    return digest;
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Delegate generation to the installed producer; retain its acknowledgment in native module cache data. */
module.exports = function reactTypedCssLoader(
  content,
  sourceMap,
  additionalData,
) {
  const options = this.getOptions();
  const { producerPath, producerDigest, producerVersion, producerOptions } =
    options;
  if (
    producerVersion !== '1.2.4' ||
    fileDigest(producerPath) !== producerDigest
  ) {
    throw new Error(
      'React typed CSS producer differs from its configured compiler',
    );
  }
  const producer = require(producerPath);
  if (
    typeof producer.default !== 'function' ||
    typeof producer.isCSSModules !== 'function'
  ) {
    throw new Error(
      'React typed CSS producer has an unsupported loader contract',
    );
  }
  this.addBuildDependency(__filename);
  this.addBuildDependency(producerPath);
  const outputPath = `${this.resourcePath}.d.ts`;
  let selected;
  const originalModules =
    producerOptions.modules === undefined ? true : producerOptions.modules;
  const modules =
    originalModules === null
      ? null
      : Object.create(
          typeof originalModules === 'object' ? originalModules : null,
        );
  if (modules)
    Object.defineProperty(modules, 'auto', {
      value(resourcePath, resourceQuery, resourceFragment) {
        selected = producer.isCSSModules({
          resourcePath,
          resourceQuery,
          resourceFragment,
          modules: originalModules,
        });
        if (selected && !/[\\/]node_modules[\\/]/.test(resourcePath)) {
          try {
            if (!fs.lstatSync(outputPath).isFile()) {
              throw new Error(
                `React typed CSS output is not a regular file: ${outputPath}`,
              );
            }
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        return selected;
      },
      enumerable: true,
    });
  const delegated = Object.create(this);
  delegated.getOptions = () => ({ ...producerOptions, modules });
  delegated.async = () => {
    const callback = this.async();
    let called = false;
    return (error, ...result) => {
      if (called) return;
      called = true;
      if (error) return callback(error, ...result);
      try {
        if (typeof selected !== 'boolean')
          throw new Error(
            'React typed CSS producer did not acknowledge its module selector',
          );
        const produced =
          selected && !/[\\/]node_modules[\\/]/.test(this.resourcePath);
        const record = {
          version: 1,
          producerPath,
          producerDigest,
          producerVersion,
          sourcePath: this.resourcePath,
          sourceDigest: fileDigest(this.resourcePath),
          produced,
          ...(produced
            ? { outputPath, outputDigest: fileDigest(outputPath) }
            : {}),
        };
        this._module.buildInfo[RECORD_KEY] = record;
        if (typeof this.ultramodernReactTypedCssProduced !== 'function')
          throw new Error(
            'React typed CSS loader has no owning native producer observer',
          );
        this.ultramodernReactTypedCssProduced(record);
        if (produced) this.addDependency(outputPath);
        callback(null, ...result);
      } catch (failure) {
        callback(failure);
      }
    };
  };
  return producer.default.call(delegated, content, sourceMap, additionalData);
};
