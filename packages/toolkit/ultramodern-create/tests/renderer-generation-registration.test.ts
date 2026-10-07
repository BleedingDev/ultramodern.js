import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type RendererBuildProfile,
  registeredRenderers,
  resolveCandidateRendererProfile,
  resolveRendererRouterFrameworks,
} from '@modern-js/ultramodern-app-tools';
import type { RendererRegistration } from '../../../solutions/ultramodern-app-tools/src/native-composition/renderer-registration';
import { shellApp } from '../src/ultramodern-workspace/descriptors';
import type { NativeAppSourceOptions } from '../src/ultramodern-workspace/renderer-generation-profile';
import {
  getRendererGenerationProfile,
  isApplicationRenderer,
} from '../src/ultramodern-workspace/renderer-profile';
import type { WorkspaceApp } from '../src/ultramodern-workspace/types';
import { writeApp } from '../src/ultramodern-workspace/write-app';
import { snapshotWorkspace } from './helpers/workspace-kit';

const paper = rstest.hoisted(() => {
  const candidate = {
    renderer: 'paper',
    status: 'preview',
    protocolVersion: 1,
    minimumNode: '26.10.0',
    hmr: {
      editedBoundary: 'may-reset',
      unaffectedComponents: 'preserved',
      document: 'preserved',
      roots: 'single',
      cleanup: 'exactly-once',
    },
    compiler: { name: '@paper/compiler', version: '4.2.1' },
    hydration: { name: 'paper-runtime', version: '4.2.3' },
    router: {
      name: '@modern-js/renderer-paper/router',
      version: '1.2.4',
      coreName: '@paper/router-core',
      coreVersion: '5.1.0',
    },
    sourceExtensions: ['.tsx'],
    jsxImportSource: 'paper-runtime',
    dependencies: {
      'paper-runtime': '4.2.3',
      '@paper/router-core': '5.1.0',
    },
    capabilities: {
      worker: false,
      moduleFederation: false,
      rsc: false,
      ssg: false,
      i18n: false,
      svgComponent: false,
    },
  } satisfies RendererBuildProfile;
  const unusedNativeRuntime = () => {
    throw new Error('Cold generation must not evaluate native runtime hooks.');
  };
  const nativeAdapter = {
    renderer: 'paper',
    infrastructurePluginName: '@modern-js/renderer-paper-infrastructure',
    profile: candidate,
    compilerArtifacts: {
      routerFrameworks: ['paper'],
      clientManifestFile: unusedNativeRuntime,
      validateClientManifest: async () => unusedNativeRuntime(),
      isMutableDevelopmentAsset: unusedNativeRuntime,
    },
    createEntryGenerator: unusedNativeRuntime,
    compiler: Object.freeze({
      schema: 'ultramodern-native-compiler-activation',
      version: 1,
      renderer: 'paper',
      operation: 'compiler',
      module: Object.freeze({
        source: './src/renderers/paper/compiler/index.ts',
        import: './dist/esm-node/renderers/paper/compiler/index.mjs',
        require: './dist/cjs/renderers/paper/compiler/index.js',
      }),
      export: 'createPaperCompilerPlugin',
    }),
  };
  const registration = {
    renderer: 'paper',
    kind: 'native',
    candidateProfile: candidate,
    routerFrameworks: ['paper'],
    frameworkModules: [
      {
        specifier: '@modern-js/renderer-paper',
        request: '@modern-js/renderer-paper/manifest',
      },
    ],
    supports: {
      reactCliPlugins: false,
      reactRuntimeDescriptors: false,
      reactCompiler: false,
      cssDeclarations: false,
    },
    nativeAdapter,
  } satisfies RendererRegistration;
  return {
    candidate,
    registration,
    nativeAdapter,
    sourceOptions: [] as NativeAppSourceOptions[],
  };
});

// Replace one static SDK owner without replacing its public catalogue resolver.
rstest.mock(
  '../../../solutions/ultramodern-app-tools/src/renderers/octane/registration',
  () => ({
    octaneRendererRegistration: paper.registration,
    octaneNativeRendererAdapter: paper.nativeAdapter,
  }),
);

rstest.mock('../src/ultramodern-workspace/renderer-generation-registry', () => {
  const actual = rstest.requireActual<
    typeof import('../src/ultramodern-workspace/renderer-generation-registry')
  >('../src/ultramodern-workspace/renderer-generation-registry');
  return {
    ...actual,
    rendererGenerations: {
      ...actual.rendererGenerations,
      paper: {
        renderer: 'paper',
        kind: 'native',
        createProfile(selected: RendererBuildProfile) {
          return {
            renderer: selected.renderer,
            profile: {
              renderer: selected.renderer,
              protocolVersion: selected.protocolVersion,
              compiler: { ...selected.compiler },
              hydration: { ...selected.hydration },
              router: { ...selected.router },
            },
            sourceExtension: '.tsx',
            jsxImportSource: selected.jsxImportSource,
            routerFrameworks: ['paper'],
            nodeVersion: selected.minimumNode,
            frameworkDependencies: [
              '@modern-js/renderer-core',
              '@modern-js/renderer-paper',
            ],
            dependencies: { ...selected.dependencies },
            devDependencies: {
              [selected.compiler.name]: selected.compiler.version,
            },
            capabilities: {
              ssr: true,
              streaming: true,
              workers: selected.capabilities.worker,
              federation: selected.capabilities.moduleFederation,
              rsc: selected.capabilities.rsc,
            },
            typecheckCommand: 'paper-check --project tsconfig.json',
            tsconfig: {
              paper: { compiler: 'paper/compiler', platform: 'web' },
            },
          };
        },
        generateAppSources(options: NativeAppSourceOptions) {
          paper.sourceOptions.push(options);
          return {
            sourceExtension: options.sourceExtension,
            jsxImportSource: options.jsxImportSource,
            artifacts: [
              {
                path: 'src/routes/layout.tsx',
                content: `import { Outlet } from '@modern-js/renderer-paper/router';

export default function Layout() {
  return <main data-renderer="paper"><Outlet /></main>;
}
`,
              },
              {
                path: 'src/routes/page.tsx',
                content: `import { createAtom } from 'paper-runtime';

export default function Page() {
  const count = createAtom(0);
  return <button onClick={() => count.update(value => value + 1)}>${options.title}: {count.read()}</button>;
}
`,
              },
            ],
          };
        },
      },
    },
  };
});

test('a foreign renderer owner uses the public SDK resolver and common writer', () => {
  const renderer: string = 'paper';
  assert.deepEqual(registeredRenderers, ['react', 'solid', 'paper']);
  assert.deepEqual(resolveCandidateRendererProfile(renderer), paper.candidate);
  assert.deepEqual(resolveRendererRouterFrameworks(renderer), ['paper']);
  assert.ok(isApplicationRenderer(renderer));
  const profile = getRendererGenerationProfile(renderer);
  assert.equal(profile.renderer, 'paper');
  assert.equal(profile.profile.renderer, 'paper');
  assert.deepEqual(profile.profile.compiler, {
    name: '@paper/compiler',
    version: '4.2.1',
  });
  assert.deepEqual(profile.profile.hydration, {
    name: 'paper-runtime',
    version: '4.2.3',
  });
  assert.deepEqual(profile.profile.router, {
    name: '@modern-js/renderer-paper/router',
    version: '1.2.4',
    coreName: '@paper/router-core',
    coreVersion: '5.1.0',
  });
  assert.equal(profile.sourceExtension, '.tsx');
  assert.equal(profile.jsxImportSource, 'paper-runtime');
  assert.deepEqual(profile.routerFrameworks, ['paper']);

  const tempRoot = fs.mkdtempSync(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'um-generation-registration-',
    ),
  );
  const targetDir = path.join(tempRoot, 'workspace');
  const app: WorkspaceApp = {
    ...shellApp,
    renderer,
    displayName: 'Paper Shell',
    rendererProfile: profile.profile,
    rendererCapabilities: profile.capabilities,
  };
  try {
    writeApp(
      targetDir,
      'paper-workspace',
      app,
      { strategy: 'workspace', modernPackageVersion: '3.8.3' },
      false,
    );
    const files = snapshotWorkspace(targetDir);
    const directory = app.directory;
    const manifest = JSON.parse(files[`${directory}/package.json`]!);
    const tsconfig = JSON.parse(files[`${directory}/tsconfig.json`]!);
    assert.equal(
      manifest.dependencies['@modern-js/renderer-paper'],
      'workspace:*',
    );
    assert.equal(
      manifest.dependencies['@modern-js/renderer-core'],
      'workspace:*',
    );
    assert.equal(manifest.dependencies['paper-runtime'], '4.2.3');
    assert.equal(manifest.dependencies['@paper/router-core'], '5.1.0');
    assert.equal(manifest.devDependencies['@paper/compiler'], '4.2.1');
    assert.equal(
      manifest.scripts.typecheck,
      'paper-check --project tsconfig.json',
    );
    assert.equal(manifest.engines.node, '>=26.10.0');
    assert.equal(tsconfig.compilerOptions.jsx, 'preserve');
    assert.equal(tsconfig.compilerOptions.jsxImportSource, 'paper-runtime');
    assert.deepEqual(tsconfig.compilerOptions.types, []);
    assert.deepEqual(tsconfig.paper, {
      compiler: 'paper/compiler',
      platform: 'web',
    });
    assert.equal(
      files[`${directory}/src/modern-app-env.d.ts`],
      `/// <reference types="@modern-js/ultramodern-app-tools/types" />
/// <reference types="paper-runtime" />
`,
    );
    assert.equal(
      files[`${directory}/src/routes/layout.tsx`],
      `import { Outlet } from '@modern-js/renderer-paper/router';

export default function Layout() {
  return <main data-renderer="paper"><Outlet /></main>;
}
`,
    );
    assert.equal(
      files[`${directory}/src/routes/page.tsx`],
      `import { createAtom } from 'paper-runtime';

export default function Page() {
  const count = createAtom(0);
  return <button onClick={() => count.update(value => value + 1)}>Paper Shell: {count.read()}</button>;
}
`,
    );
    assert.match(
      files[`${directory}/modern.config.ts`]!,
      /renderer:\s*["']paper["']/u,
    );
    assert.match(
      files[`${directory}/modern.config.ts`]!,
      /source:\s*\{\s*mainEntryName:\s*'main'\s*\}/u,
    );
    assert.deepEqual(paper.sourceOptions, [
      {
        appId: app.id,
        title: 'Paper Shell',
        entryName: 'main',
        sourceExtension: '.tsx',
        jsxImportSource: 'paper-runtime',
        capabilities: { ssr: true, federation: false },
      },
    ]);
    for (const [relativePath, content] of Object.entries(files)) {
      assert.doesNotMatch(
        content,
        /(?:solid-js|@solidjs\/|octane|@octanejs\/|@modern-js\/renderer-(?:solid|octane))/u,
        relativePath,
      );
    }
  } finally {
    paper.sourceOptions.length = 0;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('a misspelled renderer is rejected before the common writer creates output', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'um-generation-unknown-',
    ),
  );
  const targetDir = path.join(tempRoot, 'workspace');
  const app: WorkspaceApp = { ...shellApp };
  Reflect.set(app, 'renderer', 'paepr');
  try {
    assert.equal(isApplicationRenderer('paepr'), false);
    assert.throws(
      () =>
        writeApp(
          targetDir,
          'paper-workspace',
          app,
          { strategy: 'workspace', modernPackageVersion: '3.8.3' },
          false,
        ),
      /requires a renderer resolved from modern.config/u,
    );
    assert.equal(fs.existsSync(targetDir), false);
    assert.deepEqual(fs.readdirSync(tempRoot), []);
    assert.deepEqual(paper.sourceOptions, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
