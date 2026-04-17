# SDK-0001: Module SDK Core Contract and Optional Profiles

- Status: Active
- Date: 2026-02-22
- Related Beads: `modernjs-44t.6.2`
- Depends on:
  - `BOUNDARY-0001-framework-core-vs-module-vs-external-matrix.md`

## 1. Purpose

Define a stable module SDK contract around domain-neutral module requirements, with optional profile overlays for downstream specializations.

This contract is machine-readable and enforced through CI anti-pattern checks.

## 2. Canonical Contract Artifact

Source of truth:

- `docs/super-app-rfc-adr/contracts/module-sdk-contracts.json`
- `docs/super-app-rfc-adr/contracts/module-manifest.example.json`

Schema highlights:

1. `schemaVersion`
2. `compatibilityLanes`
3. `sharedRequirements`
4. `sharedRequirements.requiredLifecycleHooks`
5. `sharedRequirements.requiredPolicyHooks`
6. `sharedRequirements.requiredObservabilityHooks`
7. `sharedRequirements.forbiddenCodePatterns`
8. `profiles.<profile>.requiredLifecycleHooks` (optional overlay)
9. `profiles.<profile>.requiredPolicyHooks` (optional overlay)
10. `profiles.<profile>.requiredObservabilityHooks` (optional overlay)
11. `profiles.<profile>.forbiddenCodePatterns` (optional overlay)

## 3. Profile Model

1. Framework-core certification is driven entirely by `sharedRequirements`.
2. `profiles` are optional overlays, not part of the mandatory certification shape.
3. Profile identifiers are downstream-owned strings and must not encode a framework-level product taxonomy.

## 4. Required Hook Categories

Each shared contract requires:

1. Lifecycle hooks:
   - `registerRoutes`
   - `registerCapabilities`
   - `registerMigrations`
2. Policy hooks:
   - `authorize`
   - `enforceTenantScope`
   - `validateOperationContext`
3. Observability hooks:
   - `emitBusinessMetric`
   - `emitAuditEvent`
   - `emitTraceContext`

## 5. Shared Compliance Flags

Each module manifest must declare:

1. `usesSdkContracts`
2. `usesPolicyMiddleware`
3. `usesObservabilityHooks`

All must be `true` for certification readiness.

## 6. Out of Scope

Intentionally excluded from framework core:

1. Fixed product-family bucket lists baked into framework contracts.
2. CRM stage semantics.
3. PM workflow semantics.
4. Invoicing/legal/tax semantics.
5. Chat moderation semantics.
6. Automation DAG/business logic semantics.

## 7. Validation

Contract enforcement is performed by anti-pattern CI checks (ticket `modernjs-44t.6.3`), which consume this contract file as input.

Local validation tooling:

1. `scripts/module-sdk-contracts/validate-module-sdk-contracts.js`
2. `scripts/module-sdk-contracts/validator.js`
3. `scripts/module-sdk-contracts/__tests__/validator.test.js`

Example commands:

1. Contract-only validation:
   - `node scripts/module-sdk-contracts/validate-module-sdk-contracts.js --contract docs/super-app-rfc-adr/contracts/module-sdk-contracts.json --skip-manifest-validation`
2. Contract + example manifest validation:
   - `node scripts/module-sdk-contracts/validate-module-sdk-contracts.js --contract docs/super-app-rfc-adr/contracts/module-sdk-contracts.json --manifest docs/super-app-rfc-adr/contracts/module-manifest.example.json`
3. Unit tests:
   - `node --test scripts/module-sdk-contracts/__tests__/validator.test.js`
