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
const repoRoot = path.resolve(__dirname, '../../../..');
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

  test('createRoutes apps register tanstack through the runtime router wrapper instead of generated files', () => {
    // createRoutes-style apps have no file-route entries, so the codegen must
    // not emit router.gen.ts/register.gen.d.ts mirrors for them — the router
    // instance only exists at runtime.
    expect(
      fs.existsSync(path.join(appDir, 'src/modern-tanstack/register.gen.d.ts')),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(appDir, 'src/modern-tanstack/index/router.gen.ts'),
      ),
    ).toBe(false);

    // Instead the generated entry value-imports the router plugin through the
    // plugin-tanstack wrapper module, which registers the TanStack router
    // provider as a side effect (cannot be tree-shaken away).
    const runtimeRegister = fs.readFileSync(
      path.join(appDir, 'node_modules/.modern-js/index/runtime-register.js'),
      'utf8',
    );
    expect(runtimeRegister).toContain(
      "import { routerPlugin } from '@modern-js/plugin-tanstack/runtime/router';",
    );
    expect(runtimeRegister).toContain('plugins.push(routerPlugin(');

    const routerWrapperSource = fs.readFileSync(
      path.join(
        repoRoot,
        'packages/runtime/plugin-tanstack/src/runtime/router.ts',
      ),
      'utf8',
    );
    expect(routerWrapperSource).toContain("import './register';");
    expect(routerWrapperSource).toContain(
      "export { routerPlugin } from '@modern-js/runtime/router/internal';",
    );

    const registerSource = fs.readFileSync(
      path.join(
        repoRoot,
        'packages/runtime/plugin-tanstack/src/runtime/register.ts',
      ),
      'utf8',
    );
    expect(registerSource).toContain(
      "registerRouterProvider('tanstack', tanstackRouterProviderFactory);",
    );
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
