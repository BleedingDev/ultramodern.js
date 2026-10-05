import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  discoverBrowserExecutable,
  formatMatrix,
  parseReleaseOptions,
} from './release.mjs';
import { validateConsumerSelection } from './run.mjs';

test('release options select steps and renderers in canonical order', () => {
  const options = parseReleaseOptions([
    '--cohort-dir',
    '/tmp/cohort',
    '--only',
    'rsc,http',
    '--renderers',
    'octane,react',
  ]);
  assert.deepEqual(options.steps, ['http', 'rsc']);
  assert.deepEqual(options.renderers, ['react', 'octane']);
  assert.equal(options.stepTimeoutMs, 120 * 60_000);
});

test('release options default to every step and renderer', () => {
  const options = parseReleaseOptions(['--version', '3.9.0-ultramodern.1']);
  assert.deepEqual(options.steps, [
    'http',
    'browser',
    'reject',
    'worker',
    'mf',
    'rsc',
    'tractor',
  ]);
  assert.deepEqual(options.renderers, ['react', 'solid', 'octane']);
});

test('release options reject unknown steps and a missing cohort source', () => {
  assert.throws(
    () => parseReleaseOptions(['--cohort-dir', '/x', '--only', 'http,witness']),
    /Unknown step: witness/u,
  );
  assert.throws(() => parseReleaseOptions([]), /--cohort-dir/u);
});

test('the matrix shows result, duration and first error per step', () => {
  const text = formatMatrix([
    { name: 'cohort', status: 'PASS', seconds: 1.234 },
    { name: 'http', status: 'FAIL', seconds: 61, error: 'react build failed' },
    { name: 'rsc', status: 'SKIP', seconds: 0, error: 'react not selected' },
  ]);
  const lines = text.split('\n');
  assert.match(lines[0], /^step\s+\| result \| seconds \| first error$/u);
  assert.match(lines[2], /^cohort \| PASS\s+\| 1\.2/u);
  assert.match(
    lines[3],
    /^http\s+\| FAIL\s+\| 61\.0\s+\| react build failed$/u,
  );
  assert.match(lines[4], /^rsc\s+\| SKIP/u);
});

test('browser discovery prefers an explicit executable', () => {
  assert.equal(discoverBrowserExecutable('/opt/chrome'), '/opt/chrome');
});

test('browser discovery finds the newest Chrome for Testing in the puppeteer cache', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'release-browser-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const app =
    process.platform === 'darwin'
      ? `chrome-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
      : 'chrome-linux64/chrome';
  for (const version of ['mac_arm-150.0.1', 'mac_arm-153.0.2']) {
    const file = path.join(home, '.cache/puppeteer/chrome', version, app);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
  }
  t.mock.method(os, 'homedir', () => home);
  const previous = process.env.PUPPETEER_EXECUTABLE_PATH;
  delete process.env.PUPPETEER_EXECUTABLE_PATH;
  t.after(() => {
    if (previous !== undefined)
      process.env.PUPPETEER_EXECUTABLE_PATH = previous;
  });
  assert.equal(
    discoverBrowserExecutable(),
    path.join(home, '.cache/puppeteer/chrome/mac_arm-153.0.2', app),
  );
});

test('packed conformance accepts a renderer subset but still requires both kinds', () => {
  assert.throws(
    () => validateConsumerSelection([], ['react', 'vue']),
    /Unknown or duplicate selected renderer/u,
  );
  assert.throws(
    () =>
      validateConsumerSelection(
        [{ renderer: 'react', kind: 'generated' }],
        ['react'],
      ),
    /Exactly one generated and one hand-authored/u,
  );
});
