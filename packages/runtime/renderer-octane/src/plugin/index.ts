import path from 'node:path';
import {
  defineRendererAdapter,
  type NativeRendererAdapter,
  nativeRendererDependencies,
} from '@modern-js/renderer-core/adapter';
import { octaneCompilerArtifacts } from './artifacts';
import { createOctaneCompilerPlugin, pluginSourceDirectory } from './compiler';
import { generateOctaneAppSources } from './create';
import { octaneProfile } from './profile';
import { assertOctaneEntrySource } from './source';

/** The build-side Octane renderer adapter UltraModern loads for `renderer: 'octane'`. */
export const rendererAdapter: NativeRendererAdapter<'octane'> =
  defineRendererAdapter({
    name: 'octane',
    kind: 'native',
    profile: octaneProfile,
    routerFrameworks: ['octane'],
    ownedPackages: ['octane', '@octanejs/', '@modern-js/renderer-octane'],
    runtime: {
      package: 'octane',
      bootstrap: '@modern-js/renderer-octane',
      entryClient: '@modern-js/renderer-octane/entry-client',
      entryServer: '@modern-js/renderer-octane/entry-server',
      router: '@modern-js/renderer-octane/router',
      i18n: '@modern-js/renderer-octane/i18n',
      manifest: '@modern-js/renderer-octane/manifest',
    },
    worker: { nativeDocuments: true, rsc: false },
    lazyStyles: 'document',
    // Hydration bytes belong to this exact native client compilation.
    entryClient: {
      declarations: 'declare const __webpack_hash__: string;\n',
      fields: { nativeHydrationBuildId: '__webpack_hash__' },
    },
    svgComponentTemplate: path.join(
      pluginSourceDirectory(),
      'svg-component-template.cjs',
    ),
    compiler: createOctaneCompilerPlugin,
    artifacts: octaneCompilerArtifacts,
    assertSupportedSource: assertOctaneEntrySource,
    create: {
      dependencies: (profile, { typescriptVersion }) => ({
        frameworkDependencies: [
          '@modern-js/renderer-core',
          '@modern-js/renderer-octane',
        ],
        dependencies: nativeRendererDependencies(profile),
        devDependencies: {
          [profile.compiler.name]: profile.compiler.version,
          typescript: typescriptVersion,
        },
        typecheckCommand: 'octane-tsc --noEmit --project tsconfig.json',
        tsconfig: {
          tsrx: {
            compiler: 'octane/compiler/volar',
            platform: 'web',
          },
        },
      }),
      generateAppSources: generateOctaneAppSources,
    },
  });
