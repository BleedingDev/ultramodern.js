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

function createFederatedI18nSetup(
  app: WorkspaceApp,
  localeRoot: string,
): string {
  const namespace = appI18nNamespace(app);

  return `import { FederatedI18nBoundary, useModernI18n } from '@modern-js/plugin-i18n/runtime';
import csResource from '${localeRoot}/cs/${namespace}.json';
import enResource from '${localeRoot}/en/${namespace}.json';

const federatedI18nLanguages = ['en', 'cs'];
const federatedI18nResources = {
  cs: { ${JSON.stringify(namespace)}: csResource },
  en: { ${JSON.stringify(namespace)}: enResource },
};`;
}

function createFederatedI18nBoundary(
  namespace: string,
  content: string,
): string {
  return `<FederatedI18nBoundary
      defaultNamespace="${namespace}"
      fallbackLanguage="en"
      resources={federatedI18nResources}
      supportedLanguages={federatedI18nLanguages}
    >
      ${content}
    </FederatedI18nBoundary>`;
}

export function createShellPage(
  shell: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): string {
  const tw = createTw(tailwindPrefixForApp(shell));
  const remoteCount = String(remotes.length);

  return renderFileTemplate(
    'workspace/apps/shell-super-app/src/routes/[lang]/page.tsx',
    {
      value0: tw(
        'mx-auto grid max-w-7xl items-center gap-8 py-8 md:grid-cols-[0.9fr_1.1fr] lg:gap-14',
      ),
      value1: tw('min-w-0'),
      value2: tw(
        'text-xs font-black uppercase tracking-[0.18em] text-emerald-800',
      ),
      value3: tw(
        'mt-3 max-w-3xl text-5xl font-black leading-none tracking-normal text-stone-950 md:text-7xl',
      ),
      value4: tw('mt-5 max-w-2xl text-lg leading-8 text-stone-600'),
      value5: tw('mt-7 flex flex-wrap gap-3'),
      value6: tw(
        'inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-800 px-5 font-bold text-white shadow-lg shadow-stone-900/10',
      ),
      value7: tw(
        'inline-flex min-h-11 items-center justify-center rounded-full border border-stone-900/15 bg-white/90 px-5 font-bold text-stone-950 shadow-lg shadow-stone-900/10',
      ),
      value8: tw('rounded-3xl bg-white/90 p-6 shadow-2xl shadow-stone-900/15'),
      value9: tw('grid gap-4 sm:grid-cols-2'),
      value10: tw('rounded-2xl bg-emerald-50 p-5'),
      value11: tw(
        'text-sm font-black uppercase tracking-[0.16em] text-emerald-800',
      ),
      value12: tw('mt-3 block text-3xl font-black text-stone-950'),
      value13: remoteCount,
      value14: tw('mt-2 text-sm font-semibold text-stone-600'),
      value15: tw('rounded-2xl bg-amber-50 p-5'),
      value16: tw(
        'text-sm font-black uppercase tracking-[0.16em] text-amber-800',
      ),
      value17: tw('mt-3 block text-3xl font-black text-stone-950'),
      value18: tw('mt-2 text-sm font-semibold text-stone-600'),
      value19: tw('sr-only'),
      value20: tw('sr-only'),
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
            value0: shell.id,
            value1: tw(
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
      value0: federationImports,
      value1: remoteCount,
      value2: federationHelpers,
      value3: remoteComponentExports,
      value4: tw(
        'flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 md:flex-1',
      ),
      value5: shell.mfName,
      value6: tw(
        'whitespace-nowrap text-xl font-black tracking-normal text-stone-950 no-underline',
      ),
      value7: tw(
        'inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-stone-900/15 bg-white px-4 text-sm font-extrabold text-stone-950 shadow-lg shadow-stone-900/5',
      ),
      value8: tw(
        'mx-auto mt-12 max-w-7xl rounded-2xl bg-white/90 p-6 shadow-xl shadow-stone-900/10',
      ),
      value9: tw('text-lg font-bold text-stone-700'),
      value10: tw('mx-auto mt-12 max-w-7xl'),
      value11: shell.mfName,
      value12: showcaseGrid,
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
    ? "import { DistributedSsrBoundary } from '@modern-js/runtime/module-federation';\nimport type { ComponentType, ReactNode } from 'react';"
    : "import { createLazyComponent } from '@module-federation/modern-js-v3/react';\nimport { getInstance } from '@module-federation/modern-js-v3/runtime';\nimport { createDistributedSsrComponent } from '@modern-js/runtime/module-federation';\nimport type { ComponentType, FunctionComponent, ReactNode } from 'react';";
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
      ? `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { Link } from '@modern-js/plugin-tanstack/runtime';
import { useEffect, useState } from 'react';
import {
  Effect,
  ${listApiItems}Rpc,
} from '../../api/${resolveApiStem(app)}-rpc-client';
import { UltramodernRouteHead } from '../ultramodern-route-head';
import { ultramodernUiMarker } from '../../ultramodern-build';
`
      : `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
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
    : "import { useModernI18n } from '@modern-js/plugin-i18n/runtime';\nimport { Link } from '@modern-js/plugin-tanstack/runtime';\nimport { UltramodernRouteHead } from '../ultramodern-route-head';\nimport { ultramodernUiMarker } from '../../ultramodern-build';\n";
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
  const tw = createTw(tailwindPrefixForApp(app));
  const domain = app.domain ?? app.id;
  const namespace = appI18nNamespace(app);
  const componentName = `${toPascalCase(domain)}Route`;

  return `${createFederatedI18nSetup(app, '../locales')}

const ${componentName}Content = () => {
  const { t } = useModernI18n();

  return (
    <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="./Route">
      <h2 className="${tw('text-2xl font-black')}">{t('${domain}.title')}</h2>
      <p className="${tw('mt-2 text-stone-600')}">{t('${domain}.routeSurface')}</p>
    </section>
  );
};

export default function ${componentName}() {
  return (
    ${createFederatedI18nBoundary(namespace, `<${componentName}Content />`)}
  );
}
`;
}

function createRemoteWidget(app: WorkspaceApp): string {
  const tw = createTw(tailwindPrefixForApp(app));
  const domain = app.domain ?? app.id;
  const componentName = `${toPascalCase(domain)}Widget`;
  const namespace = appI18nNamespace(app);

  return `${createFederatedI18nSetup(app, '../../locales')}

const ${componentName}Content = () => {
  const { t } = useModernI18n();

  return (
    <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="./Widget">
      <h2 className="${tw('text-2xl font-black')}">{t('${domain}.title')}</h2>
      <p className="${tw('mt-2 text-stone-600')}">{t('${domain}.widgetBody')}</p>
    </section>
  );
};

export default function ${componentName}() {
  return (
    ${createFederatedI18nBoundary(namespace, `<${componentName}Content />`)}
  );
}
`;
}

export function createRemoteWidgetFragmentPage(app: WorkspaceApp): string {
  return createRemoteExposeFragmentPage(app, './Widget');
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
import { useDistributedSsrFragmentProps } from '@modern-js/runtime/module-federation/distributed-ssr';
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
  const tw = createTw(tailwindPrefixForApp(app));

  if (expose === './Widget') {
    return createRemoteWidget(app);
  }

  const componentName = `${toPascalCase(app.domain ?? app.id)}${toPascalCase(
    expose.replace(/^\.\//u, ''),
  )}`;
  const domain = app.domain ?? app.id;
  const namespace = appI18nNamespace(app);

  return `${createFederatedI18nSetup(app, '../../locales')}

const ${componentName}Content = () => {
  const { t } = useModernI18n();

  return (
    <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">
      <h2 className="${tw('text-2xl font-black')}">{t('${domain}.title')}</h2>
      <p className="${tw('mt-2 text-stone-600')}">{t('${domain}.federatedSurface')}</p>
    </section>
  );
};

export default function ${componentName}() {
  return (
    ${createFederatedI18nBoundary(namespace, `<${componentName}Content />`)}
  );
}
`;
}

export function remoteComponentOutputPath(app: WorkspaceApp, expose: string) {
  const exposePath = app.exposes?.[expose];

  if (!exposePath?.startsWith('./src/components/')) {
    return undefined;
  }

  return `${app.directory}/${exposePath.replace(/^\.\//u, '')}`;
}

export type GeneratedNavigationSurfaceKind = 'demo-component' | 'shell-frame';

const tanstackRuntimeModule = '@modern-js/plugin-tanstack/runtime';

function ensureNamedImport(
  source: string,
  moduleName: string,
  names: string[],
) {
  const importEndMarker = `from '${moduleName}';`;
  const importEnd = source.indexOf(importEndMarker);

  if (importEnd >= 0) {
    const importStart = source.lastIndexOf('import ', importEnd);
    const openBrace = source.indexOf('{', importStart);
    const closeBrace = source.indexOf('}', openBrace);
    if (openBrace >= 0 && closeBrace >= 0 && closeBrace < importEnd) {
      const existingNames = source
        .slice(openBrace + 1, closeBrace)
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);
      const missingNames = names.filter(name => !existingNames.includes(name));
      if (missingNames.length === 0) {
        return source;
      }
      const importedNames = [...existingNames, ...missingNames].toSorted(
        (left, right) => left.localeCompare(right),
      );
      return `${source.slice(0, openBrace + 1)} ${importedNames.join(', ')} ${source.slice(closeBrace)}`;
    }
  }

  const firstImportEnd = source.indexOf('\n');
  const importLine = `import { ${names.join(', ')} } from '${moduleName}';\n`;
  return firstImportEnd < 0
    ? `${importLine}${source}`
    : `${source.slice(0, firstImportEnd + 1)}${importLine}${source.slice(firstImportEnd + 1)}`;
}

function ensureNavigateHook(source: string) {
  if (source.includes('const navigate = useNavigate();')) {
    return source;
  }

  const functionStart = source.indexOf('export default function ');
  const parametersEnd = source.indexOf(')', functionStart);
  const bodyStart = source.indexOf('{', parametersEnd);
  if (functionStart < 0 || parametersEnd < 0 || bodyStart < 0) {
    return source;
  }

  return `${source.slice(0, bodyStart + 1)}\n  const navigate = useNavigate();${source.slice(bodyStart + 1)}`;
}

function closingParenthesis(source: string, openingParenthesis: number) {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = openingParenthesis; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote !== '') {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function removeLegacyLocationSuffixHelper(source: string) {
  return source
    .replace(
      /(^|\n)const locationSuffix = \(location: \{ hash\?: unknown; search\?: unknown; searchStr\?: unknown \}\) => \{[\s\S]*?\n\};\n/u,
      '$1',
    )
    .replace('\n  const suffix = locationSuffix(location);', '');
}

function rewriteRouterLocationSuffix(source: string) {
  let changed = false;
  const next = source.replace(
    /^(\s*)to: `\$\{([^`\n]+)\}\$\{suffix\}`,/gmu,
    (_match, indentation: string, destination: string) => {
      changed = true;
      return `${indentation}hash: true,\n${indentation}search: true,\n${indentation}to: ${destination},`;
    },
  );

  return {
    changed,
    source: changed ? removeLegacyLocationSuffixHelper(next) : next,
  };
}

function rewriteWindowLocationAssignments(source: string) {
  const callMarker = 'window.location.assign';
  let next = source;
  let searchFrom = 0;
  let changed = false;
  let preservesCurrentLocationState = false;

  while (true) {
    const callStart = next.indexOf(callMarker, searchFrom);
    if (callStart < 0) {
      break;
    }
    const openingParenthesis = next.indexOf('(', callStart + callMarker.length);
    if (openingParenthesis < 0) {
      break;
    }
    const callEnd = closingParenthesis(next, openingParenthesis);
    if (callEnd < 0) {
      break;
    }

    let destination = next.slice(openingParenthesis + 1, callEnd).trim();
    if (destination.endsWith(',')) {
      destination = destination.slice(0, -1).trimEnd();
    }
    const preservesSuffix =
      destination.includes('$' + '{suffix}') &&
      next.includes('const suffix = locationSuffix(location);');
    if (preservesSuffix) {
      destination = destination.replace('$' + '{suffix}', '');
      if (destination.startsWith('`${') && destination.endsWith('}`')) {
        destination = destination.slice(3, -2);
      }
      preservesCurrentLocationState = true;
    }
    const lineStart = next.lastIndexOf('\n', callStart) + 1;
    const indentation = next.slice(lineStart, callStart);
    const options = preservesSuffix
      ? `hash: true,\n${indentation}  search: true,\n${indentation}  to: ${destination},`
      : `to: ${destination},`;
    const replacement = `void navigate({\n${indentation}  ${options}\n${indentation}})`;
    next = `${next.slice(0, callStart)}${replacement}${next.slice(callEnd + 1)}`;
    searchFrom = callStart + replacement.length;
    changed = true;
  }

  if (preservesCurrentLocationState) {
    next = removeLegacyLocationSuffixHelper(next);
  }

  return { changed, source: next };
}

function closingJsxTag(source: string, openingTagStart: number) {
  let braces = 0;
  let quote = '';
  let escaped = false;

  for (let index = openingTagStart; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote !== '') {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '{') {
      braces += 1;
    } else if (character === '}') {
      braces -= 1;
    } else if (character === '>' && braces === 0) {
      return index;
    }
  }

  return -1;
}

function isInternalHref(openingTag: string) {
  return (
    openingTag.includes('href="/') ||
    openingTag.includes("href='/") ||
    openingTag.includes('href={`/')
  );
}

function removeSyntheticClickHandler(openingTag: string) {
  const onClickStart = openingTag.indexOf(' onClick=');
  if (onClickStart < 0) {
    return openingTag;
  }
  const valueStart = openingTag.indexOf('{', onClickStart);
  if (valueStart < 0) {
    return openingTag;
  }

  let depth = 0;
  for (let index = valueStart; index < openingTag.length; index += 1) {
    const character = openingTag[index] ?? '';
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        const handler = openingTag.slice(valueStart, index + 1);
        return handler.includes('preventDefault')
          ? `${openingTag.slice(0, onClickStart)}${openingTag.slice(index + 1)}`
          : openingTag;
      }
    }
  }

  return openingTag;
}

function rewriteInternalAnchors(source: string) {
  let next = source;
  let searchFrom = 0;
  let changed = false;

  while (true) {
    const openingTagStart = next.indexOf('<a', searchFrom);
    if (openingTagStart < 0) {
      break;
    }
    const boundary = next[openingTagStart + 2];
    if (boundary !== ' ' && boundary !== '\n' && boundary !== '\t') {
      searchFrom = openingTagStart + 2;
      continue;
    }
    const openingTagEnd = closingJsxTag(next, openingTagStart);
    if (openingTagEnd < 0) {
      break;
    }
    const openingTag = next.slice(openingTagStart, openingTagEnd + 1);
    if (!isInternalHref(openingTag)) {
      searchFrom = openingTagEnd + 1;
      continue;
    }
    const closingTagStart = next.indexOf('</a>', openingTagEnd + 1);
    if (closingTagStart < 0) {
      break;
    }

    const nativeOpeningTag = removeSyntheticClickHandler(openingTag)
      .replace('<a', '<Link')
      .replace('href=', 'to=');
    next = `${next.slice(0, openingTagStart)}${nativeOpeningTag}${next.slice(
      openingTagEnd + 1,
      closingTagStart,
    )}</Link>${next.slice(closingTagStart + '</a>'.length)}`;
    searchFrom = openingTagStart + nativeOpeningTag.length;
    changed = true;
  }

  return { changed, source: next };
}

function rewriteJsxElementName(
  source: string,
  elementName: string,
  componentName: string,
) {
  const openingMarker = `<${elementName}`;
  const closingMarker = `</${elementName}>`;
  let next = source;
  let searchFrom = 0;
  let changed = false;

  while (true) {
    const openingTagStart = next.indexOf(openingMarker, searchFrom);
    if (openingTagStart < 0) {
      break;
    }
    const boundary = next[openingTagStart + openingMarker.length];
    if (boundary !== ' ' && boundary !== '\n' && boundary !== '\t') {
      searchFrom = openingTagStart + openingMarker.length;
      continue;
    }
    const openingTagEnd = closingJsxTag(next, openingTagStart);
    const closingTagStart = next.indexOf(closingMarker, openingTagEnd + 1);
    if (openingTagEnd < 0 || closingTagStart < 0) {
      break;
    }

    next = `${next.slice(0, openingTagStart)}<${componentName}${next.slice(
      openingTagStart + openingMarker.length,
      closingTagStart,
    )}</${componentName}>${next.slice(closingTagStart + closingMarker.length)}`;
    searchFrom = openingTagStart + componentName.length + 1;
    changed = true;
  }

  return { changed, source: next };
}

export function regenerateGeneratedNavigationSurface(
  source: string,
  kind: GeneratedNavigationSurfaceKind,
) {
  const routerLocationSuffix = rewriteRouterLocationSuffix(source);
  const anchors = rewriteInternalAnchors(routerLocationSuffix.source);
  const locationAssignments = rewriteWindowLocationAssignments(anchors.source);
  const forms =
    kind === 'demo-component'
      ? rewriteJsxElementName(locationAssignments.source, 'form', 'Form')
      : { changed: false, source: locationAssignments.source };
  let next = forms.source;

  if (anchors.changed || locationAssignments.changed || forms.changed) {
    const imports = [
      ...(forms.changed ? ['Form'] : []),
      ...(anchors.changed ? ['Link'] : []),
      ...(locationAssignments.changed ? ['useNavigate'] : []),
    ];
    next = ensureNamedImport(next, tanstackRuntimeModule, imports);
  }
  if (locationAssignments.changed) {
    next = ensureNavigateHook(next);
  }

  return next;
}
