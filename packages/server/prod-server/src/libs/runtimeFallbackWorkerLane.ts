import { Worker } from 'node:worker_threads';

export const DEFAULT_RUNTIME_FALLBACK_WORKER_TIMEOUT_MS = 250;

export type RuntimeFallbackWorkerLaneConfig = {
  enabled: boolean;
  timeoutMs: number;
};

export type RuntimeFallbackWorkerLanePayload = {
  snapshotPath: string;
  gateName: string;
  failureHoldMs: number;
  payload: Record<string, unknown>;
  schemaVersion: number;
};

export type RuntimeFallbackWorkerLaneResult = {
  ok: boolean;
  error?: string;
};

const WORKER_SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);

const main = async () => {
  const now = Date.now();
  const snapshotPath = String(workerData.snapshotPath || '');
  const gateName = String(workerData.gateName || 'runtime-mf-fallback-health');
  const failureHoldMsRaw = Number(workerData.failureHoldMs);
  const failureHoldMs = Number.isFinite(failureHoldMsRaw) && failureHoldMsRaw > 0
    ? Math.floor(failureHoldMsRaw)
    : 300000;
  const schemaVersionRaw = Number(workerData.schemaVersion);
  const schemaVersion = Number.isFinite(schemaVersionRaw) ? schemaVersionRaw : 1;
  const payload = isRecord(workerData.payload) ? workerData.payload : {};

  let snapshot = {
    schemaVersion,
    updatedAt: now,
    gates: {},
  };

  try {
    const raw = await fs.readFile(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      snapshot = {
        schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : schemaVersion,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : now,
        gates: isRecord(parsed.gates) ? parsed.gates : {},
      };
    }
  } catch (_error) {
    // start from empty snapshot when file does not exist or cannot be parsed
  }

  const reason = typeof payload.reason === 'string' ? payload.reason : 'runtime_fallback';
  const phase = typeof payload.phase === 'string' ? payload.phase : 'unknown';
  const appName = typeof payload.appName === 'string' ? payload.appName : 'unknown';
  const entry = typeof payload.entry === 'string' ? payload.entry : undefined;

  snapshot.schemaVersion = schemaVersion;
  snapshot.updatedAt = now;
  snapshot.gates = isRecord(snapshot.gates) ? snapshot.gates : {};
  snapshot.gates[gateName] = {
    passed: false,
    reason: \`runtime_fallback:\${reason} phase=\${phase} app=\${appName}\${entry ? \` entry=\${entry}\` : ''}\`,
    updatedAt: now,
    expiresAt: now + failureHoldMs,
    source: 'runtime-mf-fallback-signal',
    metadata: payload,
  };

  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + '\\n');

  return {
    ok: true,
  };
};

main()
  .then(result => {
    parentPort.postMessage(result);
  })
  .catch(error => {
    parentPort.postMessage({
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  });
`;

const normalizeErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

export const persistRuntimeFallbackContractGateInWorker = async (
  payload: RuntimeFallbackWorkerLanePayload,
  config: RuntimeFallbackWorkerLaneConfig,
): Promise<RuntimeFallbackWorkerLaneResult> => {
  if (!config.enabled) {
    return {
      ok: false,
      error: 'worker_lane_disabled',
    };
  }

  return new Promise(resolve => {
    let settled = false;

    const worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      workerData: payload,
    });

    const finish = (result: RuntimeFallbackWorkerLaneResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      void worker.terminate().catch(() => {
        // best-effort cleanup only
      });
      resolve(result);
    };

    const timeoutId = setTimeout(
      () => {
        finish({
          ok: false,
          error: 'worker_lane_timeout',
        });
      },
      Math.max(25, config.timeoutMs),
    );

    worker.once('message', message => {
      if (message && typeof message === 'object' && message.ok === true) {
        finish({
          ok: true,
        });
        return;
      }

      finish({
        ok: false,
        error:
          message && typeof message === 'object' && 'error' in message
            ? String((message as { error?: unknown }).error || 'worker_error')
            : 'worker_error',
      });
    });

    worker.once('error', error => {
      finish({
        ok: false,
        error: normalizeErrorMessage(error),
      });
    });

    worker.once('exit', code => {
      if (settled || code === 0) {
        return;
      }
      finish({
        ok: false,
        error: `worker_lane_exit_${String(code)}`,
      });
    });
  });
};
