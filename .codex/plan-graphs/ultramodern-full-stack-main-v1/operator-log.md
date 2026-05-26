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
| A1 React DOM singleton writer | write-capable local | none | `ultramodern-react-dom-client-shared-singleton`; owns `ultramodern-workspace.ts`, generated validator, create integration tests for this narrow change only | completed locally | Integrate with next gates |
| A2 Zephyr profile evidence scout | read-only, Curie `019e615b-ef60-7ee2-882d-03f59f42c8ca` | none | Zephyr docs, package versions, ADR/test/generator mismatch evidence | completed | Await A3 before B1 decision |
| A3 Zephyr plugin compatibility spike scout | read-only with temp files only, Bohr `019e615c-1405-7ad3-b405-e4de5b362789` | none | Build/config experiment in temp copy or disposable generated workspace; no repo edits | completed | Official `zephyr-modernjs-plugin` preserves local MF artifacts; live Zephyr extraction remains a deployment gate |
| A4 Split architecture map scout | read-only, Hypatia `019e615d-5dad-77f0-b3f3-2656e80dfbb6` | none | current remote/service/shared-effect/topology/add-flow/test map | completed | Use fixture proof for full-stack MF+BFF package pivot |
| A5 Full-stack package contract scout | read-only, Linnaeus `019e615d-7332-79f3-a9ce-a25c79c674d1` | none | contract proposal from local code + Modern.js MF SSR + Effect/BFF constraints | completed | Use package contract for C lanes |
| A6 Zephyr switching/API proof scout | read-only, McClintock `019e615d-869b-7033-9df9-3c480de940a1` | none | Zephyr dependency selectors, environment overrides, machine-readable evidence plan | completed | Use `zephyr:dependencies`, `ZE_ENV`, env overrides, topology overlays; no internal API automation |
| A7 Zerops Node proof scout | read-only, Fermat `019e615d-97d5-7580-b682-280bec6a8f50` | none | `zerops.yaml`, start command, readiness, artifact rollback, scaling proof design | completed | Carry Node deploy artifact/health/start contract into D3 |
| A8 MF patch upstream gate scout | read-only, Mendel `019e615d-a84e-7bd1-9049-e5cbbfcad9ae` | none | PR 4755, releases, npm versions, local patch redundancy status | completed | Keep local patches until PR 4755 merges and a newer MF release ships |
| A9 Test command scout | read-only, Chandrasekhar `019e615d-b805-7a73-9bce-a5f6469e238b` | none | exact focused test/build commands for changed packages and generated workspace | completed | Focused create integration and preflight gates are active |

Primary agent local work during Wave 1:

- Keep ownership of graph coordination and Beads.
- Review A1 patch as soon as it returns.
- Do not edit generator files while A1 is active.

### Wave 2: Zephyr Profile Decision And Serialized Generator Pivot

Start after A1 lands and after A2/A3 return.

| Lane | Mode | Dependencies | Ownership | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| B1 Zephyr profile implementation | write-capable local | A2, A3, A1 integrated | ADR/generator/validator/tests/docs for selected Zephyr plugin profile | completed | Integrated into generator, validator, tests, and preflight |
| B2 Full-stack model design integrator | read-only or local | A4, A5, B1 decision | final implementation contract and phased patch order | ready | Start next after checkpoint |

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

### Wave 3 Active Relaunch: Full-Stack Generator And Parallel Readiness

Started after the React DOM singleton and Zephyr profile lanes landed in commit `b3dd9ac352`.

| Lane | Mode | Dependencies | Ownership | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| FS-C1 Generator owner, Bernoulli `019e6179-7383-7af0-b0e0-6c882311accb` | write-capable | discovery/contract complete | `packages/toolkit/create/src/ultramodern-workspace.ts`; plan statuses for generator/model/topology/add-flow todos only | completed | Landed full-stack vertical generator model/files/topology/add-flow |
| FS-C5 Tests/validator/docs owner, Ptolemy `019e6179-a1be-7550-8adc-f556f4069f0c` | write-capable | target contract fixed; generator may still be in flight | create integration test, generated validator, contract doctor, generated README | completed | Landed full-stack tests, validator, contract doctor, README |
| FS-D1 Version proof designer, Halley `019e6179-c559-7450-b551-2d7753fa5274` | read-only | full-stack implementation not landed | proof matrix, local simulation design, Zephyr/Zerops evidence shape | completed | Feed into next version-switching implementation graph |
| FS-MF-GATE Patch gate, Planck `019e6179-de7f-7900-9691-3171f7de7ab2` | read-only | upstream release availability | PR 4755/release/npm status; local patch removal gate | completed-blocked | PR 4755 still unreleased; keep patches |
| FS-ZE-LIVE Zephyr live evidence, Volta `019e6179-f68b-77f2-b8f3-ed6945c80af1` | read-only | official plugin landed; live credentials not used | opt-in Zephyr proof workflow and evidence bundle | completed | Feed into next live Zephyr proof lane |
| FS-ADD-FLOW Add-flow scout, Bacon `019e617a-0dee-7930-88a9-6311ac1693fd` | read-only | none | add-flow case matrix and generated-file expectations | completed | Full-stack remote add-flow covered; explicit service flow preserved |
| FS-CTX-OTEL Context/telemetry scout, Descartes `019e617a-251d-7c11-9573-8571c55ff763` | read-only | none | OperationContext and default OTel/fallback event design | completed | Feed into version-switching/runtime proof |
| FS-SUPPLY Supply-chain scout, Euler `019e617a-425c-7c32-b35b-68888d2c3e61` | read-only | add-flow hardening later | package/publication surface and trusted publishing blockers | completed | Feed into publish readiness follow-up |

### Wave 3 Completion

Full-stack generator lane completed and verified from the parent workspace:

- focused create-ultramodern-workspace Rstest: pass
- contract doctor, local control-plane, and preflight unit tests: pass
- generated workspace validator: pass
- contract doctor against generated workspace: pass
- Biome check on changed files: pass
- `@modern-js/create` build/DTS gate: pass

### Wave 4: Proof And Deployment Evidence

Start after full-stack generator gates pass.

| Lane | Mode | Dependencies | Ownership | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| D1 Local v1/v2 switching fixture | write-capable | C5 | generated fixture or test harness proving UI and API markers switch together locally | blocked | Spawn worker |
| D2 Zephyr live proof runner | verification-only, credential-gated | D1 | authenticated Zephyr proof, build logs, app UIDs, versions, manifests, runtime assertions | blocked | Spawn worker only when credentials/account ready |
| D3 Zerops proof artifact | write-capable docs/config | D1, A7 | `zerops.yaml` proof design or example, Node start/readiness/rollback docs | blocked | Spawn worker |
| D4 Final verifier | verification-only | D1-D3 | independent graph-level gate review and residual risk report | blocked | Spawn verifier |

### Wave 4 Active Execution

Started after full-stack generator commit `b7e8edc72b`; artifact commits landed on `bleedingdev/main-ultramodern`.

| Lane | Mode | Agent | Ownership | Status | Result |
| --- | --- | --- | --- | --- | --- |
| D1 Local v1/v2 switching fixture | write-capable | Maxwell `019e618d-d37a-7691-b490-d34fa1836e48` | `scripts/ultramodern-version-switching/**` | completed | Added deterministic matrix CLI, local HTTP proof, skew failure, and archive output in commit `fbd6bd780a` |
| D2 Zephyr live evidence harness | write-capable | Arendt `019e618d-d456-7ee1-8022-873deea8faaf` | `scripts/ultramodern-zephyr-live-evidence/**` | completed-blocked-live | Added opt-in dry-run/live harness, schema, README, redaction, and command plan in commit `0522941533`; authenticated live capture remains blocked on Zephyr config/credentials |
| D3 Zerops proof artifact | write-capable | Beauvoir `019e618d-d55d-7311-b4d4-c641b025c55d` | `docs/super-app-rfc-adr/ZEROPS-0001-ultramodern-full-stack-node-proof.md` | completed | Added Zerops long-running Node proof design in commit `a978b0768b` |

Parent verification after pulling all Wave 4 commits:

- `node --test scripts/ultramodern-version-switching/__tests__/run-version-switching-proof.test.js scripts/ultramodern-zephyr-live-evidence/__tests__/run-zephyr-live-evidence.test.js`: pass
- `pnpm exec biome check scripts/ultramodern-version-switching scripts/ultramodern-zephyr-live-evidence`: pass
- `node scripts/ultramodern-version-switching/run-version-switching-proof.js --case matrix`: pass
- `node scripts/ultramodern-zephyr-live-evidence/run-zephyr-live-evidence.js --dry-run --out /tmp/modernjs-zephyr-evidence-smoke.json`: dry-run pass
- `node scripts/ultramodern-zephyr-live-evidence/run-zephyr-live-evidence.js --live --out /tmp/modernjs-zephyr-live-blocked.json`: blocked as expected without `ZE_ENV`, Zephyr token/user, app UIDs, selectors, manifest/runtime URLs, and API assertion URLs

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
