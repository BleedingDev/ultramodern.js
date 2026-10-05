import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  confinedPath,
  fileEvidence,
} from '../react-rsc-worker-proof/contract.mjs';

const roles = ['host', 'healthy', 'fragile'];
const shared = `const shared = Object.fromEntries(
  ['react', 'react-dom', 'react-dom/client', '@modern-js/runtime', '@modern-js/runtime/head'].map(name => [
    name,
    {
      singleton: true,
      requiredVersion: require(
        name === 'react-dom/client'
          ? 'react-dom/package.json'
          : name === '@modern-js/runtime/head'
            ? '@modern-js/runtime/package.json'
            : name + '/package.json',
      ).version,
      treeShaking: false,
    },
  ]),
);
`;

function modernConfig(port, origin) {
  return `import { defineConfig } from '@modern-js/ultramodern-app-tools';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';

export default defineConfig({
  renderer: 'react',
  server: {
    port: ${port},
    ssr: { mode: 'stream', moduleFederationAppSSR: true },
  },
  output: { assetPrefix: ${JSON.stringify(`${origin}/`)} },
  plugins: [moduleFederationPlugin()],
});
`;
}

function federationConfig(role, controlOrigin) {
  const name = `lifecycle${role[0].toUpperCase()}${role.slice(1)}`;
  const composition =
    role === 'host'
      ? `remotes: {
    lifecycleHealthy: ${JSON.stringify(`lifecycleHealthy@${controlOrigin}/manifest/healthy.json`)},
    lifecycleFragile: ${JSON.stringify(`lifecycleFragile@${controlOrigin}/manifest/fragile.json`)},
  },`
      : "exposes: { './Proof': './src/Proof.tsx' },";
  const dts =
    role === 'host'
      ? "dts: { consumeTypes: true, generateTypes: false, tsConfigPath: './tsconfig.json' },"
      : `dts: {
    displayErrorInTerminal: true,
    generateTypes: {
      compilerInstance: resolveEffectTsgoCompiler({ from: import.meta.url }),
    },
    tsConfigPath: './tsconfig.json',
  },`;
  return `import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
${role === 'host' ? '' : "import { resolveEffectTsgoCompiler } from '@modern-js/app-tools-extensions/config';\n"}
const require = createRequire(import.meta.url);
${shared}
export default createModuleFederationConfig({
  name: '${name}',
  filename: 'remoteEntry.js',
  bridge: { enableBridgeRouter: false },
  ${dts}
  ${composition}
  shared,
});
`;
}

function terminalPlugin(controlOrigin) {
  return `import { defineRuntimeConfig, type RuntimePlugin } from '@modern-js/runtime';

type Terminal = {
  status: 'complete' | 'fallback' | 'error' | 'cancelled';
};

const observeStream = (): RuntimePlugin => ({
  name: 'native-mf-lifecycle-observer',
  setup(api) {
    api.extendStreamSSR(({ request }: { request: Request }) => ({
      onTerminal(terminal: Terminal) {
        const token = new URL(request.url).searchParams.get('token');
        if (!token) return;
        void fetch(${JSON.stringify(`${controlOrigin}/terminal`)}, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, status: terminal.status }),
        }).catch((error: unknown) => {
          console.error('Native MF lifecycle terminal observation failed', error);
        });
      },
    }));
  },
});

export default defineRuntimeConfig({ plugins: [observeStream()] });
`;
}

const hostLayout = `import { Link, Outlet } from '@modern-js/runtime/router';
import './host.css';

export default function Layout() {
  return (
    <main id="lifecycle-layout" className="lifecycle-host">
      <nav>
        <Link id="to-away" to="/away">Away</Link>
        <Link id="to-mf" to="/mf?token=browser">Federation</Link>
      </nav>
      <Outlet />
    </main>
  );
}
`;

const hostLoader = `import type { LoaderFunctionArgs } from '@modern-js/runtime/router';

export default function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return {
    token: url.searchParams.get('token') ?? 'browser',
    gate: url.searchParams.get('gate') === 'held',
  };
}
`;

const remoteComponents = `import { lazy, type ComponentType } from 'react';
import { loadRemote } from '@module-federation/modern-js-v3/runtime';

export type RemoteProps = { token: string; gate: boolean };
type RemoteModule = { default: ComponentType<RemoteProps> };

export const Healthy = lazy(async () => {
  const module = await loadRemote<RemoteModule>('lifecycleHealthy/Proof');
  if (!module) throw new Error('Native healthy remote is absent');
  return module;
});
export const Fragile = lazy(async () => {
  const module = await loadRemote<RemoteModule>('lifecycleFragile/Proof');
  if (!module) throw new Error('Native fragile remote is absent');
  return module;
});
`;

const federationLayout = `import { Suspense } from 'react';
import { Outlet, useLoaderData } from '@modern-js/runtime/router';
import { Healthy, type RemoteProps } from './remote-components';

export default function FederationLayout() {
  const props = useLoaderData() as RemoteProps;
  return (
    <section id="lifecycle-mf-page" data-token={props.token}>
      <Suspense fallback={<p id="healthy-pending">Healthy remote pending</p>}>
        <Healthy {...props} />
      </Suspense>
      <Outlet />
    </section>
  );
}
`;

const fragilePage = `import { Suspense } from 'react';
import { useLoaderData } from '@modern-js/runtime/router';
import { Fragile, type RemoteProps } from '../remote-components';

export default function FragilePage() {
  const props = useLoaderData() as RemoteProps;
  return (
    <Suspense fallback={<p id="fragile-pending">Fragile remote pending</p>}>
      <Fragile {...props} />
    </Suspense>
  );
}
`;

function remoteProof(role, controlOrigin) {
  return `import { Suspense, useEffect, useRef, useState } from 'react';
import { Helmet } from '@modern-js/runtime/head';
import './shared.css';
import './${role}.css';

type Props = { token: string; gate: boolean };
type Lifecycle = { active: number; setups: number; cleanups: number };
declare global {
  interface Window {
    __mfLifecycle?: Record<string, Lifecycle>;
  }
}
type GateResource = {
  status: 'pending' | 'complete' | 'error';
  promise: Promise<void>;
  error?: unknown;
};
const gates = new Map<string, GateResource>();

function HeldGate({ token, gate }: Props) {
  if (!gate || typeof window !== 'undefined') return null;
  let resource = gates.get(token);
  if (!resource) {
    const pending: GateResource = {
      status: 'pending',
      promise: Promise.resolve(),
    };
    pending.promise = fetch(
      ${JSON.stringify(`${controlOrigin}/gate?token=`)} + encodeURIComponent(token),
    )
      .then(async response => {
        if (!response.ok) throw new Error('Native remote gate failed: ' + response.status);
        const body = await response.text();
        if (body !== token) throw new Error('Native remote gate returned another request token');
        pending.status = 'complete';
      })
      .catch((error: unknown) => {
        pending.status = 'error';
        pending.error = error;
      });
    gates.set(token, pending);
    resource = pending;
  }
  if (resource.status === 'pending') throw resource.promise;
  if (resource.status === 'error') throw resource.error;
  return <span id="${role}-gate-released" data-token={token}>{token + ':deferred'}</span>;
}

export default function Proof({ token, gate }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const lifecycle = window.__mfLifecycle ??= {};
    const state = lifecycle.${role} ??= { active: 0, setups: 0, cleanups: 0 };
    state.active += 1;
    state.setups += 1;
    root.current?.setAttribute('data-hydrated', 'true');
    return () => {
      state.active -= 1;
      state.cleanups += 1;
    };
  }, []);
  return (
    <>
      <Helmet>
        <meta name="lifecycle-${role}" content={token} />
      </Helmet>
      <Suspense fallback={<p id="${role}-gate-pending" data-token={token}>Gate pending</p>}>
        <HeldGate token={token} gate={gate} />
      </Suspense>
      <div
        ref={root}
        id="${role}-proof"
        className="lifecycle-shared lifecycle-${role}"
        data-token={token}
        data-hydrated="false"
      >
        <span>Native ${role} remote body</span>
        <button id="${role}-count" onClick={() => setCount(value => value + 1)}>
          count:{count}
        </button>
      </div>
    </>
  );
}
`;
}

/** Materialize three ordinary native apps from authenticated consumer inputs. */
export function materializeFixture({
  consumer,
  inputs,
  origins,
  ports,
  controlOrigin,
  release,
}) {
  assert(path.isAbsolute(consumer), 'Consumer root must be absolute');
  assert.equal(inputs.manifest.version, release.release.version);
  assert.equal(inputs.manifest.packageManager, `pnpm@${release.tools.pnpm}`);
  assert(inputs.manifest.dependencies['@module-federation/modern-js-v3']);
  assert(/^packages: \[\]\n/mu.test(inputs.workspaceYaml));
  const emit = (root, relative, contents) => {
    const file = confinedPath(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    assert(!fs.existsSync(file), `Fixture file already exists: ${file}`);
    fs.writeFileSync(file, contents);
    return fileEvidence(file, consumer);
  };
  const json = value => `${JSON.stringify(value, null, 2)}\n`;
  emit(
    consumer,
    'package.json',
    json({
      private: true,
      name: '@ultramodern-proof/native-mf-lifecycle-workspace',
      packageManager: inputs.manifest.packageManager,
    }),
  );
  emit(
    consumer,
    'pnpm-workspace.yaml',
    inputs.workspaceYaml.replace(
      /^packages: \[\]\n/mu,
      'packages:\n  - host\n  - healthy\n  - fragile\n',
    ),
  );
  const roots = {};
  const fixture = {};
  for (const role of roles) {
    assert(Number.isInteger(ports[role]) && ports[role] > 0);
    assert.equal(origins[role], `http://127.0.0.1:${ports[role]}`);
    const root = confinedPath(consumer, role);
    roots[role] = root;
    const sources = {
      'package.json': json({
        ...inputs.manifest,
        name: `@ultramodern-proof/native-mf-lifecycle-${role}`,
      }),
      'tsconfig.json': json({
        extends: '@modern-js/tsconfig/base',
        compilerOptions: {
          strict: true,
          jsx: 'preserve',
          moduleResolution: 'Bundler',
        },
        include: ['src', 'modern.config.ts', 'module-federation.config.ts'],
      }),
      'modern.config.ts': modernConfig(ports[role], origins[role]),
      'module-federation.config.ts': federationConfig(role, controlOrigin),
      'src/modern-app-env.d.ts':
        '/// <reference types="@modern-js/ultramodern-app-tools/react-types" />\n',
    };
    if (role === 'host') {
      Object.assign(sources, {
        'src/modern.runtime.ts': terminalPlugin(controlOrigin),
        'src/routes/layout.tsx': hostLayout,
        'src/routes/host.css': '.lifecycle-host { padding: 1rem; }\n',
        'src/routes/mf/layout.tsx': federationLayout,
        'src/routes/mf/layout.data.ts': hostLoader,
        'src/routes/mf/remote-components.tsx': remoteComponents,
        'src/routes/mf/__fragile/layout.tsx':
          "import { Outlet } from '@modern-js/runtime/router';\nexport default function FragileLayout() { return <Outlet />; }\n",
        'src/routes/mf/__fragile/error.tsx':
          'export default function FragileError() { return <p id="fragile-fallback">Fragile remote unavailable</p>; }\n',
        'src/routes/mf/__fragile/page.tsx': fragilePage,
        'src/routes/mf/__fragile/page.data.ts': hostLoader,
        'src/routes/away/page.tsx':
          'export default function Away() { return <p id="away-page">Away</p>; }\n',
        'src/routes/page.tsx':
          'export default function Home() { return <p id="lifecycle-home">Native MF lifecycle proof</p>; }\n',
      });
    } else {
      Object.assign(sources, {
        'src/App.tsx': `export default function App() { return <p>Native ${role} federation remote</p>; }\n`,
        'src/Proof.tsx': remoteProof(role, controlOrigin),
        'src/shared.css':
          '.lifecycle-shared { border: 1px solid currentColor; }\n',
        [`src/${role}.css`]: `.lifecycle-${role} { padding: ${role === 'healthy' ? 7 : 11}px; }\n`,
      });
    }
    fixture[role] = Object.entries(sources).map(([relative, contents]) =>
      emit(root, relative, contents),
    );
  }
  return { roots, fixture };
}
