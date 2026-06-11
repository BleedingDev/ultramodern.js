/**
 * Single typed pass over every environment variable consumed by the
 * ultramodern.js server runtime extensions (telemetry pipeline, contract-gate
 * canary autopilot and module federation runtime helpers).
 *
 * All modules in this package read environment state exclusively through
 * `parseServerRuntimeExtensionsEnv()` so the full surface is documented and
 * testable in one place. See the package README for per-variable docs.
 */

export const DEFAULT_TELEMETRY_OTLP_ENDPOINT = 'http://127.0.0.1:4318/v1/logs';
export const DEFAULT_TELEMETRY_VICTORIA_METRICS_ENDPOINT =
  'http://127.0.0.1:8428/api/v1/import/prometheus';
export const DEFAULT_MF_REMOTE_MANIFEST_TIMEOUT_MS = 1_500;
export const DEFAULT_ENVIRONMENT_NAME = 'development';

export interface ServerRuntimeExtensionsEnv {
  /**
   * `MODERN_ENV` — deployment environment name loaded by the Modern.js env
   * bootstrap (`.env.{MODERN_ENV}`). Undefined when unset or blank.
   */
  modernEnv?: string;
  /** `NODE_ENV` — standard Node.js environment name. Undefined when unset or blank. */
  nodeEnv?: string;
  /**
   * Effective telemetry environment label:
   * `MODERN_ENV` || `NODE_ENV` || `"development"`.
   */
  environmentName: string;
  /**
   * `MODERN_CONTRACT_GATES_FILE` — path of the contract-gate snapshot file
   * (absolute, or relative to the app directory). Undefined when unset.
   */
  contractGatesFile?: string;
  /**
   * `MODERN_TELEMETRY_OTLP_ENDPOINT` — default endpoint for the OTLP
   * log-envelope exporter when `server.telemetry.exporters.otlp.endpoint`
   * is not configured.
   */
  telemetryOtlpEndpoint: string;
  /**
   * `MODERN_TELEMETRY_VICTORIA_ENDPOINT` — default endpoint for the
   * VictoriaMetrics exporter when
   * `server.telemetry.exporters.victoriaMetrics.endpoint` is not configured.
   */
  telemetryVictoriaMetricsEndpoint: string;
  /**
   * `MODERN_MF_REMOTE_MANIFEST_TIMEOUT_MS` — timeout (ms) for fetching remote
   * module federation manifests during SSR CSS collection. Invalid or
   * non-positive values fall back to the default (1500ms).
   */
  mfRemoteManifestTimeoutMs: number;
}

const readString = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readPositiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const raw = readString(value);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

/**
 * Parse all environment variables consumed by this package in one typed,
 * documented pass. Defaults are applied here so consumers never touch
 * `process.env` directly.
 */
export const parseServerRuntimeExtensionsEnv = (
  env: Record<string, string | undefined> = process.env,
): ServerRuntimeExtensionsEnv => {
  const modernEnv = readString(env.MODERN_ENV);
  const nodeEnv = readString(env.NODE_ENV);

  return {
    modernEnv,
    nodeEnv,
    environmentName: modernEnv || nodeEnv || DEFAULT_ENVIRONMENT_NAME,
    contractGatesFile: readString(env.MODERN_CONTRACT_GATES_FILE),
    telemetryOtlpEndpoint:
      readString(env.MODERN_TELEMETRY_OTLP_ENDPOINT) ||
      DEFAULT_TELEMETRY_OTLP_ENDPOINT,
    telemetryVictoriaMetricsEndpoint:
      readString(env.MODERN_TELEMETRY_VICTORIA_ENDPOINT) ||
      DEFAULT_TELEMETRY_VICTORIA_METRICS_ENDPOINT,
    mfRemoteManifestTimeoutMs: readPositiveInteger(
      env.MODERN_MF_REMOTE_MANIFEST_TIMEOUT_MS,
      DEFAULT_MF_REMOTE_MANIFEST_TIMEOUT_MS,
    ),
  };
};
