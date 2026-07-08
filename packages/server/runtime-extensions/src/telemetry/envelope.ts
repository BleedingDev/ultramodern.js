import type { LogEvent, MonitorEvent } from '@modern-js/types';

export type TelemetrySignalType = 'log' | 'metric' | 'trace';

export interface TelemetryEnvelope {
  timestamp: number;
  service: string;
  module: string;
  environment: string;
  signalType: TelemetrySignalType;
  name: string;
  level?: string;
  value?: number;
  unit?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  tags?: Record<string, string>;
  attributes?: Record<string, unknown>;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
}

export interface TelemetryExporter {
  name: string;
  init?: (context: {
    service: string;
    module: string;
    environment: string;
  }) => void | Promise<void>;
  emit: (batch: TelemetryEnvelope[]) => void | Promise<void>;
  flush?: () => void | Promise<void>;
  shutdown?: () => void | Promise<void>;
}

export function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) {
    return max;
  }

  return Math.max(min, Math.min(max, value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redactObject(
  value: unknown,
  redactionKeys: Set<string>,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (redactionKeys.has(key)) {
      output[key] = '[REDACTED]';
      continue;
    }

    if (Array.isArray(nested)) {
      output[key] = nested.map(item => {
        if (isRecord(item)) {
          return redactObject(item, redactionKeys);
        }
        return item;
      });
      continue;
    }

    if (isRecord(nested)) {
      output[key] = redactObject(nested, redactionKeys);
      continue;
    }

    output[key] = nested;
  }

  return output;
}

function normalizeLabels(labels: Record<string, unknown> | undefined) {
  if (!labels) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === undefined || value === null) {
      continue;
    }
    normalized[key] = String(value);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function extractError(args: unknown[]): TelemetryEnvelope['error'] | undefined {
  for (const arg of args) {
    if (arg instanceof Error) {
      return {
        name: arg.name,
        message: arg.message,
        stack: arg.stack,
      };
    }
  }

  return undefined;
}

export function toTelemetryEnvelope(
  event: MonitorEvent,
  input: {
    service: string;
    module: string;
    environment: string;
    traceId?: string;
    spanId?: string;
    attributes?: Record<string, unknown>;
  },
): TelemetryEnvelope {
  const base: Pick<
    TelemetryEnvelope,
    | 'timestamp'
    | 'service'
    | 'module'
    | 'environment'
    | 'traceId'
    | 'spanId'
    | 'attributes'
  > = {
    timestamp: Date.now(),
    service: input.service,
    module: input.module,
    environment: input.environment,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.spanId ? { spanId: input.spanId } : {}),
    ...(input.attributes ? { attributes: input.attributes } : {}),
  };

  if (event.type === 'log') {
    const payload = event.payload as LogEvent['payload'];
    const args = payload.args || [];
    const signalType: TelemetrySignalType =
      payload.level === 'trace' ? 'trace' : 'log';
    return {
      ...base,
      signalType,
      name: payload.message,
      level: payload.level,
      attributes: {
        ...(base.attributes || {}),
        args,
      },
      error: extractError(args),
    };
  }

  if (event.type === 'timing') {
    return {
      ...base,
      signalType: 'metric',
      name: event.payload.name,
      value: event.payload.dur,
      unit: 'ms',
      tags: normalizeLabels(event.payload.tags),
      attributes: {
        ...(base.attributes || {}),
        desc: event.payload.desc,
        args: event.payload.args,
      },
    };
  }

  return {
    ...base,
    signalType: 'metric',
    name: event.payload.name,
    value: 1,
    unit: 'count',
    tags: normalizeLabels(event.payload.tags),
    attributes: {
      ...(base.attributes || {}),
      args: event.payload.args,
    },
  };
}
