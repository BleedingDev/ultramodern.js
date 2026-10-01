---
name: Dependency refresh runtime and security
overview: Update active runtime libraries and prebundled utilities, resolve security findings and preserve server router image and documentation contracts.
todos:
  - id: update-active-runtime-libraries
    content: Upgrade frozen runtime router i18n Hono data and documentation targets and repair the owning framework contracts with regression coverage.
    status: pending
  - id: refresh-prebundled-utilities
    content: Update utility producer inputs, resolve dotenv-expand execution policy, replace deprecated packages, and regenerate vendor outputs through the existing producer.
    status: pending
  - id: repair-transitive-security
    content: Upgrade affected parents and scoped security floors and document a verified disposition for every remaining advisory path.
    status: pending
isProject: false
---

# Dependency refresh runtime and security

## Execution Notes

Beads `modernjs-h8xqq.5`. Depends on baseline and tooling. Own non-Effect runtime/server/router/i18n/image integration source and tests, utility/prebundle authoring inputs, documentation dependency/config updates and security override proposals. Build lane owns supply recipes and compiler integration; coordinate image producer changes with it. Manifest and workspace YAML edits are applied by one integration coordinator.

Move TanStack React Router/core to 1.170.41/1.171.34, retain history 1.162.4, update Hono to 4.13.12, and keep already-current platform singletons exact at the producer. Evaluate ioredis 6, type-is 3, es-module-lexer 3 and Mermaid 12 at their listed consumers. React Router v7 and v8 remain scoped to real consumer requirements; the MF bridge's v7 peer forbids a blanket v8 override. Drizzle RC.4 is a qualified existing contract, not an automatic downgrade to latest 0.45.3.

Chalk 6, Execa 10, Nano ID 6, dotenv 18 and pkg-up replacement affect producer/runtime utility contracts. For dotenv-expand 1000, require explicit evidence that command-like values remain literal under the framework contract, or choose a supported replacement before release. Verify variable precedence, empty/unset defaults and no unintended process execution. Do not implement a custom substitute blindly. Remove stub type dependencies only after implementation declarations are available.

## Constraints

Keep Tractor UI and native framework navigation primitives. Do not add compatibility layers for obsolete UltraModern APIs. Never edit compiled output by hand; run the existing prebundle producer and commit its legitimate regenerated artifacts. Do not blanket-bump transitive majors to flatten duplicates. Application database schema migrations remain valid when actually required.

## Operator Guidance

Use the security artifact to cover Sharp >=0.35.4, adm-zip >=0.6.1, undici >=7.29.1, brace-expansion 1.1.21/2.1.7/5.0.12, engine.io >=6.6.10, axios >=1.20.0, serialize-javascript >=7.1.2 and DOMPurify >=3.4.16. Prefer current parents; use justified scoped overrides where necessary. Verify image sharpening and parser safeguards through corrected sidecars. Inspect Storybook's crypto polyfill for real elliptic usage because no fixed elliptic version is published.

Run targeted server/BFF Hono, routing/prefetch, localization, SSR/RSC, image and utility tests. Include ESM/CJS consumers, project-root discovery, subprocess cancellation and environment expansion for utility updates. Verify documentation and Mermaid rendering and compare packed runtime output. Re-audit after the coordinator installs the integrated graph. Security-only recipe changes are reviewed by the supply owner before generation.
