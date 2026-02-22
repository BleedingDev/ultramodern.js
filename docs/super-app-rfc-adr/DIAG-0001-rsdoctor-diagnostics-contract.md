# DIAG-0001: RsDoctor Diagnostics Artifact Contract

- Status: Active
- Date: 2026-02-22
- Related Beads: `modernjs-44t.5.3`
- Depends on:
  - `ADR-0001-rsdoctor-default-on.md`
  - `ARCH-0001-effect-tanstack-target-architecture.md`

## 1. Purpose

Define a stable diagnostics artifact contract for developer and coding-agent workflows so RsDoctor outputs are discoverable without heuristics.

## 2. Contract Scope

Applies to Rspack builds where `performance.rsdoctor` resolves to enabled.

Out of scope:

1. RsDoctor internal manifest schema evolution.
2. Non-Rspack providers.

## 3. Artifact Locations

When RsDoctor is enabled, Modern.js writes artifacts to:

1. RsDoctor output root: `<reportDir or outputPath>/.rsdoctor`
2. RsDoctor manifest: `<reportDir or outputPath>/.rsdoctor/manifest.json`
3. UltraModern diagnostics contract: `<reportDir or outputPath>/.rsdoctor/ultramodern-diagnostics.json`

`reportDir` comes from `performance.rsdoctor.reportDir`; if absent, `outputPath` is used.

## 4. Contract JSON Shape

`ultramodern-diagnostics.json` contains:

1. `schemaVersion` (current: `1`)
2. `tool` (`rsdoctor`)
3. `format` (`ultramodern-rsdoctor-contract`)
4. `generatedAt` (ISO timestamp)
5. `mode` (`normal` | `brief` | `lite`)
6. `disableClientServer` (boolean)
7. `artifactBaseDir` (absolute base dir for artifact resolution)
8. `artifacts.reportDir` (relative path, expected `.rsdoctor`)
9. `artifacts.manifest` (relative manifest path, expected `.rsdoctor/manifest.json`)
10. `artifacts.contract` (relative self-path, expected `.rsdoctor/ultramodern-diagnostics.json`)

## 5. Consumption Rules (Agents and Tooling)

1. First resolve `ultramodern-diagnostics.json`.
2. Read `schemaVersion`; reject unknown major versions.
3. Resolve `artifacts.manifest` relative to `artifactBaseDir`.
4. Treat missing contract as a hard diagnostics-contract failure.
5. Treat missing manifest as RsDoctor runtime/report generation failure.

## 6. Compatibility Notes

1. Default Modern.js behavior remains intact: RsDoctor still defaults on in production and off in development.
2. The new contract artifact is additive and does not change runtime app behavior.
3. `reportDir` and `mode` are optional extensions to preserve upstream compatibility.

## 7. Validation and Tests

Validation for this contract is covered by builder plugin tests:

1. RsDoctor plugin option wiring (including `reportDir` and `mode`).
2. Contract artifact generation in `.rsdoctor`.
3. Deterministic path semantics in contract payload.

