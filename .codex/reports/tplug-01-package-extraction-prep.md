# TPLUG-01 Package Extraction Prep

Graph: `tanstack-plugin-first-class-ssr`
Plan: `tanstack-router-plugin-package.plan.md`
Todo: `tplug-01`
Prototype reference: `refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class` at `32b44a7aa771402842bc72971eb1b8528ede1c26`

## Scope

Prepare the first scaffold slice for `@modern-js/plugin-tanstack` after generic core hooks are ready. This is a package extraction checklist only; no source scaffold, fixture migration, lockfile change, commit, or push was performed.

The package should use current `main-ultramodern` runtime code as the implementation source of truth. The PR #8317 branch is only a package-shape reference because it predates the current TanStack version, SSR state, router lifecycle hooks, and `modernRouteAction` bridge.

## Exact Package Files To Scaffold

Create this package root:

```text
packages/runtime/plugin-tanstack/
```

Initial package/config files:

```text
packages/runtime/plugin-tanstack/package.json
packages/runtime/plugin-tanstack/rslib.config.mts
packages/runtime/plugin-tanstack/rstest.config.mts
packages/runtime/plugin-tanstack/tsconfig.json
packages/runtime/plugin-tanstack/src/cli.ts
packages/runtime/plugin-tanstack/src/runtime.ts
packages/runtime/plugin-tanstack/src/cli/index.ts
packages/runtime/plugin-tanstack/src/cli/tanstackTypes.ts
packages/runtime/plugin-tanstack/src/runtime/index.tsx
packages/runtime/plugin-tanstack/src/runtime/basepathRewrite.ts
packages/runtime/plugin-tanstack/src/runtime/dataMutation.tsx
packages/runtime/plugin-tanstack/src/runtime/prefetchLink.tsx
packages/runtime/plugin-tanstack/src/runtime/routeTree.ts
packages/runtime/plugin-tanstack/src/runtime/DefaultNotFound.tsx
packages/runtime/plugin-tanstack/src/runtime/ssr-shim.d.ts
packages/runtime/plugin-tanstack/tests/router/tanstackTypes.test.ts
packages/runtime/plugin-tanstack/tests/router/routeTree.test.ts
packages/runtime/plugin-tanstack/tests/router/dataMutation.test.tsx
```

Defer these files until `tplug-02` / `tplug-03`, unless the core hooks are already available and the implementation compiles cleanly:

```text
packages/runtime/plugin-tanstack/src/runtime/plugin.tsx
packages/runtime/plugin-tanstack/src/runtime/plugin.node.tsx
```

`rslib.config.mts` should match current runtime plugin package convention:

```ts
import { rslibConfig } from '@modern-js/rslib';
import { defineConfig } from '@rslib/core';

export default defineConfig(rslibConfig);
```

`tsconfig.json` should match `packages/runtime/plugin-i18n/tsconfig.json`, with `include: ["src", "types"]` only if a `types/` directory is added. Otherwise use the prototype's `include: ["src"]`.

`rstest.config.mts` should use current `packages/runtime/plugin-runtime/rstest.config.mts` style, not the prototype `.ts` extension. The first slice should split node and client tests:

```ts
import type { ProjectConfig } from '@rstest/core';
import { withTestPreset } from '@scripts/rstest-config';

const commonConfig: ProjectConfig = {
  setupFiles: ['@scripts/rstest-config/setup.ts'],
  globals: true,
  tools: {
    swc: {
      jsc: {
        transform: {
          react: {
            runtime: 'automatic',
          },
        },
      },
    },
  },
};

export default {
  projects: [
    withTestPreset({
      name: 'plugin-tanstack-node',
      testEnvironment: 'node',
      include: [
        'tests/router/tanstackTypes.test.ts',
        'tests/router/routeTree.test.ts',
      ],
      extends: commonConfig,
    }),
    withTestPreset({
      name: 'plugin-tanstack-client',
      testEnvironment: 'happy-dom',
      include: ['tests/router/dataMutation.test.tsx'],
      extends: commonConfig,
    }),
  ],
};
```

## Package Metadata And Export Map Proposal

Use current repo versions and package conventions:

```json
{
  "name": "@modern-js/plugin-tanstack",
  "description": "TanStack Router integration for Modern.js.",
  "homepage": "https://modernjs.dev",
  "bugs": "https://github.com/web-infra-dev/modern.js/issues",
  "repository": {
    "type": "git",
    "url": "https://github.com/web-infra-dev/modern.js",
    "directory": "packages/runtime/plugin-tanstack"
  },
  "license": "MIT",
  "keywords": ["react", "framework", "modern", "modern.js", "tanstack-router"],
  "version": "3.2.0",
  "engines": {
    "node": ">=20"
  },
  "types": "./dist/types/cli/index.d.ts",
  "main": "./dist/cjs/cli/index.js",
  "exports": {
    ".": {
      "types": "./dist/types/cli/index.d.ts",
      "node": {
        "import": "./dist/esm-node/cli/index.mjs",
        "require": "./dist/cjs/cli/index.js"
      },
      "default": "./dist/cjs/cli/index.js"
    },
    "./package.json": "./package.json",
    "./cli": {
      "types": "./dist/types/cli/index.d.ts",
      "node": {
        "import": "./dist/esm-node/cli/index.mjs",
        "require": "./dist/cjs/cli/index.js"
      },
      "default": "./dist/cjs/cli/index.js"
    },
    "./runtime": {
      "types": "./dist/types/runtime/index.d.ts",
      "node": {
        "module": "./dist/esm/runtime/index.mjs"
      },
      "default": "./dist/esm/runtime/index.mjs"
    }
  },
  "typesVersions": {
    "*": {
      ".": ["./dist/types/cli/index.d.ts"],
      "cli": ["./dist/types/cli/index.d.ts"],
      "runtime": ["./dist/types/runtime/index.d.ts"]
    }
  },
  "scripts": {
    "dev": "rslib build --watch",
    "prepublishOnly": "only-allow-pnpm",
    "build": "rslib build",
    "test": "rstest --passWithNoTests"
  },
  "sideEffects": false,
  "publishConfig": {
    "registry": "https://registry.npmjs.org/",
    "access": "public",
    "types": "./dist/types/cli/index.d.ts"
  }
}
```

Runtime barrel exports for `src/runtime/index.tsx`:

```ts
export * from '@tanstack/react-router';
export { useMatch } from '@tanstack/react-router';
export { Link, NavLink } from './prefetchLink';
export {
  Form,
  RouteActionResponseError,
  useFetcher,
} from './dataMutation';
export type {
  LinkProps,
  NavLinkProps,
  PrefetchBehavior,
} from './prefetchLink';
export type {
  Fetcher,
  FetcherState,
  FetcherSubmitOptions,
  FormProps,
  SubmitOptions,
} from './dataMutation';
```

Add `export { tanstackRouterPlugin } from './plugin';` only when the client runtime plugin is moved in `tplug-03`. Add server-specific exports only if generic SSR hooks require a public server entry; do not invent `./server` for the scaffold slice.

CLI barrels:

```ts
// src/cli.ts
export * from './cli/index';
export { default } from './cli/index';

// src/runtime.ts
export * from './runtime/index';
```

## Dependency Ownership

Move ownership out of `@modern-js/runtime` and into `@modern-js/plugin-tanstack` once implementation is extracted.

Package dependencies:

```json
{
  "dependencies": {
    "@modern-js/plugin": "workspace:*",
    "@modern-js/runtime-utils": "workspace:*",
    "@modern-js/types": "workspace:*",
    "@modern-js/utils": "workspace:*",
    "@swc/helpers": "^0.5.21",
    "@tanstack/react-router": "1.168.26"
  },
  "peerDependencies": {
    "@modern-js/runtime": "workspace:^3.2.0",
    "react": "^19.2.6",
    "react-dom": "^19.2.6"
  },
  "devDependencies": {
    "@modern-js/app-tools": "workspace:*",
    "@modern-js/rslib": "workspace:*",
    "@modern-js/runtime": "workspace:*",
    "@rslib/core": "0.21.4",
    "@scripts/rstest-config": "workspace:*",
    "@tanstack/history": "1.161.6",
    "@testing-library/dom": "^10.4.1",
    "@testing-library/react": "^16.3.2",
    "@types/node": "^25.6.0",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "typescript": "6.0.3"
  }
}
```

Notes:

- `@tanstack/react-router` belongs in plugin `dependencies` because runtime exports re-export it and generated app code imports it through `@modern-js/plugin-tanstack/runtime`.
- `@tanstack/history` belongs in plugin `devDependencies` for route-tree tests; do not keep it in `@modern-js/runtime` after tests move.
- `@modern-js/runtime` should be a peer and dev dependency of the plugin. It should not own TanStack packages.
- Keep `react` and `react-dom` as peers matching current repo `^19.2.6`, not the prototype's broad `>=17.0.2`.
- Use current `@swc/helpers`, `@rslib/core`, `@types/node`, React, and TypeScript versions from `packages/runtime/plugin-runtime` / `packages/runtime/plugin-i18n`, not PR #8317 versions.
- Lockfile changes are intentionally not part of this prep report. The implementation slice will need the package added through normal pnpm workflow.

## Files And Tests To Move Or Copy First

First scaffold slice should copy current source files, then adjust import paths in the new package. Do not copy from PR #8317 except for package shape.

Copy these implementation files from current runtime core:

```text
packages/runtime/plugin-runtime/src/router/cli/code/tanstackTypes.ts
packages/runtime/plugin-runtime/src/router/runtime/tanstack/basepathRewrite.ts
packages/runtime/plugin-runtime/src/router/runtime/tanstack/dataMutation.tsx
packages/runtime/plugin-runtime/src/router/runtime/tanstack/prefetchLink.tsx
packages/runtime/plugin-runtime/src/router/runtime/tanstack/routeTree.ts
packages/runtime/plugin-runtime/src/router/runtime/tanstack/ssr-shim.d.ts
packages/runtime/plugin-runtime/src/router/runtime/DefaultNotFound.tsx
packages/runtime/plugin-runtime/src/exports/tanstack-router.ts
```

Map them to:

```text
src/cli/tanstackTypes.ts
src/runtime/basepathRewrite.ts
src/runtime/dataMutation.tsx
src/runtime/prefetchLink.tsx
src/runtime/routeTree.ts
src/runtime/ssr-shim.d.ts
src/runtime/DefaultNotFound.tsx
src/runtime/index.tsx
```

Required import/path adjustments:

- `tanstackTypes.ts`: replace `./makeLegalIdentifier` and `./utils` imports with imports from the runtime CLI export once `tpcore-02` exposes them, or copy the minimal helpers into `src/cli/` only as a temporary scaffold step if those helpers are not public yet.
- `tanstackTypes.ts`: parameterize the runtime module and default it to `@modern-js/plugin-tanstack/runtime`; generated code must not import `@modern-js/runtime/tanstack-router` as the primary path.
- `tanstackTypes.ts`: preserve current `modernRouteAction` static-data generation. This is a regression risk if the prototype generator is copied.
- `routeTree.ts`: change `import { DefaultNotFound } from '../DefaultNotFound';` to `import { DefaultNotFound } from './DefaultNotFound';`.
- Runtime plugin files, when moved later, must import runtime core contracts from `@modern-js/runtime` subpaths exposed by core hooks, not deep relative paths into `packages/runtime/plugin-runtime/src`.
- `ssr-shim.d.ts` should live beside plugin runtime files until upstream TanStack SSR typings make it unnecessary.

Copy these tests first:

```text
packages/runtime/plugin-runtime/tests/router/tanstackTypes.test.ts
packages/runtime/plugin-runtime/tests/router/tanstackRouteTree.test.ts
packages/runtime/plugin-runtime/tests/router/dataMutation.test.tsx
```

Map them to:

```text
packages/runtime/plugin-tanstack/tests/router/tanstackTypes.test.ts
packages/runtime/plugin-tanstack/tests/router/routeTree.test.ts
packages/runtime/plugin-tanstack/tests/router/dataMutation.test.tsx
```

Required test adjustments:

- `tanstackTypes.test.ts`: import from `../../src/cli/tanstackTypes`.
- `tanstackTypes.test.ts`: assert generated imports use `@modern-js/plugin-tanstack/runtime`.
- `routeTree.test.ts`: import from `../../src/runtime/routeTree`.
- `dataMutation.test.tsx`: import from `../../src/runtime/dataMutation`.
- Keep `tests/router/lifecycle.test.tsx` in `@modern-js/runtime`; it exercises generic lifecycle hooks and should be made framework-neutral by core work, not moved.
- Keep non-TanStack router CLI tests in `@modern-js/runtime`; only plugin-owned TanStack generator/runtime tests move.

## CLI Plugin Shape For Later Slices

Once `tpcore-02` exposes scoped entry generation and file-change hooks, `src/cli/index.ts` should follow the prototype shape with current branch logic:

- Export `tanstackRouterPlugin(options)` and `TanstackRouterPluginOptions`.
- Default `routesDir` to `views`.
- Default `generatedDirName` to `modern-tanstack`.
- Use `TANSTACK_ENTRYPOINTS_KEY = '__tanstack_router_entries__'`.
- Use `TANSTACK_RUNTIME_MODULE = '@modern-js/plugin-tanstack/runtime'`.
- Inject runtime plugin path `@{metaName}/plugin-tanstack/runtime`.
- Own `api.checkEntryPoint`, `api.modifyEntrypoints`, `api.generateEntryCode`, `api.onFileChanged`, `api.modifyFileSystemRoutes`, and `api.onBeforeGenerateRoutes`.
- Merge `NESTED_ROUTE_SPEC_FILE` JSON instead of overwriting entries from other route plugins.
- Preserve action-aware `writeTanstackRegisterFile` and `writeTanstackRouterTypesForEntry`.

Do not use the old core heuristic `framework: 'tanstack'` to activate plugin codegen as the primary path. The plugin should activate from explicit `tanstackRouterPlugin(...)` config and plugin-owned route entry detection.

## Compatibility Shim Strategy

Keep `@modern-js/runtime/tanstack-router` as a temporary compatibility subpath during migration, but make it a thin facade after `@modern-js/plugin-tanstack/runtime` exists.

Target shim:

```ts
// packages/runtime/plugin-runtime/src/exports/tanstack-router.ts
export * from '@modern-js/plugin-tanstack/runtime';
```

Compatibility requirements:

- `packages/runtime/plugin-runtime/package.json` keeps the `./tanstack-router` export and `typesVersions` entry during the compatibility window.
- Generated code should switch to `@modern-js/plugin-tanstack/runtime` immediately for new plugin-owned generation.
- Existing apps importing `@modern-js/runtime/tanstack-router` continue to work through the shim only if they install the plugin package.
- Avoid making `@modern-js/runtime` depend on `@modern-js/plugin-tanstack`; that would recreate the ownership problem. If package-manager constraints make the direct re-export impossible without a dependency cycle, replace the shim with an explicit runtime error/deprecation module or defer the shim to a separate compatibility issue.
- Do not keep duplicate TanStack runtime implementation in both packages after the plugin runtime move.

For type registration during staged migration:

- Primary generated module augmentation should target `@modern-js/plugin-tanstack/runtime`.
- If old fixtures still rely on `@modern-js/runtime/tanstack-router`, emit a temporary secondary augmentation only as a compatibility bridge and remove it when fixtures migrate.

## What Not To Port From PR #8317

Do not port these prototype changes:

- Root `package.json` and `pnpm-lock.yaml` churn.
- Prototype dependency versions: `@tanstack/react-router@1.161.4`, `@swc/helpers@^0.5.17`, `@rslib/core@0.19.6`, `@types/node@^20`, React `^19.2.4`, TypeScript `^5`.
- Prototype `tanstackTypes.ts` as-is. It lacks current `modernRouteAction` static-data handoff.
- Broad docs, Tailwind, create-template, or changeset files from the old branch.
- Fixture migration from `tests/integration/routes-tanstack*` in the scaffold slice.
- Any changes under dirty `tests/integration/routes-tanstack-mf/**`.
- Removal of current runtime router lifecycle hooks. They are generic core surfaces needed by the plugin.
- `presetMicroVerticals` or Module Federation SSR work. The current direction remains `presetUltramodern` plus later generic SSR/MF contracts.
- Old server SSR removal without an equivalent plugin-owned server implementation. Current `plugin.node.tsx` contains richer SSR behavior than the prototype.

## Verification Commands For First Scaffold Slice

Run these after the package scaffold is implemented and dependencies are installed. Start with package-local checks before touching fixtures:

```bash
pnpm --filter @modern-js/plugin-tanstack build
pnpm --filter @modern-js/plugin-tanstack test
pnpm --filter @modern-js/plugin-tanstack exec rstest tests/router/tanstackTypes.test.ts
pnpm --filter @modern-js/plugin-tanstack exec rstest tests/router/routeTree.test.ts
pnpm --filter @modern-js/plugin-tanstack exec rstest tests/router/dataMutation.test.tsx
pnpm lint:package-json
pnpm check-dependencies
```

Optional scaffold smoke checks:

```bash
node -e "console.log(require('./packages/runtime/plugin-tanstack/package.json').exports)"
pnpm --filter @modern-js/runtime test -- tests/router/lifecycle.test.tsx
```

Do not run or migrate integration fixtures for the first scaffold slice. Fixture activation belongs to `tplug-04`.

## Read-Only Commands Used

```bash
sed -n '1,240p' .codex/plans/tanstack-router-plugin-package.plan.md
sed -n '1,260p' .codex/reports/tpcore-01-runtime-core-audit.md
sed -n '1,260p' .codex/reports/tpcore-01-pr8317-plugin-prototype-audit.md
find packages/runtime -maxdepth 2 -name package.json -o -name tsconfig.json -o -name build.config.ts | sort
sed -n '1,240p' packages/runtime/plugin-i18n/package.json
sed -n '1,240p' packages/runtime/plugin-image/package.json
sed -n '1,260p' packages/runtime/plugin-runtime/package.json
find packages/runtime/plugin-i18n packages/runtime/plugin-image packages/runtime/render -maxdepth 3 -type f | sort
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/package.json
sed -n '1,220p' packages/runtime/plugin-i18n/rslib.config.mts
sed -n '1,220p' packages/runtime/plugin-i18n/tsconfig.json
sed -n '1,220p' packages/runtime/plugin-runtime/rslib.config.mts
find packages/runtime/plugin-runtime -maxdepth 2 -name 'rstest.config.*' -o -name 'rslib.config.*' -o -name 'tsconfig*.json' | sort
git ls-tree -r --name-only refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class -- packages/runtime/plugin-tanstack | sort
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/rslib.config.mts
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/rstest.config.ts
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/tsconfig.json
sed -n '1,220p' packages/runtime/plugin-runtime/rstest.config.mts
sed -n '1,220p' packages/runtime/plugin-runtime/tsconfig.json
find packages/runtime/plugin-runtime/src/router/runtime/tanstack -maxdepth 1 -type f -print | sort
find packages/runtime/plugin-runtime/tests/router -maxdepth 1 -type f | sort
rg -n "@modern-js/runtime/tanstack-router|modern-tanstack|modernRouteAction|writeTanstack|tanstack" packages/runtime/plugin-runtime/src/router packages/runtime/plugin-runtime/src/exports packages/runtime/plugin-runtime/tests/router --glob '!**/node_modules/**'
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/src/cli/index.ts
sed -n '1,460p' packages/runtime/plugin-runtime/src/router/cli/code/tanstackTypes.ts
sed -n '1,260p' packages/runtime/plugin-runtime/src/exports/tanstack-router.ts
sed -n '1,260p' packages/runtime/plugin-runtime/tests/router/tanstackTypes.test.ts
sed -n '1,220p' packages/runtime/plugin-runtime/tests/router/tanstackRouteTree.test.ts
sed -n '1,220p' packages/runtime/plugin-runtime/tests/router/dataMutation.test.tsx
sed -n '1,220p' package.json
sed -n '1,220p' pnpm-workspace.yaml
git status --short --branch
git show --stat --oneline --decorate -1 refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class
sed -n '180,360p' packages/runtime/plugin-runtime/package.json
sed -n '1,120p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.tsx
sed -n '1,140p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.node.tsx
sed -n '1,80p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/routeTree.ts
sed -n '1,90p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/dataMutation.tsx
sed -n '1,80p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/prefetchLink.tsx
sed -n '1,120p' packages/runtime/plugin-runtime/src/router/runtime/DefaultNotFound.tsx
sed -n '1,120p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/basepathRewrite.ts
sed -n '1,120p' packages/runtime/plugin-runtime/src/router/runtime/hooks.ts
sed -n '1,120p' packages/runtime/plugin-runtime/src/router/runtime/types.ts
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/src/runtime/index.tsx
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/src/runtime.ts
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/src/cli.ts
git show refs/remotes/bleedingdev/feat/tanstack-router-tailwind-first-class:packages/runtime/plugin-tanstack/src/runtime/hooks.ts
rg -n "^(import|export).*from" packages/runtime/plugin-runtime/src/router/runtime/tanstack packages/runtime/plugin-runtime/src/exports/tanstack-router.ts packages/runtime/plugin-runtime/src/router/cli/code/tanstackTypes.ts packages/runtime/plugin-runtime/tests/router/{tanstackTypes.test.ts,tanstackRouteTree.test.ts,dataMutation.test.tsx}
```
