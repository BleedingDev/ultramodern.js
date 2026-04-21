---
name: Ultramodern Single Preset Rollout
overview: Assemble one public presetUltramodern that drives the MV-first, TanStack-first, Effect-first, and super-app hardening direction without introducing a second public preset or hiding missing core seams behind policy.
todos:
  - id: uspr-01
    content: Move stronger defaults behind explicit seams in core while preserving full capability for the stricter Ultramodern path.
    status: completed
  - id: uspr-02
    content: Encode presetUltramodern as one public policy entrypoint with internal option layers for microVerticals, moduleFederation, strictTrust, strictBff, router, and runtime targets.
    status: completed
  - id: uspr-03
    content: Wire create templates, docs, release gates, and certification surfaces so presetUltramodern is the only public opinionated entrypoint.
    status: completed
  - id: uspr-04
    content: Add rollout evidence covering Bun and Node, TanStack and React Router compatibility, Effect and Hono compatibility, and Module Federation SSR behavior.
    status: completed
isProject: false
---

# Ultramodern Single Preset Rollout

## Execution Notes

This is the public-surface assembly plan. It intentionally assumes there will be only one public preset: `presetUltramodern`.

The preset should push the MV direction and super-app hardening, but it should do that by composing real framework seams rather than by hiding missing runtime capability behind scaffolding or docs.

## Constraints

1. Do not introduce `presetMicroVerticals` as a second public preset.
2. Keep core Modern.js-like where policy is not required.
3. Keep stronger behavior explicit and reviewable in the preset and its options.
4. Preserve compatibility lanes as explicit opt-in modes, not as the new default path.

## Operator Guidance

Treat this plan as the public-contract layer on top of the technical plans. Do not start here if the router, MF SSR, and BFF contract seams are still missing.

The preset should be opinionated about:
- default topology
- default routing and BFF stack
- trust and compatibility policy
- scaffolding and certification

It should not be forced to emulate missing runtime hooks.

## References

- [packages/solutions/app-tools/src/baseline.ts](/Users/satan/side/experiments/modernjs/packages/solutions/app-tools/src/baseline.ts)
- [packages/toolkit/create/template/modern.config.ts.handlebars](/Users/satan/side/experiments/modernjs/packages/toolkit/create/template/modern.config.ts.handlebars)
- [packages/document/docs/en/guides/get-started/ultramodern.mdx](/Users/satan/side/experiments/modernjs/packages/document/docs/en/guides/get-started/ultramodern.mdx)
- [scripts/release-gates/rc-contract-profile.json](/Users/satan/side/experiments/modernjs/scripts/release-gates/rc-contract-profile.json)
