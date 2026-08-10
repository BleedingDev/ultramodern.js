/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import {
  acquireFixtureLock,
  type ReleaseFixtureLock,
} from '../../../utils/fixtureLock';
import { modernBuild } from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

// The beforeAll queues on the routes-tanstack-create-routes fixture lock
// (shared with the index dev/build suite, which holds it for minutes) before
// rebuilding the fixture.
setSuiteTimeout(1000 * 60 * 10);

const projectRoot = path.resolve(__dirname, '../../..');
const appDir = path.join(
  projectRoot,
  'integration/routes-tanstack-create-routes',
);

const readFixture = (relativePath: string) =>
  fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

const readFixtureJson = (relativePath: string) =>
  JSON.parse(readFixture(relativePath));

describe('tanstack create-routes contracts', () => {
  let releaseFixtureLock: ReleaseFixtureLock | undefined;

  beforeAll(async () => {
    releaseFixtureLock = await acquireFixtureLock(appDir);
    await modernBuild(appDir);
  });

  afterAll(async () => {
    await releaseFixtureLock?.();
  });

  test('generated route manifest preserves SPA/SSR hybrid route semantics', () => {
    const routeManifest = readFixtureJson(
      'integration/routes-tanstack-create-routes/dist/route.json',
    );

    expect(Array.isArray(routeManifest.routes)).toBe(true);
    expect(routeManifest.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          urlPath: '/',
          entryName: 'index',
          entryPath: 'html/index/index.html',
          isSPA: true,
          isSSR: true,
          isStream: false,
          isRSC: false,
          bundle: 'bundles/index.js',
        }),
      ]),
    );
  });
});
