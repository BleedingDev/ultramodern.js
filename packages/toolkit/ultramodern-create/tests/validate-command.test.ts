import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createWorkspace, snapshotWorkspace } from './helpers/workspace-kit';

test('validate evaluates authored config in development regardless of the caller NODE_ENV', async () => {
  const { tempRoot, workspaceDir } = await createWorkspace('validation-mode', {
    tempPrefix: 'um-validation-mode-',
  });
  const observations = path.join(tempRoot, 'callbacks.jsonl');
  try {
    const configFile = path.join(
      workspaceDir,
      'apps/shell-super-app/modern.config.ts',
    );
    const generated = fs.readFileSync(configFile, 'utf8');
    const configStart = 'export default defineConfig(';
    assert.equal(generated.split(configStart).length, 2);
    assert.match(generated, /,\s*\);\s*$/u);
    // Keep the generated native plugins and source entries in an authored
    // async callback so its context is checked by the real config evaluator.
    const authored = `import assert from 'node:assert/strict';
import fs from 'node:fs';
${generated
  .replace(
    configStart,
    `export default defineConfig(async ({ env, command }) => {
  assert.equal(env, 'development');
  assert.equal(command, 'validate');
  const nodeEnv = getBuildConfigEnvironment('NODE_ENV');
  assert.equal(nodeEnv, 'development');
  fs.appendFileSync(${JSON.stringify(observations)}, JSON.stringify({ env, command, nodeEnv }) + '\\n');
  await Promise.resolve();
  return (`,
  )
  .replace(/,\s*\);\s*$/u, ');\n});\n')}`;
    fs.writeFileSync(configFile, authored);
    const before = snapshotWorkspace(workspaceDir);

    for (const callerEnvironment of ['test', 'production']) {
      const result = spawnSync(
        process.execPath,
        [path.resolve(__dirname, '../bin/run.js'), 'ultramodern', 'validate'],
        {
          cwd: workspaceDir,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_ENV: callerEnvironment,
            ULTRAMODERN_WORKSPACE_ROOT: workspaceDir,
          },
        },
      );
      assert.equal(
        result.status,
        0,
        `${callerEnvironment} caller: ${result.stdout}\n${result.stderr}`,
      );
      assert.deepEqual(snapshotWorkspace(workspaceDir), before);
    }
    assert.deepEqual(
      fs
        .readFileSync(observations, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line)),
      ['test', 'production'].map(() => ({
        env: 'development',
        command: 'validate',
        nodeEnv: 'development',
      })),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
