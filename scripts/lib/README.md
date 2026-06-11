# scripts/lib

Shared, dependency-free helpers for the `scripts/` gate validators
(`module-sdk-contracts`, `boundary-guards`, `mv-lane-policy`,
`mv-ci-hardening`, `release-gates`, `ai-capabilities`, and friends).

- `validation-kit.js` — JSON loading with path-aware parse errors, file
  existence checks, primitive shape guards (`ensureObject`, `ensureString`,
  `ensureStringArray`, ...), placeholder-value detection, schema-version
  checking, and path resolution.

Rules:

- Plain CommonJS, Node builtins only. The validators run under both `node`
  and `bun` (see `validate:bun-smoke`) without any install or build step.
- Keep error messages stable; validator test suites assert on them.
- Run the tests with `pnpm run test:scripts` (plain `node --test`).
