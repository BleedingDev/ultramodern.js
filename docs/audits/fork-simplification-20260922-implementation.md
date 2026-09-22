# Fork simplification implementation

Implementation baseline: `0dee65d737` (framework source `ba2f373ad9`). First implementation checkpoint: `6669146287`. The fixed vanilla ownership base remains `eded841256`; no ownership scope or provenance reset was made.

## Changes

Twelve parallel owners implemented the selected graph, with separate independent semantic reviews and root-controlled builds. The cuts remove competing decisions and executable template machinery; current application features and platform boundaries remain acceptance requirements.

| Area | Removed machinery | Preserved contract |
|---|---|---|
| Workspace | Double preview staging, handwritten JSON mutation summaries, repeated config reads | Preview/apply bytes, authored files, modes, symlinks, concurrent edits and recovery |
| Validator | Executable Handlebars validator, reconstructed ghost contract, temporary rendered commands | Installed policy, real filesystem checks, compiler checks, cohort/patch parity and authored proof inputs |
| Scaffold | Three repeated remote bodies and positional template inputs | 21 byte-identical generated outputs, native links and visible markup |
| Routes | Locale expansion/collapse and conflicting root/pathless/index rules | Physical React Router routes, canonical TanStack routes, localized splats and emitted navigation types |
| Router | Framework-shape guessing and copied live snapshot metadata | Native provider capabilities, immutable SSR snapshot, stream lifetime and active-loader cancellation |
| BFF | Competing producer lookups, hash projections, entry resolvers and batch defaults | Native Effect inference, source-free SDK identity, Hono default identity, auth/cancel/dedup/replay policy |
| Federation | Repeated acquisition/cancellation and identity interpretation | Exact bytes, SHA-256, whole-operation budgets, redirects, platform differences and nonblocking fallback telemetry |
| Build | Generated remote URL algorithm, repeated parser/scope mechanics and SSR inference | Explicit production addresses, local development, app-copy priority and conditional exports |
| Governance | Parallel ownership classification and current Markdown evidence parsing | Fixed audited identity, semantic same-PR evidence, fail-closed budgets and historical ledger reading |
| Release | Six inline programs, duplicate registry transport, manifest parsing and receipt checks | OIDC/job separation, exact artifacts, provenance, attempt identity and propagation budget |
| Tests | Implicit build locks/caches and all-to-all dependency links | One prerequisite owner, actual packed dependency graphs, Windows spawning and retained browser assertions |
| Supply | Repeated patch inventories and incidental-store verification | One integrity-pinned inventory, deterministic sidecars, executable modes, licenses and image behavior |

The static per-app route worker remains intentionally: Module Federation captures the working directory when imported, and app-tools owns process-global lifecycle state. Each app receives a fresh process and native cleanup. The worker is packaged source, not a rendered temporary program.

## Verification

The initial baseline passed 106 focused tests and all 47 prerequisite build tasks. After implementation, all 47 build tasks passed again, repository-wide Biome passed, and all ten strict Effect/TypeScript configurations passed. Each lane ran its retained behavior suites; counts overlap and are not presented as one inflated total.

Independent reviews caught and led to fixes for implicit Hono identity, extracted release bindings, React Router publication, active-loader cancellation, localized wildcard types, and formatting-only ledger authorization. Actual packed installation exposed injected-workspace TypeScript externalization, which is fixed in the fork-owned loader; both CJS and ESM regressions and production BFF serving pass.

The final source-isolated packed suites passed: two BFF cases and three workspace cases. They use real generated dependency manifests, strip first-party framework source directories and clear `NODE_PATH`; they cover installed validation, route generation with natural process exit, generated route artifacts, production serving/building, mixed-cohort rejection, undeclared-import rejection and public exports. All four retained portfolio browser cases and three prerequisite-runner checks passed.

The [Tractor acceptance report](fork-simplification-20260922-tractor.json) passed against framework revision `5438498b2d0354d4a4396d802ef0b166f0a08cff`, with 46 framework packages and three stable sidecars staged into a local registry. The report records the exact cohort digest and artifact identity. Both Node and workerd passed distributed server rendering, JavaScript-disabled HTML checks and the visible shopping workflow. The runner also passed frozen installation, formatting, type/architecture checks, builds and backend federation. Its browser routes use `/en`; this is not a claim of additional-locale browser coverage. Framework locale suites provide separate coverage. No package was published.

The fixed-scope boundary check and same-PR allowlist-governance check passed. Supported budget recording preserves the fixed vanilla base: 816 files, 3,076 hunks and 50,970 divergent lines. Divergence grew by 88 lines, largely native regression tests, with five current ledger entries covering non-shrink native changes. This work does not claim reduced canonical native divergence.

## Measured cuts

Compared with implementation baseline `0dee65d737`, counting both sides of changed files with rename detection disabled:

| Category | Before | After | Net |
|---|---:|---:|---:|
| Production code and executable templates | 33,396 | 32,215 | **−1,181** |
| Tests and harnesses | 16,906 | 18,086 | +1,180 |
| Dependency patch files | 536 | 1,129 | +593 |
| Manifests and lockfiles | 37,687 | 37,687 | 0 |
| Other changed declarative/docs files | 6,463 | 6,332 | −131 |

These are changed-file populations, not whole-repository totals. Production includes JS/TS and Handlebars; tests are classified first by test directories or test/spec filenames. Patch assets include the canonical Drizzle declaration patch and the Module Federation ESM correction. Beads, execution plans, this audit directory and the divergence ledger are excluded. Tests and patches outweigh the production reduction; there is no claim of a net repository line reduction.

## Qualified decisions

No worker wrappers were added around upstream or external Cloudflare aliases. Historical Markdown ledger reading and the distinct AST policy check remain because deleting them would weaken historical evidence or inline-policy enforcement. Governance improves authority and maintainability but is not a net line reduction.

Follow-up `modernjs-wuutt.15` retains unproved replacements, the evidenced broad module-root resolver leak, and a dead ownership recognizer whose retained synthetic test requires explicit test-selection approval. No prior test purge or retired framework migration/Effect-generation system was restored.

The configured Tractor checkout was absent. Acceptance used a clean disposable checkout of workflow-pinned revision `28a3e4d363226b5d4e08576a21fe83583e4d736a`, preserving its visible UI. All proof requests targeted local servers. The report records the resulting acceptance application commit; no demo change was pushed. Existing unrelated Beads edits were kept outside implementation commits.
