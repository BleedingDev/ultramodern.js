---
'@modern-js/bff-effect': minor
---

Publish the fork-owned Effect BFF runtime, edge dispatcher, client runtime, and
data-platform primitives as a dedicated package. Effect and its OpenTelemetry
integration are exact optional peers at `4.0.0-rc.112`, allowing peer-free BFF
lanes to avoid loading Effect while Effect consumers share one cohort.

Validator-aware handler factories are registered in a private `WeakSet`.
Forgeable `EFFECT_VALIDATOR_AWARE_FACTORY` and
`isValidatorAwareHandlerFactory` branding APIs are deliberately absent from the
public package surface.

Keep dispatcher APIs on the canonical `@modern-js/bff-effect/effect-edge`
entry instead of publishing a redundant `effect-edge/dispatcher` subpath. The
historical `@modern-js/plugin-bff/effect-edge/dispatcher` compatibility path
continues to delegate to that canonical edge entry. The edge dispatcher omits
the Scalar and Swagger UI namespaces so evaluator-bearing browser payloads do
not enter Worker bundles; the Node Effect surface remains unchanged.
