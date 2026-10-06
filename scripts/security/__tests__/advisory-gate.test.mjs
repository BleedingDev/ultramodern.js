import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertNoHighAdvisories,
  readAdvisoryExceptions,
} from '../advisory-gate.mjs';

// Recorded from `pnpm audit --prod --audit-level=high --json` on a scratch
// lockfile that pins image-size 2.0.2.
const imageSizeReport = fs.readFileSync(
  new URL('./fixtures/pnpm-audit-image-size-2.0.2.json', import.meta.url),
  'utf8',
);
const now = new Date('2026-09-27T00:00:00Z');

function withExceptions(entries, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-gate-'));
  const exceptionsPath = path.join(directory, 'exceptions.json');
  fs.writeFileSync(exceptionsPath, JSON.stringify(entries));
  try {
    return run(exceptionsPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function auditReturning(stdout, exitCode = 1) {
  const calls = [];
  const runCommandImpl = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return { exitCode, stdout, stderr: '' };
  };
  return { calls, runCommandImpl };
}

test('a lockfile pinning image-size 2.0.2 fails with the advisory and the fix', () => {
  const { calls, runCommandImpl } = auditReturning(imageSizeReport);
  withExceptions([], exceptionsPath => {
    assert.throws(
      () =>
        assertNoHighAdvisories({
          cwd: '/scratch',
          exceptionsPath,
          now,
          runCommandImpl,
        }),
      error =>
        error.message.includes('found 2 high or critical advisories') &&
        error.message.includes('GHSA-5p2g-fcmc-qvqq image-size@2.0.2') &&
        error.message.includes('patched >=2.0.3') &&
        error.message.includes('fix: pnpm update --recursive image-size'),
    );
  });
  assert.deepEqual(calls, [
    {
      command: 'pnpm',
      args: ['audit', '--prod', '--audit-level=high', '--json'],
      cwd: '/scratch',
    },
  ]);
});

test('an unexpired exception acknowledges exactly its advisory', () => {
  const { runCommandImpl } = auditReturning(imageSizeReport);
  const exception = (id, parents = ['.']) => ({
    id,
    package: 'image-size',
    parents,
    reason: 'test',
    expires: '2026-10-01',
  });
  withExceptions(
    [exception('GHSA-5p2g-fcmc-qvqq'), exception('GHSA-w3rx-r6r6-pgpr')],
    exceptionsPath => {
      assert.deepEqual(
        assertNoHighAdvisories({
          cwd: '/scratch',
          exceptionsPath,
          now,
          runCommandImpl,
        }),
        {
          auditLevel: 'high',
          acknowledged: ['GHSA-5p2g-fcmc-qvqq', 'GHSA-w3rx-r6r6-pgpr'],
        },
      );
    },
  );
  withExceptions([exception('GHSA-5p2g-fcmc-qvqq')], exceptionsPath => {
    assert.throws(
      () =>
        assertNoHighAdvisories({
          cwd: '/scratch',
          exceptionsPath,
          now,
          runCommandImpl,
        }),
      /found 1 high or critical advisory:\nhigh GHSA-w3rx-r6r6-pgpr/u,
    );
  });
  // Same advisory, but pulled in by a parent the exception does not name.
  withExceptions(
    [
      exception('GHSA-5p2g-fcmc-qvqq', ['some-parent']),
      exception('GHSA-w3rx-r6r6-pgpr'),
    ],
    exceptionsPath => {
      assert.throws(
        () =>
          assertNoHighAdvisories({
            cwd: '/scratch',
            exceptionsPath,
            now,
            runCommandImpl,
          }),
        /found 1 high or critical advisory:\nhigh GHSA-5p2g-fcmc-qvqq[\s\S]*via \.>image-size/u,
      );
    },
  );
});

test('an expired exception fails before auditing', () => {
  const { calls, runCommandImpl } = auditReturning(imageSizeReport);
  withExceptions(
    [
      {
        id: 'GHSA-5p2g-fcmc-qvqq',
        package: 'image-size',
        parents: ['.'],
        reason: 'test',
        expires: '2026-09-26',
      },
    ],
    exceptionsPath => {
      assert.throws(
        () =>
          assertNoHighAdvisories({
            cwd: '/scratch',
            exceptionsPath,
            now,
            runCommandImpl,
          }),
        /expired .*\n {2}GHSA-5p2g-fcmc-qvqq image-size \(expired 2026-09-26\)/u,
      );
    },
  );
  assert.equal(calls.length, 0);
});

test('a missing audit report fails closed', () => {
  const { runCommandImpl } = auditReturning('', 1);
  withExceptions([], exceptionsPath => {
    assert.throws(
      () =>
        assertNoHighAdvisories({
          cwd: '/scratch',
          exceptionsPath,
          now,
          runCommandImpl,
        }),
      /pnpm audit returned no advisory report \(exit 1\)/u,
    );
  });
});

test('moderate advisories do not fail the gate', () => {
  const report = JSON.parse(imageSizeReport);
  for (const advisory of Object.values(report.advisories)) {
    advisory.severity = 'moderate';
  }
  const { runCommandImpl } = auditReturning(JSON.stringify(report), 0);
  withExceptions([], exceptionsPath => {
    assert.deepEqual(
      assertNoHighAdvisories({
        cwd: '/scratch',
        exceptionsPath,
        now,
        runCommandImpl,
      }),
      { auditLevel: 'high', acknowledged: [] },
    );
  });
});

test('the committed exceptions are well formed', () => {
  assert.ok(readAdvisoryExceptions() instanceof Map);
});
