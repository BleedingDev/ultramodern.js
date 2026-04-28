import { RuntimeCompatibilityError } from '../src/runtime/compatibility';
import {
  emitErrorFallbackTelemetry,
  emitFallbackTelemetry,
  inferFallbackPhase,
  inferFallbackReason,
} from '../src/runtime/fallbackTelemetry';
import { RemoteTrustPolicyError } from '../src/runtime/trust';
import type { RuntimeCompatibilityIssue } from '../src/runtime/useModuleApps';

describe('fallback telemetry contract', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('maps runtime compatibility errors to runtime_incompatible reason', () => {
    const issue: RuntimeCompatibilityIssue = {
      appName: 'dashboard',
      hostDigest: 'host-v1',
      remoteDigest: 'remote-v2',
      reason: 'digest_mismatch',
    };

    expect(inferFallbackReason(new RuntimeCompatibilityError(issue))).toBe(
      'runtime_incompatible',
    );
    expect(inferFallbackPhase(new RuntimeCompatibilityError(issue))).toBe(
      'compatibility',
    );
  });

  test('derives runtime compatibility appName when emitting structured fallback telemetry', () => {
    const issue: RuntimeCompatibilityIssue = {
      appName: 'dashboard',
      hostDigest: 'host-v1',
      remoteDigest: 'remote-v2',
      reason: 'digest_mismatch',
    };

    const payload = emitErrorFallbackTelemetry(
      {
        error: new RuntimeCompatibilityError(issue),
        phase: 'compatibility',
      },
      {
        emitConsole: false,
        emitWindowEvent: false,
        reportToServer: false,
      },
    );

    expect(payload).toMatchObject({
      schemaVersion: 1,
      runtimeSurface: 'module-federation',
      appName: 'dashboard',
      reason: 'runtime_incompatible',
      phase: 'compatibility',
      code: 'MV_RUNTIME_INCOMPATIBLE',
      trustDecision: 'trusted',
      compatibilityDecision: 'incompatible',
      parityClaimId: 'mv-runtime-parity',
    });
    expect(typeof payload.timestamp).toBe('string');
    expect(Date.parse(payload.timestamp)).not.toBeNaN();
    expect(typeof payload.traceId).toBe('string');
  });

  test('maps trust integrity mismatch to integrity_mismatch reason', () => {
    const error = new RemoteTrustPolicyError({
      appName: 'dashboard',
      entry: 'https://remote.example.com/remoteEntry.js',
      reason: 'integrity_mismatch',
      expectedIntegrity: 'sha256-expected',
      actualIntegrity: 'sha256-actual',
    });

    expect(inferFallbackReason(error)).toBe('integrity_mismatch');
    expect(inferFallbackPhase(error)).toBe('integrity');
  });

  test('derives trust error appName and entry when emitting structured fallback telemetry', () => {
    const error = new RemoteTrustPolicyError({
      appName: 'dashboard',
      entry: 'https://remote.example.com/remoteEntry.js',
      reason: 'integrity_mismatch',
      expectedIntegrity: 'sha256-expected',
      actualIntegrity: 'sha256-actual',
    });

    const payload = emitErrorFallbackTelemetry(
      {
        error,
        phase: 'integrity',
      },
      {
        emitConsole: false,
        emitWindowEvent: false,
        reportToServer: false,
      },
    );

    expect(payload).toMatchObject({
      appName: 'dashboard',
      entry: 'https://remote.example.com/remoteEntry.js',
      reason: 'integrity_mismatch',
      phase: 'integrity',
    });
  });

  test('maps trust origin isolation violations to origin_isolation_violation reason', () => {
    const error = new RemoteTrustPolicyError({
      appName: 'dashboard',
      entry: 'https://remote.example.com/remoteEntry.js',
      reason: 'origin_isolation_violation',
      origin: 'https://remote.example.com',
      expectedOrigin: 'https://isolated.example.com',
    });

    expect(inferFallbackReason(error)).toBe('origin_isolation_violation');
    expect(inferFallbackPhase(error)).toBe('trust');
  });

  test('maps trust attestation mismatch to attestation_mismatch reason', () => {
    const error = new RemoteTrustPolicyError({
      appName: 'dashboard',
      entry: 'https://remote.example.com/remoteEntry.js',
      reason: 'attestation_mismatch',
      expectedAttestation: 'attest-v2',
      actualAttestation: 'attest-v1',
    });

    expect(inferFallbackReason(error)).toBe('attestation_mismatch');
  });

  test('emits structured fallback telemetry through callback and browser event', () => {
    const onFallback = rstest.fn();
    const eventHandler = rstest.fn();
    window.addEventListener(
      'modernjs:test-mf-fallback',
      eventHandler as EventListener,
    );

    const payload = emitFallbackTelemetry(
      {
        reason: 'entry_load_failed',
        phase: 'load',
        appName: 'dashboard',
        entry: 'https://remote.example.com/remoteEntry.js',
        message: 'load failed',
        metadata: {
          runtimeDigest: 'runtime-v1',
          rawAuthorizationHeader: 'redacted-before-send',
        },
      },
      {
        eventName: 'modernjs:test-mf-fallback',
        emitConsole: false,
        reportToServer: false,
        onFallback,
      },
    );

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0][0]).toMatchObject({
      service: 'modernjs',
      module: 'plugin-garfish',
      environment: 'test',
      runtimeSurface: 'module-federation',
      reason: 'entry_load_failed',
      phase: 'load',
      appName: 'dashboard',
      entry: 'https://remote.example.com/remoteEntry.js',
      message: 'load failed',
      code: 'MV_ENTRY_LOAD_FAILED',
      trustDecision: 'trusted',
      compatibilityDecision: 'compatible',
      parityClaimId: 'mv-runtime-parity',
    });
    expect(onFallback.mock.calls[0][0].metadata).toEqual({
      runtimeDigest: 'runtime-v1',
    });

    expect(eventHandler).toHaveBeenCalledTimes(1);
    const emittedEvent = eventHandler.mock.calls[0][0] as CustomEvent;
    expect(emittedEvent.detail).toMatchObject({
      reason: payload.reason,
      phase: payload.phase,
      appName: payload.appName,
      entry: payload.entry,
    });
    expect(typeof payload.timestamp).toBe('string');

    window.removeEventListener(
      'modernjs:test-mf-fallback',
      eventHandler as EventListener,
    );
  });

  test('uses parity event name by default', () => {
    const eventHandler = rstest.fn();
    window.addEventListener(
      'modernjs:mv-runtime-parity',
      eventHandler as EventListener,
    );

    emitFallbackTelemetry(
      {
        reason: 'origin_not_allowed',
        phase: 'trust',
        appName: 'dashboard',
        entry: 'https://remote.example.com/remoteEntry.js',
      },
      {
        emitConsole: false,
        reportToServer: false,
        traceId: 'trace-default-event-name',
      },
    );

    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect((eventHandler.mock.calls[0][0] as CustomEvent).detail).toMatchObject(
      {
        reason: 'origin_not_allowed',
        code: 'MV_ORIGIN_NOT_ALLOWED',
        trustDecision: 'blocked',
        traceId: 'trace-default-event-name',
      },
    );

    window.removeEventListener(
      'modernjs:mv-runtime-parity',
      eventHandler as EventListener,
    );
  });

  test('reports fallback telemetry to server endpoint by default', () => {
    const mockFetch = rstest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 202 }),
      );
    global.fetch = mockFetch as typeof fetch;

    emitFallbackTelemetry(
      {
        reason: 'runtime_incompatible',
        phase: 'compatibility',
        appName: 'dashboard',
        entry: 'https://remote.example.com/remoteEntry.js',
      },
      {
        emitConsole: false,
        emitWindowEvent: false,
        reportEndpoint: 'https://telemetry.example.com/runtime-fallback',
        reportHeaders: {
          'x-modernjs-test': '1',
        },
      },
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://telemetry.example.com/runtime-fallback');
    expect(init.method).toBe('POST');
  });

  test('supports disabling fallback telemetry server reporting', () => {
    const mockFetch = rstest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 202 }),
      );
    global.fetch = mockFetch as typeof fetch;

    emitFallbackTelemetry(
      {
        reason: 'unknown',
        phase: 'recovery',
      },
      {
        emitConsole: false,
        emitWindowEvent: false,
        reportToServer: false,
        reportEndpoint: 'https://telemetry.example.com/runtime-fallback',
      },
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
