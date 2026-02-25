import { createServer } from 'http';
import {
  type GateSnapshot,
  resolveContractGateSnapshotStore,
} from '../../src/plugins/contractGateSnapshotStore';

describe('contract gate snapshot store', () => {
  test('supports built-in http stateStore adapter', async () => {
    let snapshot: GateSnapshot | undefined;

    const server = createServer((req, res) => {
      if (!req.url || req.url !== '/snapshot') {
        res.statusCode = 404;
        res.end();
        return;
      }

      if (req.method === 'GET') {
        if (!snapshot) {
          res.statusCode = 404;
          res.end();
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(snapshot));
        return;
      }

      if (req.method === 'PUT') {
        let body = '';
        req.on('data', chunk => {
          body += String(chunk);
        });
        req.on('end', () => {
          snapshot = JSON.parse(body);
          res.statusCode = 204;
          res.end();
        });
        return;
      }

      res.statusCode = 405;
      res.end();
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const endpoint = `http://127.0.0.1:${String(port)}/snapshot`;

    try {
      const store = await resolveContractGateSnapshotStore({
        appDirectory: process.cwd(),
        gateSnapshotPath: '.modern/contract-gates.json',
        stateStore: {
          module: 'http',
          options: {
            endpoint,
          },
        },
      });

      expect(await store.readSnapshot()).toBeUndefined();

      await store.writeSnapshot({
        schemaVersion: 1,
        updatedAt: Date.now(),
        gates: {
          'runtime-mf-fallback-health': {
            passed: false,
          },
        },
      });

      const loaded = await store.readSnapshot();
      expect(loaded?.gates?.['runtime-mf-fallback-health']).toEqual({
        passed: false,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
