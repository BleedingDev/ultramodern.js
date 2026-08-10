<p align="center">
  <a href="https://modernjs.dev" target="blank"><img src="https://lf3-static.bytednsdoc.com/obj/eden-cn/ylaelkeh7nuhfnuhf/modernjs-cover.png" width="300" alt="Modern.js Logo" /></a>
</p>

<h1 align="center">Modern.js</h1>

<p align="center">
  A Progressive React Framework for modern web development.
</p>

## UltraModern.js Create

The BleedingDev create package has one supported generated product: an
UltraModern SuperApp workspace.

```bash
pnpm dlx @bleedingdev/modern-js-create my-workspace
```

The supported pnpm command contract is the scoped package specifier above:
`pnpm dlx @bleedingdev/modern-js-create <target>`. Do not shorten it to
`pnpm dlx modern-js-create`; there is no unscoped `modern-js-create` npm
package. Release proof runs this scoped form from a temporary pnpm store/cache
so it cannot pass because of a local link cache.

To initialize the empty directory you are already in, pass `.` explicitly:

```bash
pnpm dlx @bleedingdev/modern-js-create .
```

The workspace starts shell-only so the first commit has no fake business
domains to delete. It generates:

- `apps/shell-super-app` as the Module Federation host and topology owner.
- `verticals/*` empty until a real domain is added with `--vertical`.
- `packages/shared-*` placeholders for shared contracts, tokens, and Effect
API support.
- `.modernjs/ultramodern.json` as compact generator provenance, package-source
  config, app topology, bridge, deploy, Module Federation, and tooling config.
- `topology/*` as app-owned topology, ownership, and local development overlay
  JSON.

Validate the generated workspace before making application changes:

```bash
cd my-workspace
mise install
pnpm install
pnpm check
pnpm build
```

The generated toolchain pins Node `26.7.0`, pnpm `11.21.0`, and
`@types/node@^26.2.0`; its engine baseline remains Node `>=26` with pnpm `11+`.
`packageManager`, `.mise.toml`, generated validation, and CI should all agree
on those values; do not reintroduce Corepack or older pnpm aliases.

The current generated dependency cohort also pins `@effect/tsgo@0.36.2`,
`@tanstack/react-router@1.170.25`, `@tanstack/router-core@1.171.21`,
`@tanstack/history@1.162.1`, the Module Federation integration `2.8.2` cohort,
`@module-federation/node@2.7.49`, and `react-router@7.18.2`. Move these only
through the generator-owned version policy so templates, validation, and the
published workspace contract stay aligned.

## TS-Go Compatibility Boundary

The supported generator runtime surfaces are:

- `@modern-js/create/ultramodern-workspace`
- `@modern-js/create/ultramodern-workspace/codesmith`
- The `@bleedingdev/modern-js-create` CLI that delegates to those APIs.

These surfaces are plain Node generator code. They must not import
`typescript` or TypeScript compiler internals at runtime. The package build is
the local validation command for this boundary:

```bash
pnpm --filter @modern-js/create build
```

That command runs the Rslib runtime build and then emits declarations through
the repo `tsgo:dts` flow. Run `pnpm --filter @modern-js/create test` when
changing generator behavior; it includes a boundary test that scans generator
sources, templates, and generated workspace output for compiler API imports.

Generated app packages keep stable `typescript` on TS7 so Modern/Rspack and
`@effect/tsgo` use TS-Go by default. Generated app/package source must not
depend on compiler API internals. If a future AST utility is needed, keep it
behind a dedicated TypeScript adapter and test it against stable `typescript`.

Generated CI does not call the local aggregate. It runs format, lint,
typecheck, skills, i18n boundary validation, contract validation, and build as
separate matrix jobs so failures are isolated and parallelizable. Generated
lefthook config runs separate format and lint-fix commands on pre-commit, then
runs the read-only primitive gates in parallel on pre-push.

For local monorepo dependency testing, add `--workspace`:

```bash
pnpm dlx @bleedingdev/modern-js-create my-workspace --workspace
```

For package-source validation outside the monorepo, pass explicit
`--ultramodern-package-*` options.

## Automation And Public API

The supported runtime import is the public generator subpath. It exposes only
generator operations and stable result types; CLI argument parsing, prompts,
registry lookup, and process-exit flows stay private.

```ts
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
  planUltramodernVertical,
} from '@modern-js/create/ultramodern-workspace';

const workspace = generateUltramodernWorkspace({
  targetDir: '/tmp/my-workspace',
  packageName: 'my-workspace',
  modernVersion: '3.4.0',
  packageSource: {
    strategy: 'install',
    modernPackageVersion: '3.4.0',
  },
});

const plan = planUltramodernVertical({
  workspaceRoot: workspace.workspaceRoot,
  name: 'new-vertical',
  modernVersion: '3.4.0',
});

const vertical = addUltramodernVertical({
  workspaceRoot: workspace.workspaceRoot,
  name: 'new-vertical',
  modernVersion: '3.4.0',
});
```

Workspace generation returns `operation`, `workspaceRoot`, `packageScope`,
`packageSource`, `createdApps`, `createdPaths`, `rewrittenPaths`,
`assignedPorts`, `moduleFederationNames`, `apiPrefixes`,
`generatedContractPath`, and `warnings`. MicroVertical addition returns the
same shape for the new vertical and all rewritten integration surfaces.

Dry-run is available for MicroVertical addition only. The CLI prints the plan as
JSON and writes no files:

```bash
pnpm dlx @bleedingdev/modern-js-create new-vertical --vertical --dry-run
pnpm dlx @bleedingdev/modern-js-create --vertical=new-vertical --dry-run
pnpm dlx @bleedingdev/modern-js-create --vertical-name new-vertical --dry-run
```

The dry-run object adds `dryRun: true`, `selectedPort`,
`moduleFederationRemote`, `apiPrefix`, `jsonMutations`,
`shellDependencyChanges`, and `generatedContractChanges`. It still validates
the workspace before returning a plan.

Validation runs before the first filesystem write. Failures name the owning
contract so automation can stop safely:

| Failure area | Typical cause | Fix |
| --- | --- | --- |
| Fresh input | Invalid or missing vertical name | Use `<name> --vertical`, `--vertical=<name>`, or `--vertical-name <name>` |
| Existing topology | Duplicate app ID, package suffix, path, Module Federation name, port, API prefix, or manifest key | Choose a new vertical name or repair the existing topology/local overlay first |
| Workspace files | Missing or non-object compact UltraModern config, topology, ownership, or local overlay JSON | Restore the generated config files from source control or rerun from a valid workspace |
| Tailwind prefix | Existing app already owns the generated CSS prefix | Rename the vertical before generation |
| Output path | A generated path already exists | Treat it as an existing vertical and do not overwrite it |

Package source is explicit and recorded in `.modernjs/ultramodern.json`.

| Strategy | Use when | CLI |
| --- | --- | --- |
| `install` | Published BleedingDev package cohort or release proof | Default for the BleedingDev create package; optional `--ultramodern-package-version`, `--ultramodern-package-registry`, `--ultramodern-package-scope`, and `--ultramodern-package-name-prefix` |
| `workspace` | Local monorepo testing against unreleased packages | `--workspace` or `--ultramodern-package-source=workspace` |

## Migrating Older Workspaces

Older generated repos should move by adopting one published BleedingDev cohort
at a time. Start with a dry-run vertical addition so validation reports
topology, ownership, package-source, overlay, Tailwind prefix, Module Federation,
and compact UltraModern config conflicts before files are written:

```bash
pnpm dlx @bleedingdev/modern-js-create@latest catalog --vertical --dry-run
pnpm dlx @bleedingdev/modern-js-create@latest catalog --vertical
mise install
mise exec -- pnpm install
mise exec -- pnpm check
mise exec -- pnpm build
```

For strict Effect API migrations, update generated package metadata and Modern
package aliases through the framework command before hand-editing app code:

```bash
pnpm dlx @bleedingdev/modern-js-create@3.5.0-ultramodern.10 ultramodern \
  migrate-strict-effect --version 3.5.0-ultramodern.10
pnpm api:check
pnpm contract:check
pnpm check
pnpm build
```

The command updates `.modernjs/ultramodern.json`, root `modernjs.packageSource`,
generated Modern package aliases, framework-owned toolchain pins, old direct
topology metadata, strict Effect pnpm overrides/trust policy, and the pnpm
lockfile. It does not invent compatibility shims or move business code behind
your back. If `pnpm api:check` still fails, migrate the source to
`shared/api.ts`, `api/index.ts`, and `src/api/*-client.ts` and delete
`api/effect`, `api/lambda`, `shared/effect`, and `src/effect` paths.

Generated strict Effect workspaces pin the compatible Effect cohort through
`pnpm-workspace.yaml` overrides: `effect@4.0.0-beta.107`,
`@effect/opentelemetry@4.0.0-beta.107`, and
`@effect/vitest@4.0.0-beta.107`. The strict 24-hour release-age gate applies to
the installed cohort; the current policy carries no Effect age exemption, and
the override-only `@effect/vitest` entry is not an installed approval target.
Separately, exact
`trustPolicyExclude` entries for `effect` and `@effect/opentelemetry` cover the
trusted-publisher to provenance transition. Trust exclusions are not
release-age approvals. Do not override the cohort in app packages; update the
framework cohort when the runtime moves.

Use `--ultramodern-package-source=install` for published cohort proof and pin a
specific release with `--ultramodern-package-version` when CI must prove an
exact framework version. Keep `--workspace` only for local monorepo testing
against unpublished packages. After install, run the generated
`scripts/validate-ultramodern-workspace.mts` contract check and fix ownership
conflicts in the owning JSON/config files instead of editing generated metadata
by hand.

## CodeSmith Adapter And Overlays

The CodeSmith adapter is exported from:

```ts
import ultramodernCodeSmith from '@modern-js/create/ultramodern-workspace/codesmith';
```

Non-interactive usage passes config directly:

```ts
await ultramodernCodeSmith({
  config: {
    mode: 'workspace',
    name: 'my-workspace',
    targetDir: '/tmp/my-workspace',
    modernVersion: '3.4.0',
    packageSourceStrategy: 'install',
    modernPackageVersion: '3.4.0',
  },
});

await ultramodernCodeSmith({
  config: {
    mode: 'vertical',
    name: 'new-vertical',
    workspaceRoot: '/tmp/my-workspace',
    dryRun: true,
    logResult: true,
  },
});
```

The adapter prompts only when a required name is missing and a CodeSmith prompt
function is available. It returns the same public generation result or dry-run
plan as the direct API.

Overlays are explicit CodeSmith generators that run after base workspace or
MicroVertical generation:

```bash
pnpm dlx @bleedingdev/modern-js-create new-vertical --vertical \
  --codesmith-overlay ./generators/vertical-overlay
```

```ts
addUltramodernVertical({
  workspaceRoot: '/tmp/my-workspace',
  name: 'new-vertical',
  modernVersion: '3.4.0',
  overlays: [
    {
      generator: './generators/vertical-overlay',
      config: { owner: 'workspace' },
    },
  ],
});
```

Overlay config receives `workspaceRoot`, `packageScope`, `operation`,
`generatedApp`, `generatedApps`, `assignedPort`, `assignedPorts`,
`moduleFederationName`, `moduleFederationNames`, `apiPrefix`,
`apiPrefixes`, `packageSource`, and `generationResult`. Overlays extend
the generated output after base generation; they do not replace, inherit, or
shadow the base templates. Overlay failures stop the command with an
`UltraModern CodeSmith overlay failed` error and do not report base generation
as fully successful.

## Vertical Workspace Recipes

Use the workspace add flow from the UltraModern workspace root. It derives the
package path, package name, port, Module Federation name, topology entry, local
overlay, ownership entry, strict Effect HttpApi surface, and root `dev:*` script from the
requested vertical name.

```bash
pnpm dlx @bleedingdev/modern-js-create catalog --vertical
pnpm dlx @bleedingdev/modern-js-create --vertical=catalog
pnpm dlx @bleedingdev/modern-js-create --vertical-name catalog
```

Use this decision table before adding a vertical:

| Need | Keep inside current vertical | Create a new vertical |
| --- | --- | --- |
| Route or widget changes with the same product owner, release train, and fallback behavior | Yes | No |
| Route subtree needs independent rollout, rollback, or incident ownership | No | `--vertical` |
| UI and Effect BFF must version, deploy, and roll back together | No | `--vertical` |
| Design tokens, primitives, generated clients, or domain-neutral utilities | Yes | Use an ordinary workspace package, not a vertical |
| Feature composites or workflow state shared across verticals | No | Revisit ownership; do not hide it in shared code |

## SuperApp Architecture Contracts

The generated shell owns route assembly and policy. Each vertical added with
`--vertical` owns its route subtree, Module Federation exposes, Effect BFF
contract, generated client, `localisedUrls`, locale JSON, CSS layer, and
Cloudflare Worker output. The shell consumes vertical UI through Module
Federation manifests and vertical APIs through generated Effect clients
exported by the vertical packages.

Route metadata is route-owned and colocated in
`src/routes/**/route.meta.ts`. The scaffold regenerates
`src/routes/ultramodern-route-metadata.ts` as a generated route manifest for
Modern.js config, i18n, public head, and public surface contracts; authors
should not hand-maintain it. Locale JSON is served from
`/locales/{{lng}}/{{ns}}.json`; Czech and English routes are generated from the
route owner, not from shell rewrites.

Routes default to `privateByDefault: true` and
`publicnessDefault: private-app-screen`. Public web artifacts are build/deploy
outputs generated by `scripts/generate-public-surface-assets.mjs` into
`dist/public` and `.output/public`, not source files under `config/public`.
Generated public files use only explicit `public && indexable` route metadata,
so private app screens publish only a disallowing `robots.txt` by default.
JSON-LD is not inferred from route titles, descriptions, localized paths, app
names, BFF APIs, or Module Federation metadata. To publish structured data,
author `jsonLd` explicitly in route metadata for a `public && indexable` route;
generated apps provide `src/routes/ultramodern-jsonld.ts` helpers for
`WebPage`, `WebApplication`, `SoftwareApplication`, `BreadcrumbList`,
`FAQPage`, and `Organization`, while raw JSON-LD remains possible for other
schema types.

Dynamic public routes can expand sitemap entries through route-owned,
Node-safe ESM providers, normally `route.sitemap.mjs` beside the route
metadata. The public-surface generator discovers those providers for dynamic
public routes and still honors explicit `routes.publicSurface.contentSources`
entries in the generated route manifest. Providers may export
`entries`, `entries()`, or a default entries/loader returning sitemap entries;
draft entries and `indexable: false` entries are omitted.

CSS federation is explicit:

- `packages/shared-design-tokens` exports `./tokens.css` and owns
  `ultramodern-shared-tokens`.
- The shell owns shell base and overlay CSS only.
- Verticals own their vertical CSS layer and `[data-app-id="<vertical>"]`
  root marker.
- Tailwind CSS v4 is configured per app through `@rsbuild/plugin-tailwindcss`.
- Duplicate base styles are forbidden; SSR first paint depends on shared token
  CSS plus Modern/Rspack-emitted app CSS.

## Public URL Environment Variables

Generated apps must not bake absolute `http://localhost:<port>` URLs into asset
configuration. Public URL and asset prefix environment variables have distinct
roles, and stale aliases should not be carried forward when regenerating or
updating workspaces.

| Variable | Role | Feeds |
| --- | --- | --- |
| `MODERN_PUBLIC_SITE_URL` | Canonical site origin for public SEO output only | Canonical, hreflang, sitemap `<loc>`, robots `Sitemap:` |
| `MODERN_ASSET_PREFIX` | Preferred JS/CSS/static asset prefix | Modern/Rspack-emitted asset URLs |
| `ULTRAMODERN_ASSET_PREFIX` | UltraModern asset prefix fallback | Modern/Rspack-emitted asset URLs when `MODERN_ASSET_PREFIX` is unset |
| `ULTRAMODERN_PUBLIC_URL_<APP_ID>` | Per-app deployment/proof URL | Cloudflare proof inputs and Module Federation remote URLs |

Shell asset URLs use this precedence: `MODERN_ASSET_PREFIX` →
`ULTRAMODERN_ASSET_PREFIX` → origin-relative `/`. Module Federation remotes use
the same env precedence, then fall back to their per-app public origin:
configured public URL, inferred workers.dev URL, or local dev port.
`MODERN_PUBLIC_SITE_URL` is canonical/SEO-only and must not be used as an
asset-prefix fallback.
SEO output uses `MODERN_PUBLIC_SITE_URL`; if it is unset, generated local and
preview outputs remain non-public until deployment proof provides explicit
public URLs.

Without public URLs configured, shell asset paths are origin-relative (`/`).
Remote dev manifests publish their own local origin so host shells load
`remoteEntry.js` and exposed chunks from the remote dev server. Shell-only
workspaces can set `MODERN_PUBLIC_SITE_URL` for SEO output without changing
where assets load from.

## Cloudflare And Zephyr Proof

Each generated workspace app has:

- `cloudflare:build`, `cloudflare:deploy`, `cloudflare:preview`, and
  `cloudflare:proof` scripts.
- Cloudflare Worker deploy config from Modern config plus
  `.modernjs/ultramodern.json`.
- `zephyr:dependencies` for any consumed verticals.
- `zephyr-rspack-plugin` wired through the generated Modern.js Rspack bridge.

Deploy first, then pass each deployed app's generated public URL env key into
the proof step. The proof script reads the compact UltraModern config and checks the
Cloudflare Worker surface, including public-route sitemap/robots consistency,
preview noindex behavior, unknown-route status, asset headers, byte budgets,
and public sourcemap exposure. Shell-only workspaces only need the shell URL;
added verticals use the same `ULTRAMODERN_PUBLIC_URL_<APP_ID>` pattern with
hyphens converted to underscores and uppercased:

```bash
pnpm cloudflare:deploy
ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP=https://shell-super-app.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_TRANSPORTATION=https://transportation.example.workers.dev \
pnpm cloudflare:proof --require-public-urls
```

Without public URLs and credentials, use local primitive gates and `pnpm build`
evidence only; do not claim live Cloudflare or Zephyr selection has been
proven.

## Troubleshooting

| Symptom | Current check | Owner |
| --- | --- | --- |
| Package cohort mismatch | Regenerate with one package source strategy, run `mise install`, then rerun `pnpm install` from the activated shell. | Generated workspace package source metadata |
| Install failure | Check the active Node/pnpm from `mise install`; rerun `pnpm install` after the shell sees the pinned versions. | Toolchain setup |
| Build failure | Run the matching primitive gate (`pnpm lint`, `pnpm typecheck`, `pnpm i18n:boundaries`, `pnpm contract:check`) before `pnpm build`; fix the owning failure first. | Owning package or generated contract |
| Missing public URL | Set the app public URL env key recorded in `.modernjs/ultramodern.json`, for example `ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP`. | Deployment operator |
| Cloudflare credentials | Confirm Wrangler credentials before `pnpm cloudflare:deploy`; local checks do not prove live Worker access. | Deployment operator |
| Asset or CSS 404 | Rebuild with `pnpm build` or `pnpm cloudflare:deploy` and inspect emitted Modern/Rspack asset paths instead of hardcoding CSS URLs. | Framework/runtime asset pipeline |
| Federation manifest failure | Run the shell and vertical build scripts, then check each deployed `/mf-manifest.json` URL used by the shell. | Module Federation owner |

## Modern.js Documentation

- [English Documentation](https://modernjs.dev/en/)
- [中文文档](https://modernjs.dev)

## License

Modern.js is [MIT licensed](https://github.com/web-infra-dev/modern.js/blob/main/LICENSE).
