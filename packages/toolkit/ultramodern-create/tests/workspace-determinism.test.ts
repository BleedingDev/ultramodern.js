import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import type { TestContext } from '@rstest/core';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { linkInstalledEffectCompiler } from './helpers/workspace-kit';

type FileTreeSnapshot = Map<string, Buffer>;

type GenerationProcess = {
  kind: 'formatter' | 'metadata';
  event: 'start' | 'exit';
  pid: number;
  time: number;
  code?: number;
};

function trackPhases(onTestFailed: TestContext['onTestFailed']) {
  const startedAt = performance.now();
  let phase = 'fixture setup';
  let phaseStartedAt = startedAt;
  onTestFailed(() => {
    const failedAt = performance.now();
    console.error(
      `[workspace-determinism] phase=${phase}; phase elapsed=${Math.round(failedAt - phaseStartedAt)}ms; total elapsed=${Math.round(failedAt - startedAt)}ms`,
    );
  });
  return (nextPhase: string) => {
    phase = nextPhase;
    phaseStartedAt = performance.now();
  };
}

async function generateFixedWorkspace(
  workspaceDir: string,
  setPhase: (phase: string) => void,
) {
  setPhase(`${path.basename(workspaceDir)}: generation`);
  await generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: 'deterministic-workspace',
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: {
      strategy: 'workspace',
    },
  });

  setPhase(`${path.basename(workspaceDir)}: compiler fixture setup`);
  linkInstalledEffectCompiler(workspaceDir);
  setPhase(`${path.basename(workspaceDir)}: addVertical`);
  await addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: 'catalog',
    modernVersion: '3.2.1',
  });
}

function collectFileTreeSnapshot(root: string) {
  const snapshot: FileTreeSnapshot = new Map();

  function walk(directory: string) {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((first, second) => first.name.localeCompare(second.name));

    for (const entry of entries) {
      // Keep installed compiler fixtures outside the authored-file snapshot.
      if (directory === root && entry.name === 'node_modules') {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path
        .relative(root, absolutePath)
        .split(path.sep)
        .join('/');

      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile()) {
        snapshot.set(relativePath, fs.readFileSync(absolutePath));
      } else if (entry.isSymbolicLink()) {
        snapshot.set(relativePath, Buffer.from(fs.readlinkSync(absolutePath)));
      } else {
        snapshot.set(relativePath, Buffer.from(`unsupported:${entry.name}`));
      }
    }
  }

  walk(root);

  return snapshot;
}

function firstFileTreeDifference(
  first: FileTreeSnapshot,
  second: FileTreeSnapshot,
) {
  const firstPaths = [...first.keys()].sort();
  const secondPaths = [...second.keys()].sort();
  const pathCount = Math.max(firstPaths.length, secondPaths.length);

  for (let index = 0; index < pathCount; index++) {
    const firstPath = firstPaths[index];
    const secondPath = secondPaths[index];

    if (firstPath === undefined) {
      return `extra file only in second tree: ${secondPath}`;
    }

    if (secondPath === undefined) {
      return `missing file from second tree: ${firstPath}`;
    }

    if (firstPath !== secondPath) {
      return `file set differs at sorted index ${index}: first has ${firstPath}, second has ${secondPath}`;
    }
  }

  for (const relativePath of firstPaths) {
    const firstBytes = first.get(relativePath);
    const secondBytes = second.get(relativePath);

    if (!firstBytes || !secondBytes) {
      return `file set lookup failed for ${relativePath}`;
    }

    if (!firstBytes.equals(secondBytes)) {
      return `contents differ for ${relativePath}: ${firstBytes.length} bytes in first tree, ${secondBytes.length} bytes in second tree`;
    }
  }

  return undefined;
}

test('generates byte-identical workspaces for a fixed shell and MicroVertical spec', async ({
  onTestFailed,
}) => {
  const setPhase = trackPhases(onTestFailed);
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-workspace-determinism-'),
  );
  const auditPath = path.join(tempRoot, 'processes.jsonl');
  const preloadPath = path.join(tempRoot, 'process-audit.cjs');
  const previousNodeOptions = process.env.NODE_OPTIONS;
  const previousAudit = process.env.UM_GENERATION_PROCESS_AUDIT;
  let processes: GenerationProcess[] = [];
  let capturedAt = Date.now();
  const readProcesses = () => {
    if (!fs.existsSync(auditPath)) return processes;
    const records = fs
      .readFileSync(auditPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as GenerationProcess);
    capturedAt = Date.now();
    return records;
  };
  onTestFailed(() => {
    try {
      processes = readProcesses();
    } catch {
      // The cleanup snapshot remains available if a live audit is incomplete.
    }
    const summary = ['formatter', 'metadata'].map(kind => {
      const started = processes.filter(
        record => record.kind === kind && record.event === 'start',
      );
      const durations: number[] = [];
      const active: number[] = [];
      for (const child of started) {
        const exit = processes.find(
          record => record.pid === child.pid && record.event === 'exit',
        );
        (exit ? durations : active).push(
          (exit?.time ?? capturedAt) - child.time,
        );
      }
      return {
        kind,
        started: started.length,
        completed: durations.length,
        completedMs: durations.reduce((sum, duration) => sum + duration, 0),
        longestMs: Math.max(0, ...durations, ...active),
        activeMs: active,
      };
    });
    console.error(
      `[workspace-determinism processes] ${JSON.stringify(summary)}`,
    );
  });

  try {
    // Observe the real CLIs and isolated config workers without replacing
    // subprocess calls or adding another generation workload.
    fs.writeFileSync(
      preloadPath,
      `const fs = require('node:fs');
const path = require('node:path');
const script = path.basename(process.argv[1] || '');
const kind = script === 'oxfmt' ? 'formatter' : script === 'config-metadata-worker.js' ? 'metadata' : undefined;
if (kind) {
  const record = event => fs.appendFileSync(process.env.UM_GENERATION_PROCESS_AUDIT, JSON.stringify({ kind, pid: process.pid, time: Date.now(), ...event }) + '\\n');
  record({ event: 'start' });
  process.once('exit', code => record({ event: 'exit', code }));
}
`,
    );
    process.env.NODE_OPTIONS = `${previousNodeOptions ?? ''} --import=${pathToFileURL(preloadPath).href}`;
    process.env.UM_GENERATION_PROCESS_AUDIT = auditPath;
    const firstWorkspaceDir = path.join(tempRoot, 'first');
    const secondWorkspaceDir = path.join(tempRoot, 'second');

    await generateFixedWorkspace(firstWorkspaceDir, setPhase);
    await generateFixedWorkspace(secondWorkspaceDir, setPhase);

    setPhase('file tree snapshot comparison');
    const difference = firstFileTreeDifference(
      collectFileTreeSnapshot(firstWorkspaceDir),
      collectFileTreeSnapshot(secondWorkspaceDir),
    );

    assert.equal(difference, undefined, difference);
    processes = readProcesses();
    const started = processes.filter(record => record.event === 'start');
    assert.equal(
      started.filter(record => record.kind === 'formatter').length,
      6,
      'each workspace uses generation, one canonical batch, and final formatting',
    );
    const metadata = started.filter(record => record.kind === 'metadata');
    assert.equal(metadata.length, 6);
    assert.equal(new Set(metadata.map(record => record.pid)).size, 6);
    for (const child of started) {
      assert.ok(
        processes.some(
          record =>
            record.pid === child.pid &&
            record.event === 'exit' &&
            record.code === 0,
        ),
        `${child.kind} process ${child.pid} must finish successfully`,
      );
    }
  } finally {
    try {
      processes = readProcesses();
    } catch {
      // Diagnostic collection must not replace the original failure or cleanup.
    }
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    if (previousAudit === undefined)
      delete process.env.UM_GENERATION_PROCESS_AUDIT;
    else process.env.UM_GENERATION_PROCESS_AUDIT = previousAudit;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// Restored: delivery-unit build markers were once seeded per process, so a
// marker stamped by the CLI never matched the one recomputed by a later
// process (the generated `pnpm check` validator asserts they agree).
test('the CLI stamps the same delivery-unit build marker as an in-process add', async ({
  onTestFailed,
}) => {
  const setPhase = trackPhases(onTestFailed);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-marker-cross-'));
  try {
    const inProcessDir = path.join(tempRoot, 'in-process');
    await generateFixedWorkspace(inProcessDir, setPhase);

    const cliDir = path.join(tempRoot, 'cli');
    setPhase('cli: generation');
    await generateUltramodernWorkspace({
      targetDir: cliDir,
      packageName: 'deterministic-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    setPhase('cli: compiler fixture setup');
    linkInstalledEffectCompiler(cliDir);
    setPhase('cli: addVertical command');
    const cli = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../dist/esm-node/index.js'),
        'catalog',
        '--vertical',
      ],
      { cwd: cliDir, encoding: 'utf8' },
    );
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);

    setPhase('delivery-unit build marker assertion');
    const markerOf = (root: string) =>
      JSON.parse(
        fs.readFileSync(
          path.join(root, 'verticals/catalog/shared/ultramodern-build.json'),
          'utf8',
        ),
      ).deliveryUnit.buildMarker;
    assert.equal(markerOf(cliDir), markerOf(inProcessDir));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
