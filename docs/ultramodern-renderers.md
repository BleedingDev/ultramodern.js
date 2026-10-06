# Choosing a renderer

An UltraModern.js app builds with exactly one renderer: `react` (default),
`solid`, or `octane`. Select it once in `modern.config.ts`:

```ts
import { defineConfig } from '@bleedingdev/modern-js-ultramodern-app-tools';

export default defineConfig({ renderer: 'solid' });
```

`@bleedingdev/modern-js-ultramodern-app-tools` is the published package
(`packages/solutions/ultramodern-app-tools/package.json`, name
`@modern-js/ultramodern-app-tools`, published under the `bleedingdev` scope).
A workspace created by the generator installs it through a pnpm catalog
alias, so its own `modern.config.ts` imports the unscoped specifier,
`@modern-js/ultramodern-app-tools`; installing the package directly uses the
published name shown above, as the renderer conformance fixtures do
(`tests/ultramodern-renderers/conformance/fixtures/{solid,octane}/modern.config.ts`).

## What the renderer switch does

Selecting a renderer swaps, for the whole app, the compiler, the JSX import
source, the hydration runtime, the router bindings and the server document
renderer (`packages/solutions/ultramodern-app-tools/src/renderers/{react,solid,octane}/profile.ts`).
It does not translate source. A component authored for one renderer is not
rewritten for another: route modules are checked against the selected
renderer before the build proceeds, and plugins that only work with React are
rejected outright. See "Switching an existing app" below.

## Creating an app

Pass `--renderer` to the generator:

```sh
pnpm dlx @bleedingdev/modern-js-ultramodern-create@<V> my-app --renderer solid
```

`--renderer <react|solid|octane>` is defined in
`packages/toolkit/ultramodern-create/src/cli/flags.ts`. Each native starter
(Solid, Octane) writes the same shape:

| File | Purpose |
| --- | --- |
| `src/routes/layout.tsx` | Root layout; `Link`/`Outlet` from the renderer's router |
| `src/routes/page.tsx` | Home route; reads `useLoaderData` and submits a route action |
| `src/routes/page.data.ts` | `loader`/`action` exports, native TanStack Router data handlers |
| `src/routes/page.head.ts` | Per-route `head()` metadata |
| `src/routes/about/page.tsx`, `about/page.head.ts` | A second route, same shape |
| `src/routes/error.tsx` | `ErrorRouteComponent` boundary |
| `src/routes/not-found.tsx` | `NotFoundRouteComponent` |
| `src/components/Counter.tsx`, `Stable.tsx` | HMR fixtures: one edited component, one left alone |

(`packages/toolkit/ultramodern-create/src/ultramodern-workspace/renderer-templates/{solid,octane}/index.ts`.)

## Routing and data

Both native renderers use file-system routes and the same `loader`/`action`
shape, backed by native TanStack Router data handlers
(`DataHandlerInput` from `@bleedingdev/modern-js-renderer-core/data`). Only
the component-side router bindings differ.

### Solid

Router bindings come from `@bleedingdev/modern-js-renderer-solid/router`:

```tsx
// src/routes/page.tsx
import {
  ActionForm,
  useLoaderData,
  useRouteAction,
} from '@bleedingdev/modern-js-renderer-solid/router';

export default function HomePage() {
  const data = useLoaderData({ strict: false });
  const action = useRouteAction();
  return (
    <section>
      <pre>{JSON.stringify(data())}</pre>
      <ActionForm action={action}>
        <input name="name" />
        <button type="submit" disabled={action.pending()}>
          Save
        </button>
      </ActionForm>
    </section>
  );
}
```

```ts
// src/routes/page.data.ts
import type { DataHandlerInput } from '@bleedingdev/modern-js-renderer-core/data';

export function loader({ request }: DataHandlerInput) {
  return { message: 'Native loader value' };
}

export async function action({ request }: DataHandlerInput) {
  const form = await request.formData();
  return { saved: form.get('name') };
}
```

(Full fixture:
`tests/ultramodern-renderers/conformance/fixtures/solid/src/routes/page.tsx`.)

### Octane

Router bindings come from `@bleedingdev/modern-js-renderer-octane/router`.
Components are authored as `.tsx` today (the generator's starter); Octane
also admits its own `.tsrx` source extension for components, declared in its
build profile's `sourceExtensions`:

```tsx
// src/routes/page.tsx
import {
  createOctaneRouteAction,
  useApplicationIdentity,
  useApplicationRouteId,
  useLoaderData,
  useRouter,
} from '@bleedingdev/modern-js-renderer-octane/router';
import { useActionState, useMemo } from 'octane';

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
  return <pre>{JSON.stringify(data)}</pre>;
}
```

A `.tsrx` component (`tests/ultramodern-renderers/octane-admission/src/Counter.tsrx`)
uses Octane's own block syntax instead of a `return`:

```tsrx
export function Counter() @{
  const [count, setCount] = useAdmissionCount();
  <button onClick={() => setCount(count + 1)}>{"Count: " + count}</button>;
}
```

`page.data.ts` uses the same `loader`/`action` shape as Solid.

## Capability matrix

Source of truth:
`packages/solutions/ultramodern-app-tools/src/renderers/{react,solid,octane}/profile.ts`.

| Capability | react | solid | octane |
| --- | --- | --- | --- |
| SSR / streaming, CSR | Yes | Yes | Yes |
| Worker (Cloudflare) SSR | Yes | Yes | Yes |
| SSG (`output.ssg`) | Yes | Yes | Yes |
| SVG components (`?component` import) | Yes | Yes | Yes |
| Module Federation | Full, including app SSR | Federated components, client-only | No |
| RSC | Yes | No | No |
| i18n | Yes | No | No |

SSR/streaming and CSR carry no per-renderer gate in
`renderer-selection.ts`; worker, SSG and SVG components are declared `true`
in all three profiles' `capabilities`.

Solid's Module Federation support is one-directional and client-only:
`federatedComponent()` from `@bleedingdev/modern-js-renderer-solid/federation`
renders a same-renderer remote's default export on the client once the host
root has settled; the server and the hydration pass render its `fallback`
instead. It never participates in application-level SSR federation.

```tsx
import { federatedComponent } from '@bleedingdev/modern-js-renderer-solid/federation';

const RemoteWidget = federatedComponent('remote/Widget', {
  fallback: () => <p>Loading…</p>,
});
```

Unsupported combinations fail when the config is evaluated, before the build
starts:

```
unsupported-renderer-capability: renderer solid does not support React Server Components
```

`assertCapturedRenderer` in `renderer-selection.ts` raises the same error,
naming the capability, for RSC, i18n, SSG, SVG components, Module Federation
application SSR, and worker or non-Node/Cloudflare deployment targets.

## Switching an existing app

Changing `renderer` without migrating the app's source surfaces two kinds of
startup errors, both from
`packages/solutions/ultramodern-app-tools/src/native-composition/renderer-selection.ts`
and `renderer-source-ownership.ts`.

React-only CLI plugins (`assertRendererCliPlugins`):

```
unsupported-renderer-plugin: renderer solid cannot use React-only plugins registered in modern.config plugins:
  - @modern-js/plugin-tanstack: remove tanstackRouterPlugin(); the solid renderer routes src/routes through @modern-js/renderer-solid/router
Remove these plugins for the native renderer, or keep renderer: 'react'.
```

Route files still authored for the previous renderer
(`assertRouteSourcesMatchRenderer`, detected by a `.tsrx` extension, an
`@jsxImportSource` pragma, or an import of a renderer-owned package such as
`react-router` or `solid-js`):

```
renderer-source-mismatch: modern.config selects renderer solid, but these route modules are authored for react:
  - src/routes/page.tsx imports 'react-router' (react)
Port them to solid components and install its packages, or set renderer: 'react' in modern.config.
```

Fix both before the build proceeds: remove the listed plugins, then port or
relocate the listed route files.

## Preview status

`solid` (Solid 2 RC) and `octane` (a maintained Octane fork) are
`status: 'preview'` in their build profiles; `react` is `status: 'stable'`.
Expect their compiler, router and capability set to change between releases.
