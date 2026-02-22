import { RuntimeCompatibilityError } from '../src/runtime';
import { RemoteTrustPolicyError } from '../src/runtime/trust';
import {
  emitFallbackTelemetry,
  inferFallbackReason,
} from '../src/runtime/fallbackTelemetry';
import type { RuntimeCompatibilityIssue } from '../src/runtime';

describe('fallback telemetry contract', () => {
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
    const onFallback = jest.fn();
    const eventHandler = jest.fn();
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
});
