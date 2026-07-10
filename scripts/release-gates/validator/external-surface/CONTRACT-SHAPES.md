# External-surface validator — contract shapes (G13b/G14/G15/G18)

Standalone, pure node ESM validator modules for MicroVertical **Phase 6**.
Wired **nowhere** yet: the gate-runner integrator imports from
[`index.mjs`](./index.mjs). Binding vocabulary: root `CONTEXT.md`,
`docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md`,
`packages/toolkit/create/delivery-unit-schema-SPEC.md`.

Every comparator returns a common **diff result**:

```
{ kind, surfaceId, zone, changes[], classification: 'additive'|'breaking',
  breakingChanges[], sideBySide: { satisfied: boolean, details }, verdict, notes[], errors[] }
```

`verdict` ∈ `pass` | `pass-with-note` | `fail`. `zone` ∈ `coordinated` | `external`.

## G14-MF — `compare-mf.mjs`

```jsonc
{ "kind": "mf", "surfaceId": "checkout",
  "exposes": [ { "path": "./cart", "signature": "<opaque type-signature hash|string>", "major": 1 } ] }
```

- `signature` — opaque per-expose type-signature hash/string the owner emits.
  **Signature-less path-only contracts are never signature-verified.** When
  either side lacks an owner-emitted `signature` string, the expose is
  **unverifiable**: there is NO structural-hash fallback (an earlier version
  silently manufactured a "signature" from the whole object, hiding real
  mutations). An unverifiable expose is **additive-on-add** and
  **breaking-on-removal** only; an in-place change cannot be detected, so it is
  reported as `type: 'unverifiable'` with a note, never as a breaking signature
  change.
- `major` — the externally published semver major the expose materialises
  (ADR-0020: a new exposed MF path such as `./checkout/v2`). Derived from a
  trailing `/vN` path segment when omitted.
- **Breaking** = a previously published expose path removed or its (verified)
  signature mutated in place. A published external major is immutable → a
  breaking change ships as a new `/vN` path exposed **side by side** with the
  retained old path. **Side-by-side is satisfied only when the old-major surface
  is UNCHANGED** (retained AND signatures equal): mutating v1 while adding v2
  does not satisfy it and fails. REST applies the identical old-prefix
  immutability rule.

## G14-REST — `compare-rest.mjs`

```jsonc
{ "kind": "rest", "surfaceId": "orders",
  "routes": [ { "method": "GET", "path": "/orders/:id",
    "params": [ /* subset */ ], "response": { /* schema subset */ },
    "responseHash": "<optional precomputed>", "major": 1 } ] }
```

Aligned with the operation records emitted by
`packages/toolkit/create/src/ultramodern-workspace/api/contracts.ts`
(`method` + `path` per op). Route key = `METHOD path`. A REST major
materialises as a new route **prefix** (`/v2/orders`). Same immutable-major
rule as MF (side-by-side requires the old prefix retained **and unchanged**).
`params` **always** participate in the route signature; a precomputed
`responseHash` substitutes only for the response body, so a params-only change
is never masked.

## G14-RPC — `compare-rpc.mjs`

```jsonc
{ "kind": "rpc", "surfaceId": "checkoutRpc",
  "contractVersion": 2, "servedVersions": [1, 2], "retiredMajors": [],
  "operations": [ { "name": "addItem", "contractHash": "<per-op contract hash>" } ] }
```

Mirrors the plugin-bff cross-project contract model
(`packages/cli/plugin-bff/src/runtime/effect/endpoint-contracts.ts`:
per-endpoint `createOperationContractHash`). `contractVersion` is the published
major. **Breaking** = op removed, `contractHash` changed, **or a
previously-served major dropped from `servedVersions` without being listed in
`retiredMajors`** (silently un-serving a major breaks external consumers even
when the operations are unchanged). `retiredMajors` is the explicit opt-in that
reclassifies such a drop as additive. Side-by-side is satisfied when
`contractVersion` is bumped past the old major **and** the old major stays in
`servedVersions`.

## G15/G18 — `baseline-compat.mjs`

```jsonc
// host
{ "pins": { "react": "19.0.0", "tanstackRouter": "1.58.0", "effect": "4.0.0-beta.94", "tailwind": "4.0.0" } }
// units[]
{ "unitId": "acme/checkout",
  "baselineCohort": { "cohortId": "cohort-2026-07",
    "resolved": { "react": "19.0.0", "tanstackRouter": "1.58.0", "effect": "4.0.0-beta.94", "tailwind": "4.0.0" } },
  "baselineCompatibility": { "react": { "majors": [18, 19] } } }
```

The four **singletons** (React, TanStack Router, Effect, Tailwind) are compared
by major. A unit accepts `baselineCompatibility[dep].majors`, or — when omitted
— only the major of its own resolved cohort pin. **Singleton intersection
rule**: two units on one host demanding disjoint majors of any singleton →
host incompatible.

## G13b-support — `zone-policy.mjs`

Input: a comparator diff + publication metadata

```jsonc
{ "zone": "external", "owner": "checkout-team", "kind": "component",
  "external": { "surfaceMajor": 2, "baselineCompatibility": "cohort-2026-07",
    "retirement": { "supersededBy": "acme/checkout#cart@v2", "sunsetAfter": "2027-01" } } }
```

- unknown/misspelled `zone`, or a malformed diff (`classification` not
  `additive`|`breaking`) → **error** verdict (fail-closed; never silently
  defaults to coordinated/additive).
- coordinated → breaking allowed, report-only note.
- external, incomplete metadata (missing any of `owner`, `kind`, `major`,
  `baselineCompatibility`, `retirement`) → **error**.
- external breaking without side-by-side major → **error**.
