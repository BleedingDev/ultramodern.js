import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createReleaseArtifactBinding } from '../published-create-proof/acceptance-contract.mjs';
import {
  confinedPath,
  fileEvidence,
  releaseConsumerInputs,
  sha256,
} from '../react-rsc-worker-proof/contract.mjs';

export { confinedPath, fileEvidence, sha256 };

export function parseArgs(argv) {
  const required = new Map([
    ['--manifest', 'manifestPath'],
    ['--expected-source-revision', 'expectedSourceRevision'],
    ['--expected-version', 'expectedVersion'],
    ['--qualified-node', 'qualifiedNode'],
    ['--pnpm-executable', 'pnpmExecutable'],
    ['--store-dir', 'storeDir'],
    ['--browser-dependency-root', 'browserDependencyRoot'],
    ['--browser-executable', 'browserExecutable'],
    ['--work-dir', 'workDir'],
    ['--receipt', 'receiptPath'],
    ['--owner', 'owner'],
    ['--owner-pid', 'ownerPid'],
  ]);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert(required.has(key), `Unknown argument: ${key}`);
    assert(value && !value.startsWith('--'), `${key} requires a value`);
    const field = required.get(key);
    assert(!(field in options), `Duplicate argument: ${key}`);
    options[field] = value;
  }
  for (const [flag, field] of required)
    assert(field in options, `${flag} is required`);
  assert(/^[1-9]\d*$/u.test(options.ownerPid));
  options.ownerPid = Number(options.ownerPid);
  return validateOptions(options);
}

export function validateOptions(options) {
  for (const field of [
    'manifestPath',
    'qualifiedNode',
    'pnpmExecutable',
    'storeDir',
    'browserDependencyRoot',
    'browserExecutable',
    'workDir',
    'receiptPath',
  ]) {
    assert(
      typeof options[field] === 'string' && path.isAbsolute(options[field]),
      `${field} must be absolute`,
    );
    assert.equal(
      path.resolve(options[field]),
      options[field],
      `${field} must be canonical`,
    );
  }
  assert(
    /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(options.expectedSourceRevision),
  );
  assert(
    typeof options.expectedVersion === 'string' &&
      options.expectedVersion.length > 0,
  );
  assert(typeof options.owner === 'string' && options.owner.length > 0);
  assert(Number.isSafeInteger(options.ownerPid) && options.ownerPid > 1);
  confinedPath(
    options.workDir,
    path.relative(options.workDir, options.receiptPath),
  );
  return options;
}

export function consumerInputs(release) {
  const template = JSON.parse(
    fs.readFileSync(
      new URL(
        '../react-rsc-worker-proof/fixture/package.json.template',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  delete template.dependencies['server-only'];
  template.dependencies['@modern-js/federation-runtime'] = 'cohort';
  template.dependencies['@modern-js/server-runtime-extensions'] = 'cohort';
  // These are the generator's authenticated dependency declarations, including
  // its admitted native MF alias. A plain MF version selects different bytes.
  for (const name of [
    '@module-federation/modern-js-v3',
    '@effect/tsgo',
    '@typescript/native',
  ]) {
    const declared = release.createPackage.packageJson.dependencies[name];
    assert(
      typeof declared === 'string' && declared.length > 0,
      `Authenticated generator dependency missing: ${name}`,
    );
    (name.startsWith('@module-federation/')
      ? template.dependencies
      : template.devDependencies)[name] = declared;
  }
  const specifier = template.dependencies['@module-federation/modern-js-v3'];
  const version =
    /^npm:(?:@[^/]+\/[^@]+|[^@]+)@(.+)$/u.exec(specifier)?.[1] ?? specifier;
  const native = createReleaseArtifactBinding(release).moduleFederation.find(
    item => item.packageName === '@module-federation/modern-js-v3',
  );
  assert(native);
  assert.equal(version, native.version);
  const inputs = releaseConsumerInputs(release, template);
  inputs.nativeDependency = {
    canonicalName: native.packageName,
    declaredSpecifier: specifier,
    version,
    owner: release.createPackage.targetName,
    ownerArtifactSha256: release.createPackage.sha256,
  };
  return inputs;
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

export function assertRequestHtml(
  html,
  token,
  { deferred = true, origins, expectedRemoteCss } = {},
) {
  assert(/^[a-zA-Z0-9_-]+$/u.test(token));
  assert(
    html.includes(`data-token="${token}"`),
    `Real remote body must carry the owning request's props: ${token}`,
  );
  if (deferred)
    assert(
      html.includes(`${token}:deferred`),
      `The actual held remote subtree must finish: ${token}`,
    );
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/u.exec(html)?.[1];
  assert(head, 'Actual native HTML head is missing');
  for (const role of ['healthy', 'fragile']) {
    const marker = new RegExp(
      `<meta\\b(?=[^>]*\\bname="lifecycle-${role}")(?=[^>]*\\bcontent="${token}")[^>]*>`,
      'gu',
    );
    assert.equal(
      [...head.matchAll(marker)].length,
      1,
      `Native ${role} Helmet must publish exactly one owning-request head marker: ${token}`,
    );
  }
  const hrefs = [
    ...head.matchAll(
      /<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"/gu,
    ),
  ].map(match => match[1]);
  assert(hrefs.length > 0, 'Native head must include CSS assets');
  assert.equal(
    new Set(hrefs).size,
    hrefs.length,
    'Native head must deduplicate identical CSS URLs',
  );
  if (origins) {
    const local = hrefs
      .map((href, index) => ({ href, index }))
      .filter(item => item.href.startsWith(origins.host));
    const remote = hrefs
      .map((href, index) => ({ href, index }))
      .filter(
        item =>
          item.href.startsWith(origins.healthy) ||
          item.href.startsWith(origins.fragile),
      );
    assert(
      local.length > 0 && remote.length > 0,
      'Actual native head must contain both host and remote CSS URLs',
    );
    assert(
      Math.max(...local.map(item => item.index)) <
        Math.min(...remote.map(item => item.index)),
      'Native head must place host CSS before remote CSS',
    );
    for (const role of ['healthy', 'fragile'])
      assert(
        remote.some(item => item.href.startsWith(origins[role])),
        `Actual ${role} remote CSS must appear in native SSR head`,
      );
  }
  if (expectedRemoteCss) {
    assert(
      expectedRemoteCss.length > 0,
      'Expected remote CSS must come from the actual built manifests',
    );
    const expected = new Set(expectedRemoteCss);
    assert.deepEqual(
      hrefs.filter(href => expected.has(href)),
      expectedRemoteCss,
      'Actual native head must publish every authenticated remote CSS URL in native collector order',
    );
  }
  return {
    htmlSha256: sha256(html),
    byteLength: Buffer.byteLength(html),
    headSha256: sha256(head),
    css: hrefs,
  };
}
