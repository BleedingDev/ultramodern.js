export const DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT =
  '/_modern/contract-gates/runtime-fallback';

export const DEFAULT_RUNTIME_STATUS_ENDPOINT = '/_modern/runtime/status';

export const DEFAULT_RUNTIME_FALLBACK_GATE_NAME = 'runtime-mf-fallback-health';

export const DEFAULT_RUNTIME_FALLBACK_FAILURE_HOLD_MS = 5 * 60_000;

export const DEFAULT_RUNTIME_FALLBACK_MAX_BODY_BYTES = 16 * 1024;

export const DEFAULT_RUNTIME_FALLBACK_AUTH_HEADER =
  'x-modernjs-runtime-signal-token';

export const DEFAULT_RUNTIME_FALLBACK_TRUST_MAX_SIGNALS_PER_WINDOW = 30;

export const DEFAULT_RUNTIME_FALLBACK_TRUST_WINDOW_MS = 60_000;

export const DEFAULT_RUNTIME_FALLBACK_TRUST_DEDUPE_WINDOW_MS = 10_000;
