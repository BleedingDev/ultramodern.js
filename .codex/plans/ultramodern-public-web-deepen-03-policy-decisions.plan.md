---
name: ultramodern-public-web-deepen-03-policy-decisions
overview: Deepen `PUBLIC_WEBSITE_POLICY` from a nested constant bag into a private create-package policy module that owns generated public-web decisions without becoming a broad profile or certification engine.
todos:
  - id: map-policy-projections
    content: Map every current projection of `PUBLIC_WEBSITE_POLICY` into contracts, generated validator snippets, generated head robots, proof fallbacks, tests, and docs.
    status: completed
  - id: characterize-policy-output
    content: Strengthen characterization only where generated quality gates, robots policy, provider defaults, or proof fallback values are not already pinned.
    status: completed
  - id: deepen-policy-rendering
    content: Move behavior-preserving rendering decisions behind the private policy module so callers ask for decisions rather than reassembling nested policy fragments.
    status: completed
  - id: validate-policy-decisions
    content: Run focused integration tests, create package tests, and Biome checks; confirm ADR-0016 boundaries are still respected.
    status: completed
isProject: false
---

# ultramodern-public-web-deepen-03-policy-decisions

## Execution Notes

`PUBLIC_WEBSITE_POLICY` currently improves locality for literals but still exposes a broad nested data shape. This lane should deepen the module only where it reduces repeated projection logic.

## Constraints

Do not create `webSpec`, profile, certification, or agent-readiness configuration. Do not move Cloudflare runtime security defaults into public-web policy ownership. Do not change generated contract values, proof assertion names, CLI/env behavior, or private-first defaults.

## Operator Guidance

This lane should start after the route path semantics lane if both need the same generated public-surface code. If it is only characterization or docs, it can run in parallel as read-only or test-only work.
