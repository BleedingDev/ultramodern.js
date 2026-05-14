# tpcore-01 MF Fixture Dirty Patch Audit

Graph: `tanstack-plugin-first-class-ssr`
Plan: `tanstack-plugin-core-hooks.plan.md`
Todo: `tpcore-01`
Downstream: `tanstack-plugin-ssr-mf-contract.plan.md` / `tpssr-01`

## Scope

This report audits the existing uncommitted `tests/integration/routes-tanstack-mf/**` patch only. No source, test, plan, or Beads files were modified as part of the audit.

The patch is useful as evidence that the fixture can express shell SSR and name the missing MF remote-render seam, but it is not plugin-compatible yet. It still relies on TanStack support embedded in `@modern-js/runtime`, while the desired architecture from PR #8317 is `@modern-js/plugin-tanstack` plus generic core hooks.

## Commands Used

```bash
git status --short -- tests/integration/routes-tanstack-mf .codex/reports/tpcore-01-mf-fixture-dirty-patch-audit.md
git diff --name-only -- tests/integration/routes-tanstack-mf
git diff --stat -- tests/integration/routes-tanstack-mf
git diff -- tests/integration/routes-tanstack-mf/mf-host/modern.config.ts tests/integration/routes-tanstack-mf/mf-remote/modern.config.ts tests/integration/routes-tanstack-mf/mf-remote-2/modern.config.ts
git diff -- tests/integration/routes-tanstack-mf/mf-host/module-federation.config.ts tests/integration/routes-tanstack-mf/mf-remote/module-federation.config.ts tests/integration/routes-tanstack-mf/mf-remote-2/module-federation.config.ts
git diff -- tests/integration/routes-tanstack-mf/mf-host/src/routes/mf/page.tsx
git diff -- tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts
git diff -- tests/integration/routes-tanstack-mf/test/index.test.ts
git diff -- tests/integration/routes-tanstack-mf/test/deploy-certification.test.ts
sed -n '1,220p' .codex/plans/tanstack-plugin-core-hooks.plan.md
sed -n '1,240p' .codex/plans/tanstack-plugin-ssr-mf-contract.plan.md
sed -n '1,220p' .codex/reports/tanstack-plugin-ssr-hooks-pr8317-20260514.md
rg -n "@modern-js/plugin-tanstack|tanstackRouterPlugin|@modern-js/runtime/tanstack|modernRouteAction|remote-ssr-contract-gap|moduleFederationAppSSR|treeShaking" packages/runtime tests/integration/routes-tanstack-mf -g '!**/node_modules/**'
find tests/integration/routes-tanstack-mf -maxdepth 3 -name package.json -o -name modern.config.ts -o -name module-federation.config.ts | sort
sed -n '1,220p' tests/integration/routes-tanstack-mf/mf-host/package.json
sed -n '1,220p' tests/integration/routes-tanstack-mf/mf-remote/package.json
sed -n '1,220p' tests/integration/routes-tanstack-mf/mf-remote-2/package.json
sed -n '1,220p' tests/integration/routes-tanstack-mf/mf-host/src/modern-tanstack/index/router.gen.ts
```

## Per-File Classification

| File | Classification | Reason |
| --- | --- | --- |
| `tests/integration/routes-tanstack-mf/mf-host/modern.config.ts` | should-land-after-plugin | Enabling `server.ssr.mode = 'string'` and `moduleFederationAppSSR = true` is the correct fixture direction for shell SSR, but it should be reintroduced after the TanStack router behavior is plugin-owned so the fixture proves plugin integration rather than core TanStack coupling. |
| `tests/integration/routes-tanstack-mf/mf-remote/modern.config.ts` | should-land-after-plugin | Same as host. Remote SSR intent is useful, but remote server render semantics need the plugin/core SSR hook seam before this becomes meaningful contract coverage. |
| `tests/integration/routes-tanstack-mf/mf-remote-2/modern.config.ts` | should-land-after-plugin | Same as first remote. Keep the explicit SSR configuration in the later plugin fixture cleanup if it remains necessary after hook extraction. |
| `tests/integration/routes-tanstack-mf/mf-host/module-federation.config.ts` | needs cleanup | Reading installed React/ReactDOM versions is defensible for deterministic singleton contracts, but disabling shared tree shaking for React, ReactDOM, TanStack Router, and runtime is broad and currently unproven. This may hide a real SSR/MF integration bug instead of specifying the hook seam. |
| `tests/integration/routes-tanstack-mf/mf-remote/module-federation.config.ts` | needs cleanup | Same tree-shaking and version-resolution concerns as host. Any `treeShaking: false` requirement should be justified by a focused failing contract or moved into a separate MF SSR compatibility patch. |
| `tests/integration/routes-tanstack-mf/mf-remote-2/module-federation.config.ts` | needs cleanup | Same as first remote. Do not land the blanket tree-shaking change as part of `tpssr-01` unless it is the minimal reproducible condition for server remote rendering. |
| `tests/integration/routes-tanstack-mf/mf-host/src/routes/mf/page.tsx` | useful seam evidence | The `remote-ssr-contract-gap` marker with `data-runtime-seam="tanstack-mf-server-remote-render"` is valuable. It clearly distinguishes shell SSR from missing remote component SSR and names the missing runtime/plugin boundary. This is the strongest part of the patch. |
| `tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts` | needs cleanup | The executable gap matrix is useful, but the file also adds duplicated `plugin-data-loader` build bootstrapping and retry logic. The matrix should survive; the helper churn should not be copied into the plugin-ready patch unless factored into a shared test utility or replaced by correct workspace build prerequisites. |
| `tests/integration/routes-tanstack-mf/test/index.test.ts` | needs cleanup | The browser expectation change correctly targets shell SSR plus remote fallback metadata, but the worker reported the browser run was stopped and Puppeteer setup was not completed. It also duplicates build prerequisite and `ENOTEMPTY` retry logic. Keep as guidance, not landable code. |
| `tests/integration/routes-tanstack-mf/test/deploy-certification.test.ts` | needs cleanup | The deploy certification assertions mirror the desired seam, but they are unverified and include the same broad build-helper churn. This should wait until the plugin fixture path passes normal browser integration. |

No file in this dirty patch is an outright reject on intent. The rejectable parts are the broad helper duplication and unproven MF shared tree-shaking workaround, not the shell SSR seam itself.

## Risks

- The fixture currently proves TanStack behavior through `@modern-js/runtime/tanstack-router`; that is explicitly the architecture ByteDance pushed back on in PR #8317.
- `router.gen.ts` still imports TanStack helpers from `@modern-js/runtime/tanstack-router`; after plugin extraction, generated code should import from `@modern-js/plugin-tanstack/runtime` or a plugin-owned generated runtime surface.
- The patch can be misread as "MF remote SSR works" when it actually proves only shell SSR plus deterministic placeholders.
- Blanket `treeShaking: false` for shared packages may mask a Module Federation SSR bug or create a larger bundle behavior change unrelated to TanStack plugin hooks.
- The duplicated `ensurePluginDataLoaderRuntimeBuilt()` helpers encode local build-order assumptions into three test files.
- Browser and deploy certification expectations were edited before a completed browser/deploy verification pass.
- The fixture packages still depend on `@modern-js/runtime` and do not declare or configure `@modern-js/plugin-tanstack`, so they cannot validate first-class plugin architecture yet.

## Verification Gaps

- No completed `routes-tanstack-mf/test/index.test.ts` browser run with a working Chrome/Puppeteer setup was recorded for this dirty patch.
- No completed `deploy-certification.test.ts` run was recorded after the shell SSR expectation changes.
- No test currently proves that generic core hooks can host TanStack SSR without importing TanStack packages from `@modern-js/runtime`.
- No test currently proves server-side MF remote component rendering; the fixture only emits placeholder/fallback markers.
- No focused test proves whether `treeShaking: false` is necessary for SSR or only a workaround for the current dirty state.
- No plugin package, plugin config, or plugin runtime import path is present in the fixture package metadata.

## Must Wait For `@modern-js/plugin-tanstack`

- Plugin-owned route generation and generated imports. The fixture should stop using generated imports from `@modern-js/runtime/tanstack-router`.
- Plugin-owned loader/action handoff. `modernRouteAction` is useful, but the generated static-data bridge should be emitted by the plugin generator after extraction.
- Plugin-owned SSR lifecycle participation: memory history creation, router load, matched-route snapshot, dehydrated data, hydration scripts, and cleanup.
- Generic core SSR hooks that let a router plugin participate without TanStack dependencies in runtime core.
- MF server remote render or fallback hook. The named seam is `tanstack-mf-server-remote-render`; the plugin needs a way to resolve/render server-capable remotes or emit typed fallback metadata before hydration.
- Fixture package/config updates that explicitly enable `@modern-js/plugin-tanstack` in host and remotes.

## Minimal Cleanup Path For `tpssr-01`

1. Do not land the current dirty patch as-is.
2. After `tpcore-*` and the plugin package slice provide the generic hooks plus `@modern-js/plugin-tanstack`, recreate the fixture patch from a clean base.
3. Keep only the minimal shell SSR seam first: explicit SSR config, plugin enablement, and the `remote-ssr-contract-gap` marker with deterministic placeholder metadata.
4. Move generated TanStack imports and static-data handoff to the plugin runtime/generator before changing browser/deploy assertions.
5. Drop duplicated `ensurePluginDataLoaderRuntimeBuilt()` helpers from fixture tests. If a build prerequisite is still needed, solve it once through a shared test helper or workspace setup.
6. Revert blanket `treeShaking: false` unless a focused failing SSR/MF test proves it is required. If required, land it as a separate compatibility rationale with a narrow assertion.
7. Start verification with `tanstack-mf-contract.test.ts`, then run the browser integration test with explicit `PUPPETEER_EXECUTABLE_PATH` if local Chrome discovery is unreliable.
8. Only after browser integration passes, update `deploy-certification.test.ts` expectations and run the deploy certification path.
9. If remote component SSR still cannot work through existing MF runtime APIs, stop at the explicit fallback contract and file the exact MF runtime seam rather than expanding the fixture patch.

