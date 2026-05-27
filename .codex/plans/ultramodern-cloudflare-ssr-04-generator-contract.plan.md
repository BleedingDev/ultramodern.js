---
name: Ultramodern Cloudflare SSR 04 Generator Contract
overview: Update UltraModern workspace generation so full-stack remotes opt into mandatory i18n, MF SSR, Effect BFF, Zephyr metadata, and Cloudflare Worker deployment without drifting away from vanilla Modern.js.
todos:
  - id: update-generator-dependencies
    content: "Update generated workspace dependencies and version constants for the Cloudflare/Zephyr SSR path, including zephyr-agent if needed, current zephyr-rspack-plugin, wrangler, and any Worker preview dependency; keep TypeScript 6/7 native-preview expectations explicit."
    status: completed
  - id: generate-worker-config
    content: "Generate Modern config for full-stack verticals that enables stream SSR, moduleFederationAppSSR, deploy.worker.ssr, Effect BFF runtime, flat output, mandatory i18n, and Cloudflare-compatible output without custom runtime boot hacks."
    status: completed
  - id: generate-version-markers
    content: "Generate deterministic UI and Effect BFF version/build markers so runtime tests can prove selected UI and selected API behavior come from the same vertical artifact."
    status: completed
  - id: generate-package-scripts
    content: "Add only necessary package scripts for build, preview, and opt-in Zephyr SSR evidence while avoiding duplicated package-manager sources of truth and avoiding corepack."
    status: completed
  - id: update-doctor-and-validator
    content: "Update contract doctor and generator integration tests to assert structured package metadata, generated config outputs, build artifacts, HTTP behavior, and absence of source-content-only checks."
    status: pending
  - id: preserve-vanilla-modernjs-profile
    content: "Update ADR and generator guidance so Cloudflare/Zephyr SSR is an official deploy profile on top of Modern.js primitives, not a private boot-time mutation layer."
    status: completed
isProject: true
---

# Ultramodern Cloudflare SSR 04 Generator Contract

## Execution Notes

This lane adapts the UltraModern starter and generated workspaces after the framework deploy target and BFF dispatch contract are known. It should not lead by hardcoding around missing framework support.

Known current generator evidence:

- `packages/toolkit/create/src/ultramodern-workspace.ts` currently generates `zephyr-rspack-plugin` integration through a Modern `modifyRspackConfig` bridge.
- Generated full-stack verticals already include `bffPlugin()`, `runtimeFramework: 'effect'`, `moduleFederationPlugin()`, stream SSR, flat output, and mandatory i18n.
- Root package manager source has been moved to `packageManager: 'pnpm@11.3.0'`.
- Tests already assert TypeScript `6.0.3`, `@typescript/native-preview` `7.0.0-dev.20260525.1`, `@module-federation/modern-js-v3` `2.5.0`, TanStack Router `1.170.8`, i18next `26.2.0`, and Zephyr Rspack plugin `1.1.1` in generated workspaces.

## Constraints

Do not remove mandatory i18n. The starter must retain multi-language support through the closest native Modern.js path available.

Do not create duplicated package-manager truth across mise, proto, corepack, and packageManager metadata. The generated workspace should follow the selected project policy and avoid corepack.

Do not make tests assert arbitrary source substrings when a generated config parse, package JSON field, built artifact, or HTTP assertion can prove the same behavior.

Do not expose API modules as browser MF exposes.

## Operator Guidance

This plan should start after the deploy preset and BFF edge runtime have a stable shape. If it starts earlier, limit work to validator scaffolding and dependency constants that are already proven current.

Primary files likely involved:

- `packages/toolkit/create/src/ultramodern-workspace.ts`
- `tests/integration/create-ultramodern-workspace/tests/index.test.ts`
- `scripts/ultramodern-contract-doctor/run-contract-doctor.js`
- `scripts/mv-zephyr-profile/validate-zephyr-profile.js`
- `docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md`
- `docs/super-app-rfc-adr/ZEROPS-0001-ultramodern-full-stack-node-proof.md`
