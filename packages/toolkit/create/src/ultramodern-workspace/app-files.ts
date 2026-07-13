import {
  appEmitsBrowserUi,
  appI18nNamespace,
  remoteDependencyAlias,
  resolveRemoteRefs,
} from './descriptors';
import { readFileTemplate, renderFileTemplate } from './fs-io';
import { packageName, tailwindPrefixForApp } from './naming';
import type { JsonValue, WorkspaceApp } from './types';

function createBoundaryDebugMetadata(
  scope: string,
  shell: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): JsonValue {
  return {
    appId: shell.id,
    boundaries: [shell, ...remotes].map(app => ({
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
  emitsUi = appEmitsBrowserUi(app),
): string {
  const pluginsConfig =
    app.kind === 'shell'
      ? `  plugins: [
    ultramodernBoundaryDebuggerPlugin({
      metadata: ${JSON.stringify(
        createBoundaryDebugMetadata(scope, app, remotes),
        null,
        6,
      )
        .split('\n')
        .join('\n      ')},
    }),
  ],
`
      : '';

  const routeMetadataImport = emitsUi
    ? "import { ultramodernRouteNamespace } from './routes/ultramodern-route-metadata';\n"
    : '';
  const routeNamespace = emitsUi ? 'ultramodernRouteNamespace' : "'api'";

  return `import { defineRuntimeConfig } from '@modern-js/runtime';
${app.kind === 'shell' ? "import { ultramodernBoundaryDebuggerPlugin } from '@modern-js/runtime/boundary-debugger';\n" : ''}import { createInstance } from 'i18next';
import csResource from '../locales/cs/${appI18nNamespace(app)}.json';
import enResource from '../locales/en/${appI18nNamespace(app)}.json';
${routeMetadataImport}

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
  cs: { [${routeNamespace}]: flattenLocaleResource(csResource) },
  en: { [${routeNamespace}]: flattenLocaleResource(enResource) },
} as const;

export default defineRuntimeConfig({
  i18n: {
    i18nInstance,
    initOptions: {
      defaultNS: ${routeNamespace},
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
      ns: [${routeNamespace}, 'translation'],
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

function createShellStyles(
  enableTailwind: boolean,
  scope: string,
  shell: WorkspaceApp,
): string {
  return `${enableTailwind ? createTailwindImport(tailwindPrefixForApp(shell)) : ''}${createCssTokenImport(
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
    ? createShellStyles(enableTailwind, scope, app)
    : createRemoteStyles(enableTailwind, scope, app);
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

export function createShellFrameComponent(shell?: WorkspaceApp): string {
  const source = readFileTemplate('app/shell-frame.tsx');
  const prefix = tailwindPrefixForApp(
    shell ?? {
      kind: 'shell',
      id: 'shell-super-app',
      directory: 'apps/shell-super-app',
      packageSuffix: 'shell-super-app',
      displayName: 'Shell Super App',
      portEnv: 'SHELL_SUPER_APP_PORT',
      port: 3020,
      mfName: 'shellSuperApp',
      ownership: {
        team: 'super-app-platform',
        slack: '#super-app-platform',
        pagerDuty: 'pd-super-app-platform',
        runbookRef: 'runbooks/wave2/shell-super-app.md',
        adrRef:
          'docs/super-app-rfc-adr/wave2/reference-topology.md#shell-super-app',
        blastRadius: { tier: 'tier-0-shell', references: [] },
      },
    },
  );
  return prefix === 'shell'
    ? source
    : source.replace(/\bshell:/gu, `${prefix}:`);
}
