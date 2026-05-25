---
name: Ultramodern Zephyr Profile Alignment
overview: Resolve the mismatch between the written Ultramodern Zephyr profile and the generated implementation by deciding whether Modern.js apps should use zephyr-modernjs-plugin directly or keep the current zephyr-rspack-plugin wrapper for Module Federation ordering.
todos:
  - id: collect-official-zephyr-plugin-evidence
    content: "Re-read Zephyr Modern.js and Rspack documentation plus package latest data for zephyr-modernjs-plugin and zephyr-rspack-plugin."
    status: completed
  - id: inspect-current-generator-and-adr
    content: "Compare ADR-0012, generated modern.config.ts content, generated validator assertions, and integration tests for plugin package and ordering expectations."
    status: completed
  - id: run-minimal-plugin-compatibility-spike
    content: "Generate or use a minimal Ultramodern shell plus remote and build once with the current Rspack wrapper and once with the official Modern.js plugin path, preserving Module Federation manifest output."
    status: completed
  - id: choose-profile-contract
    content: "Record the decision in code and docs: either switch generator and validator to zephyr-modernjs-plugin or update ADR and validator to define the Rspack wrapper as the intentional MF profile."
    status: completed
  - id: update-tests-and-profile-docs
    content: "Update integration tests, generated validator text, README or ADR references, and any docs that claim a different Zephyr plugin path."
    status: completed
  - id: run-zephyr-profile-quality-gates
    content: "Run focused generator tests and generated workspace validation proving Modern.js lifecycle scripts remain vanilla and Zephyr config matches the selected profile."
    status: completed
isProject: true
---

# Ultramodern Zephyr Profile Alignment

## Execution Notes

Source Bead: `modernjs-ogrz`.

This plan is a prerequisite for the full-stack micro-vertical pivot. The full-stack package work should not hard-code a plugin path until this plan decides which Zephyr profile is canonical.

Current repo evidence:

- ADR-0012 says `withZephyr()` must come from the official `zephyr-modernjs-plugin` and be registered in the Modern.js plugins array: `docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md:94`.
- The current generator imports `withZephyr as withZephyrRspack` from `zephyr-rspack-plugin`: `packages/toolkit/create/src/ultramodern-workspace.ts:1008`.
- The generator wraps the Rspack plugin in `zephyrRspackPlugin` with a `pre` ordering constraint before Module Federation config mutation: `packages/toolkit/create/src/ultramodern-workspace.ts:1025`.
- The generated validator currently expects `zephyr-rspack-plugin`, `zephyrRspackPlugin()`, `withZephyrRspack()`, and the pre-ordering hook: `packages/toolkit/create/template-workspace/scripts/validate-ultramodern-workspace.mjs.handlebars:623`.
- Integration tests assert the Rspack plugin wrapper shape at `tests/integration/create-ultramodern-workspace/tests/index.test.ts:927`.

External API and docs evidence to re-check during execution:

- NPM registry: `pnpm view zephyr-modernjs-plugin version --json` and `pnpm view zephyr-rspack-plugin version --json`. Planning pass result on 2026-05-26: both returned `1.1.1`.
- Zephyr docs URL: `https://docs.zephyr-cloud.io/meta-frameworks/modernjs`.
- Zephyr docs URL: `https://docs.zephyr-cloud.io/bundler-guides/rspack` if plugin ordering or Rspack-specific behavior needs confirmation.

## Constraints

- Keep normal Modern.js lifecycle scripts: `modern dev`, `modern build`, `modern serve`.
- Do not add `zephyr:*` scripts. The generated validator already forbids custom Zephyr lifecycle scripts.
- Do not mutate MF manifests after build as a deployment strategy; ADR-0012 forbids that pattern.
- Preserve app-level MF SSR with `server.ssr.mode: 'stream'` and `moduleFederationAppSSR: true`.
- Preserve flat HTML output and `source.mainEntryName: 'index'` unless official Zephyr docs require a different Modern.js shape.

## Operator Guidance

The key question is not package preference; it is whether the official Modern.js plugin can be used without losing deterministic Module Federation manifest generation and Zephyr dependency extraction. If both plugin paths work, prefer the official Modern.js plugin and simplify the generated config. If only the Rspack wrapper preserves MF ordering, keep it but update ADR-0012 and the validator so the profile is honest.

Suggested verification commands:

```bash
pnpm view zephyr-modernjs-plugin version --json
pnpm view zephyr-rspack-plugin version --json
pnpm --filter @modern-js/create tests -- tests/integration/create-ultramodern-workspace/tests/index.test.ts
```

Acceptance requires a single canonical statement across generator, validator, tests, and ADR. Mixed documentation is a failure even if builds pass.
