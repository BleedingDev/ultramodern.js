import { fs } from '@modern-js/utils';
import path, { join } from 'path';
import { modernBuild } from '../../../../utils/modernTestUtils';
import { acquireTestLock } from '../../test-utils';

rstest.setConfig({ testTimeout: 1000 * 60 * 3, hookTimeout: 1000 * 60 * 3 });

const projectDir = path.resolve(__dirname, '..');

describe('ssg', () => {
  let releaseLock: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    // index.test.ts runs a dev server against the SAME fixture directory;
    // this build rewrites node_modules/.modern-js/*/routes.js which would
    // force HMR full reloads under that dev server. Serialize the two suites.
    releaseLock = await acquireTestLock('i18n-routes-ssr-fixture', {
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

    const zhAboutHtmlPath = path.join(
      appDir,
      './dist-ssg/html/index/zh/about/index.html',
    );
    const enAboutHtmlPath = path.join(
      appDir,
      './dist-ssg/html/index/en/about/index.html',
    );
    const zhAboutContent = fs.readFileSync(zhAboutHtmlPath, 'utf-8');
    const enAboutContent = fs.readFileSync(enAboutHtmlPath, 'utf-8');
    expect(zhAboutContent).toMatch('关于');
    expect(enAboutContent).toMatch('About');
  });
});
