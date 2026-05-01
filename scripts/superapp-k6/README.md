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

The runner passes `BASE_URL`, `SUPERAPP_K6_BASE_URL`, `SUPERAPP_K6_RUN_ID`,
`SUPERAPP_K6_OUTPUT_DIR`, `SUPERAPP_K6_SUMMARY`, `SUPERAPP_K6_TARGET`, and
`SUPERAPP_K6_PROFILE` into the k6 process.
