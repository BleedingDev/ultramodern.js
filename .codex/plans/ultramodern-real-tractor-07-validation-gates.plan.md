---
name: Ultramodern Real Tractor 07 Validation Gates
overview: Define mandatory validation gates for real Tractor micro-verticals using build artifacts, contracts, HTTP checks, and browser behavior, with no source-content tests.
todos:
  - id: define-generated-contract-validation
    content: "Define generated contract validation for vertical manifests, topology, ownership, package-source aliases, toolchain policy, route metadata, CSS ownership, i18n namespaces, and MF exposes."
    status: completed
  - id: define-build-validation
    content: "Define build validation for each remote and shell: Modern.js build, Cloudflare build, MF DTS artifacts, native-preview typecheck, app-tools/plugin-i18n/plugin-bff package builds where relevant."
    status: completed
  - id: define-http-validation
    content: "Define HTTP validation for SSR localized routes, MF manifests, remoteEntry assets, locale JSON, CSS chunks, Effect endpoints, health/readiness endpoints, and fallback routes."
    status: completed
  - id: define-browser-validation
    content: "Define browser validation for remote composition, cart flows, checkout/thanks flows, language switching, boundary overlay geometry, no layout shift, no FOUC, mobile/desktop screenshots, and fallback UX."
    status: completed
  - id: define-css-validation
    content: "Define CSS-specific gates for deduped shared CSS, remote-owned CSS loading, computed style presence before interaction, no duplicate base layers, and version-switched CSS markers."
    status: completed
  - id: define-version-switch-validation
    content: "Define local and live version-switch validation for UI/API/CSS/i18n marker coherence across v1/v2 and environment overrides."
    status: completed
  - id: define-ci-and-release-gates
    content: "Define CI/release placement for fast local checks, credential-gated live Zephyr/Cloudflare checks, npm trusted publishing verification, and bead/session closeout rules."
    status: completed
isProject: true
---

# Ultramodern Real Tractor 07 Validation Gates

## Execution Notes

This plan is intentionally validation-heavy. The previous failing mode was claiming architecture from code shape or screenshots. The new gates must prove behavior.

Required evidence types:

- JSON contract inspection
- package metadata inspection
- built artifact inspection
- HTTP requests
- browser interactions
- screenshots and geometry measurements
- published npm metadata
- Cloudflare/Zephyr runtime markers

## Constraints

- No tests that assert source code contains or does not contain strings.
- No regex policing of implementation source as a substitute for behavioral validation.
- No "works by gut feel" closure. A bead closes only with recorded evidence.

## Operator Guidance

Use generated temporary workspaces for install-backed tests. Keep live deployment checks opt-in when credentials are required, but make local Cloudflare/Wrangler checks mandatory for claim closure.

