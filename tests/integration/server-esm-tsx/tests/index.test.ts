import dns from 'node:dns';
import { pathToFileURL } from 'node:url';
import { fs as fse } from '@modern-js/utils';
import path from 'path';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';

rstest.setConfig({ testTimeout: 1000 * 60 * 2, hookTimeout: 1000 * 60 * 2 });

dns.setDefaultResultOrder('ipv4first');

const appDir = path.resolve(__dirname, '../');
const serverDistDir = path.join(appDir, 'dist', 'server');

describe('custom server under native esm', () => {
  beforeAll(async () => {
    await fse.remove(path.join(appDir, 'dist'));
    await modernBuild(appDir);
  });

  afterAll(async () => {
    await fse.remove(path.join(appDir, 'dist'));
  });

  it('should emit js for tsx entries and keep sources out of dist', async () => {
    // `jsx: preserve` would emit `foo/index.jsx`, which Node cannot load.
    expect(
      await fse.pathExists(path.join(serverDistDir, 'foo', 'index.js')),
    ).toBeTruthy();
    expect(
      await fse.pathExists(path.join(serverDistDir, 'foo', 'index.jsx')),
    ).toBeFalsy();
    expect(
      await fse.pathExists(path.join(serverDistDir, 'foo', 'index.tsx')),
    ).toBeFalsy();
  });

  it('should be loadable by node', async () => {
    // The strongest check: Node itself resolves the emitted specifiers.
    const mod = await import(
      pathToFileURL(path.join(serverDistDir, 'modern.server.js')).href
    );

    expect(mod.default).toBeDefined();
  });

  it('should serve requests with the custom server applied', async () => {
    const port = await getPort();
    const app = await modernServe(appDir, port);

    try {
      const res = await fetch(`http://localhost:${port}`);

      expect(res.headers.get('x-esm-tsx')).toBe('foo-tsx-shared-message');
    } finally {
      await killApp(app);
    }
  });
});
