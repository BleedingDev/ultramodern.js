import fs from 'node:fs';
import { createRequire, findPackageJSON } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { types as utilTypes } from 'node:util';
import { describe, expect, it } from '@rstest/core';
import { initializeOwningConfigNativeBinding } from '../../src/native-composition/config-evaluator/native-bootstrap';
import { observeConfigSourceInputs } from '../../src/native-composition/config-evaluator/observed-inputs';
import { captureConfigSourceSnapshot } from '../../src/native-composition/config-evaluator/source-snapshot';

async function fixture(run: (root: string, input: string) => Promise<void>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-map-options-'),
    ),
  );
  const input = path.join(root, 'input.json');
  fs.writeFileSync(input, '{"renderer":"solid"}');
  try {
    await run(root, input);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('owning native Node realpath cache observations', () => {
  it('loads an authentic CJS helper under observation and records its authored read', async () =>
    fixture(async (root, input) => {
      const binding = initializeOwningConfigNativeBinding();
      const helper = path.join(root, 'actual.cjs');
      fs.writeFileSync(
        helper,
        `module.exports = require('node:fs').readFileSync(${JSON.stringify(input)}, 'utf8');`,
      );
      const require = createRequire(path.join(root, 'config.cjs'));
      const result = await observeConfigSourceInputs(
        captureConfigSourceSnapshot({ sourceRoots: [root] }),
        async () => require('./actual.cjs'),
        undefined,
        undefined,
        binding,
      );
      expect(JSON.parse(result.value).renderer).toBe('solid');
      expect(result.consumedSourceInputs.observations).toContainEqual({
        path: input,
        canonicalPath: input,
        operation: 'content',
        existed: true,
      });
      expect(
        result.consumedSourceInputs.observations.some(
          observation =>
            observation.operation === 'module' &&
            observation.canonicalPath === helper,
        ),
      ).toBe(true);
    }));

  it('uses the real public ESM package lookup under observation without evaluating its source', async () =>
    fixture(async root => {
      const binding = initializeOwningConfigNativeBinding();
      const manifest = path.join(root, 'package.json');
      const helper = path.join(root, 'package-lookup.cjs');
      fs.writeFileSync(
        manifest,
        JSON.stringify({ name: 'ultramodern-config-source', version: '1.0.0' }),
      );
      fs.writeFileSync(
        helper,
        "throw new Error('Package lookup must not evaluate this source');",
      );
      const result = await observeConfigSourceInputs(
        captureConfigSourceSnapshot({ sourceRoots: [root] }),
        async () => findPackageJSON(helper, helper),
        undefined,
        undefined,
        binding,
      );
      expect(result.value).toBe(manifest);
      expect(result.consumedSourceInputs.observations).toContainEqual({
        path: helper,
        canonicalPath: helper,
        operation: 'metadata',
        existed: true,
      });
    }));

  it('accepts exact built-in Maps containing recursively safe data', async () =>
    fixture(async (root, input) => {
      const options = {
        encoding: 'utf8' as const,
        cache: new Map([
          ['data', { nested: new Map([['renderer', 'solid']]) }],
        ]),
      };
      const result = await observeConfigSourceInputs(
        captureConfigSourceSnapshot({ sourceRoots: [root] }),
        async () => fs.readFileSync(input, options),
      );
      expect(JSON.parse(result.value).renderer).toBe('solid');
    }));

  it.each([
    'subclass',
    'proxy',
    'forged',
    'accessor',
    'function',
    'nested-accessor',
    'null-prototype-copy',
  ])('rejects malformed Map %s without executing getters or traps', async kind =>
    fixture(async (root, input) => {
      let calls = 0;
      let cache: object = new Map([['path', input]]);
      if (kind === 'subclass')
        cache = new (class extends Map {
          get(key: unknown) {
            calls++;
            return super.get(key);
          }
        })([['path', input]]);
      if (kind === 'proxy')
        cache = new Proxy(cache, {
          getPrototypeOf() {
            calls++;
            return Map.prototype;
          },
          ownKeys() {
            calls++;
            return [];
          },
        });
      if (kind === 'forged') cache = Object.create(Map.prototype);
      if (kind === 'accessor')
        Object.defineProperty(cache, 'get', {
          get() {
            calls++;
            return Map.prototype.get;
          },
        });
      if (kind === 'function') cache = new Map([['path', () => calls++]]);
      if (kind === 'nested-accessor')
        cache = new Map([
          [
            'path',
            Object.defineProperty({}, 'renderer', {
              get() {
                calls++;
                return 'solid';
              },
            }),
          ],
        ]);
      if (kind === 'null-prototype-copy')
        Object.setPrototypeOf(
          cache,
          Object.freeze(
            Object.create(
              null,
              Object.getOwnPropertyDescriptors(Map.prototype),
            ),
          ),
        );
      const options = { encoding: 'utf8' as const, cache };
      await expect(
        observeConfigSourceInputs(
          captureConfigSourceSnapshot({ sourceRoots: [root] }),
          async () => {
            try {
              fs.readFileSync(input, options);
            } catch {}
          },
        ),
      ).rejects.toThrow('Unsupported config source observation');
      expect(calls).toBe(0);
    }));

  it('rejects an uncovered raw request even when a data-only realpath cache redirects it into source', async () =>
    fixture(async (root, input) => {
      const binding = initializeOwningConfigNativeBinding();
      const source = path.join(root, 'source');
      fs.mkdirSync(source);
      const covered = path.join(source, 'covered.json');
      fs.writeFileSync(covered, '{}');
      const probe = path.join(root, 'probe.cjs');
      fs.writeFileSync(probe, 'module.exports = null;');
      const descriptor = Object.getOwnPropertyDescriptor(fs, 'realpathSync')!;
      const original = fs.realpathSync;
      let cacheKey: symbol | undefined;
      Object.defineProperty(fs, 'realpathSync', {
        ...descriptor,
        value: function (this: unknown, ...args: unknown[]) {
          const options = args[1];
          if (options && typeof options === 'object')
            for (const key of Object.getOwnPropertySymbols(options))
              if (
                utilTypes.isMap(
                  Object.getOwnPropertyDescriptor(options, key)?.value,
                )
              )
                cacheKey = key;
          return Reflect.apply(original, this, args);
        },
      });
      try {
        createRequire(path.join(root, 'config.cjs')).resolve('./probe.cjs');
      } finally {
        Object.defineProperty(fs, 'realpathSync', descriptor);
      }
      expect(cacheKey).toBeDefined();
      const options = {
        encoding: 'utf8' as const,
        [cacheKey!]: new Map([[input, covered]]),
      };
      expect(fs.realpathSync(input, options)).toBe(covered);
      await expect(
        observeConfigSourceInputs(
          captureConfigSourceSnapshot({ sourceRoots: [source] }),
          async () => {
            try {
              fs.realpathSync(input, options);
            } catch {}
          },
          undefined,
          undefined,
          binding,
        ),
      ).rejects.toThrow(`uncovered source path ${input}`);
    }));

  it('does not turn a public WeakSet prototype override into a private cache grant', async () =>
    fixture(async (root, input) => {
      const binding = initializeOwningConfigNativeBinding();
      const cache = new Map([['path', input]]);
      Object.setPrototypeOf(
        cache,
        Object.freeze(
          Object.create(null, Object.getOwnPropertyDescriptors(Map.prototype)),
        ),
      );
      const snapshot = captureConfigSourceSnapshot({ sourceRoots: [root] });
      const descriptor = Object.getOwnPropertyDescriptor(
        WeakSet.prototype,
        'has',
      )!;
      let calls = 0;
      let failure: unknown;
      Object.defineProperty(WeakSet.prototype, 'has', {
        ...descriptor,
        value: function (this: unknown, value: object) {
          if (value === cache) {
            calls++;
            return true;
          }
          return Reflect.apply(descriptor.value, this, [value]);
        },
      });
      try {
        await observeConfigSourceInputs(
          snapshot,
          async () => {
            try {
              fs.readFileSync(input, { encoding: 'utf8', cache });
            } catch {}
          },
          undefined,
          undefined,
          binding,
        );
      } catch (error) {
        failure = error;
      } finally {
        Object.defineProperty(WeakSet.prototype, 'has', descriptor);
      }
      expect(failure).toBeInstanceOf(Error);
      if (failure instanceof Error)
        expect(failure.message).toContain('custom prototype');
      expect(calls).toBe(0);
    }));
});
