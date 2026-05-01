# SuperApp k6 Runner

`run-superapp-k6.js` owns the local k6 execution path for the SuperApp torture
load lane. It does not call proto or any package-manager plugin. It probes, in
order:

1. `--k6-bin`, `SUPERAPP_K6_BIN`, or `K6_BIN`
2. `node_modules/.bin/k6`
3. `k6` on `PATH`

When no usable binary is found, the runner writes a skipped diagnostic artifact
and exits `0` by default so CI jobs without k6 do not fail or pretend a load
test ran. Use `--require-k6` in a job that should fail when k6 is missing.

```bash
node scripts/superapp-k6/run-superapp-k6.js --check
SUPERAPP_K6_BIN=/usr/local/bin/k6 node scripts/superapp-k6/run-superapp-k6.js --check
```

Future k6 scenarios can use the same runner by passing `--script` and optional
k6 arguments after `--`:

```bash
node scripts/superapp-k6/run-superapp-k6.js \
  --script scripts/superapp-k6/smoke.js \
  -- --vus 4 --duration 30s
```

This lane also ships a deterministic scenario catalog and a k6 entry script:

```bash
node scripts/superapp-k6/run-superapp-k6.js --list-scenarios
node scripts/superapp-k6/run-superapp-k6.js --scenario smoke
node scripts/superapp-k6/run-superapp-k6.js --scenario mixed-read-write
node scripts/superapp-k6/run-superapp-k6.js --scenario all
```

The built-in catalog covers `smoke`, `ramp-up`, `spike`, `breakpoint`,
`mixed-read-write`, `tenant-boundary`, `chat`, `reset`, and
`chaos-triggering`. Each scenario declares k6 executor metadata plus weighted
operations with method, path, workload profile, artifact link, and reset/seed
references where applicable. Missing k6 still produces the same skipped
diagnostic artifact by default.

The runner passes `BASE_URL`, `SUPERAPP_K6_BASE_URL`, `SUPERAPP_K6_RUN_ID`,
`SUPERAPP_K6_OUTPUT_DIR`, `SUPERAPP_K6_SUMMARY`, `SUPERAPP_K6_SCENARIO`,
`SUPERAPP_K6_SCENARIOS`, `SUPERAPP_K6_TARGET`, `SUPERAPP_K6_PROFILE`, and
`SUPERAPP_K6_THRESHOLD_PROFILE` into the k6 process.

## Threshold Profiles

The default threshold profile is `smoke`. It is metadata-only and does not add
load thresholds or certification commands to the default PR/smoke profile.
Release and nightly certification opt in explicitly:

```bash
node scripts/superapp-k6/run-superapp-k6.js \
  --profile release \
  --threshold-profile release \
  --scenario smoke,ramp-up,mixed-read-write,tenant-boundary,chat,reset

node scripts/superapp-k6/run-superapp-k6.js \
  --profile nightly \
  --threshold-profile nightly \
  --scenario all
```

`release` applies stable thresholds across smoke, ramp-up, mixed read/write,
tenant-boundary, chat, and reset workloads. `nightly` applies stricter
thresholds across every built-in scenario, including spike, breakpoint, and
chaos-triggering. Missing k6 still uses the CI-safe skipped diagnostic unless a
caller sets `SUPERAPP_K6_REQUIRE=1` or passes `--require-k6`.

## App Server Orchestration

`--app-dir` starts the SuperApp server as a separate process before k6 runs,
health-checks it, waits for optional warmup, runs k6 as a separate process,
waits for optional cooldown, then stops the server. If k6 is unavailable, the
CI-safe fallback writes the skipped diagnostic artifact and does not start the
server.

```bash
node scripts/superapp-k6/run-superapp-k6.js \
  --app-dir tests/integration/superapp-portfolio \
  --scenario smoke \
  --app-host 127.0.0.1 \
  --app-port 8088 \
  --health-path / \
  --warmup-ms 5000 \
  --cooldown-ms 2000 \
  --server-cpu-affinity "server cores 0-3" \
  --load-cpu-affinity "k6 cores 4-7"
```

The server defaults to `pnpm run build` followed by `pnpm run serve` in the app
directory. Use `--skip-build`, `--build-command`/`--build-arg`, and
`--server-command`/`--server-arg` when a caller needs a prebuilt app or custom
launcher. The output directory captures `summary.json`, `orchestration.json`,
server stdout/stderr logs, k6 stdout/stderr logs, and the k6 summary export
when k6 runs.

CPU affinity is metadata-only in this Node runner because portable process CPU
binding is not available on macOS and Node. Use an external launcher such as
`taskset` on Linux for hard binding; keep the intended placement in
`--server-cpu-affinity` and `--load-cpu-affinity` so artifacts record it.

## Autocannon Endpoint Probes

`--autocannon-probes` switches the runner from k6 to endpoint-specific
autocannon probes. The probe catalog is derived from the k6 scenario operations
so GET and POST coverage keeps the same paths, headers, request bodies, workload
profile ids, and artifact links.

```bash
node scripts/superapp-k6/run-superapp-k6.js --list-autocannon-probes
node scripts/superapp-k6/run-superapp-k6.js \
  --autocannon-probes get-bootstrap,post-workflow \
  --base-url http://localhost:8080
```

Each probe runs autocannon with multiple workers by default and writes
`autocannon-probes.json` next to the normal `summary.json`. The artifact records
worker count, connections, duration, endpoint metadata, stdout/stderr paths, and
a classification that separates server HTTP failures from client/socket
failures such as timeouts and socket errors. `--threshold-profile release`
enforces stable endpoint thresholds; `--threshold-profile nightly` raises
nightly pressure and tightens latency ceilings. Neither profile is selected by
default, so smoke/default PR cost is unchanged.

If autocannon is not installed, the runner behaves like the k6 path and writes a
skipped diagnostic artifact unless `--require-autocannon` is set. To run through
`pnpm dlx` without adding a package dependency:

```bash
SUPERAPP_AUTOCANNON_BIN=pnpm \
SUPERAPP_AUTOCANNON_BIN_ARGS="dlx autocannon" \
node scripts/superapp-k6/run-superapp-k6.js --autocannon-probes all
```
