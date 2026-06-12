import { fs } from '@modern-js/utils';
import path, { join } from 'path';
import { modernBuild } from '../../../../utils/modernTestUtils';
import { acquireTestLock } from '../../test-utils';

rstest.setConfig({ testTimeout: 1000 * 60 * 3, hookTimeout: 1000 * 60 * 3 });

const projectDir = path.resolve(__dirname, '..');

describe('ssg', () => {
  let releaseLock: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    // index.test.ts runs dev and serve suites against the SAME fixture
    // directory; this build rewrites node_modules/.modern-js/*/routes.js
    // which would force HMR full reloads under the dev server. Serialize.
    releaseLock = await acquireTestLock('i18n-app-ssr-fixture', {
      timeoutMs: 240_000,
    });
  });

  afterAll(async () => {
    if (releaseLock) {
      await releaseLock();
    }
  });

  test('should simple ssg work correctly', async () => {
    const appDir = projectDir;
    await modernBuild(appDir, ['--config', 'modern.ssg.config.ts']);

    const zhHtmlPath = path.join(appDir, './dist-ssg/html/index/zh/index.html');
    const enHtmlPath = path.join(appDir, './dist-ssg/html/index/en/index.html');
    const zhContent = fs.readFileSync(zhHtmlPath, 'utf-8');
    const enContent = fs.readFileSync(enHtmlPath, 'utf-8');
    expect(zhContent).toMatch('你好，世界');
    expect(enContent).toMatch('Hello World');
  });
});
