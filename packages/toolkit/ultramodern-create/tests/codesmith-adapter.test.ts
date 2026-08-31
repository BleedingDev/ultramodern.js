import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodeSmith } from '@modern-js/codesmith';
import ultramodernCodeSmithAdapter from '../src/ultramodern-workspace/codesmith';
import { createWorkspace } from './helpers/workspace-kit';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');
const builtCodeSmithAdapterPath = path.join(
  packageRoot,
  'dist/cjs/ultramodern-workspace/codesmith.cjs',
);

const hermeticEnv = {
  ...process.env,
  MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: '3.2.0-ultramodern.108',
};

function read(workspaceDir: string, relativePath: string) {
  return fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');
}

function readJson(workspaceDir: string, relativePath: string): any {
  return JSON.parse(read(workspaceDir, relativePath));
}

function comparableCompactConfig(config: any) {
  const scrub = (value: any): any => {
    if (Array.isArray(value)) {
      return value.map(scrub);
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [
          key,
          key === 'buildMarker' || (key === 'build' && 'uiSurface' in value)
            ? '<ignored>'
            : scrub(nested),
        ]),
      );
    }

    return value;
  };

  return scrub({
    ...config,
    generator: {
      ...config.generator,
      version: '<ignored>',
    },
  });
}

function runCli(cwd: string, args: string[]) {
  assert.equal(fs.existsSync(builtCliPath), true, builtCliPath);
  return spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: hermeticEnv,
  });
}

function createAdapterPackage(tempRoot: string) {
  const generatorDir = path.join(tempRoot, 'codesmith-generator');
  fs.mkdirSync(generatorDir, { recursive: true });
  fs.writeFileSync(
    path.join(generatorDir, 'package.json'),
    JSON.stringify(
      {
        name: 'test-ultramodern-codesmith-generator',
        version: '0.0.0',
        main: './index.cjs',
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(generatorDir, 'index.cjs'),
    `module.exports = require(${JSON.stringify(builtCodeSmithAdapterPath)});\n`,
  );
  return generatorDir;
}

async function runCodeSmith(
  pwd: string,
  generator: string,
  config: Record<string, unknown>,
) {
  const codesmith = new CodeSmith({});
  await codesmith.forge({
    pwd,
    tasks: [
      {
        generator,
        config,
      },
    ],
  });
  return codesmith.core?._context.data.ultramodernResult;
}

test('CodeSmith adapter creates a workspace with non-interactive config', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-codesmith-'));

  try {
    const generatorDir = createAdapterPackage(tempRoot);
    const result = await runCodeSmith(tempRoot, generatorDir, {
      mode: 'workspace',
      name: 'codesmith-workspace',
      modernVersion: '3.2.1',
      enableTailwind: false,
      packageSourceStrategy: 'workspace',
    });
    const workspaceDir = path.join(tempRoot, 'codesmith-workspace');
    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );

    assert.equal(result.operation, 'workspace');
    assert.equal(result.packageSource.strategy, 'workspace');
    assert.equal(ultramodernConfig.packageSource.strategy, 'workspace');
    assert.equal(
      shellPackage.dependencies['@modern-js/runtime'],
      'workspace:*',
    );
    assert.equal(shellPackage.devDependencies.tailwindcss, undefined);
    assert.equal(
      fs.existsSync(
        path.join(workspaceDir, 'apps/shell-super-app/tailwind.config.ts'),
      ),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CodeSmith adapter MicroVertical output matches CLI contract output', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-codesmith-'));

  try {
    const generatorDir = createAdapterPackage(tempRoot);
    const codesmithWorkspace = path.join(
      tempRoot,
      'codesmith',
      'contract-workspace',
    );
    const cliWorkspace = path.join(tempRoot, 'cli', 'contract-workspace');
    fs.mkdirSync(path.dirname(codesmithWorkspace), { recursive: true });
    fs.mkdirSync(path.dirname(cliWorkspace), { recursive: true });
    createWorkspace(codesmithWorkspace);
    createWorkspace(cliWorkspace);

    const codesmithResult = await runCodeSmith(
      codesmithWorkspace,
      generatorDir,
      {
        mode: 'vertical',
        name: 'catalog',
        modernVersion: '3.2.1',
      },
    );
    const cliResult = runCli(cliWorkspace, ['--vertical=catalog']);
    assert.equal(cliResult?.status, 0, cliResult?.stderr);

    assert.equal(codesmithResult.operation, 'vertical');
    assert.deepEqual(
      comparableCompactConfig(
        readJson(codesmithWorkspace, '.modernjs/ultramodern.json'),
      ),
      comparableCompactConfig(
        readJson(cliWorkspace, '.modernjs/ultramodern.json'),
      ),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CodeSmith adapter dry-run returns a plan without writing files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-codesmith-'));
  const workspaceDir = path.join(tempRoot, 'dry-run-workspace');

  try {
    createWorkspace(workspaceDir);
    assert.equal(fs.existsSync(path.join(workspaceDir, 'verticals')), false);
    const result = await ultramodernCodeSmithAdapter(
      {
        config: {
          mode: 'vertical',
          name: 'catalog',
          modernVersion: '3.2.1',
          dryRun: true,
        },
      },
      {
        outputPath: workspaceDir,
      },
    );

    assert.equal(result.operation, 'vertical');
    assert.equal('dryRun' in result && result.dryRun, true);
    assert.equal(fs.existsSync(path.join(workspaceDir, 'verticals')), false);
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'verticals/catalog')),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CodeSmith adapter prompts only when required config is missing', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-codesmith-'));

  try {
    const result = await ultramodernCodeSmithAdapter(
      {
        config: {
          mode: 'workspace',
          modernVersion: '3.2.1',
          packageSource: {
            strategy: 'workspace',
          },
        },
        prompt: async questions => {
          assert.deepEqual(
            questions.map(question => question.name),
            ['name'],
          );
          return { name: 'prompted-workspace' };
        },
      },
      {
        outputPath: tempRoot,
      },
    );

    assert.equal(result.operation, 'workspace');
    assert.equal(
      fs.existsSync(path.join(tempRoot, 'prompted-workspace/package.json')),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
