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
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

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
      ? `import { createLazyComponent } from '@module-federation/bridge-react';
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

const remoteFallback =
  ({ error }: { error: Error }) => {
    const { i18nInstance } = useModernI18n();
    const t = i18nInstance['t'].bind(i18nInstance);
    return <div className="${tw('rounded-xl border border-red-900/20 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900')}" data-remote-error={error.name}>{t('shell.remoteUnavailable')}</div>;
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
        fallback: remoteFallback,
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
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <header className="${tw('flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 md:flex-1')}" data-modern-boundary-id="${shellApp.mfName}" data-modern-mf-expose="shell/Header">
      <Link className="${tw('whitespace-nowrap text-xl font-black tracking-normal text-stone-950 no-underline')}" to="/">{t('shell.title')}</Link>
    </header>
  );
};

export const StatusBadge = () => {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <span className="${tw('inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-stone-900/15 bg-white px-4 text-sm font-extrabold text-stone-950 shadow-lg shadow-stone-900/5')}">
      {widgetCount} {t('shell.hero.cardOneKicker')}
    </span>
  );
};

export const VerticalShowcase = () => {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

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
  const { i18nInstance, language } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);
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

  if (app.exposes?.['./RecordPage']) {
    return `export { default } from './components/record-page';
`;
  }

  if (app.exposes?.['./ActionQueue']) {
    return `export { default } from './components/action-queue';
`;
  }

  return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function ${toPascalCase(domain)}Route() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

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
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

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

  if (app.id === 'workspace' && expose === './Header') {
    return `import { Link, useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function Header() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <header className="${tw('flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 md:flex-1')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">
      <Link className="${tw('whitespace-nowrap text-xl font-black tracking-normal text-stone-950 no-underline')}" to="/">{t('workspace.header.brand')}</Link>
      <nav aria-label={t('workspace.header.navigation')} className="${tw('flex items-center gap-5')}">
        <Link className="${tw('text-sm font-extrabold text-stone-900 no-underline')}" to="/workspaces">{t('workspace.header.workspaces')}</Link>
        <Link className="${tw('text-sm font-extrabold text-stone-900 no-underline')}" to="/directory">{t('workspace.header.directory')}</Link>
      </nav>
    </header>
  );
}
`;
  }

  if (app.id === 'workspace' && expose === './Highlights') {
    return `import { Link, useModernI18n } from '@modern-js/plugin-i18n/runtime';

const highlights = [
  { badge: 'workspace.highlights.shell', href: '/workspaces', name: 'workspace.highlights.shellTitle' },
  { badge: 'workspace.highlights.records', href: '/records/starter-record', name: 'workspace.highlights.recordsTitle' },
  { badge: 'workspace.highlights.actions', href: '/actions', name: 'workspace.highlights.actionsTitle' },
] as const;

export default function Highlights() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <section className="${tw('mx-auto mt-12 max-w-7xl')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">
      <h2 className="${tw('text-3xl font-black tracking-normal text-stone-950')}">{t('workspace.highlights.title')}</h2>
      <div className="${tw('mt-5 grid gap-4 md:grid-cols-3')}">
        {highlights.map(highlight => (
          <Link className="${tw('block rounded-2xl bg-white/90 p-5 text-stone-950 no-underline shadow-xl shadow-stone-900/10 transition hover:-translate-y-0.5 hover:shadow-2xl')}" key={highlight.href} to={highlight.href}>
            <span className="${tw('text-xs font-black uppercase tracking-[0.16em] text-emerald-800')}">{t(highlight.badge)}</span>
            <strong className="${tw('mt-3 block text-xl font-black leading-tight')}">{t(highlight.name)}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}
`;
  }

  if (app.id === 'workspace' && expose === './DirectoryPanel') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function DirectoryPanel() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <section className="${tw('mx-auto mt-12 max-w-7xl')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">
      <h2 className="${tw('text-3xl font-black tracking-normal text-stone-950')}">{t('workspace.directory.title')}</h2>
      <div className="${tw('mt-5 grid gap-4 md:grid-cols-2')}">
        <article className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}">
          <span className="${tw('text-xs font-black uppercase tracking-[0.16em] text-emerald-800')}">{t('workspace.directory.platformTeam')}</span>
          <strong className="${tw('mt-2 block text-2xl font-black')}">{t('workspace.directory.platformName')}</strong>
          <p className="${tw('mt-2 text-sm font-semibold text-stone-600')}">{t('workspace.directory.platformCopy')}</p>
        </article>
        <article className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}">
          <span className="${tw('text-xs font-black uppercase tracking-[0.16em] text-emerald-800')}">{t('workspace.directory.deliveryTeam')}</span>
          <strong className="${tw('mt-2 block text-2xl font-black')}">{t('workspace.directory.deliveryName')}</strong>
          <p className="${tw('mt-2 text-sm font-semibold text-stone-600')}">{t('workspace.directory.deliveryCopy')}</p>
        </article>
      </div>
    </section>
  );
}
`;
  }

  if (app.id === 'workspace' && expose === './Footer') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function Footer() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return <footer className="${tw('mx-auto mt-12 max-w-7xl text-sm font-bold text-stone-600')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">{t('workspace.footer')}</footer>;
}
`;
  }

  if (expose === './Widget') {
    return createRemoteWidget(app);
  }

  const componentName = `${toPascalCase(app.domain ?? app.id)}${toPascalCase(
    expose.replace(/^\.\//u, ''),
  )}`;

  if (app.id === 'records' && expose === './RecordPage') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { Highlights, StartAction } from './vertical-components';

export default function ${componentName}() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <>
      <section className="${tw('mx-auto mt-10 grid max-w-7xl items-center gap-8 md:grid-cols-[1fr_0.95fr] lg:gap-14')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">
        <div className="${tw('rounded-3xl border-[18px] border-amber-200 bg-white/90 p-8 shadow-2xl shadow-stone-900/15')}">
          <p className="${tw('text-xs font-black uppercase tracking-[0.18em] text-emerald-800')}">{t('records.record.lifecycle')}</p>
          <dl className="${tw('mt-6 grid gap-4')}">
            <div><dt className="${tw('text-sm font-bold text-stone-500')}">{t('records.record.owner')}</dt><dd className="${tw('text-xl font-black')}">{t('records.record.ownerName')}</dd></div>
            <div><dt className="${tw('text-sm font-bold text-stone-500')}">{t('records.record.state')}</dt><dd className="${tw('text-xl font-black')}">{t('records.record.ready')}</dd></div>
          </dl>
        </div>
        <div>
          <p className="${tw('text-xs font-black uppercase tracking-[0.18em] text-emerald-800')}">{t('records.record.eyebrow')}</p>
          <h1 className="${tw('mt-3 text-5xl font-black leading-none tracking-normal text-stone-950 md:text-7xl')}">{t('records.record.title')}</h1>
          <p className="${tw('mt-5 max-w-2xl text-lg leading-8 text-stone-600')}">{t('records.record.lede')}</p>
          <div className="${tw('mt-8 grid gap-4 sm:grid-cols-3')}">
            <article className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}"><span className="${tw('block text-sm font-bold text-stone-500')}">{t('records.record.priority')}</span><strong className="${tw('mt-2 block text-lg font-black')}">{t('records.record.priorityValue')}</strong></article>
            <article className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}"><span className="${tw('block text-sm font-bold text-stone-500')}">{t('records.record.sla')}</span><strong className="${tw('mt-2 block text-lg font-black')}">{t('records.record.slaValue')}</strong></article>
            <article className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}"><span className="${tw('block text-sm font-bold text-stone-500')}">{t('records.record.status')}</span><strong className="${tw('mt-2 block text-lg font-black')}">{t('records.record.ready')}</strong></article>
          </div>
          <StartAction />
        </div>
      </section>
      <Highlights />
    </>
  );
}
`;
  }

  if (app.id === 'actions' && expose === './StartAction') {
    return `import { Link, useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useActionQueue } from '../action-queue-store';

export default function ${componentName}() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);
  const queue = useActionQueue();

  return (
    <div className="${tw('mt-8 flex flex-wrap gap-3')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">
      <button className="${tw('inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-800 px-5 font-bold text-white shadow-lg shadow-stone-900/10')}" onClick={queue.addStarterAction} type="button">
        {t('actions.controls.start')}
      </button>
      <Link className="${tw('inline-flex min-h-11 items-center justify-center rounded-full border border-stone-900/15 bg-white/90 px-5 font-bold text-stone-950 shadow-lg shadow-stone-900/10')}" to="/actions">
        {t('actions.controls.viewQueue')}
      </Link>
    </div>
  );
}
`;
  }

  if (app.id === 'actions' && expose === './StatusBadge') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useActionQueue } from '../action-queue-store';

export default function ${componentName}() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);
  const queue = useActionQueue();

  return (
    <span className="${tw('inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-stone-900/15 bg-white px-4 text-sm font-extrabold text-stone-950 shadow-lg shadow-stone-900/5')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">
      {t('actions.queue.itemCount', { count: queue.lines.length })}
    </span>
  );
}
`;
  }

  if (app.id === 'actions' && expose === './ActionQueue') {
    return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import { useActionQueue } from '../action-queue-store';

export default function ${componentName}() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);
  const queue = useActionQueue();

  return (
    <section className="${tw('mx-auto mt-10 max-w-7xl')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">
      <h1 className="${tw('text-5xl font-black leading-none tracking-normal text-stone-950 md:text-7xl')}">{t('actions.queue.title')}</h1>
      <div className="${tw('mt-8 rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}">
        {queue.lines.length === 0 ? (
          <p>{t('actions.queue.empty')}</p>
        ) : (
          <>
            {queue.lines.map(line => (
              <article className="${tw('grid gap-4 border-t border-stone-900/10 py-4 first:border-t-0 sm:grid-cols-[1fr_auto] sm:items-center')}" key={line.id}>
                <div>
                  <strong className="${tw('text-lg font-black')}">{t(line.nameKey)}</strong>
                  <p className="${tw('text-stone-600')}">{t(\`actions.queue.status.\${line.status}\`)}</p>
                </div>
                <div className="${tw('flex flex-wrap items-center gap-2')}">
                  <button className="${tw('inline-flex min-h-10 items-center justify-center rounded-full border border-stone-900/15 bg-white px-4 font-bold text-stone-950')}" onClick={() => queue.complete(line.id)} type="button">
                    {t('actions.controls.complete')}
                  </button>
                  <button className="${tw('inline-flex min-h-10 items-center justify-center rounded-full border border-stone-900/15 bg-white px-4 font-bold text-stone-950')}" onClick={() => queue.remove(line.id)} type="button">
                    {t('actions.controls.remove')}
                  </button>
                </div>
              </article>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
`;
  }

  if (app.id === 'actions' && expose === './ActionReviewPage') {
    return `export { default } from './action-queue';
`;
  }

  if (app.id === 'actions' && expose === './ActionSuccessPage') {
    return `export { default } from './action-queue';
`;
  }

  const domain = app.domain ?? app.id;

  return `import { useModernI18n } from '@modern-js/plugin-i18n/runtime';

export default function ${componentName}() {
  const { i18nInstance } = useModernI18n();
  const t = i18nInstance['t'].bind(i18nInstance);

  return (
    <section className="${tw('rounded-2xl bg-white/90 p-5 shadow-xl shadow-stone-900/10')}" data-modern-boundary-id="${app.mfName}" data-modern-mf-expose="${expose}">
      <h2 className="${tw('text-2xl font-black')}">{t('${domain}.title')}</h2>
      <p className="${tw('mt-2 text-stone-600')}">{t('${domain}.federatedSurface')}</p>
    </section>
  );
}
`;
}

export function createRecordsRemoteComponents(
  scope: string,
  app: WorkspaceApp,
): string {
  const tw = createTw(tailwindPrefixForApp(app));

  return `import { createLazyComponent } from '@module-federation/bridge-react';
import { getInstance, loadRemote } from '@module-federation/modern-js-v3/runtime';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { useModernI18n } from '@modern-js/plugin-i18n/runtime';
import HighlightsServer from '${packageName(scope, 'workspace')}/Highlights';
import StartActionServer from '${packageName(scope, 'actions')}/StartAction';

interface RemoteComponentModule {
  default: ComponentType;
}

const loadRemoteComponent = (specifier: string) =>
  loadRemote<RemoteComponentModule>(specifier) as Promise<RemoteComponentModule>;

const remoteFallback =
  ({ error }: { error: Error }) => {
    const { i18nInstance } = useModernI18n();
    const t = i18nInstance['t'].bind(i18nInstance);
    return <div className="${tw('rounded-xl border border-red-900/20 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900')}" data-remote-error={error.name}>{t('records.remoteUnavailable')}</div>;
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
        fallback: remoteFallback,
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

export const Highlights = createHydratedRemote(HighlightsServer, 'workspace/Highlights');
export const StartAction = createHydratedRemote(StartActionServer, 'actions/StartAction');
`;
}

export function remoteComponentOutputPath(app: WorkspaceApp, expose: string) {
  const exposePath = app.exposes?.[expose];

  if (!exposePath?.startsWith('./src/components/')) {
    return undefined;
  }

  return `${app.directory}/${exposePath.replace(/^\.\//u, '')}`;
}
