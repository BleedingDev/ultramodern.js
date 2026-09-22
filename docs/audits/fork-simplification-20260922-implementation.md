# Fork simplification, 22 September 2026

Implemented in `0dee65d737..bc67fd6e7b`. Vanilla ownership remains based on `eded841256`; budgets and provenance were not reset.

| Area | Simplification |
|---|---|
| Workspace | One prepared transaction supplies preview and apply; reuse normalized ownership and configuration. |
| Validator | Typed installed modules replace executable Handlebars and temporary rendered programs. |
| Scaffold | Shared remote rendering and named template inputs replace repeated bodies and positional fields. |
| Routes | One descriptor feeds runtime routes and emitted types; preserve both routers and localized splats. |
| Router | Explicit navigation capabilities, immutable SSR metadata and request-owned cleanup. |
| BFF | Shared producer/operation identity and batch defaults; preserve native Effect types and Hono defaults. |
| Federation | Shared bounded acquisition and identity checks; preserve cancellation, integrity and platform adapters. |
| Build | Shared remote-address policy and source analysis; installed app TypeScript bundles correctly. |
| Governance | Structured ledger evidence and shared ownership classification; historical evidence still works. |
| Release | Fixed script entrypoints and shared registry reads replace inline programs and repeated verification. |
| Tests | Explicit prerequisite builds and actual packed installs replace mutable-dist locks and flattened dependencies. |
| Supply | One patch inventory and deterministic sidecar reconstruction replace duplicated inventories and store-dependent checks. |

The per-app route worker remains because Module Federation captures its working directory at import and app-tools has process-global lifecycle state. Each app needs a fresh process with native cleanup.

## Verification at the implementation commit

- All 47 build tasks, repository lint, ten strict TypeScript configurations and both fork-boundary checks passed.
- Packed consumers passed with framework sources removed and `NODE_PATH` cleared: two BFF cases and three workspace cases. Four retained browser cases and three prerequisite cases also passed.
- Tractor passed all 15 acceptance checks, including Node/workerd distributed SSR, JavaScript-disabled rendering and visible shopping. Proof used local servers and a local registry with 46 framework packages and three sidecars. The configured demo checkout was absent, so the runner used pinned revision `28a3e4d363226b5d4e08576a21fe83583e4d736a`. Browser proof covered `/en`; separate framework suites covered locale behavior.
- Tractor framework source: `5438498b2d0354d4a4396d802ef0b166f0a08cff`. Cohort digest: `64ae52d47224065eaca03cd154f8ce59b65a9465a23c9db17da19c3f68bed700`. Nothing was published.

The original audit, full acceptance JSON and completed plans remain in Git at `bc67fd6e7b`. They were removed from the working tree after completion. Recover the full report with `git show bc67fd6e7b:docs/audits/fork-simplification-20260922-tractor.json`.

## Measurements and remaining work

Before the subsequent paperwork/test cleanup, the implementation removed 1,181 net production/template lines, added 1,180 test/harness lines and added 593 dependency-patch lines. These exclude audit and tracking artifacts. Native divergence grew by 88 lines, largely regression tests, to 50,970 lines; the required same-PR ledger evidence was recorded.

Beads `modernjs-wuutt` records completed implementation. Open follow-up `modernjs-wuutt.15` covers unproved replacements for Zephyr leases, public-path rewriting, declaration repair, drain ownership and artifact rediscovery, plus a package-scoped resolver and the obsolete ownership recognizer. Current features, database migrations and platform interoperability remain required.
