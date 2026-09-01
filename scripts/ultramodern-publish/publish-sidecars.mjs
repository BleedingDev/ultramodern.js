#!/usr/bin/env node
// Consumer: publish-bleedingdev.yml publish-sidecars job (runs BEFORE the cohort).
//
// The cohort package @bleedingdev/modern-js-image pins its sidecars through
// `npm:@bleedingdev/<name>@<exact version>` alias specifiers, which npm can
// only resolve once those exact versions already exist on the registry. This
// CLI publishes the staged sidecars, in alias order, from the same immutable
// release bundle the cohort publishes from, using the same npm trusted
// publishing OIDC exchange. There is no token path.
//
// Modes:
//   --check-staging  offline validation of the staged sidecar lane (no network)
//   --dry-run        plan against the live registry without publishing
//   (default)        publish, then re-verify the exact registry state
import path from 'node:path';
import cliKit from '../lib/cli-kit.js';
import validationKit from '../lib/validation-kit.js';
import { isDirectRun } from './lib/direct-run.mjs';
import { rejectInlineOptionSyntax } from './lib/option-syntax.mjs';
import { sleep } from './lib/prepare-bleedingdev-packages/commands.mjs';
import {
  repoRoot,
  sidecarAliasConsumerTargetName,
  sidecarManifestFile,
  sidecarTarballsDirectory,
} from './lib/prepare-bleedingdev-packages/constants.mjs';
import {
  assertAcceptedPublishToolchain,
  loadNpmPublishingRuntime,
  requestTrustedPublishingToken,
} from './lib/prepare-bleedingdev-packages/npm-buffer-publisher.mjs';
import { resolveOwnedPreparationOutput } from './lib/prepare-bleedingdev-packages/options.mjs';
import { lookupRegistryPackument } from './lib/prepare-bleedingdev-packages/registry.mjs';
import { verifyReleaseArtifacts } from './lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import {
  assertSidecarPublishOrder,
  assertSidecarPublishTarget,
  assertSidecarStagingManifest,
  assertSidecarTrustedPublishContext,
  npmRegistryUrl,
  sidecarPublishTag,
  sidecarRegistryDecision,
} from './lib/prepare-bleedingdev-packages/sidecar-publication.mjs';

const { parseCliArgs } = cliKit;
const { isPlainObject } = validationKit;

const registryNotFoundPattern = /registry metadata returned HTTP 404$/u;
// Bounded post-publish propagation window; npm needs a few seconds before a
// freshly published version and its dist-tag are both readable.
const propagationDelaysMs = Object.freeze([
  2000, 3000, 5000, 5000, 10000, 10000, 10000, 15000, 15000, 15000,
]);
const initialPackumentDelaysMs = Object.freeze([2000, 3000, 5000]);

// The only registry states a post-publish wait may retry. Each one is a state
// the registry reaches on its own within the propagation window; nothing here
// describes a registry that disagrees with what this lane staged.
const propagationPendingStates = Object.freeze({
  // The packument itself is not readable yet (first version of a new package).
  packumentAbsent: 'packument-absent',
  // The version index has not caught up with the publish.
  versionAbsent: 'version-absent',
  // The dist-tag already names this exact version, but the version document is
  // not indexed yet. Only reachable for the version this run just published, so
  // it can never mean drift.
  versionAbsentTagClaimed: 'version-absent-tag-claimed',
  // The version is readable and identical, but the dist-tag has not moved yet.
  tagAbsent: 'tag-absent',
});

const resumableInitialStates = new Set([
  propagationPendingStates.versionAbsentTagClaimed,
  propagationPendingStates.tagAbsent,
]);

const cliValueOptions = new Set(['--out', '--tag']);
const cliBooleanOptions = new Set(['--dry-run', '--check-staging']);

function parseArgs(argv) {
  rejectInlineOptionSyntax(argv, {
    booleanOptions: cliBooleanOptions,
    valueOptions: cliValueOptions,
  });

  const options = parseCliArgs(argv, {
    defaults: {
      checkStaging: false,
      dryRun: false,
      out: path.join(repoRoot, '.modern', 'bleedingdev-publish'),
      tag: sidecarPublishTag,
    },
    ignoreTerminator: true,
    options: {
      'check-staging': { key: 'checkStaging', type: 'boolean' },
      'dry-run': { key: 'dryRun', type: 'boolean' },
      out: {},
      tag: {},
    },
  });

  if (options.checkStaging && options.dryRun) {
    throw new Error('--check-staging and --dry-run are mutually exclusive');
  }
  if (options.tag !== sidecarPublishTag) {
    throw new Error(
      `--tag must be ${sidecarPublishTag}; the cohort and its sidecars ship one dist-tag`,
    );
  }
  options.out = resolveOwnedPreparationOutput(options.out);
  return options;
}

/**
 * Read the staged sidecar lane from the release bundle and re-derive its
 * identity from the staged bytes rather than trusting sidecars.json alone.
 */
function readStagedSidecars(
  releaseDir,
  { verifyRelease = verifyReleaseArtifacts } = {},
) {
  const release = verifyRelease(releaseDir);
  if (!release.sidecars) {
    throw new Error(
      `Missing accepted ${sidecarManifestFile} in ${releaseDir}; stage the release with --include-sidecars before publishing sidecars`,
    );
  }
  const manifest = assertSidecarStagingManifest(release.sidecars.manifest, {
    publishBefore: sidecarAliasConsumerTargetName,
  });
  const byName = new Map(
    release.sidecars.packages.map(sidecar => [sidecar.name, sidecar]),
  );
  const sidecars = manifest.packages.map(entry => {
    const accepted = byName.get(entry.name);
    if (!accepted) {
      throw new Error(
        `Accepted sidecar ${entry.name}@${entry.version} has no verified tarball`,
      );
    }
    if (
      accepted.packageJson.name !== entry.name ||
      accepted.packageJson.version !== entry.version
    ) {
      throw new Error(
        `Accepted sidecar ${entry.name}@${entry.version} contains ${String(accepted.packageJson.name)}@${String(accepted.packageJson.version)}`,
      );
    }
    assertSidecarPublishTarget(
      accepted.packageJson,
      `Sidecar ${entry.name}@${entry.version}`,
    );
    return {
      ...entry,
      bytes: accepted.bytes,
      packageJson: accepted.packageJson,
    };
  });

  assertSidecarPublishOrder(sidecars);
  return { manifest, release, sidecars };
}

async function readSidecarPackument(name, fetchImpl = globalThis.fetch) {
  try {
    // An explicit fetchImpl bypasses the process-wide packument memo, so the
    // post-publish re-read observes the registry as it is now.
    return await lookupRegistryPackument(name, { fetchImpl });
  } catch (error) {
    if (
      registryNotFoundPattern.test(error instanceof Error ? error.message : '')
    ) {
      return null;
    }
    throw error;
  }
}

async function publishSidecarBuffer(
  sidecar,
  bytes,
  options,
  dependencies = {},
) {
  const runtime = (dependencies.loadRuntime ?? loadNpmPublishingRuntime)();
  assertAcceptedPublishToolchain(options.acceptedTools, runtime);
  const requestToken =
    dependencies.requestToken ?? requestTrustedPublishingToken;
  const token = await requestToken(sidecar.name, {
    registryUrl: npmRegistryUrl,
  });
  const registry = new URL(npmRegistryUrl);
  const authKey = `//${registry.host}${registry.pathname}:_authToken`;
  await runtime.publish(sidecar.packageJson, bytes, {
    access: 'public',
    defaultTag: options.tag,
    npmVersion: runtime.npmVersion,
    provenance: true,
    registry: npmRegistryUrl,
    [authKey]: token,
  });
  return { npmVersion: runtime.npmVersion };
}

/**
 * Classify a post-publish registry read as "still propagating" or "settled".
 *
 * Returns a typed pending state while the registry has simply not caught up
 * with the publish this lane just performed, and `null` the moment the read is
 * decisive - at which point `sidecarRegistryDecision` owns the verdict.
 *
 * The distinction that matters: a MISSING dist-tag is transient (npm writes the
 * version document and the dist-tag separately), while a dist-tag pointing at a
 * DIFFERENT real version is terminal - that is another publisher's tag, not a
 * slow one, and no amount of waiting turns it into ours. Content drift is
 * terminal for the same reason: an npm version is immutable.
 *
 * Every pending answer is proved, not assumed: before reporting a transient
 * state this re-runs `sidecarRegistryDecision`, so a terminal condition hiding
 * behind a missing tag (content drift, a backwards `latest`) still throws.
 */
function classifySidecarPropagation(sidecar, packument, { tag }) {
  if (packument === null || packument === undefined) {
    return {
      detail: `${sidecar.name} is not readable on the registry yet`,
      state: propagationPendingStates.packumentAbsent,
    };
  }
  if (!isPlainObject(packument)) {
    return null;
  }
  const distTags = packument['dist-tags'];
  const versions = packument.versions;
  // Anything malformed or mis-identified is decisive: sidecarRegistryDecision
  // rejects it rather than this lane waiting on a registry that is not ours.
  if (
    packument.name !== sidecar.name ||
    !isPlainObject(distTags) ||
    !isPlainObject(versions)
  ) {
    return null;
  }
  const currentTag =
    typeof distTags[tag] === 'string' ? distTags[tag] : undefined;

  if (!Object.hasOwn(versions, sidecar.version)) {
    if (currentTag === sidecar.version) {
      return {
        detail: `${sidecar.name} dist-tag ${tag} already names ${sidecar.version}, but the version document is not indexed yet`,
        state: propagationPendingStates.versionAbsentTagClaimed,
      };
    }
    // Throws on a backwards `latest`; returns `publish` while genuinely absent.
    sidecarRegistryDecision(sidecar, packument, { tag });
    return {
      detail: `${sidecar.name}@${sidecar.version} is still absent from the registry`,
      state: propagationPendingStates.versionAbsent,
    };
  }

  if (currentTag !== undefined) {
    // The version and the dist-tag are both readable: decisive either way.
    return null;
  }

  // The version is readable but untagged. Confirm the published bytes are the
  // staged bytes before waiting - content drift can never resolve itself.
  sidecarRegistryDecision(
    sidecar,
    { ...packument, 'dist-tags': { ...distTags, [tag]: sidecar.version } },
    { tag },
  );
  return {
    detail: `${sidecar.name} dist-tag ${tag} has not propagated to ${sidecar.version} yet`,
    state: propagationPendingStates.tagAbsent,
  };
}

async function awaitPublishedSidecar(sidecar, options, dependencies = {}) {
  const readPackument = dependencies.readPackument ?? readSidecarPackument;
  const wait = dependencies.wait ?? sleep;
  const classify =
    dependencies.classifyPropagation ?? classifySidecarPropagation;
  let lastState = `${sidecar.name}@${sidecar.version} did not appear on the registry`;
  for (let attempt = 0; attempt <= propagationDelaysMs.length; attempt += 1) {
    const packument = await readPackument(sidecar.name);
    // A throw from either call is terminal by construction: the classifier only
    // ever returns a pending state it has already proved is transient.
    const pending = classify(sidecar, packument, { tag: options.tag });
    if (pending === null) {
      return sidecarRegistryDecision(sidecar, packument, { tag: options.tag });
    }
    lastState = pending.detail;
    if (attempt < propagationDelaysMs.length) {
      await wait(propagationDelaysMs[attempt]);
    }
  }
  throw new Error(
    `Published sidecar ${sidecar.name}@${sidecar.version} did not become verifiable: ${lastState}`,
  );
}

async function awaitInitialSidecarPackument(sidecar, dependencies = {}) {
  const readPackument = dependencies.readPackument ?? readSidecarPackument;
  const wait = dependencies.wait ?? sleep;
  for (const delayMs of initialPackumentDelaysMs) {
    await wait(delayMs);
    const packument = await readPackument(sidecar.name);
    if (packument !== null && packument !== undefined) {
      return packument;
    }
  }
  return null;
}

async function publishSidecars(options, dependencies = {}) {
  const readSidecars = dependencies.readSidecars ?? readStagedSidecars;
  const { manifest, release, sidecars } = readSidecars(options.out);
  const acceptedTools = release.manifest.tools;
  const plan = sidecars.map(sidecar => `${sidecar.name}@${sidecar.version}`);
  console.log(
    [
      `Sidecar publication order (before ${manifest.publishBefore}): ${plan.join(' -> ')}`,
    ].join('\n'),
  );

  if (options.checkStaging) {
    console.log(
      `Staging check only: ${sidecars.length} sidecar(s) validated offline; nothing was published.`,
    );
    return { published: [], reused: [], validated: plan };
  }

  const readPackument = dependencies.readPackument ?? readSidecarPackument;
  const published = [];
  const reused = [];
  for (const sidecar of sidecars) {
    let packument = await readPackument(sidecar.name);
    if (packument === null || packument === undefined) {
      packument = await awaitInitialSidecarPackument(sidecar, {
        ...dependencies,
        readPackument,
      });
    }
    const pending = classifySidecarPropagation(sidecar, packument, {
      tag: options.tag,
    });
    // A previous run may have published this exact version and stopped while npm
    // was indexing it. Resume only when the registry itself proves that claim:
    // the tag already names this version, or the identical version is readable
    // and only its tag is missing. An absent package/version still takes the
    // ordinary publish/bootstrap path instead of sleeping on an assumption.
    const decision =
      pending && resumableInitialStates.has(pending.state)
        ? await awaitPublishedSidecar(sidecar, options, dependencies)
        : sidecarRegistryDecision(sidecar, packument, { tag: options.tag });
    if (decision.action === 'reuse') {
      console.log(`Reusing ${decision.reason}`);
      reused.push(`${sidecar.name}@${sidecar.version}`);
      continue;
    }

    // npm trusted publishing can only publish to a package that ALREADY exists
    // and already has a trusted publisher configured; the OIDC exchange has no
    // way to create the package. A first publish is therefore a deliberate,
    // authorized, interactive act - never something this unattended lane does.
    if (packument === null || packument === undefined) {
      throw new Error(
        [
          `${sidecar.name} does not exist on the registry after the bounded propagation wait, so the trusted-publishing lane cannot create it.`,
          'npm trusted publishing publishes to an existing package with a configured trusted publisher; the OIDC token cannot bootstrap a new package name.',
          `Bootstrap ${sidecar.name}@${sidecar.version} interactively once, with explicit authorization, then configure this workflow as its trusted publisher on npm and re-run this lane.`,
          'This lane fails closed in both dry-run and publication modes rather than claiming a publish it cannot perform.',
        ].join('\n'),
      );
    }
    if (options.dryRun) {
      console.log(
        `Dry-run: would publish ${sidecar.name}@${sidecar.version} at ${options.tag} (${decision.reason})`,
      );
      published.push(`${sidecar.name}@${sidecar.version}`);
      continue;
    }

    assertSidecarTrustedPublishContext();
    await publishSidecarBuffer(
      sidecar,
      sidecar.bytes,
      { ...options, acceptedTools },
      dependencies,
    );
    await awaitPublishedSidecar(sidecar, options, dependencies);
    console.log(
      `Published ${sidecar.name}@${sidecar.version} at ${options.tag}`,
    );
    published.push(`${sidecar.name}@${sidecar.version}`);
  }

  console.log(
    [
      options.dryRun
        ? `Dry-run validated ${plan.length} sidecar(s) before ${manifest.publishBefore}.`
        : `Sidecar lane complete: ${published.length} published, ${reused.length} reused, all readable before ${manifest.publishBefore}.`,
    ].join('\n'),
  );
  return { published, reused, validated: plan };
}

async function main() {
  await publishSidecars(parseArgs(process.argv.slice(2)));
}

if (isDirectRun(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export {
  awaitInitialSidecarPackument,
  awaitPublishedSidecar,
  classifySidecarPropagation,
  initialPackumentDelaysMs,
  parseArgs,
  propagationDelaysMs,
  propagationPendingStates,
  publishSidecarBuffer,
  publishSidecars,
  readSidecarPackument,
  readStagedSidecars,
  sidecarTarballsDirectory,
};
