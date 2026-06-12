import * as utils from '@modern-js/utils' with { rstest: 'importActual' };

const dynamicImportSpecifiers: unknown[] = [];

rstest.mock('@modern-js/utils', () => ({
  __esModule: true,
  ...utils,
  dynamicImport: (specifier: unknown) => {
    dynamicImportSpecifiers.push(specifier);
    return (utils.dynamicImport as (s: unknown) => Promise<unknown>)(specifier);
  },
}));

describe('resolveESMDependency referrer', () => {
  it('should import its resolver via an absolute file URL, never a bare specifier', async () => {
    // `dynamicImport` compiles to `new Function('return import(...)')`, which
    // has no module referrer: in plain Node a bare specifier resolves from
    // process.cwd(). At deploy time cwd is the user's app dir, where
    // import-meta-resolve (an app-tools dependency) is not installed under
    // pnpm's strict layout. resolveESMDependency must therefore resolve the
    // resolver's path from this package before importing it.
    // (rstest's runtime intercepts dynamic import, so a chdir-based test
    // cannot reproduce the production failure in-process; asserting on the
    // specifier shape is the faithful unit-level check.)
    const { resolveESMDependency } = await import(
      '../../src/plugins/deploy/utils'
    );

    const resolved = await resolveESMDependency('@modern-js/prod-server');
    expect(resolved).toMatch(/dist\/esm-node\/index\.mjs$/);

    expect(dynamicImportSpecifiers).toHaveLength(1);
    const specifier = dynamicImportSpecifiers[0];
    expect(typeof specifier).toBe('string');
    expect(specifier).toMatch(/^file:\/\//);
    expect(specifier).toMatch(/import-meta-resolve/);
  });
});
