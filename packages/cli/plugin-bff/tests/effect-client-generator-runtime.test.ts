import * as utils from '@modern-js/utils' with { rstest: 'importActual' };
import { getHttpApiRuntime } from '../src/utils/effect-client-generator/runtime';

rstest.mock('@modern-js/utils', () => ({
  __esModule: true,
  ...utils,
  compatibleRequire: (specifier: string, interop = true) =>
    specifier === 'effect/unstable/httpapi'
      ? Promise.reject(
          new Error("Cannot find module 'effect/unstable/httpapi'"),
        )
      : utils.upath.extname(specifier) !== '.js'
        ? Promise.reject(
            new Error('ESM fallback resolution requires an explicit file'),
          )
        : utils.compatibleRequire(specifier, interop),
}));

describe('Effect client generator runtime', () => {
  test('loads the explicit HttpApi runtime file when the package subpath cannot be required', async () => {
    const previousLibraryFormat = process.env.MODERN_LIB_FORMAT;
    process.env.MODERN_LIB_FORMAT = 'esm';

    try {
      await expect(getHttpApiRuntime()).resolves.toEqual(
        expect.objectContaining({
          isHttpApi: expect.any(Function),
          reflect: expect.any(Function),
        }),
      );
    } finally {
      if (previousLibraryFormat === undefined) {
        delete process.env.MODERN_LIB_FORMAT;
      } else {
        process.env.MODERN_LIB_FORMAT = previousLibraryFormat;
      }
    }
  });
});
