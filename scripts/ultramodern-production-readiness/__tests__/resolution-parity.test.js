const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

// Guards promoting a published cohort whose consumer install resolves a
// closure the source lane never built or ran. The published lanes no longer
// rebuild anything; this comparison is the whole post-publish proof.

async function api() {
  const [audit, parity] = await Promise.all([
    import('../published-create-proof/release-age-audit.mjs'),
    import('../published-create-proof/resolution-parity.mjs'),
  ]);
  return { ...audit, ...parity };
}

const integrity = label => `sha512-${Buffer.from(label).toString('base64')}`;

// A pnpm v9 lock whose single importer depends on `dependencies`, each
// { name, specifier, version } exactly as pnpm writes them, including npm:
// aliases whose lock `version` is `<target>@<exact>`.
function lock(dependencies) {
  const packages = {};
  const snapshots = {};
  const importer = {};
  for (const { alias, name, version, bytes = version } of dependencies) {
    const key = `${name}@${version}`;
    importer[alias ?? name] = alias
      ? { specifier: `npm:${name}@^${version}`, version: key }
      : { specifier: `^${version}`, version };
    packages[key] = { resolution: { integrity: integrity(`${key}:${bytes}`) } };
    snapshots[key] = {};
  }
  return {
    importers: { '.': { dependencies: importer } },
    lockfileVersion: '9.0',
    packages,
    snapshots,
  };
}

async function resolve(dependencies) {
  const { buildDependencyClosure, closureResolution } = await api();
  const closure = buildDependencyClosure(lock(dependencies));
  assert.deepEqual(closure.unresolved, []);
  return closureResolution(closure);
}

const acceptedDependencies = [
  {
    alias: '@module-federation/enhanced',
    name: '@bleedingdev/mf-enhanced',
    version: '2.9.1',
  },
  { name: 'effect', version: '3.19.0' },
  { name: 'react', version: '19.2.0' },
];

test('an identical published closure passes and reports it', async () => {
  const { assertResolutionParity } = await api();
  const accepted = await resolve(acceptedDependencies);
  const observed = await resolve(acceptedDependencies);
  assert.deepEqual(
    assertResolutionParity(accepted, observed, { lane: 'Published ERP-10' }),
    { closureSha256: accepted.closureSha256, packageCount: 3 },
  );
});

test('a changed integrity for an accepted version fails and names it', async () => {
  const { assertResolutionParity } = await api();
  const accepted = await resolve(acceptedDependencies);
  const observed = await resolve(
    acceptedDependencies.map(item =>
      item.name === 'react' ? { ...item, bytes: 'repacked' } : item,
    ),
  );
  assert.throws(
    () => assertResolutionParity(accepted, observed, { lane: 'Published' }),
    error =>
      /\(1 package\(s\)\)/u.test(error.message) &&
      /react@19\.2\.0: accepted integrity sha512-\S+, now sha512-\S+/u.test(
        error.message,
      ) &&
      /registry serves different bytes/u.test(error.message),
  );
});

test('an alias that resolves another target version fails and names the target', async () => {
  const { assertResolutionParity } = await api();
  const accepted = await resolve(acceptedDependencies);
  const observed = await resolve(
    acceptedDependencies.map(item =>
      item.alias ? { ...item, version: '2.9.2' } : item,
    ),
  );
  assert.throws(
    () => assertResolutionParity(accepted, observed, { lane: 'Published' }),
    /@bleedingdev\/mf-enhanced: accepted 2\.9\.1, now resolves 2\.9\.2/u,
  );
});

// The source lane resolved under minimumReleaseAge before effect 3.19.1 was a
// day old; by the published lane it had matured, so npm now picks it.
test('a third-party release that matured between the lanes fails with its name', async () => {
  const { assertResolutionParity } = await api();
  const accepted = await resolve(acceptedDependencies);
  const observed = await resolve(
    acceptedDependencies.map(item =>
      item.name === 'effect' ? { ...item, version: '3.19.1' } : item,
    ),
  );
  assert.throws(
    () => assertResolutionParity(accepted, observed, { lane: 'Published' }),
    error =>
      error.message.includes('effect: accepted 3.19.0, now resolves 3.19.1') &&
      !error.message.includes('react') &&
      /matured between the two lanes/u.test(error.message),
  );
});

test('added and dropped packages are both named', async () => {
  const { resolutionDrift } = await api();
  const accepted = await resolve(acceptedDependencies);
  const observed = await resolve([
    ...acceptedDependencies.filter(item => item.name !== 'react'),
    { name: 'scheduler', version: '0.27.0' },
  ]);
  assert.deepEqual(
    resolutionDrift(accepted.closureIdentities, observed.closureIdentities),
    [
      'react: accepted 19.2.0, no longer resolved',
      'scheduler: not in the accepted closure, now resolves 0.27.0',
    ],
  );
});

test('an accepted closure that does not hash to its digest is refused', async () => {
  const { assertResolutionParity } = await api();
  const accepted = await resolve(acceptedDependencies);
  const observed = await resolve(acceptedDependencies);
  accepted.closureIdentities[0].version = '0.0.0';
  assert.throws(
    () => assertResolutionParity(accepted, observed, { lane: 'Published' }),
    /Accepted source resolution closure identities do not match its closureSha256/u,
  );
});

test('published acceptance cannot run without the source receipt it must reproduce', async () => {
  const [{ parseArgs }, { runAcceptanceProfile }] = await Promise.all([
    import('../../ultramodern-publish/run-release-acceptance.mjs'),
    import('../published-create-proof/acceptance-profile.mjs'),
  ]);
  const base = ['--manifest', 'release/manifest.json', '--receipt', 'r.json'];
  assert.throws(
    () => parseArgs(['--mode', 'published', ...base]),
    /--source-receipt .* required with --mode published/u,
  );
  assert.throws(
    () => parseArgs([...base, '--source-receipt', 'source.json']),
    /valid only there/u,
  );
  assert.equal(
    parseArgs(['--mode', 'published', ...base, '--source-receipt', 's.json'])
      .sourceReceiptPath,
    path.resolve('s.json'),
  );
  await assert.rejects(
    runAcceptanceProfile({ mode: 'published', options: {}, release: {} }),
    /pass acceptedResolution in published mode and only there/u,
  );
  await assert.rejects(
    runAcceptanceProfile({
      acceptedResolution: { closureIdentities: [], closureSha256: '' },
      mode: 'source',
      options: {},
      release: {},
    }),
    /pass acceptedResolution in published mode and only there/u,
  );
});
