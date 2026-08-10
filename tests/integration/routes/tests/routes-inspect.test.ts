import os from 'node:os';
import { fs } from '@modern-js/utils';
import path from 'path';
import { runModernCommand } from '../../../utils/modernTestUtils';

const sourceAppDir = path.resolve(__dirname, '../');
let appDir = '';

const shouldCopyFixturePath = (sourcePath: string) => {
  const relativePath = path.relative(sourceAppDir, sourcePath);
  const pathSegments = relativePath.split(path.sep);

  return !pathSegments.some(segment =>
    ['.modern-js', 'dist', 'node_modules'].includes(segment),
  );
};

const findRouteByPath = (routes: any[], targetPath: string): any => {
  for (const route of routes) {
    if (route.path === targetPath) {
      return route;
    }
    if (route.children && route.children.length > 0) {
      const found = findRouteByPath(route.children, targetPath);
      if (found) {
        return found;
      }
    }
  }
  return null;
};

describe('routes inspect report', () => {
  beforeAll(async () => {
    appDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modern-routes-inspect-'));
    await fs.copy(sourceAppDir, appDir, {
      filter: shouldCopyFixturePath,
    });
    await fs.ensureSymlink(
      path.join(sourceAppDir, 'node_modules'),
      path.join(appDir, 'node_modules'),
      'dir',
    );

    const distDir = path.join(appDir, './dist');
    if (await fs.pathExists(distDir)) {
      await fs.remove(distDir);
    }

    const result = await runModernCommand(['routes'], {
      cwd: appDir,
      stdout: true,
      stderr: true,
    });
    expect(result.code, result.stderr).toBe(0);
  });

  afterAll(async () => {
    if (appDir) {
      await fs.remove(appDir);
    }
  });

  test('should generate correct routes inspect report', async () => {
    const reportPath = path.join(appDir, './dist/routes-inspect.json');

    expect(await fs.pathExists(reportPath)).toBeTruthy();

    const report = await fs.readJSON(reportPath);

    expect(report).toHaveProperty('four');
    expect(report).toHaveProperty('three');
    expect(report.four).toHaveProperty('routes');
    expect(report.three).toHaveProperty('routes');

    const fourRoutes = report.four.routes;
    expect(fourRoutes).toHaveLength(1);

    const fourRoot = fourRoutes[0];
    expect(fourRoot.path).toBe('/');
    expect(fourRoot.component).toContain('@_modern_js_src/four/routes/layout');
    expect(fourRoot.children).toBeDefined();

    const fourChildren = fourRoot.children!;
    expect(fourChildren.length).toBeGreaterThan(0);

    const dynamicRoute = findRouteByPath(fourChildren, ':id');
    expect(dynamicRoute).toBeDefined();
    expect(dynamicRoute?.params).toEqual(['id']);
    expect(dynamicRoute?.data).toContain(
      '@_modern_js_src/four/routes/user/[id]/page.data',
    );

    const catchAllRoute = findRouteByPath(fourChildren, '*');
    expect(catchAllRoute).toBeDefined();

    const optionalRoute = findRouteByPath(fourChildren, 'act/:bid?');
    expect(optionalRoute).toBeDefined();
    expect(optionalRoute?.params).toEqual(['bid?']);

    const threeRoutes = report.three.routes;
    expect(threeRoutes).toHaveLength(1);

    const threeRoot = threeRoutes[0];
    expect(threeRoot.path).toBe('/');
    expect(threeRoot.component).toContain(
      '@_modern_js_src/three/routes/layout',
    );
    expect(threeRoot.error).toContain('@_modern_js_src/three/routes/error');
    expect(threeRoot.loading).toContain('@_modern_js_src/three/routes/loading');
    expect(threeRoot.config).toContain(
      '@_modern_js_src/three/routes/layout.config',
    );

    const threeChildren = threeRoot.children!;

    const authShopRoute = findRouteByPath(threeChildren, 'item');
    expect(authShopRoute).toBeDefined();
    expect(authShopRoute?.component).toContain(
      '@_modern_js_src/three/routes/__auth/__shop/item/page',
    );

    const clientLoaderRoute = findRouteByPath(threeChildren, 'client-loader');
    expect(clientLoaderRoute).toBeDefined();
    expect(clientLoaderRoute?.data).toContain(
      '@_modern_js_src/three/routes/client-loader/layout.data',
    );
    expect(clientLoaderRoute?.clientData).toContain(
      '@_modern_js_src/three/routes/client-loader/layout.data.client',
    );

    const errorRoute = findRouteByPath(threeChildren, 'error');
    expect(errorRoute).toBeDefined();
    expect(errorRoute?.component).toBe('');

    const dotRoute = findRouteByPath(threeChildren, 'user/profile/name');
    expect(dotRoute).toBeDefined();
    expect(dotRoute?.component).toContain(
      '@_modern_js_src/three/routes/user.profile.name/layout',
    );
    expect(dotRoute?.config).toContain(
      '@_modern_js_src/three/routes/user.profile.name/layout.config',
    );
  });
});
