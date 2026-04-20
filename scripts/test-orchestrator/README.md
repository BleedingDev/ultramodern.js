# Test Orchestrator

Run and analyze the full `test*` script matrix in parallel lanes.

## Commands

- `pnpm run test:all:parallel`
  - Discovers `test*` scripts from `package.json`, `packages/**`, `tests/**`, and `benchmark/**`.
  - Skips aggregate wrapper scripts in `tests/package.json` so rankings reflect the underlying leaf suites.
  - Executes scripts in lane-based parallel workers.
  - Produces machine-readable artifacts in `.modern/full-test-run/parallel-<timestamp>/`.

- `pnpm run test:all:parallel:analyze`
  - Re-analyzes the latest run directory without executing tests.
  - Useful for fast iteration on reporting.

## Artifacts

Each run directory includes:

- `summary.json`: full run summary and per-script status
- `script-rankings.json`: scripts sorted by duration (slowest first)
- `slowest-tests.raw.json`: parsed slow test lines across logs
- `slowest-tests.unique.json`: unique test files/specs by max duration
- `failures.json`: extracted failure signatures and failing scripts
- `REPORT.md`: human-readable summary

## Optional Flags

- `--max-lanes <n>`: max parallel lanes (default `4`)
- `--timeout-default-ms <n>`: default script timeout (default `420000`)
- `--timeout-heavy-ms <n>`: timeout for heavy suites (default `900000`)
- `--timeout-runaway-ms <n>`: timeout for scripts explicitly marked with `test-orchestrator-runaway` (default `180000`)
- `--mode analyze --run-dir <path>`: analyze a specific run directory
