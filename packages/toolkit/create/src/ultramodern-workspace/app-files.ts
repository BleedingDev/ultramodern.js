import {
  appI18nNamespace,
  remoteDependencyAlias,
  resolveRemoteRefs,
  shellApp,
} from './descriptors';
import { readFileTemplate, renderFileTemplate } from './fs-io';
import { packageName, tailwindPrefixForApp } from './naming';
import type { JsonValue, WorkspaceApp } from './types';

function createBoundaryDebugMetadata(
  scope: string,
  remotes: WorkspaceApp[] = [],
): JsonValue {
  return {
    appId: shellApp.id,
    boundaries: [shellApp, ...remotes].map(app => ({
      appId: app.id,
      label: app.displayName,
      mfName: app.mfName,
      ownerTeam: app.ownership.team,
      packageName: packageName(scope, app.packageSuffix),
      role: app.kind === 'shell' ? 'host' : 'vertical',
    })),
    schemaVersion: 1,
  };
}

export function createAppEnvDts(
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): string {
  const remoteModuleDeclarations = resolveRemoteRefs(app, remotes)
    .flatMap(remote =>
      Object.keys(remote.exposes ?? {})
        .filter(expose => expose !== './Route')
        .map(expose => {
          const moduleName = `${remoteDependencyAlias(remote)}/${expose.replace(
            /^\.\//u,
            '',
          )}`;
          return `declare module '${moduleName}' {
  const Component: React.ComponentType<Record<string, never>>;
  export default Component;
}
`;
        }),
    )
    .join('\n');

  const reactTypeImport = remoteModuleDeclarations
    ? "import type React from 'react';\n"
    : '';

  return [
    `import '@modern-js/app-tools/types';\n${reactTypeImport}`.trimEnd(),
    `declare global {
  const ULTRAMODERN_SITE_URL: string;
}`,
    remoteModuleDeclarations.trimEnd(),
  ]
    .filter(section => section.length > 0)
    .join('\n\n')
    .concat('\n');
}

export function createAppRuntimeConfig(
  app: WorkspaceApp,
  scope: string,
  remotes: WorkspaceApp[] = [],
): string {
  const pluginsConfig =
    app.kind === 'shell'
      ? `  plugins: [
    ultramodernBoundaryDebuggerPlugin({
      metadata: ${JSON.stringify(
        createBoundaryDebugMetadata(scope, remotes),
        null,
        6,
      )
        .split('\n')
        .join('\n      ')},
    }),
  ],
`
      : '';

  return `import { defineRuntimeConfig } from '@modern-js/runtime';
${app.kind === 'shell' ? "import { ultramodernBoundaryDebuggerPlugin } from '@modern-js/runtime/boundary-debugger';\n" : ''}import { createInstance } from 'i18next';
import csResource from '../locales/cs/${appI18nNamespace(app)}.json';
import enResource from '../locales/en/${appI18nNamespace(app)}.json';
import { ultramodernRouteNamespace } from './routes/ultramodern-route-metadata';

type LocaleResource = string | { readonly [key: string]: LocaleResource };

const flattenLocaleResource = (
  resource: LocaleResource,
  prefix = '',
): Record<string, string> => {
  if (typeof resource === 'string') {
    return prefix.length > 0 ? { [prefix]: resource } : {};
  }

  return Object.fromEntries(
    Object.entries(resource).flatMap(([key, value]) => {
      const nextKey = prefix.length > 0 ? \`\${prefix}.\${key}\` : key;
      return typeof value === 'string'
        ? [[nextKey, value]]
        : Object.entries(flattenLocaleResource(value, nextKey));
    }),
  );
};

const i18nInstance = createInstance();
const resources = {
  cs: { [ultramodernRouteNamespace]: flattenLocaleResource(csResource) },
  en: { [ultramodernRouteNamespace]: flattenLocaleResource(enResource) },
} as const;

export default defineRuntimeConfig({
  i18n: {
    i18nInstance,
    initOptions: {
      defaultNS: ultramodernRouteNamespace,
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
      ns: [ultramodernRouteNamespace, 'translation'],
      resources,
      supportedLngs: ['en', 'cs'],
    },
  },
${pluginsConfig}
  router: {
    framework: 'tanstack',
  },
});
`;
}

function createCssTokenImport(scope: string): string {
  return `@import '${packageName(scope, 'shared-design-tokens')}/tokens.css';\n`;
}

function createTailwindImport(prefix: string): string {
  return `@import 'tailwindcss' prefix(${prefix}) source(none);\n@source '..';\n`;
}

function createShellStyles(enableTailwind: boolean, scope: string): string {
  return `${enableTailwind ? createTailwindImport(tailwindPrefixForApp(shellApp)) : ''}${createCssTokenImport(
    scope,
  )}`;
}

function createRemoteStyles(
  enableTailwind: boolean,
  scope: string,
  app: WorkspaceApp,
): string {
  return `${enableTailwind ? createTailwindImport(tailwindPrefixForApp(app)) : ''}${createCssTokenImport(
    scope,
  )}`;
}

export function createAppStyles(
  enableTailwind: boolean,
  scope: string,
  app: WorkspaceApp,
): string {
  return app.kind === 'shell'
    ? createShellStyles(enableTailwind, scope)
    : createRemoteStyles(enableTailwind, scope, app);
}

export function createPostcssConfig(): string {
  return renderFileTemplate('workspace/postcss.config.mjs', {});
}

export function createTailwindConfig(): string {
  return renderFileTemplate('workspace/tailwind.config.ts', {});
}

export function createSharedDesignTokensCss(): string {
  return renderFileTemplate(
    'workspace/packages/shared-design-tokens/tokens.css',
    {},
  );
}

export function createRouteHeadModule(app: WorkspaceApp): string {
  return renderFileTemplate('app/ultramodern-route-head.tsx', {
    appDisplayNameJson: JSON.stringify(app.displayName),
  });
}

export function createShellFrameComponent(): string {
  return readFileTemplate('app/shell-frame.tsx');
}
