// Golden tests for the external-surface validator (G13b/G14/G15/G18).
// Mirrors the release-gates node:test convention. The validator modules are
// pure ESM (.mjs); this CommonJS test loads them via dynamic import so it is
// picked up by the existing `scripts/release-gates/__tests__/*.test.js` glob.
const path = require('path');
const { pathToFileURL } = require('url');
const test = require('node:test');
const assert = require('node:assert/strict');

const dir = path.join(__dirname, '..', 'validator', 'external-surface');
const fixturesDir = path.join(dir, '__fixtures__');
const load = name => pathToFileURL(path.join(dir, name)).href;
const fixture = name => require(path.join(fixturesDir, name));

const mfFx = fixture('mf.json');
const restFx = fixture('rest.json');
const rpcFx = fixture('rpc.json');
const baselineFx = fixture('baseline.json');
const zoneFx = fixture('zone-policy.json');

let mods;
test.before(async () => {
  mods = {
    mf: (await import(load('compare-mf.mjs'))).compareMfSurface,
    rest: (await import(load('compare-rest.mjs'))).compareRestSurface,
    rpc: (await import(load('compare-rpc.mjs'))).compareRpcSurface,
    baseline: await import(load('baseline-compat.mjs')),
    zone: (await import(load('zone-policy.mjs'))).evaluateZonePolicy,
  };
});

function runComparatorSuite(label, compareKey, fx) {
  for (const [scenario, data] of Object.entries(fx)) {
    test(`${label}: ${scenario}`, () => {
      const result = mods[compareKey](data.old, data.new, { zone: data.zone });
      assert.equal(
        result.classification,
        data.expect.classification,
        'classification',
      );
      assert.equal(result.verdict, data.expect.verdict, 'verdict');
      if (data.expect.sideBySide !== undefined) {
        assert.equal(
          result.sideBySide.satisfied,
          data.expect.sideBySide,
          'sideBySide',
        );
      }
      if (data.expect.verdict === 'fail') {
        assert.ok(result.errors.length > 0, 'fail must report errors');
      } else {
        assert.equal(result.errors.length, 0, 'non-fail must have no errors');
      }
    });
  }
}

runComparatorSuite('G14-MF', 'mf', mfFx);
runComparatorSuite('G14-REST', 'rest', restFx);
runComparatorSuite('G14-RPC', 'rpc', rpcFx);

test('G14-MF: removal of external expose without new major fails', () => {
  const result = mods.mf(
    { kind: 'mf', surfaceId: 's', exposes: [{ path: './a', signature: 'x' }] },
    { kind: 'mf', surfaceId: 's', exposes: [] },
    { zone: 'external' },
  );
  assert.equal(result.classification, 'breaking');
  assert.equal(result.verdict, 'fail');
});

test('G14-RPC: side-by-side requires old version still served', () => {
  const result = mods.rpc(
    {
      kind: 'rpc',
      surfaceId: 's',
      contractVersion: 1,
      servedVersions: [1],
      operations: [{ name: 'op', contractHash: 'a' }],
    },
    {
      kind: 'rpc',
      surfaceId: 's',
      contractVersion: 2,
      servedVersions: [2],
      operations: [{ name: 'op', contractHash: 'b' }],
    },
    { zone: 'external' },
  );
  assert.equal(result.sideBySide.satisfied, false);
  assert.equal(result.verdict, 'fail');
});

// ---- G15/G18 baseline compatibility --------------------------------------

for (const [scenario, data] of Object.entries(baselineFx)) {
  test(`G15/G18 baseline: ${scenario}`, () => {
    const report = mods.baseline.checkBaselineCompatibility({
      host: data.host,
      units: data.units,
    });
    assert.equal(report.compatible, data.expect.compatible, 'compatible');
    if (data.expect.singletonConflict) {
      assert.ok(
        report.singletonConflicts.some(
          c => c.dependency === data.expect.singletonConflict,
        ),
        `expected singleton conflict on ${data.expect.singletonConflict}`,
      );
    }
  });
}

test('G15/G18: majorOf handles exact, caret, and prerelease pins', () => {
  assert.equal(mods.baseline.majorOf('19.0.0'), 19);
  assert.equal(mods.baseline.majorOf('^18.2.0'), 18);
  assert.equal(mods.baseline.majorOf('4.0.0-beta.94'), 4);
  assert.equal(mods.baseline.majorOf(undefined), null);
});

// ---- G13b zone policy ------------------------------------------------------

for (const [scenario, data] of Object.entries(zoneFx)) {
  test(`G13b zone-policy: ${scenario}`, () => {
    const result = mods.zone({
      diff: data.diff,
      publication: data.publication,
    });
    assert.equal(result.verdict, data.expect.verdict, 'verdict');
    if (data.expect.verdict === 'fail') {
      assert.ok(result.errors.length > 0, 'fail must report errors');
    }
    if (data.expect.missingIncludes) {
      const joined = result.errors.join(' ');
      for (const field of data.expect.missingIncludes) {
        assert.ok(
          joined.includes(field),
          `error should mention missing ${field}`,
        );
      }
    }
  });
}

test('G13b zone-policy: comparator diff feeds directly into zone policy', () => {
  const diff = mods.mf(
    { kind: 'mf', surfaceId: 's', exposes: [{ path: './a', signature: 'x' }] },
    { kind: 'mf', surfaceId: 's', exposes: [{ path: './a', signature: 'y' }] },
    { zone: 'external' },
  );
  const policy = mods.zone({
    diff,
    publication: {
      zone: 'external',
      owner: 'team',
      kind: 'component',
      external: { surfaceMajor: 1, baselineCompatibility: 'c', retirement: {} },
    },
  });
  assert.equal(policy.verdict, 'fail');
});
