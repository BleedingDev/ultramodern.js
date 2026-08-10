import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

type DecoderScenario =
  | 'action-load'
  | 'async-iterator'
  | 'blob-type'
  | 'cycle'
  | 'form-data-roundtrip'
  | 'referenced-form-data';

const resolvePackage = createRequire(
  path.join(__dirname, 'rsc-decoder-security-resolver.cjs'),
).resolve;
const childPath = path.join(
  __dirname,
  'fixtures',
  'rscDecoderSecurityChild.cjs',
);

function runDecoderScenario(options: {
  entry: 'edge' | 'node';
  nodeEnv: 'development' | 'production';
  scenario: DecoderScenario;
}): Record<string, unknown> {
  const result = spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      childPath,
      options.scenario,
      resolvePackage(`react-server-dom-rspack/server.${options.entry}`),
      resolvePackage(`react-server-dom-rspack/client.${options.entry}`),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: options.nodeEnv },
      timeout: 5_000,
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      [
        `RSC decoder child failed for ${options.entry}/${options.nodeEnv}/${options.scenario}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
      { cause: result.error },
    );
  }

  return JSON.parse(result.stdout) as Record<string, unknown>;
}

for (const entry of ['node', 'edge'] as const) {
  for (const nodeEnv of ['development', 'production'] as const) {
    describe(`${entry} ${nodeEnv} Flight decoder security`, () => {
      test('bounds cyclic Map reconstruction before invoking constructors', () => {
        expect(
          runDecoderScenario({ entry, nodeEnv, scenario: 'cycle' }),
        ).toEqual({
          mapArrayConstructions: 2,
          rejected: true,
        });
      });

      test('decodes referenced FormData with one backing-store enumeration', () => {
        expect(
          runDecoderScenario({
            entry,
            nodeEnv,
            scenario: 'referenced-form-data',
          }),
        ).toEqual({ keyIterations: 1, values: ['first', 'second'] });
      });

      test('round-trips referenced FormData through the public client and server APIs', () => {
        expect(
          runDecoderScenario({
            entry,
            nodeEnv,
            scenario: 'form-data-roundtrip',
          }),
        ).toEqual({ values: ['first', 'second'] });
      });

      test('rejects a Blob reference backed by a string', () => {
        expect(
          runDecoderScenario({ entry, nodeEnv, scenario: 'blob-type' }),
        ).toEqual({
          rejected: true,
          returnedString: false,
        });
      });

      test('does not recursively throw into a rejecting async iterator', () => {
        expect(
          runDecoderScenario({ entry, nodeEnv, scenario: 'async-iterator' }),
        ).toEqual({ throwCalls: 1 });
      });

      test('loads one server module for eight distinct action identifiers', () => {
        expect(
          runDecoderScenario({ entry, nodeEnv, scenario: 'action-load' }),
        ).toEqual({ moduleLoads: 1, submittedEntries: [] });
      });
    });
  }
}
