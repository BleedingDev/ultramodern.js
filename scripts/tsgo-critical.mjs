#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configListPath = join(repoRoot, 'scripts/tsgo-critical.txt');
const effectTsgoCli =
  process.env.EFFECT_TSGO_CLI ||
  join(repoRoot, 'node_modules/.bin/effect-tsgo');
const tsgoBin =
  process.env.EFFECT_TSGO_BIN ||
  process.env.TSGO_BIN ||
  resolveEffectTsgoBinary(effectTsgoCli);

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

function resolveEffectTsgoBinary(cliPath) {
  if (!existsSync(cliPath)) {
    return cliPath;
  }

  const result = spawnSync(cliPath, ['get-exe-path'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return cliPath;
  }
  return result.stdout.trim() || cliPath;
}

if (!existsSync(tsgoBin)) {
  console.error(
    `effect-tsgo compiler not found at ${tsgoBin}. Run pnpm install or set EFFECT_TSGO_BIN.`,
  );
  process.exit(1);
}

try {
  accessSync(tsgoBin, constants.X_OK);
} catch {
  chmodSync(tsgoBin, 0o755);
}

const configs = readFileSync(configListPath, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

const failures = [];
const tempConfigs = [];

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

for (const [index, config] of configs.entries()) {
  const started = performance.now();
  const strictConfig = createStrictConfig(config, index);
  const result = spawnSync(
    tsgoBin,
    ['--noEmit', '--pretty', 'false', '-p', strictConfig],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const durationMs = Math.round(performance.now() - started);
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();

  if (result.status === 0) {
    console.log(`PASS ${config} (${durationMs}ms)`);
    continue;
  }

  console.error(`FAIL ${config} (${durationMs}ms)`);
  if (output) {
    console.error(output);
  }
  failures.push(config);
}

for (const tempConfig of tempConfigs) {
  rmSync(tempConfig, { force: true });
}

if (failures.length > 0) {
  console.error(`effect-tsgo validation failed: ${failures.length} config(s)`);
  process.exit(1);
}

console.log(`effect-tsgo validation passed: ${configs.length} config(s)`);
