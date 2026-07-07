import type { TelemetryEnvelope, TelemetryExporter } from './envelope';

export interface OtlpExporterOptions {
  endpoint?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface VictoriaMetricsExporterOptions extends OtlpExporterOptions {
  metricPrefix?: string;
}

const DEFAULT_OTLP_ENDPOINT = 'http://127.0.0.1:4318/v1/logs';
const DEFAULT_VM_ENDPOINT = 'http://127.0.0.1:8428/api/v1/import/prometheus';
const DEFAULT_TIMEOUT_MS = 5_000;

async function postWithTimeout(options: {
  endpoint: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  if (typeof (timer as NodeJS.Timeout).unref === 'function') {
    (timer as NodeJS.Timeout).unref();
  }

  try {
    const response = await fetch(options.endpoint, {
      method: 'POST',
      body: options.body,
      headers: options.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Telemetry exporter request failed: ${response.status} ${response.statusText}`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeMetricName(value: string) {
  return value.replace(/[^a-zA-Z0-9_:]/g, '_').replace(/_+/g, '_');
}

function escapeLabelValue(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function toPrometheusLine(
  envelope: TelemetryEnvelope,
  metricPrefix: string,
): string {
  const metricName = sanitizeMetricName(
    `${metricPrefix}_${envelope.signalType}_${envelope.name}`,
  );
  const labels: Record<string, string> = {
    service: envelope.service,
    module: envelope.module,
    environment: envelope.environment,
    ...(envelope.level ? { level: envelope.level } : {}),
    ...(envelope.traceId ? { trace_id: envelope.traceId } : {}),
    ...(envelope.spanId ? { span_id: envelope.spanId } : {}),
    ...(envelope.tags || {}),
  };

  const labelPairs = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) =>
        `${sanitizeMetricName(key)}="${escapeLabelValue(value)}"`,
    );
  const labelText = labelPairs.length > 0 ? `{${labelPairs.join(',')}}` : '';
  const value =
    typeof envelope.value === 'number' && Number.isFinite(envelope.value)
      ? envelope.value
      : 1;
  const timestampMs = envelope.timestamp;
  return `${metricName}${labelText} ${value} ${timestampMs}`;
}

export function createOtlpTelemetryExporter(
  options: OtlpExporterOptions = {},
): TelemetryExporter {
  const endpoint = options.endpoint || DEFAULT_OTLP_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = {
    'content-type': 'application/json',
    ...(options.headers || {}),
  };

  return {
    name: 'otlp',
    async emit(batch) {
      if (batch.length === 0) {
        return;
      }

      const body = JSON.stringify({
        resource: {
          service: batch[0]?.service,
          module: batch[0]?.module,
          environment: batch[0]?.environment,
        },
        emittedAt: Date.now(),
        events: batch,
      });

      await postWithTimeout({
        endpoint,
        body,
        headers,
        timeoutMs,
      });
    },
  };
}

export function createVictoriaMetricsTelemetryExporter(
  options: VictoriaMetricsExporterOptions = {},
): TelemetryExporter {
  const endpoint = options.endpoint || DEFAULT_VM_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const metricPrefix = sanitizeMetricName(options.metricPrefix || 'modernjs');
  const headers = {
    'content-type': 'text/plain; version=0.0.4',
    ...(options.headers || {}),
  };

  return {
    name: 'victoria-metrics',
    async emit(batch) {
      if (batch.length === 0) {
        return;
      }

      const lines = batch.map(item => toPrometheusLine(item, metricPrefix));
      await postWithTimeout({
        endpoint,
        body: `${lines.join('\n')}\n`,
        headers,
        timeoutMs,
      });
    },
  };
}

export function maybeWarnLegacyOtlpEndpoint(endpoint: string | undefined) {
  if (!endpoint || !endpoint.includes('/v1/metrics')) {
    return;
  }
  // Keep this warning lightweight and runtime-safe.
  // eslint-disable-next-line no-console
  console.warn(
    `[telemetry] OTLP endpoint "${endpoint}" looks like a metrics path. UltraModern telemetry exporter expects log-style envelopes (default: ${DEFAULT_OTLP_ENDPOINT}).`,
  );
}
