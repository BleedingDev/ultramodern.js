import {
  appHasApi,
  appI18nNamespace,
  distributedSsrExposes,
  remoteDependencyAlias,
  resolveApiProtocol,
  resolveApiStem,
  resolveRemoteRefs,
} from './descriptors';
import { renderFileTemplate } from './fs-io';
import {
  createTw,
  packageName,
  tailwindPrefixForApp,
  toPascalCase,
} from './naming';
import type { WorkspaceApp } from './types';

export function createShellPage(
  shell: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): string {
  const tw = createTw(tailwindPrefixForApp(shell));
  const remoteCount = String(remotes.length);

  return renderFileTemplate(
    'workspace/apps/shell-super-app/src/routes/[lang]/page.tsx',
    {
      heroClassName: tw(
        'mx-auto grid max-w-7xl items-center gap-8 py-8 md:grid-cols-[0.9fr_1.1fr] lg:gap-14',
      ),
      heroContentClassName: tw('min-w-0'),
      eyebrowClassName: tw(
        'text-xs font-black uppercase tracking-[0.18em] text-emerald-800',
      ),
      titleClassName: tw(
        'mt-3 max-w-3xl text-5xl font-black leading-none tracking-normal text-stone-950 md:text-7xl',
      ),
      ledeClassName: tw('mt-5 max-w-2xl text-lg leading-8 text-stone-600'),
      actionsClassName: tw('mt-7 flex flex-wrap gap-3'),
      primaryActionClassName: tw(
        'inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-800 px-5 font-bold text-white shadow-lg shadow-stone-900/10',
      ),
      secondaryActionClassName: tw(
        'inline-flex min-h-11 items-center justify-center rounded-full border border-stone-900/15 bg-white/90 px-5 font-bold text-stone-950 shadow-lg shadow-stone-900/10',
      ),
      cardsClassName: tw(
        'rounded-3xl bg-white/90 p-6 shadow-2xl shadow-stone-900/15',
      ),
      cardsGridClassName: tw('grid gap-4 sm:grid-cols-2'),
      remoteCardClassName: tw('rounded-2xl bg-emerald-50 p-5'),
      remoteCardKickerClassName: tw(
        'text-sm font-black uppercase tracking-[0.16em] text-emerald-800',
      ),
      cardValueClassName: tw('mt-3 block text-3xl font-black text-stone-950'),
      remoteCount,
      cardBodyClassName: tw('mt-2 text-sm font-semibold text-stone-600'),
      ssrCardClassName: tw('rounded-2xl bg-amber-50 p-5'),
      ssrCardKickerClassName: tw(
        'text-sm font-black uppercase tracking-[0.16em] text-amber-800',
      ),
      hiddenClassName: tw('sr-only'),
    },
  );
}

function createShellRemoteComponentsSource(
  shell: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
  worker = false,
): string {
  const tw = createTw(tailwindPrefixForApp(shell));
  const widgetRemotes = remotes.filter(remote =>
    Object.hasOwn(remote.exposes ?? {}, './Widget'),
  );
  const remoteComponentExports = widgetRemotes
    .map(remote => {
      const componentName = `${toPascalCase(remote.id)}Widget`;
      return worker
        ? `const ${componentName} = createRemoteComponent(
  '${remote.id}',
  './Widget',
);`
        : `const ${componentName} = createRemoteComponent(
  '${remote.id}',
  './Widget',
  () => import('${remoteDependencyAlias(remote)}/Widget'),
);`;
    })
    .join('\n');
  const federationImports =
    widgetRemotes.length > 0
      ? renderFileTemplate(
          worker
            ? 'workspace/apps/shell-super-app/src/routes/vertical-components.worker.imports.tsx'
            : 'workspace/apps/shell-super-app/src/routes/vertical-components.imports.tsx',
          {},
        )
      : '';
  const federationHelpers =
    widgetRemotes.length > 0
      ? renderFileTemplate(
          worker
            ? 'workspace/apps/shell-super-app/src/routes/vertical-components.worker.helpers.tsx'
            : 'workspace/apps/shell-super-app/src/routes/vertical-components.helpers.tsx',
          {
            unavailableClassName: tw(
              'rounded-xl border border-red-900/20 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900',
            ),
          },
        )
      : '';
  const showcaseItems = widgetRemotes
    .map(remote => {
      const componentName = `${toPascalCase(remote.id)}Widget`;
      return `          <${componentName} key="${remote.id}" />`;
    })
    .join('\n');
  const showcaseGridClassName = tw('grid gap-4 md:grid-cols-2');
  const showcaseGrid =
    widgetRemotes.length === 0
      ? `<div className="${showcaseGridClassName}" />`
      : `<div className="${showcaseGridClassName}">
${showcaseItems}
      </div>`;
  const remoteCount = String(widgetRemotes.length);

  return renderFileTemplate(
    'workspace/apps/shell-super-app/src/routes/vertical-components.tsx',
    {
      federationImports,
      widgetCount: remoteCount,
      federationHelpers,
      remoteComponentExports,
      headerClassName: tw(
        'flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 md:flex-1',
      ),
      boundaryId: shell.mfName,
      titleClassName: tw(
        'whitespace-nowrap text-xl font-black tracking-normal text-stone-950 no-underline',
      ),
      statusBadgeClassName: tw(
        'inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-stone-900/15 bg-white px-4 text-sm font-extrabold text-stone-950 shadow-lg shadow-stone-900/5',
      ),
      emptyShowcaseClassName: tw(
        'mx-auto mt-12 max-w-7xl rounded-2xl bg-white/90 p-6 shadow-xl shadow-stone-900/10',
      ),
      emptyMessageClassName: tw('text-lg font-bold text-stone-700'),
      showcaseClassName: tw('mx-auto mt-12 max-w-7xl'),
      showcaseGrid,
    },
  );
}

export function createShellRemoteComponents(
  shell: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): string {
  return createShellRemoteComponentsSource(shell, remotes);
}

export function createShellWorkerRemoteComponents(
  shell: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): string {
  return createShellRemoteComponentsSource(shell, remotes, true);
}

type FederatedRegistryEntry = {
  expose: string;
  exportName: string;
  packageSpecifier: string;
  remoteAlias: string;
  remoteId: string;
};

function federatedRegistryEntries(
  scope: string,
  host: WorkspaceApp,
  remotes: WorkspaceApp[],
): FederatedRegistryEntry[] {
  const referencedRemotes = resolveRemoteRefs(host, remotes);
  const entries = referencedRemotes.flatMap(remote =>
    distributedSsrExposes(remote).map(expose => ({ remote, expose })),
  );
  const exposeNameCounts = new Map<string, number>();
  for (const { expose } of entries) {
    const exposeName = toPascalCase(expose.replace(/^\.\//u, ''));
    exposeNameCounts.set(
      exposeName,
      (exposeNameCounts.get(exposeName) ?? 0) + 1,
    );
  }

  return entries
    .map(({ remote, expose }) => {
      const exposeName = toPascalCase(expose.replace(/^\.\//u, ''));
      const exportName =
        exposeNameCounts.get(exposeName) === 1
          ? exposeName
          : `${toPascalCase(remote.id)}${exposeName}`;
      const exposeSubpath = expose.replace(/^\.\//u, '');
      return {
        expose,
        exportName,
        packageSpecifier: `${packageName(scope, remote.packageSuffix)}/${exposeSubpath}`,
        remoteAlias: `${remoteDependencyAlias(remote)}/${exposeSubpath}`,
        remoteId: remote.id,
      };
    })
    .toSorted((left, right) => left.exportName.localeCompare(right.exportName));
}

/**
 * Generates the environment-specific primitive registry used by custom hosts.
 * The browser/Node file contains native MF loaders. Cloudflare's `.worker.tsx`
 * resolution selects the sibling registry, which contains only distributed
 * service-binding boundaries and therefore cannot bundle remote UI source.
 */
export function createFederatedComponentsRegistry(
  scope: string,
  host: WorkspaceApp,
  remotes: WorkspaceApp[],
  worker = false,
): string {
  const entries = federatedRegistryEntries(scope, host, remotes);
  const typeImports = entries
    .map(
      entry =>
        `import type ${entry.exportName}Component from '${entry.packageSpecifier}';`,
    )
    .join('\n');
  const propTypes = entries
    .map(
      entry =>
        `type ${entry.exportName}Props = RemoteComponentProps<typeof ${entry.exportName}Component>;`,
    )
    .join('\n');
  const componentEntries = entries
    .map(entry =>
      worker
        ? `  ${entry.exportName}: (props: ${entry.exportName}Props) => (
    <DistributedSsrBoundary
      expose="${entry.expose}"
      fallback={fallback}
      fragmentProps={props}
      remote="${entry.remoteId}"
    >
      {null}
    </DistributedSsrBoundary>
  ),`
        : `  ${entry.exportName}: createDistributedSsrComponent<${entry.exportName}Props>({
    createComponent: () =>
      createLazyComponent<
        RemoteComponentModule<${entry.exportName}Props>,
        'default'
      >({
        export: 'default',
        fallback,
        instance: getInstance(),
        loader: () =>
          import('${entry.remoteAlias}') as Promise<
            RemoteComponentModule<${entry.exportName}Props>
          >,
        loading: null,
      }),
    expose: '${entry.expose}',
    fallback,
    remote: '${entry.remoteId}',
  }),`,
    )
    .join('\n');
  const runtimeImports = worker
    ? "import { DistributedSsrBoundary } from '@modern-js/federation-runtime';\nimport type { ComponentType, ReactNode } from 'react';"
    : "import { createLazyComponent } from '@module-federation/modern-js-v3/react';\nimport { getInstance } from '@module-federation/modern-js-v3/runtime';\nimport { createDistributedSsrComponent } from '@modern-js/federation-runtime';\nimport type { ComponentType, FunctionComponent, ReactNode } from 'react';";
  const moduleType = `
${
  worker
    ? ''
    : `interface RemoteComponentModule<Props extends object> {
  default: FunctionComponent<Props>;
}
`
}type RemoteComponentProps<Component> =
  Component extends ComponentType<infer Props>
    ? Props extends object
      ? Props
      : Record<string, never>
    : Record<string, never>;
`;

  return `${runtimeImports}
${typeImports}

${propTypes}
${moduleType}
export const createFederatedComponents = (fallback: ReactNode) => ({
${componentEntries}
});
`;
}

export function createRemotePage(app: WorkspaceApp): string {
  const tw = createTw(tailwindPrefixForApp(app));
  const listApiItems = `list${toPascalCase(resolveApiStem(app))}`;
  const rpcApi = resolveApiProtocol(app) === 'rpc';
  const apiImport = appHasApi(app)
    ? rpcApi
      ? `import { useModernI18n } from '@modern-js/plugin-i18n/runtime/consumer';
import { Link } from '@modern-js/plugin-tanstack/runtime';
import { useEffect, useState } from 'react';
import {
  Effect,
  ${listApiItems}Rpc,
} from '../../api/${resolveApiStem(app)}-rpc-client';
import { UltramodernRouteHead } from '../ultramodern-route-head';
import { ultramodernUiMarker } from '../../ultramodern-build';
`
      : `import { useModernI18n } from '@modern-js/plugin-i18n/runtime/consumer';
import { Link } from '@modern-js/plugin-tanstack/runtime';
import { useEffect, useState } from 'react';
import {
  Effect,
  ${listApiItems},
  runEffectRequest,
} from '../../api/${resolveApiStem(app)}-client';
import { UltramodernRouteHead } from '../ultramodern-route-head';
import { ultramodernUiMarker } from '../../ultramodern-build';
`
    : "import { useModernI18n } from '@modern-js/plugin-i18n/runtime/consumer';\nimport { Link } from '@modern-js/plugin-tanstack/runtime';\nimport { UltramodernRouteHead } from '../ultramodern-route-head';\nimport { ultramodernUiMarker } from '../../ultramodern-build';\n";
  const apiState = appHasApi(app)
    ? `  const [apiStatus, setApiStatus] = useState('pending');

  useEffect(() => {
    let cancelled = false;
    void ${rpcApi ? 'Effect.runPromise' : 'runEffectRequest'}(
      ${rpcApi ? `${listApiItems}Rpc(1)` : `${listApiItems}({ limit: 1 })`}.pipe(
        Effect.match({
          onFailure: () => {
            if (cancelled) {
              return;
            }
            setApiStatus('unavailable');
          },
          onSuccess: data => {
            if (cancelled) {
              return;
            }
            setApiStatus(data.items.at(0)?.title ?? 'empty');
          },
        }),
      ),
    );

    return () => {
      cancelled = true;
    };
  }, []);

`
    : '';
  const apiMarkup = appHasApi(app)
    ? `      <p data-testid="api-status">{apiStatus}</p>
`
    : '';

  return `${apiImport}
export default function ${toPascalCase(app.id)}Home() {
  const { language, supportedLanguages, t } = useModernI18n();
${apiState}  return (
    <main className="${tw('min-h-screen bg-um-canvas px-4 py-6 text-um-foreground sm:px-8')}">
      <UltramodernRouteHead />
      <nav aria-label={t('${app.domain}.language.switcher')} className="${tw('flex gap-3')}">
        {supportedLanguages.map(code => (
          <Link
            aria-current={language === code ? 'page' : undefined}
            className="${tw('rounded-full border border-stone-900/15 bg-white px-4 py-2 text-sm font-bold text-stone-950 no-underline')}"
            key={code}
            params={{ lang: code }}
            to="/$lang"
          >
            {t(\`${app.domain}.language.\${code}\`)}
          </Link>
        ))}
      </nav>
      <h1 className="${tw('mt-10 text-5xl font-black')}">{t('${app.domain}.title')}</h1>
      <p className="${tw('mt-3 text-lg text-stone-600')}" data-modern-mf-role="${app.kind}">{t('${app.domain}.role')}</p>
      <p className="${tw('sr-only')}" data-build-marker={ultramodernUiMarker.build} data-testid="ultramodern-ui-marker">
        {ultramodernUiMarker.appId}:{ultramodernUiMarker.version}
      </p>
${apiMarkup}    </main>
  );
}
`;
}

export function createLayout(appId: string): string {
  return `import { Outlet } from '@modern-js/plugin-tanstack/runtime';
import './index.css';

export default function Layout() {
  return (
    <div data-app-id="${appId}">
      <Outlet />
    </div>
  );
}
`;
}

export function createRemoteEntry(app: WorkspaceApp): string {
  return createRemoteSurface(app, {
    expose: './Route',
    localeRoot: '../locales',
    bodyTranslationKey: 'routeSurface',
  });
}

function createRemoteSurface(
  app: WorkspaceApp,
  {
    expose,
    localeRoot,
    bodyTranslationKey,
  }: {
    expose: string;
    localeRoot: string;
    bodyTranslationKey: string;
  },
): string {
  const tw = createTw(tailwindPrefixForApp(app));
  const domain = app.domain ?? app.id;
  const namespace = appI18nNamespace(app);
  const componentName = `${toPascalCase(domain)}${toPascalCase(expose.replace(/^\.\//u, ''))}`;

  return `import type { JSX } from 'react';
import { FederatedI18nBoundary, useModernI18n } from '@modern-js/plugin-i18n/runtime/consumer';
import csResource from '${localeRoot}/cs/${namespace}.json';
import enResource from '${localeRoot}/en/${namespace}.json';

const federatedI18nLanguages = ['en', 'cs'];
const federatedI18nResources = {
  cs: { ${JSON.stringify(namespace)}: csResource },
  en: { ${JSON.stringify(namespace)}: enResource },
};

const ${componentName}Content = () => {
  const { t } = useModernI18n();

  return (
    <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">
      <h2 className="${tw('text-2xl font-black')}">{t('${domain}.title')}</h2>
      <p className="${tw('mt-2 text-stone-600')}">{t('${domain}.${bodyTranslationKey}')}</p>
    </section>
  );
};

export default function ${componentName}(props: Record<string, never>): JSX.Element {
  void props;

  return (
    <FederatedI18nBoundary
      defaultNamespace="${namespace}"
      fallbackLanguage="en"
      resources={federatedI18nResources}
      supportedLanguages={federatedI18nLanguages}
    >
      <${componentName}Content />
    </FederatedI18nBoundary>
  );
}
`;
}

export function createRemoteExposeFragmentPage(
  app: WorkspaceApp,
  expose: string,
): string {
  const componentPath = app.exposes?.[expose];
  if (!componentPath?.startsWith('./src/')) {
    throw new Error(
      `Cannot generate an SSR fragment route for ${app.id} ${expose}: invalid expose path`,
    );
  }

  const importPath = `../../../../../${componentPath
    .replace(/^\.\/src\//u, '')
    .replace(/\.[cm]?[jt]sx?$/u, '')}`;
  const componentName = toPascalCase(expose.replace(/^\.\//u, ''));
  const pageName = `${componentName}FragmentPage`;

  return `import type { ComponentProps } from 'react';
import { useDistributedSsrFragmentProps } from '@modern-js/federation-runtime/distributed-ssr';
import ${componentName} from '${importPath}';

export default function ${pageName}() {
  const props = useDistributedSsrFragmentProps<ComponentProps<typeof ${componentName}>>({
    boundaryId: '${app.mfName}',
    expose: '${expose}',
  });

  return (
    <>
      <template data-modern-boundary-id="${app.mfName}" data-modern-distributed-ssr-marker="start" data-modern-mf-expose="${expose}" />
      <${componentName} {...props} />
      <template data-modern-boundary-id="${app.mfName}" data-modern-distributed-ssr-marker="end" data-modern-mf-expose="${expose}" />
    </>
  );
}
`;
}

export function createRemoteExposeComponent(
  app: WorkspaceApp,
  expose: string,
): string {
  return createRemoteSurface(app, {
    expose,
    localeRoot: '../../locales',
    bodyTranslationKey:
      expose === './Widget' ? 'widgetBody' : 'federatedSurface',
  });
}

export function remoteComponentOutputPath(app: WorkspaceApp, expose: string) {
  const exposePath = app.exposes?.[expose];

  if (!exposePath?.startsWith('./src/components/')) {
    return undefined;
  }

  return `${app.directory}/${exposePath.replace(/^\.\//u, '')}`;
}
