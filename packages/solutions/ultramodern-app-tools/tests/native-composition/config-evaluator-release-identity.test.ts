import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';

const frameworkRoot = path.resolve(__dirname, '../..');
const extensionsRoot = path.resolve(__dirname, '../../../app-tools-extensions');
const generationBuildMarker = 'generation-fixture-marker';
const unitId = 'release-identity-fixture';

function runNative(action: string) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'um-release-identity-',
      ),
    ),
  );
  try {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          path.join(
            __dirname,
            'fixtures/config-evaluator-release-identity.mjs',
          ),
          JSON.stringify({
            frameworkRoot,
            extensionsRoot,
            root,
            action,
            generationBuildMarker,
            unitId,
          }),
        ],
        {
          cwd: frameworkRoot,
          encoding: 'utf8',
          timeout: 30000,
          env: {
            ...process.env,
            MODERN_LIB_FORMAT: 'cjs',
            ULTRAMODERN_SOURCE_REVISION: '',
          },
        },
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function identity(sourceRevision: string) {
  return {
    sourceRevision,
    buildMarker:
      sourceRevision === 'workspace'
        ? generationBuildMarker
        : createHash('sha256')
            .update(
              `ultramodern-delivery-unit-release-build-marker:v1:${unitId}:${generationBuildMarker}:${sourceRevision}`,
            )
            .digest('hex')
            .slice(0, 16),
  };
}

describe('compiled owning release identity during config observation', () => {
  it('keeps CJS and ESM native Git queries live across clean, dirty and new HEAD calls', () => {
    const result = runNative('live');
    expect(result.initiallyCached).toBe(false);
    expect(result.heads[1]).not.toBe(result.heads[0]);
    expect(result.phases).toHaveLength(3);
    for (const [index, phase] of result.phases.entries()) {
      const expected = identity(
        index === 1 ? 'workspace' : result.heads[index === 0 ? 0 : 1],
      );
      expect(phase.original).toEqual([expected, expected]);
      expect(phase.observed).toEqual(phase.original);
      expect(phase.inputs.observations).toEqual([]);
      expect(phase.inputs.packageMetadata).toEqual([]);
    }
  });

  it('preserves both public entries non-Git identities and malformed revision errors', () => {
    const result = runNative('nongit');
    for (const phase of result.phases)
      expect(phase.observed).toEqual(phase.original);
    expect(result.phases[0].observed).toEqual([
      identity('workspace'),
      identity('workspace'),
    ]);
    expect(result.phases[1].observed).toEqual([
      identity('a'.repeat(64)),
      identity('a'.repeat(64)),
    ]);
    expect(result.phases[2].observed).toEqual([
      {
        error: {
          name: 'Error',
          message:
            'Configured source revision invalid must be an exact lowercase 40- or 64-character Git object ID.',
        },
      },
      {
        error: {
          name: 'Error',
          message:
            'Configured source revision invalid must be an exact lowercase 40- or 64-character Git object ID.',
        },
      },
    ]);
  });

  it('preserves native clean-HEAD and environment mismatch errors in CJS and ESM', () => {
    const result = runNative('mismatch');
    for (const phase of result.phases)
      expect(phase.observed).toEqual(phase.original);
    expect(result.phases[0].observed[0].error.message).toBe(
      `Configured source revision ${'b'.repeat(40)} does not match clean Git HEAD ${result.head}.`,
    );
    expect(result.phases[1].observed[0].error.message).toBe(
      `Configured source revision ${'b'.repeat(40)} does not match environment source revision ${'c'.repeat(40)}.`,
    );
    for (const phase of result.phases)
      expect(phase.observed[1]).toEqual(phase.observed[0]);
  });

  it('still denies authored subprocess APIs and cached CJS and ESM aliases loaded after observation', () => {
    const result = runNative('authored');
    expect(result.kinds).toEqual(['callback', 'cjs-module', 'esm-module']);
    for (const phase of result.phases) {
      expect(phase.error.message).toContain(
        'Unsupported config source observation: child_process.',
      );
      expect(
        phase.attempts.map(
          (attempt: { operation: string }) => attempt.operation,
        ),
      ).toEqual(['exec', 'execFile', 'spawn', 'exec', 'execFile', 'spawn']);
      for (const attempt of phase.attempts)
        expect(attempt.error.message).toContain(
          `Unsupported config source observation: child_process.${attempt.operation}`,
        );
      if (phase.kind !== 'callback')
        expect(phase.cachedValuePreserved).toBe(true);
    }
  });
});
