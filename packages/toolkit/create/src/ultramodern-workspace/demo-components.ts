import {
  appHasApi,
  remoteDependencyAlias,
  resolveApiStem,
  shellApp,
} from './descriptors';
import { renderFileTemplate } from './fs-io';
import {
  createTw,
  packageName,
  tailwindPrefixForApp,
  toPascalCase,
} from './naming';
import type { WorkspaceApp } from './types';

export function createShellPage(remotes: WorkspaceApp[] = []): string {
  const tw = createTw(tailwindPrefixForApp(shellApp));
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

export function createShellRemoteComponents(
  scope: string,
  remotes: WorkspaceApp[] = [],
): string {
  const tw = createTw(tailwindPrefixForApp(shellApp));
  const widgetRemotes = remotes.filter(remote =>
    Object.hasOwn(remote.exposes ?? {}, './Widget'),
  );
  const serverImports = widgetRemotes
    .map(
      remote =>
        `import ${toPascalCase(remote.id)}WidgetServer from '${packageName(
          scope,
          remote.packageSuffix,
        )}/Widget';`,
    )
    .join('\n');
  const hydratedExports = widgetRemotes
    .map(remote => {
      const componentName = `${toPascalCase(remote.id)}Widget`;
      return `const ${componentName} = createHydratedRemote(${componentName}Server, '${remoteDependencyAlias(remote)}/Widget');`;
    })
    .join('\n');
  const federationImports =
    widgetRemotes.length > 0
      ? renderFileTemplate(
          'workspace/apps/shell-super-app/src/routes/vertical-components.imports.tsx',
          {
            value0: serverImports,
          },
        )
      : '';
  const federationHelpers =
    widgetRemotes.length > 0
      ? renderFileTemplate(
          'workspace/apps/shell-super-app/src/routes/vertical-components.helpers.tsx',
          {
            value0: shellApp.id,
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
      value3: hydratedExports,
      value4: tw(
        'flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 md:flex-1',
      ),
      value5: shellApp.mfName,
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
      value11: shellApp.mfName,
      value12: showcaseGrid,
    },
  );
}

export function createRemotePage(app: WorkspaceApp): string {
  const tw = createTw(tailwindPrefixForApp(app));
  const listApiItems = `list${toPascalCase(resolveApiStem(app))}`;
  const apiImport = appHasApi(app)
    ? `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
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
    void runEffectRequest(
      ${listApiItems}({ limit: 1 }).pipe(
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

  return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function ${toPascalCase(domain)}Route() {
  const { t } = useModernI18n();

  return (
    <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="./Route">
      <h2 className="${tw('text-2xl font-black')}">{t('${domain}.title')}</h2>
      <p className="${tw('mt-2 text-stone-600')}">{t('${domain}.routeSurface')}</p>
    </section>
  );
}
`;
}

function createRemoteWidget(app: WorkspaceApp): string {
  const tw = createTw(tailwindPrefixForApp(app));
  const domain = app.domain ?? app.id;
  const componentName = `${toPascalCase(domain)}Widget`;

  return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function ${componentName}() {
  const { t } = useModernI18n();

  return (
    <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="./Widget">
      <h2 className="${tw('text-2xl font-black')}">{t('${domain}.title')}</h2>
      <p className="${tw('mt-2 text-stone-600')}">{t('${domain}.widgetBody')}</p>
    </section>
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

  return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function ${componentName}() {
  const { t } = useModernI18n();

  return (
    <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">
      <h2 className="${tw('text-2xl font-black')}">{t('${domain}.title')}</h2>
      <p className="${tw('mt-2 text-stone-600')}">{t('${domain}.federatedSurface')}</p>
    </section>
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
