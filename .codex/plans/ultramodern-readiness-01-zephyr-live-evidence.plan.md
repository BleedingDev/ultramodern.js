---
name: Ultramodern Readiness 01 Zephyr Live Evidence
overview: Prove that generated UltraModern workspaces deploy through the official Zephyr Modern.js integration using normal Modern.js lifecycle commands, without adding custom Zephyr commands or wrapping Zephyr runtime behavior.
todos:
  - id: inspect-official-zephyr-path
    content: Re-read the official Zephyr Modern.js integration docs and compare the generated UltraModern config against the required plugin package, import, and lifecycle hook expectations.
    status: completed
  - id: define-evidence-workspace
    content: Define the smallest generated workspace shape that proves shell plus one remote can be built and published through Zephyr using the official plugin.
    status: pending
  - id: design-ci-or-manual-proof
    content: Design an opt-in CI or manual validation path that runs normal Modern.js build commands with Zephyr credentials and records deployment evidence without exposing secrets.
    status: pending
  - id: capture-runtime-proof
    content: Specify the evidence bundle needed to prove the shell loads the remote from Zephyr, including manifest URL or artifact reference, build logs, and runtime page assertion.
    status: pending
  - id: document-no-wrapper-boundary
    content: Document that UltraModern must not add zephyr-specific commands, custom deployment wrappers, or a competing remote-resolution runtime.
    status: pending
isProject: true
---

# Ultramodern Readiness 01 Zephyr Live Evidence

## Execution Notes

The goal is evidence, not abstraction. UltraModern should prove that its generated Modern.js workspace works with the official `zephyr-modernjs-plugin` and ordinary Modern.js lifecycle commands. The proof can be opt-in because real Zephyr deployment needs credentials, but the path must be concrete enough that a maintainer can run it and archive the result.

## Constraints

- Do not add `zephyr:*` commands.
- Do not create a Zephyr wrapper package.
- Do not add a topology resolver or custom hotswap runtime.
- Keep the generated app close to vanilla Modern.js plus the official Zephyr plugin.
- Do not require Zephyr secrets for normal local generator tests.

## Operator Guidance

Start by validating the latest public Zephyr documentation against the current generated config. Then design the smallest deployable proof: shell, one remote, Module Federation manifest, official Zephyr plugin, and a page assertion that the remote rendered from the deployed artifact.

## Processed Findings

The subagent-graph audit verified the official Modern.js Zephyr docs at `https://docs.zephyr-cloud.io/meta-frameworks/modernjs` and compared them against generated UltraModern output. The generated config is aligned on the important vanilla requirements: `zephyr-modernjs-plugin`, `withZephyr()` in the Modern.js `plugins` array, `appTools({ bundler: 'rspack' })`, flat HTML output, `source.mainEntryName: 'index'`, and ordinary `modern dev`, `modern build`, and `modern serve` scripts.

The remaining gap is not config shape. The remaining gap is live deployment evidence: build and deploy a generated shell plus one remote through Zephyr using normal Modern.js lifecycle commands, capture the Zephyr artifact or manifest URL, and prove the deployed shell renders the Zephyr-hosted remote.
