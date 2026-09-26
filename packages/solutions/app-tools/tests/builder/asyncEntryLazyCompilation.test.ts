import path from 'node:path';
import { buildDefaultLazyCompilationTest } from '../../src/builder/shared/asyncEntryLazyCompilation';
import {
  buildSSRLazyCompilationTest,
  normalizeModulePath,
} from '../../src/builder/shared/lazyCompilation';

describe('buildDefaultLazyCompilationTest', () => {
  const internalDirectory = path.resolve('/app/node_modules/.modern-js');
  const test = buildDefaultLazyCompilationTest(internalDirectory);

  it('keeps the generated entry module (bootstrap.jsx import target) eager', () => {
    expect(
      test({ resource: path.join(internalDirectory, 'main', 'index.jsx') }),
    ).toBe(false);
    expect(
      test({
        resource: `${path.join(internalDirectory, 'main', 'index.jsx')}?x=1`,
      }),
    ).toBe(false);
    expect(
      test({
        resource: path.join(
          internalDirectory,
          'admin',
          'dashboard',
          'index.jsx',
        ),
      }),
    ).toBe(false);
  });

  it('keeps other dynamic imports lazy', () => {
    expect(test({ resource: '/app/src/components/Heavy.tsx' })).toBe(true);
    expect(test({ resource: '/app/src/main/index.jsx' })).toBe(true);
    expect(
      test({ resource: path.join(internalDirectory, 'main', 'routes.js') }),
    ).toBe(true);
    expect(test({})).toBe(true);
  });

  it('composes with the stream SSR route-eager test', () => {
    const ssrTest = buildSSRLazyCompilationTest(
      new Set([normalizeModulePath('/app/src/routes/page.tsx')]),
      test,
    );
    expect(
      ssrTest({ resource: path.join(internalDirectory, 'main', 'index.jsx') }),
    ).toBe(false);
    expect(ssrTest({ resource: '/app/src/routes/page.tsx' })).toBe(false);
    expect(ssrTest({ resource: '/app/src/components/Heavy.tsx' })).toBe(true);
  });
});
