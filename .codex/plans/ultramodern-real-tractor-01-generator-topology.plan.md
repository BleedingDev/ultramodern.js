---
name: Ultramodern Real Tractor 01 Generator Topology
overview: Update the UltraModern generator design so the Tractor demo creates real `remote-explore`, `remote-decide`, and `remote-checkout` full-stack micro-vertical packages with shell composition, topology, ownership, and deploy metadata.
todos:
  - id: design-generator-options
    content: "Design generator flags and defaults for a real Tractor reference mode, including workspace creation, add-flow support, naming rules, ports, package names, MF names, route prefixes, and package-source install/workspace compatibility."
    status: completed
  - id: map-package-layouts
    content: "Specify exact generated files for shell, remote-explore, remote-decide, remote-checkout, shared contracts, shared design tokens, and shared Effect API support without duplicating ownership or hiding cross-vertical dependencies."
    status: completed
  - id: generate-topology-and-ownership
    content: "Define topology and ownership output updates so each real vertical has package id, MF manifest URL env var, Cloudflare worker name, Zephyr dependency id, route ownership, service endpoints, locale namespaces, and blast-radius metadata."
    status: completed
  - id: generate-shell-composition
    content: "Define shell composition outputs for consuming real remotes through Module Federation manifests, including local dev defaults, Cloudflare/Zephyr production URLs, remote dependency declarations, and deterministic fallbacks."
    status: completed
  - id: generate-per-vertical-scripts
    content: "Define package scripts for dev, build, cloudflare:build, cloudflare:preview, cloudflare:deploy, zephyr dependency reporting, typecheck, lint, and vertical validation for each remote."
    status: completed
  - id: update-add-flow
    content: "Design how `--microvertical remote` and Tractor reference generation coexist, so teams can add another vertical later without corrupting shell remotes, topology, Zephyr dependencies, or route metadata."
    status: completed
  - id: define-install-backed-proof
    content: "Define the install-backed validation path using published `@bleedingdev/*` packages so the generated real Tractor workspace proves npm package metadata and aliases, not local source assumptions."
    status: completed
isProject: true
---

# Ultramodern Real Tractor 01 Generator Topology

## Execution Notes

The generator must produce real package boundaries. A valid generated workspace should contain at minimum:

```text
apps/shell-super-app
apps/remotes/remote-explore
apps/remotes/remote-decide
apps/remotes/remote-checkout
packages/shared-contracts
packages/shared-design-tokens
packages/shared-effect-api
topology/reference-topology.json
topology/ownership.json
.modernjs/ultramodern-generated-contract.json
.modernjs/ultramodern-package-source.json
```

Each remote must be individually buildable and deployable. The shell must consume the remotes through MF manifests, not through direct source imports.

## Constraints

- No fake one-remote mode for the final proof.
- No central hand-maintained topology that duplicates package facts. Generated metadata is allowed; manual overrides must be explicit and validated.
- No Corepack. The generated workspace must use mise and the pinned latest pnpm policy.
- Generated route ownership must support route-owned metadata later; the central route map may be generated from route exports.

## Operator Guidance

Implementation agents should first create the generator data model, then render files from it. Do not hand-edit three nearly identical remotes without a shared generator model; that will break add-flow and package-source aliases.

