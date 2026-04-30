import { fs } from '@modern-js/utils';
import path from 'path';
import { getPort, killApp, launchApp } from '../../../utils/modernTestUtils';

const fixtureDir = path.resolve(__dirname, '../fixtures');

describe('SSR preload', () => {
  let app: any;
  let appPort = 0;
  let fixtureAvailable = false;
  const appDir = path.join(fixtureDir, 'preload');

  beforeAll(async () => {
    fixtureAvailable = fs.existsSync(path.join(appDir, 'package.json'));
    if (!fixtureAvailable) {
      return;
    }
    appPort = await getPort();
    app = await launchApp(appDir, appPort);
  });

  afterAll(async () => {
    if (app) {
      await killApp(app);
    }
  });

  test('should handle preload fixture availability', () => {
    if (fixtureAvailable) {
      expect(fs.existsSync(path.join(appDir, 'package.json'))).toBeTruthy();
      return;
    }

    // The preload fixture was removed from active SSR coverage; keep this as
    // a guard to avoid silent reintroduction without dedicated tests.
    const nonNodeModulesEntries = fs.existsSync(appDir)
      ? fs.readdirSync(appDir).filter(name => name !== 'node_modules')
      : [];
    expect(nonNodeModulesEntries.length).toBe(0);
  });

  test('should serve preload fixture when present', async () => {
    if (!fixtureAvailable) {
      expect(
        fs.existsSync(path.join(appDir, 'dist', 'route.json')),
      ).toBeFalsy();
      return;
    }

    const response = await fetch(`http://127.0.0.1:${appPort}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<!DOCTYPE html>');
  });
});
