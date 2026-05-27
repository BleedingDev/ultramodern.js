---
name: Ultramodern Cloudflare SSR 07 Docs Ops Rollout
overview: Document the supported Cloudflare/Zephyr full-stack micro-vertical workflow, version switching operations, fallback paths, and future Zerops split without creating duplicate runtime truths.
todos:
  - id: update-architecture-docs
    content: "Update ADR/RFC docs to describe the Cloudflare Worker deploy target, Zephyr SSR snapshot path, MF/client asset coexistence, Effect BFF edge execution, and retained Node/Zerops future path."
    status: completed
  - id: document-operator-commands
    content: "Document exact build, local preview, Zephyr upload/deploy, live assertion, version switch, and environment switch commands, including what requires Zephyr login or tokens."
    status: completed
  - id: document-version-switching-model
    content: "Explain how to switch between exact versions, tags, latest, and environments for full-stack micro-verticals, and identify whether the supported path is CLI/API, Zephyr GUI, browser extension, or environment override."
    status: completed
  - id: document-limitations-and-fallbacks
    content: "Document current Cloudflare-only Zephyr SSR limitation, Node/Zerops future path, unsupported APIs, local-only fallback commands, rollback behavior, and how to diagnose mismatched UI/API markers."
    status: completed
  - id: add-release-gate-guidance
    content: "Add release gate guidance so mandatory i18n, MF SSR, dts, Effect BFF, Worker preview, and optional live Zephyr proof are checked at the correct confidence level."
    status: completed
  - id: close-bead-and-handoff
    content: "Update and close beads only after source changes, validation evidence, docs, and remote pushes are complete; include graph ID, evidence paths, and residual risks in the handoff."
    status: pending
isProject: true
---

# Ultramodern Cloudflare SSR 07 Docs Ops Rollout

## Execution Notes

Documentation should make the implementation operable by someone who did not follow the research thread.

Required explanations:

- why current Modern.js Zephyr/Rspack integration is valid for MF/client assets but not sufficient for full-stack SSR/BFF proof
- why the new Worker deploy target exists
- how the Worker output maps to Cloudflare and Zephyr SSR snapshots
- how a full-stack micro-vertical package owns UI, SSR, MF, i18n, and Effect API behavior
- how to change versions/environments at runtime and how to prove both UI and API changed together
- what remains for future Zerops long-running Node support

## Constraints

Do not write marketing copy or vague architecture claims. Every operational step needs a command, URL, config field, or evidence artifact.

Do not imply Zephyr supports non-Cloudflare SSR targets before it actually does.

Do not remove the existing Node deployment story. Cloudflare is the immediate Zephyr path; Zerops still needs durable Node compatibility later.

Do not leave follow-up work only in prose. File or update beads for any unresolved implementation, validation, or product decision.

## Operator Guidance

Docs should reference the final evidence bundle from plans 05 and 06. If live Zephyr proof is deferred because credentials or platform behavior block it, the docs must say exactly which proof is missing and which bead owns it.
