// @effect-diagnostics processEnv:off strictBooleanExpressions:off
import {
  createRequestEnvelope,
  DEFAULT_DATA_BATCH_HEADER,
  DEFAULT_DATA_ENVELOPE_HEADER,
  encodeRequestEnvelopeHeader,
  type RequestEnvelope,
  type SelectionPlan,
  type TraceContext,
} from '../data-platform';
import { isRecord, stringOrUndefined } from './guards';
import { normalizeRequest } from './request';
import { applyRequestContext } from './request-context';
import type {
  EffectOperationDescriptor,
  EffectRequestContext,
  EffectRequestContextInput,
  GeneratedEffectClientConfig,
  GeneratedEffectEndpoint,
} from './types';

const DATA_REQUEST_MODES = new Set([
  'cache-first',
  'stale-while-revalidate',
  'network-only',
]);
const DATA_MUTATION_MODES = new Set([
  'optimistic',
  'pessimistic',
  'fire-and-forget',
]);

const isDataRequestMode = (value: unknown) =>
  typeof value === 'string' && DATA_REQUEST_MODES.has(value);

const isDataMutationMode = (value: unknown) =>
  typeof value === 'string' && DATA_MUTATION_MODES.has(value);

const normalizeOrigin = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

const resolveRuntimeFetch = (): typeof fetch | undefined =>
  typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;

/**
 * Resolves the current page origin with a configurable fallback. Single
 * implementation shared by the configure() bootstrap and the data envelope
 * (the generated template previously duplicated data-platform's
 * `resolveRuntimeOrigin` with a different fallback).
 */

export const resolveOrigin = (defaultOrigin: string): string => {
  if (
    typeof window !== 'undefined' &&
    window.location &&
    typeof window.location.origin === 'string' &&
    window.location.origin
  ) {
    return window.location.origin;
  }

  const globalLocation = (
    globalThis as { location?: { origin?: unknown } } | undefined
  )?.location;
  if (
    globalLocation &&
    typeof globalLocation.origin === 'string' &&
    globalLocation.origin
  ) {
    return globalLocation.origin;
  }

  return defaultOrigin;
};

const resolveTargetOrigin = (
  dataPlatform: Record<string, unknown>,
  defaultOrigin: string,
): string => {
  const explicitTargetOrigin =
    stringOrUndefined(dataPlatform.targetOrigin) ||
    stringOrUndefined(dataPlatform.endpointOrigin);
  if (explicitTargetOrigin) {
    return explicitTargetOrigin;
  }
  return defaultOrigin;
};

const shouldAttachEnvelopeHeader = (
  dataPlatform: Record<string, unknown>,
  defaultOrigin: string,
): boolean => {
  if (dataPlatform.allowCrossOriginEnvelope === true) {
    return true;
  }
  const currentOrigin = normalizeOrigin(resolveOrigin(defaultOrigin));
  const targetOrigin = normalizeOrigin(
    resolveTargetOrigin(dataPlatform, defaultOrigin),
  );
  if (!currentOrigin || !targetOrigin) {
    return true;
  }
  return currentOrigin === targetOrigin;
};

const toEnvelopeInput = (
  normalizedRequest: Record<string, unknown>,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  if (isRecord(normalizedRequest.params)) {
    payload.path = normalizedRequest.params;
  }
  if (isRecord(normalizedRequest.query)) {
    payload.query = normalizedRequest.query;
  }
  if ('data' in normalizedRequest && normalizedRequest.data !== undefined) {
    payload.data = normalizedRequest.data;
  }
  if ('body' in normalizedRequest && normalizedRequest.body !== undefined) {
    payload.body = normalizedRequest.body;
  }
  if (
    typeof FormData !== 'undefined' &&
    normalizedRequest.formData instanceof FormData
  ) {
    payload.formData = Array.from(normalizedRequest.formData.entries()).map(
      ([key, value]) => [key, String(value)],
    );
  }
  if (
    typeof URLSearchParams !== 'undefined' &&
    normalizedRequest.formUrlencoded instanceof URLSearchParams
  ) {
    payload.formUrlencoded = normalizedRequest.formUrlencoded.toString();
  }
  return payload;
};

export const prepareEffectRequest = (options: {
  endpoint: GeneratedEffectEndpoint;
  operation: EffectOperationDescriptor;
  request: unknown;
  config: GeneratedEffectClientConfig;
  createEffectRequestContext: (
    requestContext: EffectRequestContextInput,
  ) => EffectRequestContext;
}): Record<string, unknown> => {
  const { endpoint, operation, request, config, createEffectRequestContext } =
    options;
  const defaultOrigin = config.defaultOrigin;
  const normalizedRequest = applyRequestContext(
    normalizeRequest(endpoint.method, request),
    request,
    createEffectRequestContext,
  );
  const dataPlatform =
    isRecord(request) && isRecord(request.dataPlatform)
      ? request.dataPlatform
      : {};
  const strictEnvelope =
    dataPlatform.requireEnvelope === true || dataPlatform.strict === true;

  if (
    !strictEnvelope &&
    !shouldAttachEnvelopeHeader(dataPlatform, defaultOrigin)
  ) {
    return normalizedRequest;
  }

  try {
    const namespace =
      stringOrUndefined(dataPlatform.appNamespace) || config.appNamespace;
    const origin =
      stringOrUndefined(dataPlatform.origin) || resolveOrigin(defaultOrigin);
    const envelope: RequestEnvelope = createRequestEnvelope({
      operation: {
        ...operation,
        appNamespace: namespace,
      },
      scope: {
        appNamespace: namespace,
        origin,
        tenantId: stringOrUndefined(dataPlatform.tenantId),
        userId: stringOrUndefined(dataPlatform.userId),
        sessionId: stringOrUndefined(dataPlatform.sessionId),
      },
      requestInput: {
        method: endpoint.method,
        routePath: endpoint.routePath,
        payload: toEnvelopeInput(normalizedRequest),
      },
      requestMode: isDataRequestMode(dataPlatform.requestMode)
        ? (dataPlatform.requestMode as RequestEnvelope['requestMode'])
        : undefined,
      mutationMode: isDataMutationMode(dataPlatform.mutationMode)
        ? (dataPlatform.mutationMode as RequestEnvelope['mutationMode'])
        : undefined,
      selectionPlan: isRecord(dataPlatform.selectionPlan)
        ? (dataPlatform.selectionPlan as SelectionPlan)
        : undefined,
      traceContext: isRecord(dataPlatform.traceContext)
        ? (dataPlatform.traceContext as unknown as TraceContext)
        : undefined,
      requireTraceContext: dataPlatform.requireTraceContext === true,
    });

    const headerName =
      stringOrUndefined(dataPlatform.envelopeHeader) ||
      DEFAULT_DATA_ENVELOPE_HEADER;
    const headers = isRecord(normalizedRequest.headers)
      ? { ...normalizedRequest.headers }
      : {};

    if (dataPlatform.batch === false) {
      headers[DEFAULT_DATA_BATCH_HEADER] = 'off';
    }

    headers[headerName] = encodeRequestEnvelopeHeader(envelope);

    return {
      ...normalizedRequest,
      headers,
    };
  } catch (error) {
    if (strictEnvelope) {
      throw error;
    }
    return normalizedRequest;
  }
};
