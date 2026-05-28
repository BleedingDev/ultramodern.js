# Ultramodern Real Tractor Subagent Graph

Graph state:

- Graph id: `ultramodern-real-tractor-v1`
- Selection hash: `ce96e75dc0`
- Snapshot: `.codex/plan-graphs/ultramodern-real-tractor-v1/snapshot.json`
- Plans: `.codex/plans/ultramodern-real-tractor-*.plan.md`
- Agent budget: `max_threads=50`, `max_depth=3`
- Recommended active cap: 6 agents, keeping the root agent on synthesis, integration, and final verification

User-visible goal:

Build and validate a real Tractor-style Ultramodern micro-vertical proof. Explore, Decide, and Checkout must be separate full-stack packages with their own frontend, Effect/BFF surface, i18n assets, MF exposes, styling ownership, and deployment/version metadata. Visual boundaries must reflect actual Module Federation package ownership, not simulated in-process sections.

Non-negotiables:

- No source-content tests or equivalent checks against implementation text.
- No simulated or virtual module boundaries.
- No disabling backend or i18n to make deployment easier.
- Cloudflare must run the proof now; Zephyr is the multi-cloud/versioning layer to validate against, not a replacement for runtime correctness.
- Shared packages, shared styling primitives, and platform services may exist, but domain behavior belongs to the owning micro-vertical.
- `packages/toolkit/create/src/ultramodern-workspace.ts` is single-writer unless the root agent explicitly serializes patches.

Canonical plan DAG:

```text
00 Boundary Contract
  -> 01 Generator Topology
  -> 02 MF Composition Runtime
  -> 03 Federated CSS
  -> 04 Full Stack Effect
  -> 05 Routing i18n
02 + 04 -> 06 Zephyr Cloudflare Version Proof
02 + 03 + 04 + 05 + 06 -> 07 Validation Gates
07 -> 08 Docs Adoption
```

Explicit dependency edges:

```text
ultramodern-real-tractor-00-boundary-contract -> ultramodern-real-tractor-01-generator-topology
ultramodern-real-tractor-00-boundary-contract -> ultramodern-real-tractor-02-mf-composition-runtime
ultramodern-real-tractor-00-boundary-contract -> ultramodern-real-tractor-03-federated-css
ultramodern-real-tractor-00-boundary-contract -> ultramodern-real-tractor-04-full-stack-effect
ultramodern-real-tractor-00-boundary-contract -> ultramodern-real-tractor-05-routing-i18n
ultramodern-real-tractor-01-generator-topology -> ultramodern-real-tractor-02-mf-composition-runtime
ultramodern-real-tractor-01-generator-topology -> ultramodern-real-tractor-04-full-stack-effect
ultramodern-real-tractor-01-generator-topology -> ultramodern-real-tractor-05-routing-i18n
ultramodern-real-tractor-02-mf-composition-runtime -> ultramodern-real-tractor-06-zephyr-cloudflare-version-proof
ultramodern-real-tractor-04-full-stack-effect -> ultramodern-real-tractor-06-zephyr-cloudflare-version-proof
ultramodern-real-tractor-02-mf-composition-runtime -> ultramodern-real-tractor-07-validation-gates
ultramodern-real-tractor-03-federated-css -> ultramodern-real-tractor-07-validation-gates
ultramodern-real-tractor-04-full-stack-effect -> ultramodern-real-tractor-07-validation-gates
ultramodern-real-tractor-05-routing-i18n -> ultramodern-real-tractor-07-validation-gates
ultramodern-real-tractor-06-zephyr-cloudflare-version-proof -> ultramodern-real-tractor-07-validation-gates
ultramodern-real-tractor-07-validation-gates -> ultramodern-real-tractor-08-docs-adoption
```

Critical path:

`00 Boundary Contract -> 01 Generator Topology -> 02 MF Composition Runtime -> 06 Zephyr Cloudflare Version Proof -> 07 Validation Gates -> 08 Docs Adoption`

The root agent owns the critical path decisions and final merge. Subagents provide bounded evidence, disjoint patches, and verification.

## Wave 1: Boundary Contract

Only `00 Boundary Contract` is unblocked. Launch these as sidecars while the root agent performs final synthesis.

### SG-00A Tractor Ownership Scout

- Plan: `ultramodern-real-tractor-00-boundary-contract`
- Mode: read-only research
- Purpose: define real Explore, Decide, and Checkout ownership from Tractor implementations and current Ultramodern code.
- Inputs: existing plan files, generated Ultramodern starter, prior Tractor comparison notes, local codebase.
- Output: concise ownership matrix covering routes, UI components, data ownership, Effect services, i18n namespaces, CSS ownership, MF exposes, runtime events, and boundary overlay labels.
- In scope: evidence and proposed contract only.
- Out of scope: code edits, dependency upgrades, broad redesign outside the three micro-verticals.
- Stop condition: ownership matrix is complete enough for SG-00 synthesis or any ambiguity is explicitly handed back.
- Status: ready.
- Agent id: unassigned.

### SG-00B Vertical Manifest Schema Scout

- Plan: `ultramodern-real-tractor-00-boundary-contract`
- Mode: read-only design
- Purpose: propose the canonical `microVertical` manifest/schema used by generator, MF runtime, BFF, i18n, CSS, Cloudflare, and Zephyr lanes.
- Inputs: current generator config shape, Modern.js Module Federation config, Cloudflare worker config, Zephyr manifest/config usage, package metadata.
- Output: schema proposal with field names, required/optional flags, validation rules, and which downstream lane consumes each field.
- In scope: contract shape and downstream integration map.
- Out of scope: implementing schema or changing generator files.
- Stop condition: schema proposal has no unresolved field ownership questions except those called out for root decision.
- Status: ready.
- Agent id: unassigned.

### SG-00C Federated CSS Contract Scout

- Plan: `ultramodern-real-tractor-00-boundary-contract`
- Mode: read-only research
- Purpose: define the CSS contract before implementation so remotes do not duplicate Tailwind output or silently rely on host-only styles.
- Inputs: current Tailwind setup, generated starter CSS, Modern.js CSS extraction behavior, Module Federation style handling, Cloudflare static asset output.
- Output: CSS contract covering shared tokens, vertical-scoped CSS entrypoints, asset publication, injection order, SSR/FOUC prevention, and validation evidence needed.
- In scope: contract and risk map.
- Out of scope: editing Tailwind config or generated CSS.
- Stop condition: clear recommendation for CSS ownership and required validation gates.
- Status: ready.
- Agent id: unassigned.

### SG-00R Root Boundary Synthesizer

- Plan: `ultramodern-real-tractor-00-boundary-contract`
- Mode: root-owned write-capable
- Purpose: integrate SG-00A/B/C outputs into the accepted boundary contract.
- Ownership: contract docs/plans only; no implementation files unless the next user request changes scope.
- Verification: rerun plan graph frontier and confirm `01`, `02`, `03`, `04`, and `05` are unblocked after `00` is completed.
- Status: root-owned.

Merge point M0:

- Accepted ownership matrix exists.
- Manifest/schema contract exists.
- CSS contract exists.
- No implementation shortcut is allowed downstream that collapses Explore/Decide/Checkout into one remote.

## Wave 2: Generator, CSS, BFF, Routing

Launch after M0. These lanes can run in parallel only after SG-01 lands the generated topology contract or explicitly hands off stable interfaces.

### SG-01 Generator Topology Owner

- Plan: `ultramodern-real-tractor-01-generator-topology`
- Mode: write-capable
- Purpose: make the Ultramodern starter generate real packages for `remote-explore`, `remote-decide`, `remote-checkout`, and required shared/platform packages.
- Ownership: generator topology, generated workspace/package manifests, starter package templates, workspace scripts.
- Exclusive write files: `packages/toolkit/create/src/ultramodern-workspace.ts` and any direct generator topology helpers created for this lane.
- In scope: package graph, ports, scripts, workspace manifests, generated fixture shape.
- Out of scope: MF runtime behavior, Cloudflare deployment proof, docs prose.
- Verification: generated workspace installs, builds, and contains three distinct remote package roots with separate package metadata.
- Status: blocked by M0.
- Agent id: unassigned.

### SG-03 Federated CSS Owner

- Plan: `ultramodern-real-tractor-03-federated-css`
- Mode: write-capable after SG-01 interface handoff; read-only before that
- Purpose: implement the agreed CSS model with Tailwind and MF without duplicated output or FOUC.
- Ownership: generated CSS entrypoints, Tailwind config/templates, shared token/style package if needed, CSS validation fixtures.
- In scope: SSR style order, remote CSS asset publication, boundary overlay styling that does not shift layout.
- Out of scope: changing package topology or route ownership.
- Verification: SSR HTML and browser screenshots show styled first paint, remote styles load exactly once per vertical, boundary overlay does not alter layout.
- Status: blocked by M0, then coordinated with SG-01.
- Agent id: unassigned.

### SG-04 Full-Stack Effect Owner

- Plan: `ultramodern-real-tractor-04-full-stack-effect`
- Mode: write-capable after SG-01 interface handoff
- Purpose: give each micro-vertical its own Effect-backed API/BFF surface while preserving Cloudflare compatibility.
- Ownership: generated Effect services, BFF routes, vertical API clients, worker-compatible runtime wiring, tests for API behavior.
- In scope: Explore catalog/query service, Decide product/detail/recommendation service, Checkout cart/order service, typed errors.
- Out of scope: centralizing all domain behavior in one BFF, disabling backend on Cloudflare.
- Verification: each vertical has a callable API path and browser-visible feature backed by that path in local and Cloudflare modes.
- Status: blocked by M0 and SG-01.
- Agent id: unassigned.

### SG-05 Routing i18n Owner

- Plan: `ultramodern-real-tractor-05-routing-i18n`
- Mode: write-capable after SG-01 interface handoff
- Purpose: support localized routes and dynamic translation JSON per vertical using a Modern.js-native or closest-compatible solution.
- Ownership: generated route files, i18n plugin wiring, locale namespace assets, dynamic locale loading, localized navigation.
- In scope: `/en/...` and `/cs/...` localized route slugs beyond bare language roots, CDN-cacheable translation JSON, no inline language conditionals.
- Out of scope: product copy rewrites unrelated to route/i18n proof.
- Verification: English and Czech localized routes render correct diacritics, translation JSON can be loaded dynamically, route switching preserves current vertical intent.
- Status: blocked by M0 and SG-01.
- Agent id: unassigned.

Merge point M1:

- Generator creates separate micro-vertical packages.
- Generated topology exposes stable package names, ports, remotes, and env slots to downstream lanes.

Merge point M2:

- CSS, BFF, and i18n lanes work against generated topology without merging verticals back into one package.

## Wave 3: Module Federation Runtime And Deployment Proof

Launch after SG-01 provides topology. SG-06 waits for SG-02 and SG-04 runtime evidence.

### SG-02 MF Composition Runtime Owner

- Plan: `ultramodern-real-tractor-02-mf-composition-runtime`
- Mode: write-capable
- Purpose: wire real Module Federation host/remotes for Explore, Decide, and Checkout with typed exposes, runtime version switching, and graceful fallbacks.
- Ownership: MF configs, remote expose/consume templates, host composition, runtime selection, boundary metadata integration, DTS generation policy.
- In scope: remote manifests, host registration, version/environment switches, boundary overlay labels sourced from actual remote metadata.
- Out of scope: faking boundaries inside one remote, browser-only behavior that fails SSR.
- Verification: host can consume each remote separately, changing a remote version/environment changes only that vertical, SSR and browser hydration remain correct.
- Status: blocked by M0 and SG-01.
- Agent id: unassigned.

### SG-06 Zephyr Cloudflare Version Proof Owner

- Plan: `ultramodern-real-tractor-06-zephyr-cloudflare-version-proof`
- Mode: write-capable verification/deployment
- Purpose: prove the real multi-remote app runs on Cloudflare now and can use Zephyr for MF asset/version/environment control.
- Ownership: Cloudflare worker config/templates, Zephyr config/evidence, deployment scripts, runtime evidence report.
- In scope: public Cloudflare URL, Zephyr manifests/assets where available, version switch evidence for at least one remote, documented limitations.
- Out of scope: Zerops implementation before Zephyr integration exists.
- Verification: public URL serves SSR app, API/BFF endpoints respond, at least one remote can be version/environment switched without rebuilding the whole app.
- Status: blocked by SG-02 and SG-04.
- Agent id: unassigned.

Merge point M3:

- Real MF remotes compose in local SSR.
- Real BFF surfaces work in Cloudflare target.
- Version/environment switch proof exists or a hard upstream limitation is documented with evidence.

## Wave 4: Validation And Adoption

Launch after M3.

### SG-07 Validation Gates Owner

- Plan: `ultramodern-real-tractor-07-validation-gates`
- Mode: verification-only unless a test harness helper is missing
- Purpose: lock the proof with behavioral gates, not source-content checks.
- Ownership: integration tests, browser tests, deployment smoke tests, type/build gates, evidence artifacts.
- In scope: MF manifest checks through runtime APIs, SSR/hydration, localized routes, cart behavior, boundary overlay behavior, Cloudflare smoke tests, package publish readiness.
- Out of scope: checking source text for strings, implementation shape, or forbidden imports.
- Verification: all documented gates run locally; Cloudflare smoke suite has a repeatable command.
- Status: blocked by SG-02, SG-03, SG-04, SG-05, SG-06.
- Agent id: unassigned.

### SG-08 Docs Adoption Owner

- Plan: `ultramodern-real-tractor-08-docs-adoption`
- Mode: docs-only
- Purpose: document the real micro-vertical model, generator output, deployment/version switching workflow, CSS/i18n/BFF contracts, and validation commands.
- Ownership: docs, examples README, migration/adoption notes, no implementation files.
- In scope: precise user-facing commands, architecture diagram text, known limitations backed by evidence.
- Out of scope: changing implementation after validation closes unless a defect is filed separately.
- Verification: docs commands match SG-07 gates and public deployment evidence.
- Status: blocked by SG-07.
- Agent id: unassigned.

Merge point M4:

- Behavioral gates pass locally and against Cloudflare.
- No source-content tests were introduced.
- User-visible app demonstrates real Explore, Decide, Checkout verticals.

Merge point M5:

- Docs match implementation and validation evidence.
- Remaining non-blocking future work is filed in beads.

## Conflict Risk Map

Single-writer files and areas:

- `packages/toolkit/create/src/ultramodern-workspace.ts`: SG-01 only.
- Generated package topology helpers under `packages/toolkit/create/src/**`: SG-01 owns, downstream lanes propose patches after SG-01 handoff.
- MF config templates and runtime selection files: SG-02 owns.
- CSS/Tailwind/style-package templates: SG-03 owns after SG-01 creates package slots.
- Effect/BFF templates and worker-compatible API wiring: SG-04 owns.
- Route/i18n templates and locale assets: SG-05 owns.
- Cloudflare/Zephyr deployment templates and evidence reports: SG-06 owns.
- Test harnesses and gates: SG-07 owns.
- Documentation: SG-08 owns after implementation facts are stable.

Shared integration areas:

- Package manifests and workspace scripts require root review before merge.
- Any dependency upgrade must use latest stable unless blocked by published package availability, with evidence.
- Any generated sample app changes must preserve backend, i18n, SSR, MF, and Cloudflare support.

## Launch Prompts

Use these prompts when spawning agents. Preserve the graph id and plan file path in each prompt.

### Prompt SG-00A

```text
You are SG-00A for graph ultramodern-real-tractor-v1. Work in /Users/satan/side/experiments/modernjs. Read .codex/plans/ultramodern-real-tractor-00-boundary-contract.plan.md and inspect the current Ultramodern starter and any local Tractor comparison evidence. Do read-only research only. Produce a concise ownership matrix for real Explore, Decide, and Checkout micro-verticals covering routes, UI components, data ownership, Effect services, i18n namespaces, CSS ownership, MF exposes, runtime events, and boundary overlay labels. Do not edit files. Do not propose simulated or virtual boundaries. Stop after the matrix and any explicit unresolved questions.
```

### Prompt SG-00B

```text
You are SG-00B for graph ultramodern-real-tractor-v1. Work in /Users/satan/side/experiments/modernjs. Read .codex/plans/ultramodern-real-tractor-00-boundary-contract.plan.md and inspect generator/config/deployment shapes only as needed. Do read-only design. Propose the canonical microVertical manifest/schema fields required by generator, Module Federation, Effect/BFF, i18n, CSS, Cloudflare, and Zephyr/version switching. Include required versus optional fields, validation rules, and downstream consumers. Do not edit files. Stop when the schema proposal is complete enough for root synthesis.
```

### Prompt SG-00C

```text
You are SG-00C for graph ultramodern-real-tractor-v1. Work in /Users/satan/side/experiments/modernjs. Read .codex/plans/ultramodern-real-tractor-00-boundary-contract.plan.md and inspect current Tailwind/CSS/build output patterns. Do read-only research. Define the federated CSS contract for real MF remotes: shared tokens, vertical CSS entrypoints, asset publication, injection order, SSR/FOUC prevention, and validation evidence. Do not edit files. Stop with a recommendation and risk map.
```

### Prompt SG-01

```text
You are SG-01 for graph ultramodern-real-tractor-v1. Start only after M0 is accepted. Implement .codex/plans/ultramodern-real-tractor-01-generator-topology.plan.md. You own generator topology and may edit packages/toolkit/create/src/ultramodern-workspace.ts and direct helper/template files needed for real remote-explore, remote-decide, and remote-checkout packages. Do not edit MF runtime, Cloudflare/Zephyr proof, docs, or validation gates except for minimal generated fixture hooks. Verify by generating a workspace that contains three distinct remote packages with separate package metadata and scripts.
```

### Prompt SG-02

```text
You are SG-02 for graph ultramodern-real-tractor-v1. Start only after M0 and SG-01 topology handoff. Implement .codex/plans/ultramodern-real-tractor-02-mf-composition-runtime.plan.md. You own MF configs, exposes, host composition, runtime version/environment selection, boundary metadata integration, and DTS policy. Do not fake boundaries inside one remote. Do not disable SSR. Verify that the host consumes Explore, Decide, and Checkout as separate remotes and that switching a remote version/environment changes only that vertical.
```

### Prompt SG-03

```text
You are SG-03 for graph ultramodern-real-tractor-v1. Start only after M0 and coordinate with SG-01 topology handoff before writing. Implement .codex/plans/ultramodern-real-tractor-03-federated-css.plan.md. You own Tailwind/style templates and remote CSS publication/injection behavior. Prevent duplicated Tailwind output and FOUC. Boundary overlay must be an overlay and must not change layout. Do not alter package topology or route ownership. Verify SSR first paint and browser screenshot behavior.
```

### Prompt SG-04

```text
You are SG-04 for graph ultramodern-real-tractor-v1. Start only after M0 and SG-01 topology handoff. Implement .codex/plans/ultramodern-real-tractor-04-full-stack-effect.plan.md. You own generated Effect services, BFF/API routes, vertical clients, and worker-compatible runtime wiring. Each Explore, Decide, and Checkout package must have its own domain API surface. Do not centralize all domain behavior in one BFF and do not disable backend for Cloudflare. Verify callable APIs locally and in the Cloudflare-compatible target.
```

### Prompt SG-05

```text
You are SG-05 for graph ultramodern-real-tractor-v1. Start only after M0 and SG-01 topology handoff. Implement .codex/plans/ultramodern-real-tractor-05-routing-i18n.plan.md. You own route/i18n templates, localized route slugs, locale namespace assets, and dynamic translation JSON loading. Use Modern.js-native or closest-compatible stable i18n. No inline language conditionals for user text. Verify /en and /cs localized routes, Czech diacritics, and CDN-cacheable translation JSON.
```

### Prompt SG-06

```text
You are SG-06 for graph ultramodern-real-tractor-v1. Start only after SG-02 and SG-04 produce runtime evidence. Implement .codex/plans/ultramodern-real-tractor-06-zephyr-cloudflare-version-proof.plan.md. You own Cloudflare worker config/templates, Zephyr config/evidence, deployment scripts, and the runtime evidence report. Prove the SSR app and vertical APIs run on Cloudflare and validate Zephyr MF asset/version/environment switching where possible. Do not implement Zerops yet. Record hard upstream limitations with evidence.
```

### Prompt SG-07

```text
You are SG-07 for graph ultramodern-real-tractor-v1. Start only after SG-02, SG-03, SG-04, SG-05, and SG-06 are complete. Implement .codex/plans/ultramodern-real-tractor-07-validation-gates.plan.md. You own behavioral validation gates only. Do not add tests that inspect source-code content or anything similar. Validate runtime MF manifests/APIs, SSR and hydration, localized routes, cart behavior, boundary overlay behavior, Cloudflare smoke tests, type checks, builds, and package readiness. Provide repeatable commands and evidence.
```

### Prompt SG-08

```text
You are SG-08 for graph ultramodern-real-tractor-v1. Start only after SG-07 passes. Implement .codex/plans/ultramodern-real-tractor-08-docs-adoption.plan.md. Docs only. Document the real micro-vertical architecture, generator output, CSS/i18n/BFF contracts, version/environment switching, Cloudflare and Zephyr workflow, validation commands, and known limitations backed by evidence. Do not change implementation files.
```

## Current Frontier

- Ready: SG-00A, SG-00B, SG-00C, SG-00R.
- Blocked: SG-01, SG-02, SG-03, SG-04, SG-05, SG-06, SG-07, SG-08.
- Next root action: launch SG-00A/B/C or execute their read-only research locally, then synthesize M0.

