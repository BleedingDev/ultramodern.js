---
name: Ultramodern SuperApp Workspace Generator
overview: Add a first-class generator path that creates the canonical UltraModern Micro Vertical workspace without requiring manual shell, remote, service, design-system, topology, and script composition.
todos:
  - id: uswgen-01
    content: Define generated workspace output for root config, shell, two vertical remotes, one design-system MF remote, one Effect service, shared packages, topology overlays, and validation scripts.
    status: pending
  - id: uswgen-02
    content: Extend @modern-js/create with one UltraModern workspace generation path while keeping presetUltramodern as the only public preset.
    status: pending
  - id: uswgen-03
    content: Generate topology metadata, ownership metadata, local overlays, package scripts, and template manifest evidence from repo-backed fixtures.
    status: pending
  - id: uswgen-04
    content: Add generator tests that scaffold the workspace and verify layout, package versions, config wiring, MF remote roles, Effect service wiring, and validation commands.
    status: pending
isProject: false
---

# Ultramodern SuperApp Workspace Generator

## Execution Notes

The current docs describe how to compose a Micro Vertical workspace with existing create flags, but teams still need to know too much. This lane turns the documented topology into a generated skeleton that can be validated before writing business code.

Primary hotspots are `packages/toolkit/create/src/index.ts`, `packages/toolkit/create/template/**`, create integration tests under `tests/integration/create-*`, `docs/super-app-rfc-adr/WORKSPACE-0001-micro-vertical-workspace-scaffolding.md`, and the topology fixture under `scripts/mv-integration-pilot/__fixtures__/reference-topology.json`.

## Constraints

Keep one public preset: `presetUltramodern`. Do not add `presetMicroVerticals`.

Do not make the generator own business-domain code. It should create shell, remote, service, shared-package, topology, and validation scaffolding only.

## Operator Guidance

Prefer extending existing create/template manifest behavior over adding an unrelated generator package. Generated workspaces should use the latest TanStack versions from the dependency lane and should be ready for the local control-plane and doctor lanes.
