# UltraModern.js application tools

Select the application renderer in `modern.config.ts`. `defineConfig` registers
the selected compiler, runtime, router integration and server lifecycle.

```ts
import { defineConfig } from '@modern-js/ultramodern-app-tools';

export default defineConfig({
  renderer: 'solid', // 'react' or 'octane'; omitted means 'react'
  server: { ssr: true },
});
```

Use Node **26.10.0 or newer**. Run the installed application's public CLI:

```sh
pnpm exec ultramodern dev
pnpm exec ultramodern build
pnpm exec ultramodern serve
```

The selector belongs to this config import. Do not add another `appTools()` or
`ultramodernAppTools()` base plugin. Changing the renderer requires matching
native application source and dependencies, then a dev-server restart and a
document reload. The generated entries own mounting and hydration.

## Native application imports

| Renderer | Component authoring | Application router |
| --- | --- | --- |
| React | `react` | `react-router`, or the configured TanStack integration |
| Solid 2 | `solid-js`, `@solidjs/web` | `@modern-js/renderer-solid/router` |
| Octane | `octane` | `@modern-js/renderer-octane/router` |

Solid and Octane use their native component syntax and managed filesystem
routes. Their SDKs expose `/client`, `/router`, `/server` and `/manifest`
entrypoints. Generated applications select these automatically.

### Renderer adapters

Every renderer is a `RendererAdapter` from `@modern-js/renderer-core/adapter`.
`defineConfig` loads only the selected one:

- `react` is a composed adapter (`src/renderers/react`). Its `compose()`
  registers the Modern.js React graph.
- `solid` and `octane` are native adapters exported from
  `@modern-js/renderer-<renderer>/plugin`. Each one carries its build profile,
  runtime entry modules, Rsbuild compiler plugin, compiler artifact checks,
  Module Federation singletons, worker support and create templates.

This package keeps the renderer-neutral parts: config selection, the
registered renderers' package and source-extension ownership, capability
checks, and one build, dev, SSG, worker and federation pipeline for every
native adapter. The entries it generates hold only data: `index.ts` calls the
renderer's `startNativeClient()`, `index.server.ts` calls
`createNativeServerEntry()`, and `app.client.ts`/`app.server.ts` list the
route modules. Mounting, hydration, documents, sessions, i18n and data
endpoints live in `@modern-js/renderer-core/entry-client` and
`@modern-js/renderer-core/entry-server`.

## Supported preview profile

Solid **2.0.0-rc.13** and Octane are Node previews with CSR, native streaming SSR,
hydration, route loading and actions. Their exact compiler, runtime and router
pins come from `resolveRendererProfile` exported by this package. Octane uses
the maintained [BleedingDev release artifacts](https://github.com/bleedingdev/octane/releases)
selected by that profile.

Native previews reject React Server Components, React runtime i18n
configuration and CSS declaration emission beside authored source. Octane
also rejects Module Federation.
These limits are checked before output generation; there is no preview bypass.

Native apps localize with `i18nPlugin()` from this package, which takes the
same `localeDetection`/`backend` options as `@modern-js/plugin-i18n`. URLs are
language-prefixed (`/cs/about`), translations come from
`locales/<language>/<namespace>.json`, and components use `useI18n`,
`LocalizedLink` and `I18nProvider` from `@modern-js/renderer-<renderer>/i18n`.
Install `i18next` and `@modern-js/i18n-runtime-extensions` next to the renderer:

```ts
import { defineConfig, i18nPlugin } from '@modern-js/ultramodern-app-tools';

export default defineConfig({
  renderer: 'solid',
  server: { ssr: true },
  plugins: [
    i18nPlugin({
      localeDetection: { languages: ['en', 'cs'], fallbackLanguage: 'en' },
    }),
  ],
});
```

`output.ssg` and `output.ssgByEntries` prerender native routes after the build,
in the same `dist/html/<entry>/<route>/index.html` layout as React SSG. Each
document's search-free loader data is written beside it, so client navigation
between prerendered routes works on a static host. A route cannot use both SSR
and SSG.

`import Icon from './icon.svg?component'` compiles an SVG into a Solid or
Octane component; `output.svgDefaultExport: 'component'` does the same for
plain `.svg` imports from scripts. Stylesheets and `?url` imports keep URLs.
Add `/// <reference types="@modern-js/ultramodern-app-tools/types" />` for the
`?component` module type.

Solid's native public route snapshots accept immutable plain records, arrays,
scalars and checked top-level deferred Promise slots. Rich HTTP data transport
is a separate `@modern-js/renderer-core/data` surface. Request objects, headers,
bindings and session state remain private to the request.
Authored deferred Promises use the standard prototype without custom own
properties. Symbol-bearing source Promises from async-hooks instrumentation and
Node's `--no-async-context-frame` mode are outside this preview profile.

Generate a workspace with the selected dependencies through
[`@modern-js/ultramodern-create`](../../toolkit/ultramodern-create/README.md).
Build and document identities bind the application source and installed
compiler/runtime cohort; stale manifests or hydration identities fail before
application startup.
