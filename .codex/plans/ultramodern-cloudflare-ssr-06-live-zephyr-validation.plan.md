---
name: Ultramodern Cloudflare SSR 06 Live Zephyr Validation
overview: Prove live Zephyr Cloudflare SSR deployment can serve the same full-stack micro-vertical UI, SSR, MF assets, i18n assets, and Effect BFF behavior with version/environment switching evidence.
todos:
  - id: prepare-live-evidence-config
    content: "Prepare sanitized live-evidence config for Zephyr app names, environment selector, credentials, expected routes, and artifact marker values without committing secrets."
    status: pending
  - id: deploy-vertical-v1
    content: "Build and upload/deploy vertical v1 as a Zephyr SSR snapshot, capturing application UID, snapshot ID, version, entrypoint, deployment URL, MF manifest URL, and BFF marker."
    status: pending
  - id: deploy-vertical-v2
    content: "Build and upload/deploy vertical v2 with changed UI and Effect BFF markers, capturing the same Zephyr snapshot and runtime evidence."
    status: pending
  - id: deploy-or-configure-shell
    content: "Deploy or configure the shell to consume the selected vertical through Zephyr dependencies, environment overrides, tags, or exact version selectors."
    status: pending
  - id: assert-live-runtime-switch
    content: "Assert live runtime behavior for each selected version/environment: shell UI renders selected remote marker and API call returns the matching Effect BFF marker from the same vertical artifact."
    status: pending
  - id: capture-zephyr-operations
    content: "Document and capture the operational mechanism for switching versions/environments, distinguishing CLI/API, Zephyr GUI, browser extension, and environment override paths."
    status: pending
  - id: archive-evidence-bundle
    content: "Archive sanitized live evidence including commands, URLs, HTTP responses, screenshots if useful, snapshot metadata, and failure diagnostics."
    status: pending
isProject: true
---

# Ultramodern Cloudflare SSR 06 Live Zephyr Validation

## Execution Notes

This lane proves the real product claim: a selected micro-vertical version changes both FE and BE behavior in runtime.

This is not allowed to degrade into a UI-only Zephyr proof. The live assertion must compare:

- selected UI marker from the remote rendered through the shell
- selected BFF marker from the same vertical package
- Zephyr selector/version/environment metadata that explains why that version was selected

The expected Zephyr shape follows TanStack Start SSR: server and client assets are uploaded as one SSR snapshot with an entrypoint, and Zephyr's managed Cloudflare SSR Worker executes the server entry.

## Constraints

Do not commit Zephyr secrets.

Do not claim success from local Worker preview. That belongs to plan 05.

Do not depend exclusively on manual dashboard screenshots. Screenshots can supplement, but HTTP responses and snapshot metadata are required.

Do not require Zerops for this immediate proof. Zerops long-running Node proof remains later work after the Cloudflare/Zephyr path works.

## Operator Guidance

If Zephyr login is required, run the Zephyr flow and let the user authenticate. After auth, resume with machine-readable commands and runtime assertions.

If Zephyr SSR Worker refuses Modern output, capture the exact error, snapshot entrypoint, asset list, and server bundle import error. Feed the failure back to plans 01, 02, or 03.
