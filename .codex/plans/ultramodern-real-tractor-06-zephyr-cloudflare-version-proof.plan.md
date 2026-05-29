---
name: Ultramodern Real Tractor 06 Zephyr Cloudflare Version Proof
overview: Prove real full-stack vertical version and environment switching with Zephyr as the Module Federation asset/version layer and Cloudflare Workers as the current SSR/BFF runtime.
todos:
  - id: define-v1-v2-vertical-builds
    content: "Define v1 and v2 builds for Explore, Decide, and Checkout where UI marker, CSS marker, MF manifest marker, translation marker, and Effect BFF marker visibly change per selected version."
    status: completed
  - id: define-zephyr-build-order
    content: "Define Zephyr build order and dependency declarations for real remote-to-remote composition, including Checkout before Decide where Decide consumes Checkout, and Explore dependencies where applicable."
    status: completed
  - id: define-cloudflare-deploys
    content: "Define Cloudflare deploy targets for shell and each vertical, including worker names, compatibility flags, route bindings if needed, ASSETS binding, and per-vertical public URLs."
    status: completed
  - id: define-version-selection-mechanisms
    content: "Document and validate supported version/environment switching mechanisms: Zephyr dependency selectors, environment overrides, dashboard/browser-extension steps, and any available CLI/API path."
    status: completed
  - id: define-runtime-skew-assertions
    content: "Define assertions that fail if shell loads UI v2 while calling BFF v1, if CSS remains v1 after UI v2, or if translations come from a mismatched remote version."
    status: completed
  - id: define-public-url-evidence
    content: "Define required evidence for public Cloudflare and Zephyr URLs: SSR route responses, MF manifests, locale JSON, Effect endpoints, browser screenshots, and machine-readable marker comparison."
    status: completed
  - id: define-zerops-handoff
    content: "Define what remains for later Zerops long-running Node proof, including the same vertical artifact identity, readiness path, and marker-matching contract."
    status: completed
isProject: true
---

# Ultramodern Real Tractor 06 Zephyr Cloudflare Version Proof

## Execution Notes

This is the product proof. It must answer: can we change any micro-vertical version/environment at runtime and have FE, BE, CSS, translations, and MF metadata move coherently?

Immediate target:

- Cloudflare Workers serve shell and vertical SSR/BFF outputs.
- Zephyr resolves MF assets and remote versions.
- Public URL evidence proves marker matching.

Later target:

- Zerops hosts the long-running Node variant of the same package artifact.
- Zephyr still owns MF remote asset/version selection unless Zephyr/Zerops integration changes.

## Constraints

- Local simulation is not enough for final success.
- Zephyr UI screenshots alone are not enough; capture HTTP/browser machine-readable evidence.
- Do not claim backend version switching unless the Effect BFF marker changes with the selected vertical.
- Do not publish to upstream origin.

## Operator Guidance

The proof should be repeatable with credentials present and skippable without credentials. Keep sanitized evidence paths under `.codex/reports` or docs evidence folders.
