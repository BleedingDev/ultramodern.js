import {
  appHasEffectApi,
  effectApiStem,
  remoteDependencyAlias,
  shellApp,
} from './descriptors';
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

  return `import { Link, useModernI18n } from '@modern-js/plugin-i18n/runtime';
import ShellFrame from '../shell-frame';
import { UltramodernRouteHead } from '../ultramodern-route-head';
import { VerticalShowcase } from '../vertical-components';
import { ultramodernUiMarker } from '../../ultramodern-build';

export default function ShellHome() {
  const { t } = useModernI18n();

  return (
    <ShellFrame>
      <UltramodernRouteHead />
      <section className="${tw('mx-auto grid max-w-7xl items-center gap-8 py-8 md:grid-cols-[0.9fr_1.1fr] lg:gap-14')}">
        <div className="${tw('min-w-0')}">
          <p className="${tw('text-xs font-black uppercase tracking-[0.18em] text-emerald-800')}">{t('shell.hero.eyebrow')}</p>
          <h1 className="${tw('mt-3 max-w-3xl text-5xl font-black leading-none tracking-normal text-stone-950 md:text-7xl')}">{t('shell.title')}</h1>
          <p className="${tw('mt-5 max-w-2xl text-lg leading-8 text-stone-600')}">{t('shell.hero.lede')}</p>
          <div className="${tw('mt-7 flex flex-wrap gap-3')}">
            <Link className="${tw('inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-800 px-5 font-bold text-white shadow-lg shadow-stone-900/10')}" to="/">
              {t('shell.hero.primary')}
            </Link>
            <span className="${tw('inline-flex min-h-11 items-center justify-center rounded-full border border-stone-900/15 bg-white/90 px-5 font-bold text-stone-950 shadow-lg shadow-stone-900/10')}">
              {t('shell.hero.secondary')}
            </span>
          </div>
        </div>
        <div className="${tw('rounded-3xl bg-white/90 p-6 shadow-2xl shadow-stone-900/15')}">
          <div className="${tw('grid gap-4 sm:grid-cols-2')}">
            <article className="${tw('rounded-2xl bg-emerald-50 p-5')}">
              <span className="${tw('text-sm font-black uppercase tracking-[0.16em] text-emerald-800')}">{t('shell.hero.cardOneKicker')}</span>
              <strong className="${tw('mt-3 block text-3xl font-black text-stone-950')}">${remoteCount}</strong>
              <p className="${tw('mt-2 text-sm font-semibold text-stone-600')}">{t('shell.hero.cardOne')}</p>
            </article>
            <article className="${tw('rounded-2xl bg-amber-50 p-5')}">
              <span className="${tw('text-sm font-black uppercase tracking-[0.16em] text-amber-800')}">{t('shell.hero.cardTwoKicker')}</span>
              <strong className="${tw('mt-3 block text-3xl font-black text-stone-950')}">SSR</strong>
              <p className="${tw('mt-2 text-sm font-semibold text-stone-600')}">{t('shell.hero.cardTwo')}</p>
            </article>
          </div>
        </div>
      </section>
      <VerticalShowcase />
      <p className="${tw('sr-only')}" data-testid="ultramodern-preset">presetUltramodern workspace</p>
      <p className="${tw('sr-only')}" data-build-marker={ultramodernUiMarker.build} data-testid="ultramodern-ui-marker">
        {ultramodernUiMarker.appId}:{ultramodernUiMarker.version}
      </p>
    </ShellFrame>
  );
}
`;
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
      ? `import {
  classifyModuleFederationFallback,
  createModuleFederationFallbackTelemetry,
  emitModuleFederationFallbackTelemetry,
  toModuleFederationFallbackAttributes,
} from '@modern-js/runtime/module-federation';
import { createLazyComponent } from '@module-federation/bridge-react';
import { getInstance, loadRemote } from '@module-federation/modern-js-v3/runtime';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
${serverImports}
`
      : '';
  const federationHelpers =
    widgetRemotes.length > 0
      ? `interface RemoteComponentModule {
  default: ComponentType;
}

const loadRemoteComponent = (specifier: string) =>
  loadRemote<RemoteComponentModule>(specifier) as Promise<RemoteComponentModule>;

const createRemoteFallback = (specifier: string) =>
  ({ error }: { error: Error }) => {
    const { t } = useModernI18n();
    const classification = classifyModuleFederationFallback(error);
    const telemetry = createModuleFederationFallbackTelemetry({
      appName: '${shellApp.id}',
      classification,
      entry: typeof window === 'undefined' ? undefined : window.location.href,
      error,
      eventName: 'mf.client.remote.fallback',
      exportName: 'default',
      phase: 'load',
      remote: specifier,
      status: 'degraded',
    });

    useEffect(() => {
      void emitModuleFederationFallbackTelemetry({
        appName: telemetry.appName,
        classification,
        entry: telemetry.entry,
        error,
        eventName: telemetry.eventName,
        exportName: 'default',
        metadata: telemetry.metadata,
        phase: telemetry.phase,
        remote: specifier,
        status: 'degraded',
      });
    }, [classification, error, specifier, telemetry]);

    return <div className="${tw('rounded-xl border border-red-900/20 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900')}" data-remote-error={error.name} {...toModuleFederationFallbackAttributes(telemetry)}>{t('shell.remoteUnavailable')}</div>;
  };

const createHydratedRemote =
  (ServerComponent: ComponentType, specifier: string) =>
  function HydratedRemote() {
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
      setHydrated(true);
    }, []);

    const FederatedComponent = useMemo(() => {
      if (!hydrated) {
        return null;
      }
      const instance = getInstance();
      if (instance === null || instance === undefined) {
        return null;
      }
      return createLazyComponent({
        export: 'default',
        fallback: createRemoteFallback(specifier),
        instance,
        loader: () => loadRemoteComponent(specifier),
        loading: <ServerComponent />,
      });
    }, [hydrated]);

    if (FederatedComponent === null) {
      return <ServerComponent />;
    }

    return (
      <Suspense fallback={<ServerComponent />}>
        <FederatedComponent />
      </Suspense>
    );
  };
`
      : '';
  const showcaseItems = widgetRemotes
    .map(remote => {
      const componentName = `${toPascalCase(remote.id)}Widget`;
      return `          <${componentName} key="${remote.id}" />`;
    })
    .join('\n');
  const remoteCount = String(widgetRemotes.length);

  return `${federationImports}import { Link, useModernI18n } from '@modern-js/plugin-i18n/runtime';

	const widgetCount = Number('${remoteCount}');

	${federationHelpers}
	${hydratedExports}

	export const Header = () => {
  const { t } = useModernI18n();

  return (
    <header className="${tw('flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 md:flex-1')}" data-modern-boundary-id="${shellApp.mfName}" data-modern-mf-expose="shell/Header">
      <Link className="${tw('whitespace-nowrap text-xl font-black tracking-normal text-stone-950 no-underline')}" to="/">{t('shell.title')}</Link>
    </header>
  );
};

export const StatusBadge = () => {
  const { t } = useModernI18n();

  return (
    <span className="${tw('inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-stone-900/15 bg-white px-4 text-sm font-extrabold text-stone-950 shadow-lg shadow-stone-900/5')}">
      {widgetCount} {t('shell.hero.cardOneKicker')}
    </span>
  );
};

export const VerticalShowcase = () => {
  const { t } = useModernI18n();

  if (widgetCount === 0) {
    return (
      <section className="${tw('mx-auto mt-12 max-w-7xl rounded-2xl bg-white/90 p-6 shadow-xl shadow-stone-900/10')}">
        <p className="${tw('text-lg font-bold text-stone-700')}">{t('shell.hero.empty')}</p>
      </section>
    );
  }

  return (
    <section className="${tw('mx-auto mt-12 max-w-7xl')}" data-modern-boundary-id="${shellApp.mfName}">
      <div className="${tw('grid gap-4 md:grid-cols-2')}">
${showcaseItems}
      </div>
    </section>
  );
};
`;
}

export function createRemotePage(app: WorkspaceApp): string {
  const tw = createTw(tailwindPrefixForApp(app));
  const listEffectItems = `list${toPascalCase(effectApiStem(app))}`;
  const effectBffImport = appHasEffectApi(app)
    ? `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { Link } from '@modern-js/plugin-tanstack/runtime';
import { useEffect, useState } from 'react';
import {
  Effect,
  ${listEffectItems},
  runEffectRequest,
} from '../../effect/${effectApiStem(app)}-client';
import { UltramodernRouteHead } from '../ultramodern-route-head';
import { ultramodernUiMarker } from '../../ultramodern-build';
`
    : "import { useModernI18n } from '@modern-js/plugin-i18n/runtime';\nimport { Link } from '@modern-js/plugin-tanstack/runtime';\nimport { UltramodernRouteHead } from '../ultramodern-route-head';\nimport { ultramodernUiMarker } from '../../ultramodern-build';\n";
  const effectBffState = appHasEffectApi(app)
    ? `  const [effectApiStatus, setEffectApiStatus] = useState('pending');

  useEffect(() => {
    let cancelled = false;
    void runEffectRequest(
      ${listEffectItems}({ limit: 1 }).pipe(
        Effect.match({
          onFailure: () => {
            if (cancelled) {
              return;
            }
            setEffectApiStatus('unavailable');
          },
          onSuccess: data => {
            if (cancelled) {
              return;
            }
            setEffectApiStatus(data.items.at(0)?.title ?? 'empty');
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
  const effectBffMarkup = appHasEffectApi(app)
    ? `      <p data-testid="effect-bff-status">{effectApiStatus}</p>
`
    : '';

  return `${effectBffImport}
export default function ${toPascalCase(app.id)}Home() {
  const { language, supportedLanguages, t } = useModernI18n();
${effectBffState}  return (
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
${effectBffMarkup}    </main>
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

export function createRemoteWidget(app: WorkspaceApp): string {
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
