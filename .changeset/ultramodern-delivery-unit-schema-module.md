---
'@modern-js/ultramodern-create': patch
---

Integrate the canonical delivery-unit schema module (`DeliveryUnitDescriptor`,
`SurfaceDescriptor`, `SurfaceRef` parser/formatter, `ResolvedDeliveryUnit`, and
v1 projections with unknown-field preservation) into `@modern-js/ultramodern-create`'s
generator paths. Generation now derives grammar-safe surface IDs, preserves
`agent` / `agent-team` owners through v1 round-trips, and checks v1
representability without rejecting owners the projection can preserve. The
generator also uses ownership-token mutation locks and rejects overlay
baseline relaxations through removed pins, npm aliases, overrides,
resolutions, pnpm overrides, and catalogs. The schema spec and characterization
tests document these wired behaviors.
