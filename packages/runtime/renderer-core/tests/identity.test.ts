import {
  nativeModuleManifestFilename,
  type RendererIdentity,
  readRendererIdentity,
} from '../src/identity';

const identity: RendererIdentity = {
  renderer: 'octane',
  appId: 'store',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'build-1',
};

describe('renderer identity records', () => {
  test('returns a frozen copy of an equal identity', () => {
    const result = readRendererIdentity({ ...identity }, identity);
    expect(result).toEqual(identity);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test.each([
    ['renderer', { renderer: 'react' }, 'conflicts with the application'],
    ['application', { appId: 'another' }, 'conflicts with the application'],
    ['build', { buildId: 'stale' }, 'conflicts with the application'],
    ['protocol', { protocolVersion: 2 }, 'Unsupported renderer data protocol'],
    ['empty application', { appId: '' }, 'nonempty appId'],
    ['empty entry', { entryName: '   ' }, 'nonempty entryName'],
    ['empty build', { buildId: '' }, 'nonempty buildId'],
    ['unknown field', { nativeHydrationBuildId: 'n' }, 'only identity fields'],
  ])('rejects a %s mismatch', (_name, change, message) => {
    expect(() =>
      readRendererIdentity({ ...identity, ...change }, identity),
    ).toThrow(message);
  });

  test.each([null, [], 'identity', new (class Identity {})()])(
    'rejects a non-record %#',
    value => {
      expect(() => readRendererIdentity(value, identity)).toThrow(
        'only identity fields',
      );
    },
  );
});

describe('native module manifest filenames', () => {
  test.each([
    ['solid', 'main', 'solid-module-manifest.main.json'],
    [
      'octane',
      'main/admin?view=1',
      'octane-module-manifest.main%2Fadmin%3Fview%3D1.json',
    ],
    ['octane', 'store%2Fmain', 'octane-module-manifest.store%252Fmain.json'],
  ])(
    'encodes %s entry %s into one emitted filename',
    (renderer, entry, filename) => {
      expect(nativeModuleManifestFilename(renderer, entry)).toBe(filename);
    },
  );

  test.each(['', '   '])('rejects an empty entry %s', entry => {
    expect(() => nativeModuleManifestFilename('solid', entry)).toThrow(
      'require an application entry name',
    );
  });

  test.each([undefined, null, 42])('rejects a nonstring entry %s', entry => {
    expect(() =>
      // @ts-expect-error Exercise malformed input at the filename boundary.
      nativeModuleManifestFilename('solid', entry),
    ).toThrow('require an application entry name');
  });
});
