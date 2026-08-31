import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import type { WorkspaceApp } from '../src/ultramodern-workspace/types';
import { createZeropsYaml } from '../src/ultramodern-workspace/zerops';

type CommandRecord = {
  argv: string[];
  cwd: string;
};

function writeExecutable(filePath: string, source: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `#!/usr/bin/env node\n${source}`, 'utf-8');
  fs.chmodSync(filePath, 0o755);
}

function readCommandRecords(filePath: string) {
  return fs
    .readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as CommandRecord);
}

const ownership = {
  team: 'platform',
  slack: '#platform',
  pagerDuty: 'platform',
  runbookRef: 'docs/runbook.md',
  adrRef: 'docs/adr.md',
  blastRadius: {
    tier: 'low',
    references: [],
  },
};

test('Zerops commands preserve interpolated arguments and launch the materialized runtime', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-zerops-command-'));
  const app: WorkspaceApp = {
    id: "catalog 'quoted' app",
    directory: "verticals/catalog 'quoted'",
    packageSuffix: "catalog 'quoted' pkg",
    displayName: 'Catalog',
    kind: 'vertical',
    portEnv: 'CATALOG_PORT',
    port: 3050,
    mfName: 'catalog',
    api: {
      prefix: '/catalog api',
      stem: "catalog 'stem'",
      consumedBy: [],
    },
    ownership,
  };

  const document = yaml.load(createZeropsYaml('acme', [app])) as {
    zerops: Array<Record<string, any>>;
  };
  const [service] = document.zerops;

  try {
    assert.equal(service.setup, "catalog 'quoted' app");
    assert.equal(
      service.deploy.readinessCheck.httpGet.path,
      "/catalog api/catalog 'stem'/readiness",
    );
    assert.equal(service.build.buildCommands.length, 1);

    const fakeHome = path.join(tempRoot, 'home');
    const fakeBin = path.join(tempRoot, 'bin');
    const commandRecordPath = path.join(tempRoot, 'mise-records.jsonl');
    const serveRecordPath = path.join(tempRoot, 'serve-record.json');
    const runtimeDirectory = path.join(tempRoot, '.zerops/runtime', app.id);
    fs.mkdirSync(path.join(fakeHome, '.local/bin'), { recursive: true });
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    const workspaceRealPath = fs.realpathSync(tempRoot);
    const runtimeRealPath = fs.realpathSync(runtimeDirectory);
    fs.mkdirSync(path.join(tempRoot, 'topology/local-overlays'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempRoot, 'topology/reference-topology.json'),
      '{}\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tempRoot, 'topology/local-overlays/development.json'),
      '{}\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(runtimeDirectory, 'package.json'),
      `${JSON.stringify({ scripts: { serve: 'node index.js' } }, null, 2)}\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(runtimeDirectory, 'index.js'),
      "require('node:fs').writeFileSync(process.env.UM_ZEROPS_SERVE_RECORD, JSON.stringify({ cwd: process.cwd(), service: process.env.ULTRAMODERN_ZEROPS_SERVICE }));\n",
      'utf-8',
    );

    writeExecutable(
      path.join(fakeBin, 'curl'),
      "process.stdout.write(':\\n');\n",
    );
    writeExecutable(
      path.join(fakeHome, '.local/bin/mise'),
      `
const fs = require('node:fs');
fs.appendFileSync(
  process.env.UM_ZEROPS_COMMAND_RECORD,
  JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + '\\n',
);
`,
    );

    const probeEnvironment = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
      ULTRAMODERN_ZEROPS_SERVICE: app.id,
      UM_ZEROPS_COMMAND_RECORD: commandRecordPath,
      UM_ZEROPS_SERVE_RECORD: serveRecordPath,
    };
    execFileSync('/bin/sh', ['-c', service.build.buildCommands[0]], {
      cwd: tempRoot,
      env: probeEnvironment,
      stdio: 'pipe',
    });

    assert.deepEqual(readCommandRecords(commandRecordPath), [
      { argv: ['install'], cwd: workspaceRealPath },
      {
        argv: ['exec', '--', 'pnpm', 'install', '--frozen-lockfile'],
        cwd: workspaceRealPath,
      },
      {
        argv: [
          'exec',
          '--',
          'pnpm',
          '--filter',
          "@acme/catalog 'quoted' pkg",
          'run',
          'build',
        ],
        cwd: workspaceRealPath,
      },
      {
        argv: [
          'exec',
          '--',
          'pnpm',
          'run',
          'zerops:materialize',
          '--',
          '--app',
          "catalog 'quoted' app",
          '--package',
          "@acme/catalog 'quoted' pkg",
          '--package-dir',
          "verticals/catalog 'quoted'",
        ],
        cwd: workspaceRealPath,
      },
    ]);
    assert.equal(
      fs.readFileSync(path.join(runtimeDirectory, 'topology.json'), 'utf-8'),
      '{}\n',
    );
    assert.equal(
      fs.readFileSync(
        path.join(runtimeDirectory, 'local-overlay.json'),
        'utf-8',
      ),
      '{}\n',
    );

    execFileSync('/bin/sh', ['-c', service.run.start], {
      cwd: tempRoot,
      env: probeEnvironment,
      stdio: 'pipe',
    });
    const startResult = JSON.parse(
      fs.readFileSync(serveRecordPath, 'utf-8'),
    ) as {
      cwd: string;
      service: string;
    };
    assert.deepEqual(startResult, {
      cwd: runtimeRealPath,
      service: app.id,
    });
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});
