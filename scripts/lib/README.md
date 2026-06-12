# scripts/lib

Shared, dependency-free helpers for the `scripts/` gate validators
(`module-sdk-contracts`, `boundary-guards`, `mv-lane-policy`,
`mv-ci-hardening`, `release-gates`, and friends).

- `validation-kit.js` — JSON loading with path-aware parse errors, file
  existence checks, primitive shape guards (`ensureObject`, `ensureString`,
  `ensureStringArray`, ...), placeholder-value detection, schema-version
  checking, and path resolution.

Rules:

- Plain CommonJS, Node builtins only. The validators run under both `node`
  and `bun` (see `validate:bun-smoke`) without any install or build step.
- Keep error messages stable; validator test suites assert on them.
- Run the tests with `pnpm run test:scripts` (plain `node --test`).

## Observable behavior deltas vs the pre-consolidation validators

Porting the validators onto `validation-kit.js` introduced exactly two
observable CLI behavior changes in the surviving validators. Everything else
(flags, `--help` output, success paths, and all other messages and exit
codes) is byte-identical to the standalone validators. No in-repo consumer
parses validator output; workflows consume exit codes only.

1. **Malformed JSON input (all ported validators).** `readJsonFile` wraps the
   raw `JSON.parse` error with the offending path.
   - Old: the raw parse error, e.g.
     `Expected property name or '}' in JSON at position 2 (line 1 column 3)`;
     exit code 1.
   - New: `Failed to parse JSON in /abs/path/to/file.json: Expected property
     name or '}' in JSON at position 2 (line 1 column 3)`; exit code 1.

2. **`mv-ci-hardening` now rejects the placeholder value `to-be-filled`.**
   `PLACEHOLDER_VALUES` is the union of the historical mv-ci-hardening and
   release-gates lists; `to-be-filled` came from release-gates and was not in
   the old mv-ci-hardening list.
   - Old: a profile with e.g. `owner: "to-be-filled"` validated successfully;
     exit code 0.
   - New: `profile.checks[0].owner must not use placeholder value
     "to-be-filled"`; exit code 1.
