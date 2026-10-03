export type OctaneAppSourceOptions = {
  appId: string;
  title: string;
  entryName?: string;
  appRole?: 'shell' | 'vertical';
  sourceExtension: '.tsx' | '.tsrx';
  jsxImportSource: string;
  capabilities: {
    ssr: boolean;
    federation: boolean;
  };
};

export type OctaneAppSourceArtifact = {
  path: string;
  content: string;
};

export type OctaneAppSources = {
  sourceExtension: '.tsx';
  jsxImportSource: 'octane';
  artifacts: OctaneAppSourceArtifact[];
};

/** The renderer adapter owns entry generation, the document and hydration. */
export function generateOctaneAppSources(
  options: OctaneAppSourceOptions,
): OctaneAppSources {
  if ((options.entryName ?? 'main') !== 'main') {
    throw new Error(
      'The Octane app template supports the main entry only. Additional entries require an admitted native template.',
    );
  }
  if (!options.appId.trim() || !options.title.trim()) {
    throw new Error('The Octane app template requires an appId and title.');
  }
  if (options.sourceExtension !== '.tsx') {
    throw new Error(
      'The Octane app template requires the admitted .tsx source profile. .tsrx generation requires an admitted native template profile.',
    );
  }
  if (options.jsxImportSource !== 'octane') {
    throw new Error(
      'The Octane app template requires jsxImportSource: "octane" from the admitted profile.',
    );
  }
  if (
    typeof options.capabilities.ssr !== 'boolean' ||
    typeof options.capabilities.federation !== 'boolean'
  ) {
    throw new Error('The Octane app template requires admitted capabilities.');
  }
  if (options.capabilities.federation) {
    throw new Error(
      'The Octane app template does not support federation. Select a standalone app until native federation templates are admitted.',
    );
  }

  const title = JSON.stringify(options.title);
  const appId = JSON.stringify(options.appId);
  return {
    sourceExtension: '.tsx',
    jsxImportSource: 'octane',
    artifacts: [
      {
        path: 'src/routes/layout.tsx',
        content: `import { Link, Outlet } from '@modern-js/renderer-octane/router';
import Stable from '../components/Stable';
import './index.css';

const appTitle = ${title};

export default function Layout() {
  return (
    <main data-testid="native-layout">
      <header>
        <p>{appTitle}</p>
        <nav aria-label="Application">
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
        </nav>
      </header>
      <Stable />
      <Outlet />
    </main>
  );
}
`,
      },
      {
        path: 'src/routes/page.tsx',
        content: `import {
  createOctaneRouteAction,
  Link,
  useApplicationIdentity,
  useApplicationRouteId,
  useLoaderData,
  useRouter,
} from '@modern-js/renderer-octane/router';
import { useActionState, useMemo } from 'octane';
import Counter from '../components/Counter';

const appId = ${appId};
const appTitle = ${title};

export default function HomePage() {
  const router = useRouter();
  const identity = useApplicationIdentity();
  const routeId = useApplicationRouteId();
  const data = useLoaderData({ strict: false });
  const submit = useMemo(
    () => createOctaneRouteAction({ router, routeId, identity }),
    [router, routeId, identity],
  );
  const [result, action, pending] = useActionState(submit, undefined);
  return (
    <section data-app-id={appId} data-testid="native-route" data-renderer="octane">
      <h1>{appTitle}</h1>
      <Counter />
      <pre data-testid="native-loader-value">{JSON.stringify(data)}</pre>
      <form action={action}>
        <label>
          Name <input name="name" />
        </label>
        <button type="submit" disabled={pending}>
          Save
        </button>
        <button type="submit" name="intent" value="redirect">
          Save and redirect
        </button>
      </form>
      <pre data-testid="native-action-value">{JSON.stringify(result)}</pre>
      <Link to="/about">Open native about route</Link>
    </section>
  );
}
`,
      },
      {
        path: 'src/routes/about/page.tsx',
        content: `import { Link } from '@modern-js/renderer-octane/router';

export default function AboutPage() {
  return (
    <section data-testid="native-about">
      <h1>Native Octane navigation</h1>
      <Link to="/">Home</Link>
    </section>
  );
}
`,
      },
      {
        path: 'src/components/Counter.tsx',
        content: `import { useSignal$ } from 'octane/signals/client';

export default function Counter() {
  const count$ = useSignal$(0);
  return (
    <section data-testid="native-edited-component">
      <span data-testid="native-hmr-marker">Counter before native edit</span>
      <button type="button" onClick={() => count$.set(value => value + 1)}>
        Increment
      </button>
      <output data-testid="native-count">{count$.get()}</output>
    </section>
  );
}
`,
      },
      {
        path: 'src/components/Stable.tsx',
        content: `import { useSignal$ } from 'octane/signals/client';

export default function Stable() {
  const count$ = useSignal$(0);
  return (
    <section data-testid="native-unaffected-component">
      <button type="button" onClick={() => count$.set(value => value + 1)}>
        Increment stable state
      </button>
      <output data-testid="native-unaffected-count">{count$.get()}</output>
    </section>
  );
}
`,
      },
      {
        path: 'src/routes/page.data.ts',
        content: `import type { DataHandlerInput } from '@modern-js/renderer-core/data';

export function loader({ request }: DataHandlerInput) {
  const url = new URL(request.url);
  if (url.searchParams.get('case') === 'not-found')
    throw new Response('Native route not found', { status: 404 });
  if (url.searchParams.get('case') === 'error')
    throw new Error('Native loader failure');
  if (url.searchParams.get('case') === 'redirect')
    return new Response(null, { status: 302, headers: { location: '/about' } });
  return {
    message: 'Native loader value',
    privateValue: request.headers.get('x-conformance-private'),
  };
}

export async function action({ request }: DataHandlerInput) {
  const form = await request.formData();
  const name = form.get('name');
  if (typeof name !== 'string' || !name.trim())
    return Response.json(
      { fieldErrors: { name: 'Name required' } },
      { status: 422 },
    );
  if (form.get('intent') === 'redirect')
    return new Response(null, {
      status: 303,
      headers: {
        location: '/about',
        'set-cookie': 'conformance-saved=1; Path=/; SameSite=Lax',
      },
    });
  if (form.get('intent') === 'throw') throw new Error('Native action failure');
  return {
    saved: name,
    privateValue: request.headers.get('x-conformance-private'),
  };
}
`,
      },
    ],
  };
}
