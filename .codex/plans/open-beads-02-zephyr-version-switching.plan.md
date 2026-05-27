---
name: Open Beads 02 Zephyr Version Switching
overview: Finish the actionable part of modernjs-hjgv by proving live Zephyr full-stack micro-vertical version/environment switching where UI and Effect BFF markers move together.
todos:
  - id: prepare-live-fixture
    content: "Create or reuse a generated UltraModern workspace fixture that can produce remote-commerce v1 and v2 with different UI and Effect BFF markers while keeping one package boundary."
    status: pending
  - id: build-and-upload-v1
    content: "Build and upload/deploy remote-commerce v1 through the Cloudflare/Zephyr path; capture Zephyr URLs, snapshot IDs if available, MF manifest URL, BFF endpoint URL, and marker JSON."
    status: pending
  - id: build-and-upload-v2
    content: "Build and upload/deploy remote-commerce v2 with changed UI and Effect BFF markers; capture the same evidence as v1."
    status: pending
  - id: configure-shell-selection
    content: "Deploy or configure the shell to select v1 and v2 through Zephyr-supported dependency, version, tag, exact selector, environment override, GUI, extension, or documented operational path."
    status: pending
  - id: assert-live-lockstep
    content: "For each selected version/environment, assert shell-rendered UI marker and fetched Effect BFF marker match the same vertical build identity; include a negative skew check if the platform allows controlled mismatch."
    status: pending
  - id: archive-live-evidence
    content: "Write sanitized live evidence under .codex/reports/cloudflare-ssr or .modern/zephyr-live, including commands, URLs, HTTP responses, marker comparisons, and any screenshots/logs needed."
    status: pending
  - id: update-zerops-next-step
    content: "Document the remaining Zerops long-running Node proof separately if Zephyr/Cloudflare live switching is complete but Zerops integration is not yet available."
    status: pending
  - id: close-or-split-version-switching-bead
    content: "Close modernjs-hjgv only if both Zephyr live switching and required Zerops scope are done; otherwise split the Zerops remainder into a new bead and close the Zephyr part with evidence."
    status: pending
isProject: true
---

# Open Beads 02 Zephyr Version Switching

## Execution Notes

This plan owns `modernjs-hjgv`.

The central product claim is full-stack versioning: switching a micro-vertical must change both the Module Federation UI and the owned Effect BFF behavior from the same package version/build.

Existing local evidence from `modernjs-z0z9` proves the generated vertical can run SSR, MF assets, i18n, and Effect BFF in one Cloudflare Worker. This plan must prove the live Zephyr selection story.

## Constraints

Do not claim success from local Wrangler validation alone.

Do not commit Zephyr tokens, cookies, or account-private secrets.

Do not split the Effect BFF into a separate package or process for the proof.

Do not rely only on manual screenshots. HTTP responses and marker comparisons are required.

## Operator Guidance

Use the existing marker contract:

- UI marker: generated `ultramodernUiMarker`
- BFF marker: Effect response `items[0].marker`
- pass condition: same `appId`, `packageName`, `version`, `build`, and deployment profile

If Zephyr does not expose a CLI/API for switching, document the exact supported GUI/browser-extension/environment override operation and capture before/after runtime evidence.
