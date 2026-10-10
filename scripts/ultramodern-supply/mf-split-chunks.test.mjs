import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const patch = fs.readFileSync(
  new URL(
    '../../patches/@module-federation__modern-js-v3@2.9.2.patch',
    import.meta.url,
  ),
  'utf8',
);
const filters = [
  ...patch.matchAll(
    /\+\s+if \(enableSSR && splitChunkConfig[\s\S]*?\+\s+if \(shouldWarn\)[^\n]+/g,
  ),
].map(
  match =>
    match[0]
      .split('\n')
      .map(line => line.slice(1))
      .join('\n') + '\n}',
);
assert.equal(filters.length, 3, 'exercise every shipped CLI module format');

for (const [format, filter] of filters.entries()) {
  function constrain(config, enableSSR = true) {
    let result = config;
    vm.runInNewContext(filter, {
      enableSSR,
      splitChunkConfig: config,
      _type_of__: value => typeof value,
      chain: {
        optimization: {
          splitChunks: value => {
            result = value;
          },
        },
      },
      logger: { warn() {} },
      external_logger_js_default: () => ({ warn() {} }),
    });
    return result;
  }

  test(`format ${format}: preserve disabled splitting and non-SSR settings`, () => {
    assert.equal(constrain(false), false);
    const config = { chunks: 'all', minSize: 123 };
    assert.equal(constrain(config, false), config);
    assert.equal(config.chunks, 'all');
  });

  test(`format ${format}: cache groups cannot reintroduce initial chunks`, () => {
    const accepts = chunk => chunk.accept;
    const config = {
      chunks: accepts,
      minSize: 123,
      cacheGroups: {
        vendor: { chunks: 'all', enforce: true, name: 'vendor' },
        initial: { chunks: 'initial' },
        selected: { chunks: accepts },
        disabled: false,
      },
      fallbackCacheGroup: { chunks: accepts, minSize: 456 },
    };
    assert.equal(constrain(config), config);
    assert.equal(config.minSize, 123);
    assert.equal(config.cacheGroups.vendor.name, 'vendor');
    assert.equal(config.cacheGroups.vendor.enforce, true);
    assert.equal(config.cacheGroups.vendor.chunks, 'async');
    assert.equal(config.cacheGroups.initial.chunks, 'async');
    assert.equal(config.cacheGroups.disabled, false);
    assert.equal(config.fallbackCacheGroup.minSize, 456);
    for (const chunks of [
      config.chunks,
      config.cacheGroups.selected.chunks,
      config.fallbackCacheGroup.chunks,
    ]) {
      assert.equal(chunks({ canBeInitial: () => true, accept: true }), false);
      assert.equal(chunks({ canBeInitial: () => false, accept: true }), true);
      assert.equal(chunks({ canBeInitial: () => false, accept: false }), false);
    }
  });
}
