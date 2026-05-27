---
name: Ultramodern Cloudflare SSR 05 Local Cloudflare Validation
overview: Prove the generated full-stack micro-vertical works in local Worker preview before attempting live Zephyr deployment.
todos:
  - id: create-generated-fixture
    content: "Generate or reuse the smallest UltraModern workspace with shell, one full-stack remote, TanStack routes, mandatory i18n, MF SSR, and Effect BFF enabled."
    status: completed
  - id: build-worker-output
    content: "Build the remote and shell with the Cloudflare deploy target and verify the output includes Worker entry, public assets, locale assets, route metadata, MF manifest, and server render bundles."
    status: completed
  - id: run-wrangler-preview
    content: "Run Wrangler or Miniflare local preview for the Worker output without corepack and capture startup logs, compatibility flags, asset binding behavior, and local URL."
    status: completed
  - id: assert-translated-ssr
    content: "Assert /en and /cs SSR responses contain localized content, correct canonical/hreflang behavior where generated, and no hydration-breaking asset path errors."
    status: completed
  - id: assert-mf-and-assets
    content: "Assert /mf-manifest.json, JS/CSS assets, route assets, and /locales/* resolve with expected content types and cache-safe behavior."
    status: completed
  - id: assert-effect-bff
    content: "Assert the package-owned Effect endpoint returns JSON with the expected version/build marker and that SSR UI marker and BFF marker match the same generated vertical artifact."
    status: completed
  - id: add-regression-command
    content: "Add a repeatable local regression command or test harness that runs the build/preview/assertion sequence without requiring Zephyr credentials."
    status: completed
isProject: true
---

# Ultramodern Cloudflare SSR 05 Local Cloudflare Validation

## Execution Notes

This is the first hard proof lane. It should fail if the implementation only works as static MF assets or only works in Node `modern serve`.

Required local assertions:

- `GET /en` returns SSR HTML with English text.
- `GET /cs` returns SSR HTML with Czech text.
- `GET /locales/...` returns locale JSON or the chosen Modern i18n asset shape.
- `GET /mf-manifest.json` returns a valid Module Federation manifest.
- `GET /commerce-api/effect/recommendations` or equivalent returns JSON from the Effect BFF implementation.
- UI marker and BFF marker refer to the same package/version/build identity.

## Constraints

Do not count a static file server as Cloudflare validation.

Do not bypass the generated Modern config in the fixture.

Do not require live Zephyr credentials for this lane.

Do not accept a passing UI test if the BFF route is unavailable or served by a separate process.

## Operator Guidance

Prefer a small Node-based assertion script plus Wrangler/Miniflare process management. Capture response bodies, headers, status codes, and the output file list as evidence artifacts under a deterministic evidence directory.

If Worker preview fails because of unsupported Node APIs, classify each unsupported API and feed it back to plans 01 or 02 instead of patching the fixture.
