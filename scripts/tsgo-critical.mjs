#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { resolveEffectTsgoCompiler } from '@modern-js/app-tools/config';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configListPath = join(repoRoot, 'scripts/tsgo-critical.txt');
const tsgoBin = resolveEffectTsgoCompiler({ from: import.meta.url });

const effectDiagnostics = [
  'anyUnknownInErrorContext',
  'classSelfMismatch',
  'duplicatePackage',
  'effectFnImplicitAny',
  'floatingEffect',
  'genericEffectServices',
  'missingEffectContext',
  'missingEffectError',
  'missingLayerContext',
  'missingReturnYieldStar',
  'missingStarInYieldEffectGen',
  'nonObjectEffectServiceType',
  'outdatedApi',
  'overriddenSchemaConstructor',
  'catchUnfailableEffect',
  'effectFnIife',
  'effectGenUsesAdapter',
  'effectInFailure',
  'effectInVoidSuccess',
  'globalErrorInEffectCatch',
  'globalErrorInEffectFailure',
  'layerMergeAllWithDependencies',
  'lazyPromiseInEffectSync',
  'leakingRequirements',
  'multipleEffectProvide',
  'returnEffectInGen',
  'runEffectInsideEffect',
  'schemaSyncInEffect',
  'scopeInLayerEffect',
  'strictEffectProvide',
  'tryCatchInEffectGen',
  'unknownInEffectCatch',
  'asyncFunction',
  'cryptoRandomUUID',
  'cryptoRandomUUIDInEffect',
  'extendsNativeError',
  'globalConsole',
  'globalConsoleInEffect',
  'globalDate',
  'globalDateInEffect',
  'globalFetch',
  'globalFetchInEffect',
  'globalRandom',
  'globalRandomInEffect',
  'globalTimers',
  'globalTimersInEffect',
  'instanceOfSchema',
  'newPromise',
  'nodeBuiltinImport',
  'preferSchemaOverJson',
  'processEnv',
  'processEnvInEffect',
  'unsafeEffectTypeAssertion',
  'catchAllToMapError',
  'deterministicKeys',
  'effectDoNotation',
  'effectFnOpportunity',
  'effectMapFlatten',
  'effectMapVoid',
  'effectSucceedWithVoid',
  'missedPipeableOpportunity',
  'missingEffectServiceDependency',
  'nestedEffectGenYield',
  'redundantSchemaTagIdentifier',
  'schemaStructWithTag',
  'schemaUnionOfLiterals',
  'serviceNotAsClass',
  'strictBooleanExpressions',
  'unnecessaryArrowBlock',
  'unnecessaryEffectGen',
  'unnecessaryFailYieldableError',
  'unnecessaryPipe',
  'unnecessaryPipeChain',
];

const diagnosticSeverity = Object.fromEntries(
  effectDiagnostics.map(name => [name, 'error']),
);

if (!existsSync(tsgoBin)) {
  console.error(
    `effect-tsgo compiler not found at ${tsgoBin}. Run pnpm install or set EFFECT_TSGO_BIN.`,
  );
  process.exit(1);
}

const configs = readFileSync(configListPath, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

const failures = [];
const tempConfigs = [];
const cpuCount = Math.max(
  1,
  typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length,
);

function parsePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`${label} must be a positive integer.`);
    process.exit(1);
  }
  return parsed;
}

function envPositiveInt(names, fallback) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return parsePositiveInt(value, name);
    }
  }
  return fallback;
}

const jobs = Math.min(
  configs.length,
  envPositiveInt(
    ['MODERN_TSGO_CRITICAL_JOBS', 'ULTRAMODERN_TSGO_JOBS'],
    Math.min(4, Math.max(1, Math.floor(cpuCount / 2))),
  ),
);
const checkers = envPositiveInt(
  ['ULTRAMODERN_TSGO_CHECKERS', 'TSGO_CHECKERS'],
  Math.min(4, Math.max(1, Math.floor(cpuCount / jobs))),
);

function createStrictConfig(config, index) {
  const configPath = join(repoRoot, config);
  const tempConfig = join(
    dirname(configPath),
    `.tsgo-effect-strict.${process.pid}.${index}.json`,
  );
  tempConfigs.push(tempConfig);
  writeFileSync(
    tempConfig,
    `${JSON.stringify(
      {
        extends: `./${basename(configPath)}`,
        compilerOptions: {
          plugins: [
            {
              name: '@effect/language-service',
              diagnostics: true,
              includeSuggestionsInTsc: true,
              ignoreEffectSuggestionsInTscExitCode: false,
              ignoreEffectWarningsInTscExitCode: false,
              ignoreEffectErrorsInTscExitCode: false,
              skipDisabledOptimization: true,
              diagnosticSeverity,
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  return tempConfig;
}

function runTsgoConfig(config, index) {
  const started = performance.now();
  const strictConfig = createStrictConfig(config, index);
  return new Promise(resolve => {
    const child = spawn(
      tsgoBin,
      [
        '--noEmit',
        '--pretty',
        'false',
        '--checkers',
        String(checkers),
        '-p',
        strictConfig,
      ],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => {
      resolve({
        config,
        durationMs: Math.round(performance.now() - started),
        output: error.stack || error.message,
        status: 1,
      });
    });
    child.on('close', status => {
      resolve({
        config,
        durationMs: Math.round(performance.now() - started),
        output: Buffer.concat([...stdout, ...stderr])
          .toString()
          .trim(),
        status,
      });
    });
  });
}

async function runCriticalChecks() {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < configs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await runTsgoConfig(configs[index], index);
    }
  }

  console.log(
    `effect-tsgo validation running: ${configs.length} config(s), ${jobs} job(s), ${checkers} checker(s) per config`,
  );
  await Promise.all(Array.from({ length: jobs }, () => worker()));

  for (const result of results) {
    if (result.status === 0) {
      console.log(`PASS ${result.config} (${result.durationMs}ms)`);
      continue;
    }

    console.error(`FAIL ${result.config} (${result.durationMs}ms)`);
    if (result.output) {
      console.error(result.output);
    }
    failures.push(result.config);
  }
}

try {
  await runCriticalChecks();
} finally {
  for (const tempConfig of tempConfigs) {
    rmSync(tempConfig, { force: true });
  }
}

if (failures.length > 0) {
  console.error(`effect-tsgo validation failed: ${failures.length} config(s)`);
  process.exit(1);
}

console.log(`effect-tsgo validation passed: ${configs.length} config(s)`);
