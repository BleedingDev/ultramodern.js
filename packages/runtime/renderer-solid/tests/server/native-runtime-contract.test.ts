import { rendererAdapter } from '../../src/plugin';

describe('Solid 2 native dependency ownership', () => {
  test('shares native runtime owners without replacing the independent HTTP codec', () => {
    expect(rendererAdapter.profile.compiler.version).toBe('2.0.0-rc.15');
    expect(rendererAdapter.profile.hydration.version).toBe('2.0.0-rc.15');
    expect(rendererAdapter.federation.shared).toEqual(
      expect.arrayContaining(['solid-js', '@solidjs/web', '@solidjs/signals']),
    );
    expect(rendererAdapter.profile.dependencies).not.toHaveProperty('seroval');
    expect(rendererAdapter.profile.dependencies).not.toHaveProperty(
      'seroval-plugins',
    );
    expect(rendererAdapter.federation.shared).not.toContain('seroval');
    expect(rendererAdapter.federation.shared).not.toContain('seroval-plugins');
  });
});
