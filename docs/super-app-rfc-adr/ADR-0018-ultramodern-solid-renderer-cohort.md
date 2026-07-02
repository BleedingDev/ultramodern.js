# ADR-0018: UltraModern Solid Renderer Cohort Evaluation

- Status: Evaluation accepted as planning record; implementation not yet accepted
- Date: 2026-07-02
- Decision Type: UltraModern renderer and MicroVertical architecture evaluation
- Related: ADR-0002 (app-level MF SSR), ADR-0016 (UltraModern opinionated defaults), ADR-0017 (composition/router coordination), WORKSPACE-0001 (MicroVertical workspace scaffolding)
- Beads: modernjs-96xx

## 1. Context

The fork is evaluating what it would take to support UltraModern.js with Solid.js instead of React, ideally while keeping React support. The clarified scope is not arbitrary Modern.js application support. The relevant target is the UltraModern generated super-app/MicroVertical product line: route-owned verticals, Module Federation composition, Cloudflare/SSR deployment, BFF/data contracts, i18n, Tailwind-first UI, and downstream acceptance through generated app validation.

The key clarification changes the evaluation materially:

1. UltraModern already standardizes on TanStack Router for generated workspaces.
2. TanStack Router has Solid support, so the route model can remain TanStack-shaped.
3. Tailwind is the intended styling substrate; styled-components parity is not a requirement.
4. Module Federation and MicroVertical composition are the real hard boundary, not CSS-in-JS.

## 2. Current Evidence

Current UltraModern generated workspaces are still React cohorts:

- Generated app dependencies include `@module-federation/bridge-react`, `@tanstack/react-router`, `react`, `react-dom`, and `react-router` in `packages/toolkit/create/src/ultramodern-workspace/package-json.ts`.
- Generated Module Federation config shares `@tanstack/react-router`, `react`, `react-dom`, and `react-dom/client` in `packages/toolkit/create/src/ultramodern-workspace/module-federation.ts`.
- Generated app config installs `tanstackRouterPlugin()` from `@modern-js/plugin-tanstack`, which is currently the React TanStack implementation.
- Generated remote typing uses `React.ComponentType` in `packages/toolkit/create/src/ultramodern-workspace/app-files.ts`.
- Generated shell/remote demo components use `@module-federation/bridge-react`, React `Suspense`, React hooks, and `ComponentType` in `packages/toolkit/create/src/ultramodern-workspace/demo-components.ts`.
- The shared builder path unconditionally installs `@rsbuild/plugin-react` in `packages/cli/builder/src/shared/parseCommonConfig.ts`.
- The core runtime remains React-shaped: `React.ComponentType`, React Context providers, React DOM client render/hydrate, React DOM server render/string/stream, and React Helmet.

Current UltraModern generated workspaces are already Tailwind-friendly:

- Tailwind is generated and validated through UltraModern workspace config and scripts.
- Per-app Tailwind prefixes are generated through `tailwindPrefixForApp`, which is compatible with same-page MicroVertical composition and helps avoid cross-vertical utility collisions.
- Removing styled-components from Solid parity does not remove a load-bearing UltraModern default.

External ecosystem evidence supports the route-first direction:

- TanStack Router is documented as a router for React and Solid applications with typed routes, nested routing, loaders, prefetching, file-based routing, SSR, and route/search type inference.
- Rsbuild has an official Solid plugin path, but it requires `@rsbuild/plugin-babel` plus `@rsbuild/plugin-solid`; the Solid plugin uses `babel-preset-solid`, adds Solid resolve conditions, and has an explicit `ssr` option.
- TanStack Start is useful prior art: it keeps the route tree as the application contract and adds full-document SSR, streaming, server functions, server routes, and deployment output around that model.

Primary external references:

- https://tanstack.com/router/latest/docs/overview
- https://tanstack.com/start/latest
- https://rsbuild.rs/guide/framework/solid
- https://rsbuild.rs/plugins/list/plugin-solid
- https://docs.solidjs.com/solid-router/rendering-modes/ssr

## 3. Evaluation

TanStack Router makes Solid UltraModern substantially easier, but it does not make the current implementation framework-neutral.

The route contract can be preserved:

- Route-owned verticals remain the right mental model.
- File/code route generation can remain TanStack-shaped.
- Loader/prefetch/search/params concepts map to both React and Solid TanStack Router ecosystems.
- UltraModern's current preference for TanStack over React Router becomes a strong enabling constraint.

The renderer contract still has to split:

- React components and Solid components are not interchangeable.
- React Context and Solid context have different runtime APIs.
- React root render/hydrate and Solid root render/hydrate have different signatures and lifecycle behavior.
- React stream SSR and Solid stream SSR can both serve full-document HTML, but shell callbacks, hydration markers, and async behavior must be adapterized rather than aliased.

The Module Federation contract is the central remaining risk:

- Current generated MF code uses `@module-federation/bridge-react` and React singleton sharing.
- Solid needs a same-renderer MF cohort first: Solid shell loads Solid verticals, shares Solid runtime packages, and types remote exports as Solid components.
- Mixed React/Solid composition should be a later island/custom-element boundary, not the first target.
- Hiding a renderer mismatch behind local wrappers or synthetic component adapters would violate the fork rule against app-level shims that mask framework defects.

RSC is not the first UltraModern Solid target:

- React RSC is tied to React Flight and `react-server-dom-rspack`.
- Solid has SSR, streaming, actions/server functions, and route data patterns, but not React Flight compatibility.
- For UltraModern Solid, server functions and route loaders are the right product-level replacement path. React RSC can remain React-only.

## 4. Decision Direction

If implemented, Solid support should be added as a first-class UltraModern renderer cohort:

```text
--renderer react | solid
```

React remains the default cohort until Solid reaches generated workspace acceptance. Solid should not be introduced as aliases for React package names or as app-level shims.

The desired target is:

- Solid shell app.
- Solid MicroVertical remotes.
- TanStack Solid Router route tree.
- Tailwind-only generated UI.
- Solid-compatible i18n runtime facade.
- Solid-compatible Module Federation loader/fallback story.
- SSR string first, streaming SSR second.
- Cloudflare build/deploy compatibility.
- BFF/data contracts unchanged where renderer-neutral.
- Tractor downstream acceptance after generator/runtime/tooling changes when the downstream workspace exists.

## 5. Proposed Work Lanes

### Lane 1: Renderer Selection

Add an UltraModern generator renderer option and thread it through workspace generation:

- `--renderer react` keeps existing behavior.
- `--renderer solid` selects Solid dependencies, templates, runtime imports, router plugin, MF sharing config, validation expectations, and generated ambient types.
- Generated metadata should record the renderer in `.modernjs/ultramodern.json` or the existing template manifest so validation can reject mixed cohort drift.

### Lane 2: Builder Support

Introduce renderer-aware builder plugin selection:

- React path keeps `@rsbuild/plugin-react`.
- Solid path installs `@rsbuild/plugin-babel` and `@rsbuild/plugin-solid`.
- Solid SSR builds must enable Solid plugin SSR generation for server environments.
- Snapshot tests should prove React defaults do not change.

### Lane 3: Solid Runtime Surface

Create a Solid runtime path rather than mutating the React one in place:

- `@modern-js/runtime-solid` or equivalent internal package/export.
- Solid `render`/`hydrate` entry functions.
- Solid runtime/internal context providers.
- Solid head/meta collection strategy.
- Solid SSR string renderer.
- Solid SSR streaming renderer.
- Generated Solid entry and server-entry templates.

### Lane 4: TanStack Solid Router Provider

Create a Solid TanStack provider parallel to the current React provider:

- Use `@tanstack/solid-router`.
- Reuse UltraModern route discovery/topology where possible.
- Emit Solid route modules and route tree shape.
- Preserve basename, localized paths, redirect behavior, route assets, loader data, and prefetch behavior.
- Keep the public route contract TanStack-shaped so MicroVertical authors do not learn two unrelated routing systems.

### Lane 5: Tailwind-Only UI Templates

Keep generated UI Tailwind-first:

- Preserve existing visible UltraModern UI unless a design change is explicitly requested.
- Convert generated JSX templates to Solid semantics where needed.
- Keep per-app Tailwind prefixes.
- Remove React-only lint/profile defaults from generated Solid workspaces.

### Lane 6: Module Federation Solid Cohort

Replace the React MF bridge for Solid-generated workspaces:

- Use Solid remote component types.
- Share `solid-js`, `solid-js/web`, `@tanstack/solid-router`, Solid runtime package(s), i18n Solid runtime, and any Solid MF helper package.
- Define a Solid remote fallback/hydration pattern equivalent to the current React `createHydratedRemote` behavior.
- Keep first release same-renderer only: Solid shell with Solid remotes.
- Defer mixed React/Solid MF to a later explicit island boundary.

### Lane 7: i18n Solid Facade

Reuse i18next detection/backend logic, but add Solid bindings:

- Solid provider.
- Solid `useModernI18n` equivalent.
- Solid `<Link>` wrapper over TanStack Solid Router.
- Same canonical route/localized URL contracts.
- Same locale redirect exclusions for MF assets and BFF endpoints.

### Lane 8: Acceptance Matrix

Add focused acceptance before shipping:

- Generated Solid workspace validates with `validate-ultramodern`.
- Solid shell build.
- Solid vertical build.
- Solid SSR string render.
- Cloudflare build path.
- MF manifest and remote loading.
- i18n localized route navigation.
- BFF/data contract untouched.
- React UltraModern regression still passes.
- Tractor downstream release acceptance when `/Users/satan/side/experiments/tractor-store-vertical` exists and generator/runtime/tooling changes are made.

## 6. Scope Cut

First Solid UltraModern release should not include:

- React RSC parity for Solid.
- Mixed React/Solid remotes in one MF page.
- styled-components support.
- App-level adapter shims that pretend React components are Solid components or vice versa.
- Manual click interception or router bypasses.
- Generated-file patching in downstream apps to make framework defects appear fixed.

## 7. Risk Register

1. **MF same-renderer assumption**: low to medium risk if enforced; high risk if mixed renderer support is attempted too early.
2. **SSR streaming parity**: medium risk. Solid can stream, but Modern shell injection and hydration data handling must be adapted carefully.
3. **Builder performance**: medium risk. Solid's Rsbuild path introduces Babel for JSX/TSX.
4. **Route module generation**: medium risk. Route discovery can be reused, but emitted component wrappers and lazy boundaries must be Solid-specific.
5. **i18n runtime facade**: medium risk. The backend/detection logic is reusable; hook/provider/link APIs are renderer-specific.
6. **React regression**: medium risk if renderer branching is added too deep in shared packages. Keep React cohort unchanged where possible.
7. **Downstream acceptance drift**: high risk if Tractor and generated workspace validators are not updated with the Solid renderer dimension.

## 8. Rough Sizing

- Solid CSR UltraModern workspace: 2-4 weeks.
- Solid + TanStack routing + Tailwind generated UI: 4-6 weeks.
- Solid SSR string + i18n + Cloudflare build: 6-10 weeks.
- Solid MicroVertical Module Federation with SSR and remote widgets/routes: 10-16 weeks.
- React and Solid as first-class UltraModern cohorts: 3-5 months.

These estimates assume one or two senior engineers, focused validation, and no attempt to provide React RSC parity for Solid in the first release.

## 9. Bottom Line

TanStack Router and Tailwind move this from "rewrite the framework" to "add a first-class UltraModern renderer cohort." That is still substantial, but it is credible because the product-level architecture can remain route-first, Tailwind-first, and MicroVertical-first.

The bold but defensible direction is: keep React UltraModern stable, add Solid UltraModern as a same-renderer generated cohort, and make Module Federation renderer identity explicit instead of implicit.
