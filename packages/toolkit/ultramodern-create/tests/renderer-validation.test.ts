import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRendererRouterBindings } from '@modern-js/backend-federation-contracts';
import {
  assertOverlayPreservedBaseline,
  captureOverlayBaselineSnapshot,
  OverlayBaselineRelaxationError,
} from '../src/ultramodern-workspace/overlay-baseline-guard';
import { getRendererGenerationProfile } from '../src/ultramodern-workspace/renderer-profile';
import {
  assertAuthoredRendererDependencyPins,
  assertRendererDependencies,
  assertRendererProjection,
  isForeignRendererPackage,
} from '../src/ultramodern-workspace/validation/renderer';
import { readRendererFrameworkPackageEvidence } from '../src/ultramodern-workspace/validation/renderer-framework-evidence';

function nativeProjection(renderer: 'solid' | 'octane') {
  const generation = getRendererGenerationProfile(renderer);
  const identity = {
    renderer,
    appId: 'shell-super-app',
    entryName: 'main',
    protocolVersion: 1,
    buildId: 'build-native-fixture',
  };
  const provider = { ...generation.profile.router, framework: renderer };
  return {
    id: identity.appId,
    path: 'apps/shell-super-app',
    renderer,
    rendererProfile: generation.profile,
    rendererIdentity: identity,
    rendererIdentities: { main: identity },
    routerBindings: {
      main: {
        owner: `@modern-js/renderer-${renderer}-infrastructure`,
        evidence: 'owned-default',
        defaultProvider: provider,
        providers: [provider],
      },
    },
    rendererCapabilities: generation.capabilities,
    deliveryUnit: { buildMarker: identity.buildId },
  };
}

function overlayFixture(renderer: 'solid' | 'octane') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-renderer-overlay-'));
  const app = nativeProjection(renderer);
  const generation = getRendererGenerationProfile(renderer);
  const manifest = {
    name: '@fixture/shell-super-app',
    dependencies: {
      ...generation.dependencies,
      '@modern-js/renderer-core': 'workspace:*',
      [`@modern-js/renderer-${renderer}`]: 'workspace:*',
    },
    devDependencies: { ...generation.devDependencies },
    scripts: { build: 'ultramodern build' },
  };
  const write = (relative: string, value: unknown) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  };
  write('package.json', { name: '@fixture/workspace' });
  write('topology/reference-topology.json', {
    shell: app,
    shells: [],
    verticals: [],
  });
  write(`${app.path}/package.json`, manifest);
  write(`${app.path}/tsconfig.json`, {
    compilerOptions: {
      jsx: 'preserve',
      jsxImportSource: generation.jsxImportSource,
    },
  });
  for (const relative of ['layout.tsx', 'page.tsx', 'about/page.tsx']) {
    write(
      `${app.path}/src/routes/${relative}`,
      'export default function Page() { return null; }',
    );
  }
  write(`${app.path}/shared/ultramodern-build.json`, {
    surfaces: {
      ui: {
        rendererProfile: app.rendererProfile,
        rendererIdentity: app.rendererIdentity,
        routerBindings: app.routerBindings,
      },
    },
  });
  return { root, app, manifest, write };
}

test('native renderer projections reject a mismatched tuple, identity and capability claim', () => {
  for (const renderer of ['solid', 'octane'] as const) {
    const app = nativeProjection(renderer);
    assert.equal(assertRendererProjection(app)?.renderer, renderer);
    assert.throws(
      () =>
        assertRendererProjection({
          ...app,
          rendererProfile: {
            ...app.rendererProfile,
            compiler: { ...app.rendererProfile.compiler, version: '0.0.0' },
          },
        }),
      /compiler\/runtime\/router tuple/,
    );
    assert.throws(
      () =>
        assertRendererProjection({
          ...app,
          rendererIdentity: {
            ...app.rendererIdentity,
            buildId: 'different-build',
          },
        }),
      /delivery build/,
    );
    assert.throws(
      () =>
        assertRendererProjection({
          ...app,
          rendererIdentities: { secondary: app.rendererIdentity },
        }),
      /entry identity is missing/,
    );
    assert.throws(
      () =>
        assertRendererProjection({
          ...app,
          rendererCapabilities: {
            ...app.rendererCapabilities,
            federation: true,
          },
        }),
      /admitted profile/,
    );
    assert.throws(
      () => assertRendererProjection({ ...app, moduleFederation: {} }),
      /does not support Module Federation/,
    );
  }
});

test('native renderer projections require a full router binding map for every entry', () => {
  for (const renderer of ['solid', 'octane'] as const) {
    const app = nativeProjection(renderer);
    for (const routerBindings of [undefined, {}]) {
      assert.throws(
        () => assertRendererProjection({ ...app, routerBindings }),
        routerBindings === undefined
          ? /requires router bindings captured from modern.config/
          : /router bindings disagree with its configured entries/,
      );
    }
    const secondaryIdentity = {
      ...app.rendererIdentity,
      entryName: 'secondary',
    };
    assert.throws(
      () =>
        assertRendererProjection({
          ...app,
          rendererIdentities: {
            ...app.rendererIdentities,
            secondary: secondaryIdentity,
          },
        }),
      /router bindings disagree with its configured entries/,
    );
    assert.doesNotThrow(() =>
      assertRendererProjection({
        ...app,
        rendererIdentities: {
          ...app.rendererIdentities,
          secondary: secondaryIdentity,
        },
        routerBindings: {
          ...app.routerBindings,
          secondary: app.routerBindings.main,
        },
      }),
    );
  }
});

test('native renderer projections reject structurally valid cross-renderer router providers', () => {
  const provider = {
    ...getRendererGenerationProfile('react').profile.router,
    framework: 'react-router',
  };
  for (const renderer of ['solid', 'octane'] as const) {
    const app = nativeProjection(renderer);
    const routerBindings = {
      main: {
        ...app.routerBindings.main,
        defaultProvider: provider,
        providers: [provider],
      },
    };
    assert.equal(
      validateRendererRouterBindings(routerBindings, ['main']).ok,
      true,
    );
    assert.equal(
      validateRendererRouterBindings(
        routerBindings,
        ['main'],
        'routerBindings',
        getRendererGenerationProfile(renderer).routerFrameworks,
      ).ok,
      false,
    );
    assert.throws(
      () => assertRendererProjection({ ...app, routerBindings }),
      /router bindings disagree with its configured entries/,
    );
  }
});

test('headless units cannot carry UI identity or renderer dependencies', () => {
  assert.equal(
    assertRendererProjection({ id: 'headless', renderer: 'none' }),
    undefined,
  );
  assert.throws(
    () =>
      assertRendererProjection({
        id: 'headless',
        renderer: 'none',
        rendererProfile: {},
      }),
    /headless unit must omit rendererProfile/,
  );
  assert.throws(
    () =>
      assertRendererProjection({
        id: 'headless',
        renderer: 'none',
        routerBindings: {},
      }),
    /headless unit must omit routerBindings/,
  );
  assert.throws(
    () =>
      assertRendererDependencies(
        { name: 'headless', dependencies: { react: '19.3.0' } },
        'none',
      ),
    /foreign renderer package react/,
  );
  assert.throws(
    () => assertRendererProjection({ id: 'react-app', renderer: 'react' }),
    /compiler\/runtime\/router tuple/,
  );
  assert.throws(
    () =>
      assertRendererDependencies(
        {
          name: 'native-app',
          dependencies: { 'aliased-view': 'npm:react@19.3.0' },
        },
        'solid',
      ),
    /foreign renderer package aliased-view/,
  );
  assert.equal(
    isForeignRendererPackage('@modern-js/renderer-react/browser', 'solid'),
    true,
  );
  assert.equal(
    isForeignRendererPackage('react-refresh/runtime', 'solid'),
    true,
  );
  assert.doesNotThrow(() =>
    assertRendererDependencies(
      { name: 'octane-app', devDependencies: { '@types/react': '19.3.0' } },
      'octane',
    ),
  );
  assert.throws(
    () =>
      assertRendererDependencies(
        {
          name: 'native-app',
          dependencies: { 'react-server-dom-webpack': '19.3.0' },
        },
        'solid',
      ),
    /foreign renderer package react-server-dom-webpack/,
  );
  assert.throws(
    () =>
      assertRendererDependencies(
        { name: 'native-catalog', dependencies: { legacy: 'catalog:compat' } },
        'solid',
        undefined,
        { catalogs: { compat: { legacy: 'npm:react@19.3.0' } } },
      ),
    /foreign renderer package legacy/,
  );
});

test('authored renderer ABI pins resolve explicit catalogs and reject mismatches before projection', () => {
  const generation = getRendererGenerationProfile('solid');
  const version = generation.profile.hydration.version;
  const manifest = {
    name: '@fixture/authored',
    dependencies: {
      'solid-js': 'catalog:ui',
      '@solidjs/web': 'catalog:',
      '@tanstack/router-core': generation.profile.router.coreVersion,
    },
    devDependencies: {
      '@solidjs/compiler': `npm:@solidjs/compiler@${generation.profile.compiler.version}`,
    },
  };
  const catalogs = {
    catalog: { '@solidjs/web': version },
    catalogs: { ui: { 'solid-js': version } },
  };
  assert.doesNotThrow(() =>
    assertAuthoredRendererDependencyPins(manifest, generation, catalogs),
  );
  assert.throws(
    () => assertAuthoredRendererDependencyPins(manifest, generation),
    /declared renderer ABI catalog:ui disagrees/,
  );
  assert.throws(
    () =>
      assertAuthoredRendererDependencyPins(
        {
          ...manifest,
          devDependencies: { '@solidjs/compiler': '^2.0.0-rc.13' },
        },
        generation,
        catalogs,
      ),
    /declared renderer ABI \^2.0.0-rc.13 disagrees/,
  );
  assert.throws(
    () =>
      assertAuthoredRendererDependencyPins(
        { ...manifest, dependencies: { react: '19.3.0' } },
        generation,
        catalogs,
      ),
    /conflicts with the selected solid renderer/,
  );
});

test('maintained Octane distribution pins match the generated requests exactly', () => {
  const generation = getRendererGenerationProfile('octane');
  const manifest = {
    name: '@fixture/maintained-octane',
    dependencies: { ...generation.dependencies },
    devDependencies: { ...generation.devDependencies },
  };
  assert.doesNotThrow(() =>
    assertAuthoredRendererDependencyPins(manifest, generation),
  );
  for (const profile of [
    generation.profile.hydration,
    generation.profile.router,
  ]) {
    const request = generation.dependencies[profile.name];
    assert.equal(typeof request, 'string');
    assert.notEqual(request, profile.version);
    assert.doesNotThrow(() =>
      assertAuthoredRendererDependencyPins(
        {
          ...manifest,
          dependencies: {
            ...manifest.dependencies,
            [profile.name]: 'catalog:maintained-octane',
          },
        },
        generation,
        { catalogs: { 'maintained-octane': { [profile.name]: request } } },
      ),
    );
    for (const mismatch of [profile.version, `${request}?unreviewed=1`]) {
      assert.throws(
        () =>
          assertAuthoredRendererDependencyPins(
            {
              ...manifest,
              dependencies: {
                ...manifest.dependencies,
                [profile.name]: mismatch,
              },
            },
            generation,
          ),
        /declared renderer ABI .* disagrees with the selected pin/,
      );
    }
  }
});

test('framework router workspace requests require actual producer version evidence', () => {
  const generation = getRendererGenerationProfile('solid');
  const name = generation.profile.router.name;
  assert.equal(name, '@modern-js/renderer-solid');
  const evidence = readRendererFrameworkPackageEvidence(name);
  assert.equal(evidence.kind, 'source-checkout');
  assert.equal(evidence.version, generation.profile.router.version);
  assert.ok(fs.existsSync(evidence.evidencePath));
  const manifest = {
    name: '@fixture/framework-router',
    dependencies: { [name]: 'workspace:*' },
  };
  assert.doesNotThrow(() =>
    assertAuthoredRendererDependencyPins(manifest, generation),
  );
  assert.doesNotThrow(() =>
    assertAuthoredRendererDependencyPins(
      { ...manifest, dependencies: { [name]: 'catalog:ultramodern' } },
      generation,
      { catalogs: { ultramodern: { [name]: evidence.version } } },
    ),
  );
  assert.throws(
    () =>
      assertAuthoredRendererDependencyPins(manifest, {
        ...generation,
        profile: {
          ...generation.profile,
          router: { ...generation.profile.router, version: '0.0.0' },
        },
      }),
    /disagrees with producer cohort evidence/,
  );
  assert.throws(
    () =>
      assertAuthoredRendererDependencyPins(
        {
          ...manifest,
          dependencies: {
            [name]: `npm:@unverified/renderer-solid@${evidence.version}`,
          },
        },
        generation,
      ),
    /authenticated producer package/,
  );
  assert.throws(
    () =>
      assertAuthoredRendererDependencyPins(
        {
          ...manifest,
          devDependencies: {
            [generation.profile.compiler.name]: 'workspace:*',
          },
        },
        generation,
      ),
    /declared renderer ABI workspace:\* disagrees/,
  );
});

test('selected native overlay pins stay unchanged and neutral extensions pass', () => {
  for (const renderer of ['solid', 'octane'] as const) {
    const { root, app, manifest, write } = overlayFixture(renderer);
    try {
      const snapshot = captureOverlayBaselineSnapshot(root, [app.path]);
      manifest.dependencies['fixture-extension'] = '1.0.0';
      write(`${app.path}/package.json`, manifest);
      assert.doesNotThrow(() =>
        assertOverlayPreservedBaseline({
          workspaceRoot: root,
          generator: 'neutral',
          snapshot,
        }),
      );
      const runtimeName =
        getRendererGenerationProfile(renderer).profile.hydration.name;
      manifest.dependencies[runtimeName] = '0.0.0';
      write(`${app.path}/package.json`, manifest);
      assert.throws(
        () =>
          assertOverlayPreservedBaseline({
            workspaceRoot: root,
            generator: 'runtime-pin',
            snapshot,
          }),
        (error: unknown) =>
          error instanceof OverlayBaselineRelaxationError &&
          error.violations.some(
            violation =>
              violation.kind === 'baseline-version-relaxation' &&
              violation.detail.includes(runtimeName),
          ),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('native overlays reject foreign aliases, metadata drift and unsupported artifacts', () => {
  for (const mutation of [
    'alias',
    'metadata',
    'artifact',
    'workspace-policy',
    'root-alias',
  ] as const) {
    const { root, app, manifest, write } = overlayFixture('solid');
    try {
      const snapshot = captureOverlayBaselineSnapshot(root, [app.path]);
      if (mutation === 'alias') {
        manifest.dependencies['alternate-view'] = 'npm:react@19.3.0';
        write(`${app.path}/package.json`, manifest);
      } else if (mutation === 'metadata') {
        write('topology/reference-topology.json', {
          shell: {
            ...app,
            rendererCapabilities: {
              ...app.rendererCapabilities,
              workers: true,
            },
          },
          verticals: [],
        });
      } else if (mutation === 'artifact') {
        write(`${app.path}/module-federation.config.ts`, 'export default {};');
      } else if (mutation === 'workspace-policy') {
        write('pnpm-workspace.yaml', 'overrides:\n  react: 19.3.0\n');
      } else {
        write('package.json', {
          name: '@fixture/workspace',
          dependencies: { legacy: 'npm:react@19.3.0' },
        });
      }
      assert.throws(
        () =>
          assertOverlayPreservedBaseline({
            workspaceRoot: root,
            generator: mutation,
            snapshot,
          }),
        (error: unknown) =>
          error instanceof OverlayBaselineRelaxationError &&
          error.violations.some(
            violation => violation.kind === 'renderer-profile-relaxation',
          ),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('headless overlays cannot introduce a native page source surface', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-headless-overlay-'));
  const appPath = 'verticals/headless';
  const write = (relative: string, value: unknown) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  };
  try {
    write('package.json', { name: '@fixture/workspace' });
    write('topology/reference-topology.json', {
      verticals: [{ id: 'headless', path: appPath, renderer: 'none' }],
    });
    write(`${appPath}/package.json`, { name: '@fixture/headless' });
    write(`${appPath}/shared/ultramodern-build.json`, { surfaces: {} });
    const snapshot = captureOverlayBaselineSnapshot(root, []);
    assert.doesNotThrow(() =>
      assertOverlayPreservedBaseline({
        workspaceRoot: root,
        generator: 'neutral-headless',
        snapshot,
      }),
    );
    write(
      `${appPath}/src/routes/page.tsx`,
      'export default function Page() { return null; }',
    );
    assert.throws(
      () =>
        assertOverlayPreservedBaseline({
          workspaceRoot: root,
          generator: 'headless-page',
          snapshot,
        }),
      (error: unknown) =>
        error instanceof OverlayBaselineRelaxationError &&
        error.violations.some(
          violation =>
            violation.kind === 'renderer-profile-relaxation' &&
            violation.detail.includes('src/routes'),
        ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
