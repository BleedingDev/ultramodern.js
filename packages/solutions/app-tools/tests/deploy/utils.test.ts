import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveESMDependency } from '../../src/plugins/deploy/utils';

describe('deploy utils', () => {
  it('should resolve independently of process.cwd()', async () => {
    // At deploy time cwd is the user's app dir, where import-meta-resolve is
    // not installed (it is a dependency of app-tools, not of user apps, and
    // pnpm's strict layout does not hoist it). The resolver must therefore
    // never resolve its own dependencies relative to cwd.
    const originalCwd = process.cwd();
    const emptyDir = mkdtempSync(path.join(tmpdir(), 'app-tools-deploy-'));
    try {
      process.chdir(emptyDir);

      const resolved = await resolveESMDependency('@modern-js/prod-server');

      expect(resolved).toMatch(/dist\/esm-node\/index\.mjs$/);
    } finally {
      process.chdir(originalCwd);
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('should resolve workspace esm dependencies without external resolver drift', async () => {
    const resolved = await resolveESMDependency('@modern-js/prod-server');

    expect(resolved).toContain('packages/server/prod-server/');
    expect(resolved).toMatch(/dist\/esm-node\/index\.mjs$/);
  });

  it('should resolve root-sugar exports without a "." key to the ESM entry', async () => {
    // mlly declares `exports: { types, import, require }` directly (no "."
    // key); the previous hand-rolled parser fell back to the CJS entry here.
    const resolved = await resolveESMDependency('mlly');

    expect(resolved).toMatch(/dist\/index\.mjs$/);
  });

  it('should resolve root-sugar string exports', async () => {
    // pkg-types declares `exports: { ".": "./dist/index.mjs" }`.
    const resolved = await resolveESMDependency('pkg-types');

    expect(resolved).toMatch(/dist\/index\.mjs$/);
  });

  it('should resolve conditional exports with import keys', async () => {
    const resolved = await resolveESMDependency('es-module-lexer');

    expect(resolved).toMatch(/dist\/lexer\.js$/);
  });

  it('should return undefined for unresolvable specifiers', async () => {
    await expect(
      resolveESMDependency('@modern-js/definitely-not-a-package'),
    ).resolves.toBeUndefined();
  });
});
