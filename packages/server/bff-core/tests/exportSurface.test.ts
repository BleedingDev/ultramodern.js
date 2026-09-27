import * as bffCore from '../src';

describe('bff-core export surface', () => {
  test.each([
    'registerPaths',
    'getRelativeRuntimePath',
    'createMatchPath',
  ])('does not export the removed %s resolver patch helper', name => {
    expect(bffCore).not.toHaveProperty(name);
  });
});
