import fs from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import {
  createRuntimeFallbackSignalRuntimeState,
  normalizeRuntimeFallbackSignalAuthConfig,
  normalizeRuntimeFallbackTrustPolicy,
  TelemetryRegistry,
} from '../src/libs/telemetry';
import { Server } from '../src/server/index';

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-prod-runtime-signals-'));

const createServer = () =>
  new Server({
    pwd: process.cwd(),
    config: {
      output: {},
    },
    logger: {
      info: rstest.fn(),
      warn: rstest.fn(),
      error: rstest.fn(),
    },
    metrics: {},
  } as any);

const createJsonRequest = (
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) => {
  const req = new PassThrough() as unknown as IncomingMessage;
  (req as any).method = 'POST';
  (req as any).url = '/_modern/contract-gates/runtime-fallback';
  const rawBody = JSON.stringify(body);
  (req as any).headers = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(rawBody)),
    ...(headers || {}),
  };
  process.nextTick(() => {
    req.end(rawBody);
  });
  return req;
};

const createGetRequest = (headers?: Record<string, string>) =>
  ({
    method: 'GET',
    headers: headers || {},
  }) as IncomingMessage;

const createResponse = () => {
  let body = '';
  const headerMap: Record<string, string> = {};
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headerMap[name.toLowerCase()] = value;
    },
    end(chunk?: string) {
      body = chunk ? String(chunk) : '';
    },
  } as unknown as ServerResponse;
  return {
    res,
    getBody: () => body,
    getHeader: (name: string) => headerMap[name.toLowerCase()],
  };
};

describe('prod-server runtime signal handlers', () => {
  test('enforces auth and trust policy before persisting runtime fallback gate', async () => {
    const dir = makeTempDir();
    const snapshotPath = path.join(dir, '.modern/contract-gates.json');
    const server = createServer() as any;
    server.runtimeFallbackSignalConfig = {
      endpoint: '/_modern/contract-gates/runtime-fallback',
      gateName: 'runtime-mf-fallback-health',
      gateSnapshotPath: snapshotPath,
      failureHoldMs: 5_000,
      maxBodyBytes: 4_096,
      auth: normalizeRuntimeFallbackSignalAuthConfig({
        enabled: true,
        headerName: 'x-modernjs-runtime-signal-token',
        expectedValue: 'secret-token',
      }),
      trustPolicy: normalizeRuntimeFallbackTrustPolicy({
        allowedApps: ['crm-shell'],
        allowedEntryOrigins: ['https://erp.example.com'],
        expectedRuntimeDigests: {
          'crm-shell': 'digest-crm-v1',
        },
        enforceRuntimeDigest: true,
      }),
      runtimeState: createRuntimeFallbackSignalRuntimeState(),
      workerLane: {
        enabled: true,
        timeoutMs: 2_000,
        workerSuccessCount: 0,
        fallbackToMainThreadCount: 0,
      },
    };

    try {
      const unauthorizedReq = createJsonRequest({
        reason: 'remote_load_failed',
        phase: 'load',
        appName: 'crm-shell',
        entry: 'https://erp.example.com/remoteEntry.js',
        runtimeDigest: 'digest-crm-v1',
      });
      const unauthorizedRes = createResponse();
      await server.handleRuntimeFallbackSignal(
        unauthorizedReq,
        unauthorizedRes.res,
      );
      expect(unauthorizedRes.res.statusCode).toBe(401);
      expect(fs.existsSync(snapshotPath)).toBe(false);

      const untrustedReq = createJsonRequest(
        {
          reason: 'remote_load_failed',
          phase: 'load',
          appName: 'unknown-app',
          entry: 'https://erp.example.com/remoteEntry.js',
          runtimeDigest: 'digest-crm-v1',
        },
        {
          'x-modernjs-runtime-signal-token': 'secret-token',
        },
      );
      const untrustedRes = createResponse();
      await server.handleRuntimeFallbackSignal(untrustedReq, untrustedRes.res);
      expect(untrustedRes.res.statusCode).toBe(403);
      expect(fs.existsSync(snapshotPath)).toBe(false);

      const trustedReq = createJsonRequest(
        {
          reason: 'remote_load_failed',
          phase: 'load',
          appName: 'crm-shell',
          entry: 'https://erp.example.com/remoteEntry.js',
          runtimeDigest: 'digest-crm-v1',
        },
        {
          'x-modernjs-runtime-signal-token': 'secret-token',
        },
      );
      const trustedRes = createResponse();
      await server.handleRuntimeFallbackSignal(trustedReq, trustedRes.res);
      expect(trustedRes.res.statusCode).toBe(202);
      expect(fs.existsSync(snapshotPath)).toBe(true);
      expect(
        server.runtimeFallbackSignalConfig.workerLane.workerSuccessCount,
      ).toBe(1);
      expect(
        server.runtimeFallbackSignalConfig.workerLane.fallbackToMainThreadCount,
      ).toBe(0);

      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
        gates?: Record<string, any>;
      };
      expect(snapshot.gates?.['runtime-mf-fallback-health']?.passed).toBe(
        false,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('deduplicates repeated payloads and rate-limits unique payloads per source window', async () => {
    const dir = makeTempDir();
    const snapshotPath = path.join(dir, '.modern/contract-gates.json');
    const server = createServer() as any;
    server.runtimeFallbackSignalConfig = {
      endpoint: '/_modern/contract-gates/runtime-fallback',
      gateName: 'runtime-mf-fallback-health',
      gateSnapshotPath: snapshotPath,
      failureHoldMs: 5_000,
      maxBodyBytes: 4_096,
      auth: normalizeRuntimeFallbackSignalAuthConfig(),
      trustPolicy: normalizeRuntimeFallbackTrustPolicy({
        allowedApps: ['crm-shell'],
        dedupeWindowMs: 60_000,
        maxSignalsPerWindow: 1,
        windowMs: 60_000,
      }),
      runtimeState: createRuntimeFallbackSignalRuntimeState(),
      workerLane: {
        enabled: false,
        timeoutMs: 250,
        workerSuccessCount: 0,
        fallbackToMainThreadCount: 0,
      },
    };

    try {
      const basePayload = {
        reason: 'remote_mount_failed',
        phase: 'mount',
        appName: 'crm-shell',
        entry: 'https://erp.example.com/remoteEntry.js',
      };

      const firstRes = createResponse();
      await server.handleRuntimeFallbackSignal(
        createJsonRequest(basePayload),
        firstRes.res,
      );
      expect(firstRes.res.statusCode).toBe(202);

      const duplicateRes = createResponse();
      await server.handleRuntimeFallbackSignal(
        createJsonRequest(basePayload),
        duplicateRes.res,
      );
      expect(duplicateRes.res.statusCode).toBe(202);
      expect(duplicateRes.getBody()).toContain('"deduped":true');

      const uniqueRes = createResponse();
      await server.handleRuntimeFallbackSignal(
        createJsonRequest({
          ...basePayload,
          reason: 'remote_load_failed',
        }),
        uniqueRes.res,
      );
      expect(uniqueRes.res.statusCode).toBe(429);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('runtime status endpoint requires auth when runtime signal auth is enabled', async () => {
    const server = createServer() as any;
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    server.telemetryRegistry = registry;
    server.runtimeFallbackSignalConfig = {
      endpoint: '/_modern/contract-gates/runtime-fallback',
      gateName: 'runtime-mf-fallback-health',
      gateSnapshotPath: path.join(makeTempDir(), '.modern/contract-gates.json'),
      failureHoldMs: 5_000,
      maxBodyBytes: 4_096,
      auth: normalizeRuntimeFallbackSignalAuthConfig({
        enabled: true,
        headerName: 'x-modernjs-runtime-signal-token',
        expectedValue: 'status-secret',
      }),
      trustPolicy: normalizeRuntimeFallbackTrustPolicy(),
      runtimeState: createRuntimeFallbackSignalRuntimeState(),
      workerLane: {
        enabled: true,
        timeoutMs: 2_000,
        workerSuccessCount: 0,
        fallbackToMainThreadCount: 0,
      },
    };

    try {
      const unauthorizedRes = createResponse();
      await server.handleRuntimeStatus(createGetRequest(), unauthorizedRes.res);
      expect(unauthorizedRes.res.statusCode).toBe(401);

      const authorizedRes = createResponse();
      await server.handleRuntimeStatus(
        createGetRequest({
          'x-modernjs-runtime-signal-token': 'status-secret',
        }),
        authorizedRes.res,
      );
      expect(authorizedRes.res.statusCode).toBe(200);
      const payload = JSON.parse(authorizedRes.getBody()) as {
        ok?: boolean;
        telemetry?: { enabled?: boolean; queueStats?: { capacity?: number } };
        runtimeFallbackSignal?: {
          enabled?: boolean;
          endpoint?: string;
          workerLane?: {
            enabled?: boolean;
            timeoutMs?: number;
            workerSuccessCount?: number;
            fallbackToMainThreadCount?: number;
          };
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.telemetry?.enabled).toBe(true);
      expect(payload.telemetry?.queueStats?.capacity).toBeGreaterThan(0);
      expect(payload.runtimeFallbackSignal?.enabled).toBe(true);
      expect(payload.runtimeFallbackSignal?.endpoint).toBe(
        '/_modern/contract-gates/runtime-fallback',
      );
      expect(payload.runtimeFallbackSignal?.workerLane?.enabled).toBe(true);
      expect(payload.runtimeFallbackSignal?.workerLane?.timeoutMs).toBe(2_000);
      expect(
        payload.runtimeFallbackSignal?.workerLane?.workerSuccessCount,
      ).toBe(0);
    } finally {
      await registry.shutdown();
    }
  });
});
