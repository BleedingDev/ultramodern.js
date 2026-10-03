import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureConfigSourceSnapshot } from '@modern-js/ultramodern-app-tools/config-evaluator';
import { readOptionalJsonObject } from '../src/ultramodern-tooling/config/json';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { __transactionTestHooks } from '../src/ultramodern-workspace/add-vertical/transaction';
import { trackWorkspacePublicationInputs } from '../src/ultramodern-workspace/publication-inputs';
import { listFiles } from './helpers/workspace-kit';

const verticalName = 'publication-check';

test('declarative probes guard arbitrary present and nested missing files against their original baseline', () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-declarative-probes-')),
  );
  try {
    const existing = path.join(root, 'consumer-data.json');
    const missing = path.join(root, 'missing', 'nested', 'optional.json');
    fs.writeFileSync(existing, '{"policy":"original"}\n');
    const tracker = trackWorkspacePublicationInputs(
      root,
      captureConfigSourceSnapshot({ sourceRoots: [root] }),
    );
    assert.deepEqual(readOptionalJsonObject(existing, tracker.observe), {
      policy: 'original',
    });
    assert.deepEqual(readOptionalJsonObject(missing, tracker.observe), {});
    assert.doesNotThrow(tracker.assertUnchanged);
    fs.writeFileSync(existing, '{"policy":"changed"}\n');
    assert.throws(tracker.assertUnchanged, /source input consumed/u);
    fs.writeFileSync(existing, '{"policy":"original"}\n');
    assert.doesNotThrow(tracker.assertUnchanged);
    fs.chmodSync(existing, fs.statSync(existing).mode ^ 0o100);
    assert.throws(tracker.assertUnchanged, /source input consumed/u);
    fs.chmodSync(existing, fs.statSync(existing).mode ^ 0o100);
    fs.mkdirSync(path.dirname(missing), { recursive: true });
    fs.writeFileSync(missing, '{}\n');
    assert.throws(tracker.assertUnchanged, /source input consumed/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function createSolidWorkspace() {
  const tempRoot = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-publication-inputs-')),
  );
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    await generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'publication-inputs',
      modernVersion: '3.2.1',
      renderer: 'solid',
      packageSource: { strategy: 'workspace' },
      enableTailwind: false,
      generateAgentFiles: false,
    });
    return { tempRoot, workspaceDir };
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function snapshotBytes(workspaceDir: string) {
  return new Map(
    listFiles(workspaceDir).map(relativePath => [
      relativePath,
      fs.readFileSync(path.join(workspaceDir, relativePath)),
    ]),
  );
}

function assertConsumerEditIsOnlyChange(
  workspaceDir: string,
  before: Map<string, Buffer>,
  consumerPath: string,
  consumerBytes: Buffer,
) {
  const after = snapshotBytes(workspaceDir);
  assert.deepEqual([...after.keys()], [...before.keys()]);
  for (const [relativePath, bytes] of before) {
    assert.deepEqual(
      after.get(relativePath),
      relativePath === consumerPath ? consumerBytes : bytes,
      `${relativePath} must preserve its original bytes or the consumer's edit`,
    );
  }
  assert.equal(
    fs.existsSync(path.join(workspaceDir, 'verticals', verticalName)),
    false,
  );
}

function assertNoTransactionArtifacts(tempRoot: string) {
  const artifacts: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.name.includes('.ultramodern-')) artifacts.push(filename);
      if (entry.isDirectory()) walk(filename);
    }
  };
  walk(tempRoot);
  assert.deepEqual(artifacts, []);
}

function addApiOnlyVertical(workspaceDir: string) {
  return addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: verticalName,
    modernVersion: '3.2.1',
    preset: 'api-only',
    packageSource: { strategy: 'workspace' },
    enableTailwind: false,
  });
}

test('publication rejects a concurrent edit to a note consumed by the original config callback', async () => {
  const { tempRoot, workspaceDir } = await createSolidWorkspace();
  const previousHook = __transactionTestHooks.beforePublish;
  const relativeNote = 'consumer-notes.txt';
  const notePath = path.join(workspaceDir, relativeNote);
  const callbackLog = path.join(tempRoot, 'callback-reads.jsonl');
  const originalNote = 'original consumer note\n';
  const consumerBytes = Buffer.from('concurrent consumer note\n');
  let publications = 0;
  try {
    fs.writeFileSync(notePath, originalNote);
    const appDirectory = path.join(workspaceDir, 'apps/shell-super-app');
    const configPath = path.join(appDirectory, 'modern.config.ts');
    const generated = fs.readFileSync(configPath, 'utf8');
    const configStart = 'export default defineConfig({';
    assert.equal(generated.split(configStart).length, 2);
    assert.match(generated, /\n\}\);\n$/u);
    fs.writeFileSync(
      configPath,
      `import fs from 'node:fs';
${generated
  .replace(
    configStart,
    `export default defineConfig(async () => {
  const note = fs.readFileSync(new URL('../../consumer-notes.txt', import.meta.url), 'utf8');
  fs.appendFileSync(${JSON.stringify(callbackLog)}, JSON.stringify({ note }) + '\\n');
  return ({`,
  )
  .replace(/\n\}\);\n$/u, '\n});\n});\n')}
`,
    );
    const before = snapshotBytes(workspaceDir);
    __transactionTestHooks.beforePublish = ({
      workspaceRoot,
      changedPaths,
    }) => {
      assert.equal(workspaceRoot, workspaceDir);
      assert.ok(
        changedPaths.includes(`verticals/${verticalName}/package.json`),
      );
      publications += 1;
      fs.writeFileSync(notePath, consumerBytes);
    };

    await assert.rejects(addApiOnlyVertical(workspaceDir), (error: unknown) => {
      assert.equal(
        publications,
        1,
        `the add must reach publication; original error: ${String(error)}`,
      );
      assert.ok(error instanceof Error);
      assert.match(error.message, /source input consumed by modern\.config/u);
      assert.match(error.message, /consumer-notes\.txt/u);
      return true;
    });
    assertConsumerEditIsOnlyChange(
      workspaceDir,
      before,
      relativeNote,
      consumerBytes,
    );
    assert.deepEqual(
      fs
        .readFileSync(callbackLog, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line)),
      [{ note: originalNote }],
      'the original callback must run once before the concurrent edit',
    );
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    __transactionTestHooks.beforePublish = previousHook;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('publication rejects a concurrent edit to declarative ownership read during preflight', async () => {
  const { tempRoot, workspaceDir } = await createSolidWorkspace();
  const previousHook = __transactionTestHooks.beforePublish;
  const relativeOwnership = 'topology/ownership.json';
  const ownershipPath = path.join(workspaceDir, relativeOwnership);
  let publications = 0;
  try {
    const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));
    assert.ok(ownership.owners[0]?.ownership);
    ownership.owners[0].ownership.team = 'concurrent-consumer-team';
    const consumerBytes = Buffer.from(
      `${JSON.stringify(ownership, null, 2)}\n`,
    );
    const before = snapshotBytes(workspaceDir);
    __transactionTestHooks.beforePublish = ({
      workspaceRoot,
      changedPaths,
    }) => {
      assert.equal(workspaceRoot, workspaceDir);
      assert.ok(changedPaths.includes(relativeOwnership));
      publications += 1;
      fs.writeFileSync(ownershipPath, consumerBytes);
    };

    await assert.rejects(addApiOnlyVertical(workspaceDir), (error: unknown) => {
      assert.equal(publications, 1, 'the add must reach publication');
      assert.ok(error instanceof Error);
      assert.match(error.message, /source input consumed by modern\.config/u);
      assert.match(error.message, /topology[\\/]ownership\.json/u);
      return true;
    });
    assertConsumerEditIsOnlyChange(
      workspaceDir,
      before,
      relativeOwnership,
      consumerBytes,
    );
    assertNoTransactionArtifacts(tempRoot);
  } finally {
    __transactionTestHooks.beforePublish = previousHook;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
