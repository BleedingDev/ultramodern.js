import { type RendererIdentity, readRendererIdentity } from '../src/identity';

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

  test.each([
    null,
    [],
    'identity',
    new (class Identity {})(),
  ])('rejects a non-record %#', value => {
    expect(() => readRendererIdentity(value, identity)).toThrow(
      'only identity fields',
    );
  });
});
