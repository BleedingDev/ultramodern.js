# Ultramodern Full-Stack Subagent Workflow

## Handoff Bundle

- Main graph id: `ultramodern-full-stack-main-v1`
- Main selection hash: `d21fa81898`
- Main snapshot: `.codex/plan-graphs/ultramodern-full-stack-main-v1/snapshot.json`
- Main state dir: `.codex/plan-graphs/ultramodern-full-stack-main-v1`
- Main plan selection:
  - `.codex/plans/ultramodern-react-dom-client-shared-singleton.plan.md`
  - `.codex/plans/ultramodern-zephyr-profile-alignment.plan.md`
  - `.codex/plans/ultramodern-full-stack-microvertical.plan.md`
  - `.codex/plans/ultramodern-full-stack-version-switching-proof.plan.md`
- Main explicit edges:
  - `ultramodern-react-dom-client-shared-singleton:ultramodern-full-stack-microvertical`
  - `ultramodern-zephyr-profile-alignment:ultramodern-full-stack-microvertical`
  - `ultramodern-full-stack-microvertical:ultramodern-full-stack-version-switching-proof`
- Upstream-gated graph id: `ultramodern-mf-patch-removal-v1`
- Upstream-gated selection hash: `e5f9029ddf`
- Upstream-gated snapshot: `.codex/plan-graphs/ultramodern-mf-patch-removal-v1/snapshot.json`
- Upstream-gated plan:
  - `.codex/plans/ultramodern-module-federation-patch-removal.plan.md`
- Excluded from main runnable graph: `ultramodern-module-federation-patch-removal`, because it is upstream-gated and plan-graph validation correctly rejects it as an orphan when mixed into the main graph.

## Resolved Agent Limits

- `max_threads=50`
- `max_depth=3`
- Source: `/Users/satan/.codex/config.toml`

Use the high thread budget for parallel read-only scouts and verification lanes. Do not launch many simultaneous writers against the generator because the conflict hotspot is narrow.

## Goal

Turn Ultramodern into a full-stack micro-vertical template where each vertical is one versioned package containing Module Federation UI, Effect/BFF API, vertical-owned contract/client, Zephyr dependency metadata, build scripts, and topology metadata. Preserve mandatory DTS, Zephyr/Cloudflare deployability, and later Zerops long-running Node compatibility.

## Conflict Hotspots

Single-writer or serialized ownership is required for:

- `packages/toolkit/create/src/ultramodern-workspace.ts`
- `tests/integration/create-ultramodern-workspace/tests/index.test.ts`
- `packages/toolkit/create/template-workspace/scripts/validate-ultramodern-workspace.mjs.handlebars`
- `packages/toolkit/create/template-workspace/README.md.handlebars`
- `docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md`
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and `patches/*` for the upstream-gated patch-removal lane

Do not run two write-capable agents against the first three files at the same time.

## Launch Graph

### Wave 1: Wide Parallel Scouts Plus One Safe Writer

Launch all read-only scouts in parallel. Launch only one write-capable lane because both unblocked main plans target the same generator/test files.

| Lane | Mode | Dependencies | Ownership | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| A1 React DOM singleton writer | write-capable | none | `ultramodern-react-dom-client-shared-singleton`; owns `ultramodern-workspace.ts`, generated validator, create integration tests for this narrow change only | not launched | Spawn worker |
| A2 Zephyr profile evidence scout | read-only | none | Zephyr docs, package versions, ADR/test/generator mismatch evidence | not launched | Spawn explorer |
| A3 Zephyr plugin compatibility spike scout | read-only with temp files only | none | Build/config experiment in temp copy or disposable generated workspace; no repo edits | not launched | Spawn worker or explorer |
| A4 Split architecture map scout | read-only | none | current remote/service/shared-effect/topology/add-flow/test map | not launched | Spawn explorer |
| A5 Full-stack package contract scout | read-only | none | contract proposal from local code + Modern.js MF SSR + Effect/BFF constraints | not launched | Spawn explorer |
| A6 Zephyr switching/API proof scout | read-only | none | Zephyr dependency selectors, environment overrides, machine-readable evidence plan | not launched | Spawn explorer |
| A7 Zerops Node proof scout | read-only | none | `zerops.yaml`, start command, readiness, artifact rollback, scaling proof design | not launched | Spawn explorer |
| A8 MF patch upstream gate scout | read-only | none | PR 4755, releases, npm versions, local patch redundancy status | not launched | Spawn explorer |
| A9 Test command scout | read-only | none | exact focused test/build commands for changed packages and generated workspace | not launched | Spawn explorer |

Primary agent local work during Wave 1:

- Keep ownership of graph coordination and Beads.
- Review A1 patch as soon as it returns.
- Do not edit generator files while A1 is active.

### Wave 2: Zephyr Profile Decision And Serialized Generator Pivot

Start after A1 lands and after A2/A3 return.

| Lane | Mode | Dependencies | Ownership | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| B1 Zephyr profile implementation | write-capable | A2, A3, A1 integrated | ADR/generator/validator/tests/docs for selected Zephyr plugin profile | blocked | Spawn worker after A1 integration |
| B2 Full-stack model design integrator | read-only or local | A4, A5, B1 decision | final implementation contract and phased patch order | blocked | Keep local unless design conflict remains |

Primary agent should decide the Zephyr profile after A2/A3. Do not let a worker make the architectural choice without local synthesis.

### Wave 3: Full-Stack Generator Implementation Split

Start after B1 lands and the package contract is fixed. These lanes can be parallel only if the interface owner lands first or if non-owner lanes are initially read-only.

| Lane | Mode | Dependencies | Ownership | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| C1 Generator data model/interface owner | write-capable | B1, B2 | `ultramodern-workspace.ts` types/data model/package dependency helpers | blocked | Spawn worker, single owner |
| C2 Generated file content owner | write-capable after C1 | C1 | app/service file emitters for full-stack package, Effect contract/client/API files | blocked | Spawn worker after C1 patch |
| C3 Topology and overlay owner | write-capable after C1 | C1 | topology JSON generation, local overlays, remote/service metadata merge | blocked | Spawn worker after C1 patch |
| C4 Add-flow owner | write-capable after C1 | C1 | add-ultramodern default vertical flow and optional external-service behavior | blocked | Spawn worker after C1 patch |
| C5 Docs/readme/validator/test owner | write-capable after C2-C4 | C2, C3, C4 | tests, generated validator, README, docs assertions | blocked | Spawn worker after implementation lanes |

If C2/C3/C4 all need the same function body in `ultramodern-workspace.ts`, collapse them into one owner and use scouts for review only.

### Wave 4: Proof And Deployment Evidence

Start after full-stack generator gates pass.

| Lane | Mode | Dependencies | Ownership | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| D1 Local v1/v2 switching fixture | write-capable | C5 | generated fixture or test harness proving UI and API markers switch together locally | blocked | Spawn worker |
| D2 Zephyr live proof runner | verification-only, credential-gated | D1 | authenticated Zephyr proof, build logs, app UIDs, versions, manifests, runtime assertions | blocked | Spawn worker only when credentials/account ready |
| D3 Zerops proof artifact | write-capable docs/config | D1, A7 | `zerops.yaml` proof design or example, Node start/readiness/rollback docs | blocked | Spawn worker |
| D4 Final verifier | verification-only | D1-D3 | independent graph-level gate review and residual risk report | blocked | Spawn verifier |

## Node Prompts

### A1 React DOM Singleton Writer

Purpose: implement `react-dom/client` sharing for generated Ultramodern Module Federation configs.

Mode: write-capable.

Owns:

- `packages/toolkit/create/src/ultramodern-workspace.ts`
- `tests/integration/create-ultramodern-workspace/tests/index.test.ts`
- `packages/toolkit/create/template-workspace/scripts/validate-ultramodern-workspace.mjs.handlebars`

Do not edit:

- Zephyr plugin profile docs/config beyond assertions directly required for `react-dom/client`
- full-stack vertical structure
- topology/service generation
- package manager files

Required output:

- File paths changed.
- Exact behavior changed.
- GitHub API evidence for module-federation/core issue 4727.
- Verification commands run and results.
- Any blocked checks with exact failure.

Stop condition: generated shell and remote MF configs are asserted to include `react-dom/client` singleton, or implementation is blocked by an unexpected generator/test structure.

### A2 Zephyr Profile Evidence Scout

Purpose: collect current primary evidence for Zephyr Modern.js versus Rspack plugin profile.

Mode: read-only.

Owns:

- official docs evidence
- `pnpm view zephyr-modernjs-plugin version`
- `pnpm view zephyr-rspack-plugin version`
- local ADR/generator/validator/test mismatch map

Do not edit files.

Required output:

- Recommendation: official Modern.js plugin, Rspack wrapper, or unresolved.
- Exact source links and local file refs.
- Risks of each option.
- Tests that should prove the decision.

Stop condition: enough evidence exists for the primary agent to choose the profile or identify one missing runtime spike.

### A3 Zephyr Plugin Compatibility Spike Scout

Purpose: determine whether the official `zephyr-modernjs-plugin` path can preserve Module Federation manifest output and ordering for a generated shell plus remote.

Mode: read-only against repo; temp-file writes allowed under `/tmp` or an ignored generated workspace only.

Owns:

- disposable generated workspace or temp copy
- current wrapper build result
- official Modern.js plugin build result
- output artifact comparison, especially `mf-manifest.json`, `remoteEntry.js`, server/client outputs

Do not edit tracked repo files.

Required output:

- Commands run.
- Whether each plugin path builds.
- Artifact list comparison.
- Any error logs with enough context.
- Recommendation for B1.

Stop condition: one clear build comparison is available, or the spike is blocked by credentials/network/tooling and reports exact blocker.

### A4 Split Architecture Map Scout

Purpose: map every current code path that encodes split FE remote plus separate Effect service behavior.

Mode: read-only.

Owns:

- `ultramodern-workspace.ts` emitters/data structures
- create integration tests
- generated validator
- generated README/docs
- topology/add-flow paths

Do not edit files.

Required output:

- Table of local file refs with role and required change.
- Proposed change order.
- Any hidden secondary generators or tests.

Stop condition: full-stack implementation owner has a complete edit surface map.

### A5 Full-Stack Package Contract Scout

Purpose: define the target package contract before generator implementation.

Mode: read-only.

Owns:

- FE exposes
- Effect/BFF handlers
- vertical-owned contract/client exports
- server-only versus browser-safe module boundaries
- Modern.js MF SSR constraints
- package scripts and dependencies

Do not edit files.

Required output:

- Concrete target package tree.
- `package.json` dependency/script contract.
- `modern.config.ts` plugin/config contract.
- `module-federation.config.ts` exposes/shared/remotes contract.
- Explicit things that must not be exposed to browser MF.

Stop condition: C1/C2 can implement without inventing the contract.

### A6 Zephyr Switching/API Proof Scout

Purpose: design the Zephyr proof with machine-readable evidence, not screenshots.

Mode: read-only.

Owns:

- Zephyr `zephyr:dependencies` selectors
- `workspace:*`, exact versions, labels/environments, environment overrides
- application UID and manifest evidence
- runtime UI/API marker assertion plan

Do not edit files.

Required output:

- Proof matrix for v1/v2 UI and API markers.
- Exact data to capture.
- CLI/API/dashboard steps, clearly distinguishing public API from GUI-only operations.
- Failure conditions.

Stop condition: D1/D2 know exactly what to prove.

### A7 Zerops Node Proof Scout

Purpose: design future Zerops long-running Node proof for the same full-stack vertical package.

Mode: read-only.

Owns:

- Zerops Node docs
- `zerops.yaml` shape
- build commands, deploy files, runtime ports, start command
- readiness and rollback behavior
- Cloudflare-only assumptions to avoid

Do not edit files.

Required output:

- Minimal `zerops.yaml` proposal.
- Required generated package outputs for Zerops.
- Readiness endpoint proposal.
- Rollback/version assertion plan.

Stop condition: D3 can produce docs/config without re-researching Zerops basics.

### A8 MF Patch Upstream Gate Scout

Purpose: evaluate whether local Module Federation patches can be removed yet.

Mode: read-only.

Owns:

- `gh api repos/module-federation/core/pulls/4755`
- latest Module Federation release and npm package versions
- local `pnpm-workspace.yaml` patchedDependencies and `patches/*`

Do not edit files.

Required output:

- Current PR/release/npm state.
- Whether removal is safe now.
- If unsafe, exact condition that unblocks it.
- If safe, exact implementation steps for the separate patch-removal graph.

Stop condition: upstream-gated graph has current status and next action.

### A9 Test Command Scout

Purpose: identify precise quality gates for each wave.

Mode: read-only.

Owns:

- package scripts
- nearest tests for create-ultramodern-workspace
- generated workspace build/check commands
- MF DTS assertions
- Zephyr proof opt-in command shape

Do not edit files.

Required output:

- Per-lane command list with expected runtime and credentials requirements.
- Fast smoke gates versus full gates.
- Any currently broken/unavailable commands.

Stop condition: each write lane has a proportionate test command.

## Merge Protocol

1. Integrate A1 first. Run its focused tests before B1 starts.
2. Synthesize A2/A3 locally. Update B1 prompt with the chosen Zephyr profile.
3. Integrate B1 before C1 starts. Do not let C1 implement against an unstable Zephyr profile.
4. Integrate C1 before C2/C3/C4. C1 owns the shared model and function contracts.
5. After C2/C3/C4, run a focused generator smoke before C5 updates tests/docs broadly.
6. After C5, run the full generator gate and only then start D proof lanes.

## Reattach Commands

Main graph frontier:

```bash
python /Users/satan/side/experiments/skills/plan-graph/scripts/plan_graph.py frontier \
  --graph-id ultramodern-full-stack-main-v1 --format json --lanes 8 --max-depth 8 \
  --plan ./.codex/plans/ultramodern-react-dom-client-shared-singleton.plan.md \
  --plan ./.codex/plans/ultramodern-zephyr-profile-alignment.plan.md \
  --plan ./.codex/plans/ultramodern-full-stack-microvertical.plan.md \
  --plan ./.codex/plans/ultramodern-full-stack-version-switching-proof.plan.md \
  --depends ultramodern-react-dom-client-shared-singleton:ultramodern-full-stack-microvertical \
  --depends ultramodern-zephyr-profile-alignment:ultramodern-full-stack-microvertical \
  --depends ultramodern-full-stack-microvertical:ultramodern-full-stack-version-switching-proof
```

Upstream-gated graph frontier:

```bash
python /Users/satan/side/experiments/skills/plan-graph/scripts/plan_graph.py frontier \
  --graph-id ultramodern-mf-patch-removal-v1 --format json --lanes 2 --max-depth 6 \
  --plan ./.codex/plans/ultramodern-module-federation-patch-removal.plan.md
```
