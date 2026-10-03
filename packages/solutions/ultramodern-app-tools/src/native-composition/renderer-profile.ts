import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Renderer } from '@modern-js/renderer-core';
import {
  type FrameworkModule,
  projectInstalledRendererProfile,
  type RendererProfileMetadata,
} from './renderer-installed-profile';

export interface RendererBuildProfile {
  renderer: Renderer;
  status: 'stable' | 'preview';
  protocolVersion: 1;
  minimumNode: '26.7.0';
  hmr: {
    editedBoundary: 'may-reset';
    unaffectedComponents: 'preserved';
    document: 'preserved';
    roots: 'single';
    cleanup: 'exactly-once';
  };
  compiler: { name: string; version: string };
  hydration: { name: string; version: string };
  router: {
    name: string;
    version: string;
    coreName: string;
    coreVersion: string;
  };
  sourceExtensions: readonly string[];
  jsxImportSource: string;
  dependencies: Readonly<Record<string, string>>;
  capabilities: {
    worker: boolean;
    moduleFederation: boolean;
    rsc: boolean;
    ssg: boolean;
    i18n: boolean;
    svgComponent: boolean;
  };
}

/** Generation metadata without installed SDK resolution; builds require installed admission. */
export function resolveCandidateRendererProfile(
  renderer: Renderer,
): RendererBuildProfile {
  switch (renderer) {
    case 'react':
      return {
        renderer,
        status: 'stable',
        protocolVersion: 1,
        minimumNode: '26.7.0',
        hmr: {
          editedBoundary: 'may-reset',
          unaffectedComponents: 'preserved',
          document: 'preserved',
          roots: 'single',
          cleanup: 'exactly-once',
        },
        compiler: { name: '@rsbuild/plugin-react', version: '2.1.0' },
        hydration: { name: 'react-dom', version: '19.3.0' },
        router: {
          name: 'react-router',
          version: '7.18.4',
          coreName: 'react-router',
          coreVersion: '7.18.4',
        },
        sourceExtensions: ['.tsx', '.ts', '.jsx', '.js'],
        jsxImportSource: 'react',
        dependencies: {
          react: '19.3.0',
          'react-dom': '19.3.0',
          '@modern-js/runtime': '3.9.0',
          '@modern-js/i18n-integration': '3.8.3',
          '@modern-js/runtime-renderer-extensions': '3.8.3',
          '@rsbuild/plugin-react': '2.1.0',
          '@rsbuild/plugin-svgr': '2.0.5',
          '@loadable/component': '5.16.7',
          'react-helmet-async': '3.0.0',
          'react-router': '7.18.4',
        },
        capabilities: {
          worker: true,
          moduleFederation: true,
          rsc: true,
          ssg: true,
          i18n: true,
          svgComponent: true,
        },
      };
    case 'solid':
      return {
        renderer,
        status: 'preview',
        protocolVersion: 1,
        minimumNode: '26.7.0',
        hmr: {
          editedBoundary: 'may-reset',
          unaffectedComponents: 'preserved',
          document: 'preserved',
          roots: 'single',
          cleanup: 'exactly-once',
        },
        compiler: { name: '@solidjs/compiler', version: '2.0.0-rc.13' },
        hydration: { name: '@solidjs/web', version: '2.0.0-rc.13' },
        router: {
          name: '@modern-js/renderer-solid',
          version: '3.8.3',
          coreName: '@tanstack/router-core',
          coreVersion: '1.171.32',
        },
        sourceExtensions: ['.tsx', '.ts', '.jsx', '.js'],
        jsxImportSource: '@solidjs/web',
        dependencies: {
          'solid-js': '2.0.0-rc.13',
          '@solidjs/web': '2.0.0-rc.13',
          '@solidjs/signals': '2.0.0-rc.13',
          '@solidjs/compiler': '2.0.0-rc.13',
          '@modern-js/renderer-solid': '3.8.3',
          seroval: '1.6.8',
          'seroval-plugins': '1.6.8',
        },
        capabilities: {
          worker: false,
          moduleFederation: false,
          rsc: false,
          ssg: false,
          i18n: false,
          svgComponent: false,
        },
      };
    case 'octane':
      return {
        renderer,
        status: 'preview',
        protocolVersion: 1,
        minimumNode: '26.7.0',
        hmr: {
          editedBoundary: 'may-reset',
          unaffectedComponents: 'preserved',
          document: 'preserved',
          roots: 'single',
          cleanup: 'exactly-once',
        },
        compiler: { name: '@octanejs/rspack-plugin', version: '0.1.55' },
        hydration: {
          name: 'octane',
          version: '0.7.1+ultramodern.f75bf12ac8be',
        },
        router: {
          name: '@octanejs/tanstack-router',
          version: '0.1.60+ultramodern.6c31d4be4768',
          coreName: '@tanstack/router-core',
          coreVersion: '1.171.15',
        },
        sourceExtensions: ['.tsx', '.tsrx', '.ts', '.jsx', '.js'],
        jsxImportSource: 'octane',
        dependencies: {
          octane:
            'https://github.com/bleedingdev/octane/releases/download/octane%400.7.1%2Bultramodern.f75bf12ac8be/octane-0.7.1%2Bultramodern.f75bf12ac8be.tgz',
          '@octanejs/tanstack-router':
            'https://github.com/bleedingdev/octane/releases/download/%40octanejs%2Ftanstack-router%400.1.60%2Bultramodern.6c31d4be4768/octanejs-tanstack-router-0.1.60%2Bultramodern.6c31d4be4768.tgz',
          '@octanejs/rspack-plugin': '0.1.55',
          '@modern-js/renderer-octane': '3.8.3',
          seroval: '1.6.8',
          'seroval-plugins': '1.6.8',
        },
        capabilities: {
          worker: false,
          moduleFederation: false,
          rsc: false,
          ssg: false,
          i18n: false,
          svgComponent: false,
        },
      };
    default:
      throw new Error(`Unsupported UltraModern renderer: ${String(renderer)}`);
  }
}

/** Resolve only the selected SDK owners through their public module specifiers. */
export function resolveRendererProfileMetadata(
  renderer: Renderer,
): RendererProfileMetadata {
  const candidate = resolveCandidateRendererProfile(renderer);
  const require = createRequire(import.meta.url);
  const modules: FrameworkModule[] = [
    {
      specifier: '@modern-js/ultramodern-app-tools',
      filename: fileURLToPath(import.meta.url),
    },
    {
      specifier: '@modern-js/renderer-core',
      filename: require.resolve('@modern-js/renderer-core/server'),
    },
    {
      specifier: '@modern-js/builder',
      filename: require.resolve('@modern-js/builder'),
    },
  ];
  switch (renderer) {
    case 'react':
      modules.push(
        {
          specifier: '@modern-js/runtime',
          filename: require.resolve('@modern-js/runtime/cli'),
        },
        {
          specifier: '@modern-js/runtime-renderer-extensions',
          filename: require.resolve('@modern-js/runtime-renderer-extensions'),
        },
        {
          specifier: '@modern-js/i18n-integration',
          filename: require.resolve('@modern-js/i18n-integration'),
        },
      );
      break;
    case 'solid':
      modules.push({
        specifier: '@modern-js/renderer-solid',
        filename: require.resolve('@modern-js/renderer-solid/manifest'),
      });
      break;
    case 'octane':
      modules.push({
        specifier: '@modern-js/renderer-octane',
        filename: require.resolve('@modern-js/renderer-octane/manifest'),
      });
      break;
  }
  return projectInstalledRendererProfile(candidate, modules);
}

export function resolveRendererProfile(
  renderer: Renderer,
): RendererBuildProfile {
  return resolveRendererProfileMetadata(renderer).profile;
}
