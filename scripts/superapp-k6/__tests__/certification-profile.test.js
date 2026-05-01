const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  certificationCommands,
} = require('../../superapp-certification/run-superapp-certification');

const OUT_DIR = path.resolve(
  __dirname,
  '../../../.modern/test-superapp-certification',
);

test('smoke certification does not add k6 or autocannon threshold commands', () => {
  const commands = certificationCommands('smoke', OUT_DIR);

  assert.equal(
    commands.some(item => item.id.includes('thresholds')),
    false,
  );
  assert.equal(
    commands.some(item => item.command.includes('run-superapp-k6.js')),
    false,
  );
});

test('release certification wires stable k6 and autocannon threshold profiles without require flags', () => {
  const commands = certificationCommands('release', OUT_DIR);
  const k6 = commands.find(
    item => item.id === 'superapp-k6-release-thresholds',
  );
  const autocannon = commands.find(
    item => item.id === 'superapp-autocannon-release-thresholds',
  );

  assert.ok(k6);
  assert.ok(autocannon);
  assert.equal(k6.profile, 'release');
  assert.equal(k6.env.SUPERAPP_K6_THRESHOLD_PROFILE, 'release');
  assert.match(k6.command, /--threshold-profile release/);
  assert.match(k6.command, /--scenario smoke,ramp-up,mixed-read-write/);
  assert.doesNotMatch(k6.command, /--require-k6/);
  assert.match(autocannon.command, /--threshold-profile release/);
  assert.match(autocannon.command, /--autocannon-probes get-bootstrap/);
  assert.doesNotMatch(autocannon.command, /--require-autocannon/);
});

test('nightly certification adds aggressive profile commands on top of release', () => {
  const commands = certificationCommands('nightly', OUT_DIR);
  const ids = commands.map(item => item.id);
  const nightlyK6 = commands.find(
    item => item.id === 'superapp-k6-nightly-thresholds',
  );
  const nightlyAutocannon = commands.find(
    item => item.id === 'superapp-autocannon-nightly-thresholds',
  );

  assert.ok(ids.includes('superapp-k6-release-thresholds'));
  assert.ok(ids.includes('superapp-autocannon-release-thresholds'));
  assert.ok(nightlyK6);
  assert.ok(nightlyAutocannon);
  assert.match(nightlyK6.command, /--threshold-profile nightly/);
  assert.match(nightlyK6.command, /--scenario smoke,ramp-up,spike,breakpoint/);
  assert.match(nightlyAutocannon.command, /--threshold-profile nightly/);
  assert.match(nightlyAutocannon.command, /--autocannon-connections 128/);
  assert.match(nightlyAutocannon.command, /--autocannon-duration-seconds 60/);
});
