import { RuntimeCompatibilityError } from '../src/runtime/compatibility';
import {
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

  test('maps trust origin isolation violations to origin_isolation_violation reason', () => {
    const error = new RemoteTrustPolicyError({
      appName: 'dashboard',
      entry: 'https://remote.example.com/remoteEntry.js',
      reason: 'origin_isolation_violation',
      origin: 'https://remote.example.com',
      expectedOrigin: 'https://isolated.example.com',
    });

    expect(inferFallbackReason(error)).toBe('origin_isolation_violation');
    expect(inferFallbackPhase(error)).toBe('bootstrap');
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
        reason: 'remote_load_failed',
        phase: 'load',
        appName: 'dashboard',
        entry: 'https://remote.example.com/remoteEntry.js',
        message: 'load failed',
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
      reason: 'remote_load_failed',
      phase: 'load',
      appName: 'dashboard',
      entry: 'https://remote.example.com/remoteEntry.js',
      message: 'load failed',
    });

    expect(eventHandler).toHaveBeenCalledTimes(1);
    const emittedEvent = eventHandler.mock.calls[0][0] as CustomEvent;
    expect(emittedEvent.detail).toMatchObject({
      reason: payload.reason,
      phase: payload.phase,
      appName: payload.appName,
      entry: payload.entry,
    });
    expect(typeof payload.timestamp).toBe('number');

    window.removeEventListener(
      'modernjs:test-mf-fallback',
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
        reason: 'runtime_init_failed',
        phase: 'bootstrap',
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
