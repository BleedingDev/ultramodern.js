# scripts/lib

Shared, dependency-free helpers for the current `scripts/` gate validators
and script helper families (`boundary-guards`, `release-gates`,
`superapp-certification`, `ultramodern-publish`,
`ultramodern-production-readiness`, and friends).

- `validation-kit.js` — JSON loading with path-aware parse errors, file
  existence checks, primitive shape guards (`ensureObject`, `ensureString`,
  `ensureStringArray`, ...), placeholder-value detection, schema-version
  checking, and path resolution.
- `cli-kit.js` — `node:util parseArgs` wrapper and inline-value rejection
  helper for fork-owned scripts that preserve each CLI family's historical
  unknown-argument and missing-value behavior.
- `fs-kit.js` — pretty JSON file writes with parent-directory creation and an
  atomic default for release/publish artifacts.
- `process-kit.js` — shared argv command and command-list execution plus
  small process/stream helpers (`createProcessEnv`, `killChild`, `sleep`,
  `writeStream`).
- `artifact-schema.js` — the shared SuperApp readiness dimension list.

Rules:

- Plain CommonJS, Node builtins only. The validators run under both `node`
  and `bun` (see `validate:bun-smoke`) without any install or build step.
  ESM `.mjs` scripts may import these helpers through Node's CommonJS default
  interop, e.g. `import fsKit from '../lib/fs-kit.js'`.
- Keep error messages stable; validator test suites assert on them.
- Run the tests with `pnpm run test:scripts` (plain `node --test`).

## Observable behavior deltas vs the pre-consolidation validators

Porting the validators onto `validation-kit.js` introduced one observable CLI
behavior change in the surviving validators. Everything else
(flags, `--help` output, success paths, and all other messages and exit
codes) is byte-identical to the standalone validators. No in-repo consumer
parses validator output; workflows consume exit codes only.

**Malformed JSON input (all ported validators).** `readJsonFile` wraps the
   raw `JSON.parse` error with the offending path.
   - Old: the raw parse error, e.g.
     `Expected property name or '}' in JSON at position 2 (line 1 column 3)`;
     exit code 1.
   - New: `Failed to parse JSON in /abs/path/to/file.json: Expected property
     name or '}' in JSON at position 2 (line 1 column 3)`; exit code 1.

`PLACEHOLDER_VALUES` is the shared placeholder policy for helpers that opt into
`isPlaceholderValue` or `ensureNonPlaceholderString`. It matches the current
`release-gates` evidence metadata policy, including `to-be-filled`, so helper
consumers reject the same non-concrete values consistently.
