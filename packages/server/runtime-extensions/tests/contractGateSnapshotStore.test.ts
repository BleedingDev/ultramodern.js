import fs from 'fs';
import { createServer } from 'http';
import os from 'os';
import path from 'path';
import {
  createFileContractGateSnapshotStore,
  type GateSnapshot,
  resolveContractGateSnapshotStore,
} from '../src/contract-gate-snapshot-store';

const makeTempAppDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-gate-store-app-'));

const STORE_MODULE_SOURCE = (storeName: string) => `'use strict';
exports.createContractGateSnapshotStore = ({ gateSnapshotPath }) => {
  let snapshot;
  return {
    name: ${JSON.stringify(storeName)},
    async readSnapshot() {
      return snapshot;
    },
    async writeSnapshot(next) {
      snapshot = next;
    },
  };
};
`;

describe('contract gate snapshot store', () => {
  test('preserves previous file snapshot when write fails mid-write', async () => {
    const appDirectory = makeTempAppDir();
    try {
      const snapshotPath = path.join(
        appDirectory,
        '.modern/contract-gates.json',
      );
      const store = createFileContractGateSnapshotStore(snapshotPath);
      const initialSnapshot: GateSnapshot = {
        schemaVersion: 1,
        updatedAt: 1,
        gates: {
          'runtime-mf-fallback-health': { passed: true },
        },
      };

      await store.writeSnapshot(initialSnapshot);

      const realWriteFile = fs.promises.writeFile.bind(fs.promises);
      let sabotagedWrite = false;
      const writeSpy = rs
        .spyOn(fs.promises, 'writeFile')
        .mockImplementation(async (file, _data, options) => {
          if (!sabotagedWrite) {
            sabotagedWrite = true;
            await realWriteFile(file, '{broken', options);
            throw new Error('simulated write interruption');
          }

          return realWriteFile(file, _data, options);
        });

      try {
        await expect(
          store.writeSnapshot({
            schemaVersion: 1,
            updatedAt: 2,
            gates: {
              'runtime-mf-fallback-health': { passed: false },
            },
          }),
        ).rejects.toThrow('simulated write interruption');
      } finally {
        writeSpy.mockRestore();
      }

      await expect(store.readSnapshot()).resolves.toEqual(initialSnapshot);
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

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

  test('resolves relative stateStore modules against the app directory', async () => {
    const appDirectory = makeTempAppDir();

    try {
      fs.mkdirSync(path.join(appDirectory, 'stores'), { recursive: true });
      fs.writeFileSync(
        path.join(appDirectory, 'stores', 'gate-store.js'),
        STORE_MODULE_SOURCE('relative-store'),
        'utf8',
      );

      const store = await resolveContractGateSnapshotStore({
        appDirectory,
        gateSnapshotPath: path.join(
          appDirectory,
          '.modern/contract-gates.json',
        ),
        stateStore: {
          module: './stores/gate-store.js',
        },
      });

      expect(store.name).toBe('relative-store');
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  test('resolves bare-specifier stateStore modules from the app node_modules', async () => {
    const appDirectory = makeTempAppDir();

    try {
      // Simulate a pnpm-style strict install: the store package exists only
      // in the app's node_modules, never next to the framework package.
      const packageDir = path.join(appDirectory, 'node_modules', 'gate-store');
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(
        path.join(appDirectory, 'package.json'),
        JSON.stringify({ name: 'test-app', private: true }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(packageDir, 'package.json'),
        JSON.stringify({
          name: 'gate-store',
          version: '1.0.0',
          main: 'index.js',
        }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(packageDir, 'index.js'),
        STORE_MODULE_SOURCE('bare-specifier-store'),
        'utf8',
      );

      const store = await resolveContractGateSnapshotStore({
        appDirectory,
        gateSnapshotPath: path.join(
          appDirectory,
          '.modern/contract-gates.json',
        ),
        stateStore: {
          module: 'gate-store',
        },
      });

      expect(store.name).toBe('bare-specifier-store');

      await store.writeSnapshot({
        schemaVersion: 1,
        updatedAt: Date.now(),
        gates: { 'runtime-mf-fallback-health': { passed: false } },
      });
      const loaded = await store.readSnapshot();
      expect(loaded?.gates?.['runtime-mf-fallback-health']).toEqual({
        passed: false,
      });
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  test('reports a clear error when the stateStore module cannot be resolved', async () => {
    const appDirectory = makeTempAppDir();

    try {
      await expect(
        resolveContractGateSnapshotStore({
          appDirectory,
          gateSnapshotPath: path.join(
            appDirectory,
            '.modern/contract-gates.json',
          ),
          stateStore: {
            module: 'definitely-missing-gate-store',
          },
        }),
      ).rejects.toThrow(
        /Failed to load stateStore\.module "definitely-missing-gate-store"/,
      );
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });
});
