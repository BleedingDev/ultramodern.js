import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectNpmTarball } from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { readReleaseManifest } from '../../ultramodern-publish/lib/source-create-proof/release-manifest.mjs';
import { rsbuildSpecifierFromRelease } from './rsbuild-dependency.mjs';

const sdkName = '@modern-js/renderer-octane';
const compilerVersion = '7.0.2';

function packageFile(archive, target, label, { bin = false } = {}) {
  assert.equal(typeof target, 'string', `${label} must name a package file`);
  // npm bins are package-relative; export targets require their ./ prefix.
  const relative = target.startsWith('./') ? target.slice(2) : target;
  assert.ok(
    (bin || target.startsWith('./')) &&
      relative.length > 0 &&
      relative !== '.' &&
      relative !== '..' &&
      !path.posix.isAbsolute(relative) &&
      !path.win32.isAbsolute(relative) &&
      !/^[a-z]:/iu.test(relative) &&
      !target.includes('\\') &&
      !target.includes('\0') &&
      !/[*?[\]]/u.test(target) &&
      path.posix.normalize(relative) === relative &&
      !relative.startsWith('../'),
    `${label} must name an exact file inside the SDK`,
  );
  assert.ok(
    archive.fileContents.has(relative),
    `The packed SDK is missing ${label}: ${target}`,
  );
  return target;
}

/** Point an existing standalone admission fixture at a real canonical SDK pack. */
export function prepareOctaneAdmission({
  fixtureDirectory,
  sdkTarball,
  releaseManifest,
}) {
  for (const [label, value] of Object.entries({
    fixtureDirectory,
    sdkTarball,
  })) {
    assert.ok(
      typeof value === 'string' && path.isAbsolute(value),
      `${label} must be an absolute path`,
    );
  }
  const fixture = fs.realpathSync(fixtureDirectory);
  const tarball = fs.realpathSync(sdkTarball);
  assert.ok(
    fs.statSync(fixture).isDirectory(),
    'The fixture must be a directory',
  );
  const stat = fs.statSync(tarball);
  assert.ok(stat.isFile(), 'The SDK tarball must be a file');
  assert.ok(stat.size <= 256 * 1024 * 1024, 'The SDK tarball is too large');
  const bytes = fs.readFileSync(tarball);
  const archive = inspectNpmTarball(bytes);
  const sdk = archive.packageJson;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let release;
  if (releaseManifest !== undefined) {
    assert.ok(
      typeof releaseManifest === 'string' && path.isAbsolute(releaseManifest),
      'releaseManifest must be an absolute path',
    );
    release = readReleaseManifest({ manifestPath: releaseManifest });
    const packed = release.packages.find(item => item.sourceName === sdkName);
    assert.ok(
      packed,
      'The verified release must contain the Octane renderer SDK',
    );
    assert.equal(packed.targetName, release.aliases[sdkName]);
    assert.equal(
      sdk.name,
      packed.targetName,
      'The SDK public release identity must match',
    );
    assert.equal(
      sdk.version,
      packed.version,
      'The SDK release version must match',
    );
    assert.equal(
      sha256,
      packed.sha256,
      'The SDK must be the exact verified release tarball',
    );
  } else {
    assert.equal(
      sdk.name,
      sdkName,
      'A public namespace SDK pack requires its verified release manifest',
    );
  }
  assert.equal(
    sdk.dependencies?.typescript,
    compilerVersion,
    'The packed SDK must depend on native TypeScript 7.0.2',
  );
  for (const field of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [name, specifier] of Object.entries(sdk[field] ?? {})) {
      assert.equal(typeof specifier, 'string', `Invalid ${field}.${name}`);
      assert.ok(
        !/^(?:workspace:|link:)/u.test(specifier),
        `The packed SDK must have a normal canonical ${field}.${name} dependency`,
      );
      if (specifier.startsWith('npm:')) {
        assert.ok(
          (name === '@rsbuild/core' &&
            release &&
            specifier === rsbuildSpecifierFromRelease(release)) ||
            (release?.aliases[name] &&
              specifier ===
                `npm:${release.aliases[name]}@${release.release.version}`),
          `The SDK alias ${name} must belong to the verified public release`,
        );
      }
      if (specifier.startsWith('file:')) {
        const dependency = specifier.slice('file:'.length);
        assert.ok(
          path.isAbsolute(dependency) && fs.statSync(dependency).isFile(),
          `The packed SDK's local ${name} dependency must be an absolute tarball`,
        );
      }
    }
  }
  const checker = packageFile(
    archive,
    sdk.bin?.['octane-tsc'],
    'octane-tsc bin',
    { bin: true },
  );
  const typecheck = sdk.exports?.['./typecheck'];
  assert.ok(
    typecheck?.node,
    'The packed SDK must expose its Node typecheck API',
  );
  const publicApi = packageFile(
    archive,
    typecheck.node.import,
    'public Node typecheck import',
  );
  packageFile(archive, typecheck.node.require, 'public Node typecheck require');
  packageFile(archive, typecheck.types, 'public typecheck declarations');

  const manifestFile = path.join(fixture, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.name, 'ultramodern-octane-admission');
  assert.equal(manifest.private, true);
  assert.equal(
    manifest.dependencies?.typescript,
    compilerVersion,
    'The admission app must use the same native TypeScript as its checker',
  );
  assert.ok(
    !manifest.overrides && !manifest.pnpm?.overrides,
    'The admission SDK must be installed without dependency overrides',
  );
  delete manifest.dependencies[sdkName];
  manifest.devDependencies = {
    ...manifest.devDependencies,
    [sdkName]: `file:${tarball}`,
  };
  manifest.devDependencies = Object.fromEntries(
    Object.entries(manifest.devDependencies).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    fixture,
    packageName: sdk.name,
    packageVersion: sdk.version,
    sdkTarball: tarball,
    sha256,
    dependency: `file:${tarball}`,
    checker,
    publicApi,
    compilerVersion,
    ...(release
      ? {
          releaseManifest: release.manifestPath,
          releaseManifestSha256: release.manifestSha256,
          releaseCohortDigest: release.cohortDigest,
        }
      : {}),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = {
      '--fixture': 'fixtureDirectory',
      '--sdk-tarball': 'sdkTarball',
      '--release-manifest': 'releaseManifest',
    }[args[index]];
    assert.ok(
      key && args[index + 1],
      `Unsupported or incomplete option: ${args[index]}`,
    );
    assert.ok(!options[key], `Duplicate option: ${args[index]}`);
    options[key] = args[++index];
  }
  console.log(JSON.stringify(prepareOctaneAdmission(options), null, 2));
}
