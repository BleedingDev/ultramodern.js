# Native UltraModern workflows

Use the exact release selected for your workspace. In the commands below, replace
`<V>` with the published framework version. The public CLI package is
`@bleedingdev/modern-js-ultramodern-create`; a source checkout's package version
is not proof that a release is published.

## Create or add a delivery unit

Create a workspace with its first shell:

```sh
pnpm dlx @bleedingdev/modern-js-ultramodern-create@<V> my-workspace
cd my-workspace
mise install
pnpm install
pnpm check
```

Activate the generated mise environment before running pnpm. Use `.` as the name
to initialize an empty current directory. Keep the versions declared by the
workspace instead of substituting global tool versions.

From an existing workspace root, add a business domain:

```sh
pnpm exec ultramodern-create catalog --vertical
pnpm install
pnpm check
```

An optional `--dry-run` previews a vertical addition. Choose one preset only when
the default full-stack UI and Effect REST API is not appropriate:

| Choice | Flag | Generated unit |
| --- | --- | --- |
| Headless API | `--preset api-only` | API and backend federation, no browser UI or Tailwind |
| UI only | `--preset ui-only` | Routes and components, no API |
| Shared components | `--horizontal-remote` | A UI-only horizontal remote |
| Effect RPC | `--api-protocol rpc` | RPC instead of the default REST API |

A shell composes selected verticals. Business endpoints belong to their vertical.
A headless vertical can coexist with a shell; this preset does not remove the
workspace's shell.

To add another shell, use the existing public API from the installed generator:

```ts
import { addUltramodernShell } from '@modern-js/ultramodern-create/ultramodern-workspace';

addUltramodernShell({
  workspaceRoot: process.cwd(),
  name: 'admin',
  modernVersion: '<V>',
  verticals: ['catalog'],
});
```

`planUltramodernShell` accepts the same input for a preview.
`addUltramodernVertical` accepts `shell: 'shell-admin'` to target that shell.
Neither additional-shell creation nor shell selection has a CLI flag. Install
changed dependencies and run `pnpm check` after applying the API call.

## Edit native application code

Use `Link`, route search validation and `useNavigate` from
`@tanstack/react-router`. Keep search values in the router's `search` object.
For a registered `/$lang/catalog` route, navigation can be written directly:

```tsx
<Link
  to="/$lang/catalog"
  params={{ lang: 'cs' }}
  search={{ q: 'plough' }}
>
  Catalog
</Link>
```

Declare the route's `validateSearch` function and read its validated search data
through the route. Use `useNavigate` for actions that change navigation, such as
clearing a filter. Keep the locale in route parameters. When the application has
translated URL aliases, retain its existing route-owned localization metadata
and the framework's i18n integration. Do not replace translated paths with a
hard-coded prefix rule. The [native navigation fixture](../packages/toolkit/ultramodern-create/tests/fixtures/native-workflows/native-navigation.tsx)
shows a standalone native route tree; generated file-route applications retain
their existing route registration.

Effect REST contracts use `HttpApi`, `HttpApiGroup`, `HttpApiEndpoint` and
`Schema` from `@modern-js/bff-effect/effect-client`. Server handlers use
`Effect`, `HttpApiBuilder.group`, `Layer` and `defineEffectBff` from
`@modern-js/bff-effect/effect-edge`. Compose the handler layer with
`HttpApiBuilder.layer(api).pipe(Layer.provide(handlers))` and pass it to
`defineEffectBff({ api, layer })`. Keep the server module out of browser imports.
The [native API fixture](../packages/toolkit/ultramodern-create/tests/fixtures/native-workflows/native-api.ts)
shows this composition without a local runtime adapter. Common readiness and
error contracts come from `@modern-js/bff-effect/microvertical-api`; business
schemas and handlers remain application code.

For Node-specific API modules, import `defineEffectBff` and framework context
helpers from `@modern-js/bff-effect/effect`. Import `Effect` and `Layer` as
namespaces from `effect/Effect` and `effect/Layer`, and `HttpApiBuilder` from
`effect/unstable/httpapi`. Keep worker handlers and worker context on
`@modern-js/bff-effect/effect-edge`. Native `@modern-js/plugin-bff/server`
exports Hono APIs.

## Check and build

| Task | Command | What it covers |
| --- | --- | --- |
| Format edited files | `pnpm format` | Oxfmt formatting |
| Static acceptance | `pnpm check` | Format, lint, types, skills, i18n boundaries, API files, contract and performance checks; configured bridge gates also run |
| Focused API diagnosis | `pnpm api:check` | API files and runtime topology |
| Node build | `pnpm build` | Shared declarations, configured apps, deployment output and root build checks |
| Run a built Node unit | `pnpm --filter @<scope>/<unit> serve` | Native `modern serve` |
| Workerd preview | `pnpm --filter @<scope>/<unit> cloudflare:preview` | Builds that unit, then starts Wrangler with `.output/wrangler.json` |
| Build all Cloudflare units | `pnpm cloudflare:build` | Workspace Cloudflare build and generated output checks |

Run `pnpm check` once after an edit or update. Its API-file and contract stages
already cover the static pipeline, so separate `api:check` and `contract:check`
commands are only needed to isolate a failure. Lint alone does not check the API.
A build and a static check do not start or test running services.

For a workspace with APIs, generate the Node federation configuration with
`pnpm node:backend-federation:generate`, start the built units, then run
`pnpm node:proof`. Workspaces without APIs omit the backend proof scripts.
For a live Cloudflare deployment, use `pnpm cloudflare:deploy` with your deployment
credentials and each unit's `ULTRAMODERN_PUBLIC_URL_<APP_ID>`, then run
`pnpm cloudflare:proof --require-public-urls`. Choose the runtime you deploy to;
a preview is not evidence of a successful public deployment.

## Resolve a failure

| Failure | Next action |
| --- | --- |
| Ownership or unsupported-contract conflict | Use the named path or symbol to identify the authored behavior. Keep that behavior and resolve it in the owning framework implementation. |
| API check exit `1` | Fix the reported consumer API diagnostic. |
| API check exit `2` | Fix the analyzer, executable or package-resolution failure, then rerun the check. |
| Cohort, registry or lock failure | Verify the exact target release and registry access. Retry installation after fixing the reported cause. |
| Check or build failure after installation | Use the failing stage's diagnostic; do not suppress the check or add an application compatibility shim. |

For deployment rollback, select a complete previous delivery unit through the
deployment system so its UI, API and static assets retain one identity.

`pnpm exec ultramodern-create ultramodern sync-delivery-unit` explicitly
synchronizes delivery identity from app manifest versions and topology. It can write topology and
`shared/ultramodern-build.{json,ts}`; it is not a routine dependency-update step.
