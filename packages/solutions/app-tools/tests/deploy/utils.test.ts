import { resolveESMDependency } from '../../src/plugins/deploy/utils';

describe('deploy utils', () => {
  it('should resolve workspace esm dependencies without external resolver drift', async () => {
    const resolved = await resolveESMDependency('@modern-js/prod-server');

    expect(resolved).toContain('packages/server/prod-server/');
    expect(resolved).toMatch(/dist\/esm-node\/index\.mjs$/);
  });
});
