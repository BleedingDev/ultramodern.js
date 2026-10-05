import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { auditInstalledConsumer, auditReleaseArtifacts } from './artifacts.mjs';
import {
  assertNativeCompilerObservationUnchanged,
  assertNativeTypeProgramBindings,
  readCompiledClientModuleGraph,
  readNativeCompilerObservation,
} from './compiler-observation.mjs';
import { probeHttp } from './http.mjs';
import { assertConformanceReceipt, renderers } from './matrix.mts';

const sha256 = value => createHash('sha256').update(value).digest('hex');

async function authoredInputDigest(applicationRoot) {
  const inputs = [];
  async function visit(relative) {
    const absolute = path.join(applicationRoot, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolute)).sort())
        await visit(path.join(relative, name));
    } else if (stat.isFile())
      inputs.push([relative, sha256(await fs.readFile(absolute))]);
    else throw new Error('Acceptance authored inputs must be ordinary files');
  }
  for (const name of (await fs.readdir(applicationRoot)).sort())
    if (name === 'src' || /\.(?:[cm]?[jt]sx?|json|css)$/u.test(name))
      await visit(name);
  return sha256(JSON.stringify(inputs));
}

function validHmrProfile(hmr) {
  return (
    ['preserved', 'may-reset'].includes(hmr?.editedBoundary) &&
    hmr.unaffectedComponents === 'preserved' &&
    hmr.document === 'preserved' &&
    hmr.roots === 'single' &&
    hmr.cleanup === 'exactly-once'
  );
}

export function publicPackageSpecifier(canonicalName, kind = 'hand-authored') {
  if (
    !canonicalName.startsWith('@modern-js/') ||
    !['generated', 'hand-authored'].includes(kind)
  )
    throw new Error(
      'Public package resolution requires the actual consumer kind',
    );
  return kind === 'generated'
    ? canonicalName
    : `@bleedingdev/modern-js-${canonicalName.slice('@modern-js/'.length)}`;
}

export function requiredExportProbes(renderer, kind = 'hand-authored') {
  const runtime = publicPackageSpecifier(
    `@modern-js/renderer-${renderer}`,
    kind,
  );
  return [
    {
      role: 'configuration',
      specifier: publicPackageSpecifier(
        '@modern-js/ultramodern-app-tools',
        kind,
      ),
      exports: [
        'defineConfig',
        'resolveRendererProfile',
        'validateRendererBuildManifest',
        'validateRendererDevelopmentBuildManifest',
      ],
    },
    {
      role: 'client-runtime',
      specifier:
        renderer === 'react'
          ? `${publicPackageSpecifier('@modern-js/runtime', kind)}/browser`
          : `${runtime}/client`,
      exports:
        renderer === 'react'
          ? ['render', 'hydrateWithReact']
          : renderer === 'solid'
            ? ['mountApplication', 'hydrateApplication']
            : ['mountOctaneApplication', 'hydrateOctaneApplication'],
      conditions: ['browser'],
    },
    {
      role: 'server-runtime',
      specifier:
        renderer === 'react'
          ? `${publicPackageSpecifier('@modern-js/runtime', kind)}/ssr/server`
          : `${runtime}/server`,
      exports:
        renderer === 'react'
          ? ['renderString', 'renderStreaming']
          : renderer === 'solid'
            ? ['renderApplication']
            : ['renderOctaneApplication'],
    },
    {
      role: 'router',
      specifier:
        renderer === 'react'
          ? `${publicPackageSpecifier('@modern-js/plugin-tanstack', kind)}/runtime`
          : `${runtime}/router`,
      exports: ['Link', 'Outlet'],
      conditions: ['browser'],
    },
    ...(renderer === 'react'
      ? []
      : [
          {
            role: 'data-protocol',
            specifier: `${publicPackageSpecifier('@modern-js/renderer-core', kind)}/data`,
            exports: ['readDataResponse', 'deferData'],
          },
        ]),
  ];
}

/** Use the installed public owning validator, never a workspace source import. */
export async function loadInstalledBuildManifest({
  applicationRoot,
  metadata,
  renderer,
  kind = 'hand-authored',
  environment = 'production',
}) {
  if (!['production', 'development'].includes(environment))
    throw new Error('Unknown renderer build manifest environment');
  const require = createRequire(path.join(applicationRoot, 'package.json'));
  const owner = require(
    publicPackageSpecifier('@modern-js/ultramodern-app-tools', kind),
  );
  if (
    typeof owner.resolveRendererProfile !== 'function' ||
    typeof owner.validateRendererBuildManifest !== 'function'
  )
    throw new Error(
      'Packed framework does not expose its owning renderer build manifest validator',
    );
  const validate =
    environment === 'development'
      ? owner.validateRendererDevelopmentBuildManifest
      : owner.validateRendererBuildManifest;
  if (typeof validate !== 'function')
    throw new Error(
      'Packed framework does not expose its owning development renderer manifest validator',
    );
  return validate(metadata, owner.resolveRendererProfile(renderer));
}

export function loadInstalledRendererProfile({
  applicationRoot,
  renderer,
  kind = 'hand-authored',
}) {
  const require = createRequire(path.join(applicationRoot, 'package.json'));
  const owner = require(
    publicPackageSpecifier('@modern-js/ultramodern-app-tools', kind),
  );
  if (typeof owner.resolveRendererProfile !== 'function')
    throw new Error(
      'Packed framework does not expose its admitted renderer profile',
    );
  return owner.resolveRendererProfile(renderer);
}

export function loadInstalledDataResponseReader({ applicationRoot, kind }) {
  const require = createRequire(path.join(applicationRoot, 'package.json'));
  const owner = require(
    `${publicPackageSpecifier('@modern-js/renderer-core', kind)}/data`,
  );
  if (typeof owner.readDataResponse !== 'function')
    throw new Error(
      'Packed native framework does not expose its owning data protocol decoder',
    );
  return owner.readDataResponse;
}

export function validateConsumerSelection(consumers, selected = renderers) {
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.some(renderer => !renderers.includes(renderer)) ||
    new Set(selected).size !== selected.length
  )
    throw new Error('Unknown or duplicate selected renderer');
  if (!Array.isArray(consumers) || consumers.length !== selected.length * 2) {
    throw new Error(
      'Exactly one generated and one hand-authored consumer per renderer are required',
    );
  }
  const seen = new Set();
  const roots = new Set();
  for (const consumer of consumers) {
    const key = `${consumer.renderer}:${consumer.kind}`;
    if (
      !selected.includes(consumer.renderer) ||
      !['generated', 'hand-authored'].includes(consumer.kind) ||
      seen.has(key)
    ) {
      throw new Error('Unknown or duplicate renderer consumer');
    }
    seen.add(key);
    if (
      !path.isAbsolute(consumer.consumerRoot ?? '') ||
      typeof consumer.typeProgramFile !== 'string' ||
      !consumer.typeProgramFile ||
      (consumer.renderer !== 'react' &&
        (typeof consumer.hostTypeProgramFile !== 'string' ||
          !consumer.hostTypeProgramFile)) ||
      !Array.isArray(consumer.entryFiles) ||
      !consumer.entryFiles.length
    ) {
      throw new Error(
        `${key} requires an isolated absolute consumer root and built entry files`,
      );
    }
    if (Object.hasOwn(consumer, 'nativeTypeEntries'))
      throw new Error(
        'Native type entry roots must come from the actual build observation, not consumer configuration',
      );
    if (roots.has(path.resolve(consumer.consumerRoot)))
      throw new Error('Consumers must have separate roots and type programs');
    roots.add(path.resolve(consumer.consumerRoot));
    for (const environment of ['development', 'production']) {
      if (
        typeof consumer.environments?.[environment]?.metadataFile !==
          'string' ||
        path.basename(consumer.environments[environment].metadataFile) !==
          'renderer-build.json'
      )
        throw new Error(`${key} requires actual ${environment} build metadata`);
    }
    if (
      !consumer.exactPackages ||
      !Object.keys(consumer.exactPackages).length
    ) {
      throw new Error(`${key} requires its exact installed native tuple`);
    }
    if (!validHmrProfile(consumer.profile?.hmr)) {
      throw new Error(`${key} requires its admitted native HMR state policy`);
    }
    if (
      !/^\d+\.\d+\.\d+$/u.test(consumer.profile?.minimumNode ?? '') ||
      !path.isAbsolute(consumer.nodeExecutable ?? '') ||
      !path.isAbsolute(consumer.packageManagerExecutable ?? '')
    ) {
      throw new Error(
        `${key} requires its exact minimum Node and pinned Node/package-manager executables`,
      );
    }
    if (
      !consumer.commands ||
      Object.keys(consumer.commands).sort().join(',') !== 'build,typecheck'
    )
      throw new Error(
        `${key} requires exactly typecheck and one combined build command`,
      );
    for (const name of ['typecheck', 'build']) {
      const commands = Array.isArray(consumer.commands[name])
        ? consumer.commands[name]
        : [consumer.commands[name]];
      if (
        commands.length !==
        (name === 'typecheck' && consumer.renderer !== 'react' ? 2 : 1)
      )
        throw new Error(
          `${key} requires a browser and Node-host typecheck and one build`,
        );
      for (const command of commands)
        if (
          !command ||
          typeof command.command !== 'string' ||
          ![
            consumer.nodeExecutable,
            consumer.packageManagerExecutable,
          ].includes(command.command) ||
          !Array.isArray(command.args) ||
          command.args.some(value => typeof value !== 'string')
        )
          throw new Error(`${key} requires an executable ${name} command`);
    }
    if (
      !Array.isArray(consumer.exportProbes) ||
      consumer.exportProbes.length === 0
    ) {
      throw new Error(`${key} requires public export execution probes`);
    }
    if (
      !consumer.exportProbes.some(
        probe =>
          probe.specifier ===
            publicPackageSpecifier(
              '@modern-js/ultramodern-app-tools',
              consumer.kind,
            ) &&
          probe.role === 'configuration' &&
          probe.exports?.includes('defineConfig'),
      )
    ) {
      throw new Error(`${key} must execute the public defineConfig export`);
    }
    for (const requirement of requiredExportProbes(
      consumer.renderer,
      consumer.kind,
    )) {
      const probe = consumer.exportProbes.find(
        value => value.role === requirement.role,
      );
      if (
        !probe ||
        probe.specifier !== requirement.specifier ||
        !Array.isArray(probe.exports) ||
        !probe.exports.length ||
        !requirement.exports.every(name => probe.exports.includes(name)) ||
        probe.exports.some(name => typeof name !== 'string' || !name)
      )
        throw new Error(
          `${key} requires the public ${requirement.role} module and its native exports`,
        );
      if (requirement.conditions && !probe.conditions?.includes('browser'))
        throw new Error(
          `${key} requires the browser condition for ${requirement.role}`,
        );
      publicExportCommand({
        ...probe,
        renderer: consumer.renderer,
        nodeExecutable: consumer.nodeExecutable,
      });
    }
  }
  for (const renderer of selected) {
    const pair = consumers.filter(consumer => consumer.renderer === renderer);
    const tuple = consumer =>
      Object.fromEntries(Object.entries(consumer.exactPackages).sort());
    if (
      !isDeepStrictEqual(tuple(pair[0]), tuple(pair[1])) ||
      !isDeepStrictEqual(pair[0].profile, pair[1].profile)
    ) {
      throw new Error(
        `${renderer} generated and hand-authored consumers must use the same admitted profile`,
      );
    }
  }
  return consumers;
}

export async function executeCommand(
  command,
  cwd,
  { timeoutMs = 120_000, env = process.env } = {},
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000) {
    throw new Error('Command timeout must be a bounded positive duration');
  }
  const start = performance.now();
  const stdout = createHash('sha256');
  const stderr = createHash('sha256');
  const child = spawn(command.command, command.args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: process.platform !== 'win32',
  });
  let failureTail = '';
  for (const [stream, digest] of [
    [child.stdout, stdout],
    [child.stderr, stderr],
  ]) {
    stream.on('data', value => {
      digest.update(value);
      failureTail = `${failureTail}${value}`.slice(-4_096);
    });
  }
  let timedOut = false;
  let wasInterrupted = false;
  let hardStop;
  const terminate = signal => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const stop = () => {
    terminate('SIGTERM');
    hardStop ??= setTimeout(() => terminate('SIGKILL'), 2_000);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  const interrupted = () => {
    wasInterrupted = true;
    stop();
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => {
    clearTimeout(timer);
    clearTimeout(hardStop);
    terminate('SIGTERM');
    terminate('SIGKILL');
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
  });
  if (timedOut || wasInterrupted || exit.code !== 0) {
    throw new Error(
      `Consumer command failed (${timedOut ? 'timeout' : wasInterrupted ? 'interrupted' : (exit.code ?? exit.signal)}): ${command.command}\n${failureTail}`,
    );
  }
  return {
    command: command.command,
    args: command.args,
    cwd,
    exitCode: exit.code,
    durationMs: Math.round(performance.now() - start),
    stdoutSha256: stdout.digest('hex'),
    stderrSha256: stderr.digest('hex'),
  };
}

export function publicExportCommand(probe) {
  if (
    typeof probe.specifier !== 'string' ||
    !probe.specifier ||
    !Array.isArray(probe.exports) ||
    !probe.exports.length
  ) {
    throw new Error('Public export probe requires a specifier and exports');
  }
  const invocation =
    probe.role === 'configuration'
      ? `\nconst config = await value.defineConfig({ renderer: ${JSON.stringify(probe.renderer)} }); if (!config || config.renderer !== ${JSON.stringify(probe.renderer)} || !Array.isArray(config.plugins) || config.plugins.length === 0) throw new Error('Public defineConfig did not compose the selected renderer');`
      : '';
  const source = `const value = await import(${JSON.stringify(probe.specifier)});\nfor (const name of ${JSON.stringify(probe.exports)}) { if (!(name in value)) throw new Error('Missing public export ' + name); }${invocation}`;
  const conditions = probe.conditions ?? ['node'];
  if (
    !Array.isArray(conditions) ||
    conditions.some(condition => !/^[a-z][a-z\d-]*$/u.test(condition))
  ) {
    throw new Error('Invalid export condition');
  }
  return {
    command: probe.nodeExecutable ?? process.execPath,
    args: [
      ...conditions.map(condition => `--conditions=${condition}`),
      '--input-type=module',
      '--eval',
      source,
    ],
  };
}

function profileDigest(consumers) {
  const profiles = consumers
    .map(consumer => ({
      renderer: consumer.renderer,
      kind: consumer.kind,
      exactPackages: Object.fromEntries(
        Object.entries(consumer.exactPackages).sort(),
      ),
      profile: consumer.profile,
      identityMetadataSha256: consumer.identityMetadataSha256,
    }))
    .sort((left, right) =>
      `${left.renderer}:${left.kind}`.localeCompare(
        `${right.renderer}:${right.kind}`,
      ),
    );
  return sha256(JSON.stringify(profiles));
}

/** Runs builds and HTTP probes against already provisioned, owned isolated consumers. */
export async function runPackedConformance(config, dependencies = {}) {
  const consumers = validateConsumerSelection(
    config.consumers,
    config.renderers ?? renderers,
  );
  const auditArtifacts =
    dependencies.auditReleaseArtifacts ?? auditReleaseArtifacts;
  const auditConsumer =
    dependencies.auditInstalledConsumer ?? auditInstalledConsumer;
  const run = dependencies.executeCommand ?? executeCommand;
  const http = dependencies.probeHttp ?? probeHttp;
  const loadBuildManifest =
    dependencies.loadBuildManifest ?? loadInstalledBuildManifest;
  const loadRendererProfile =
    dependencies.loadRendererProfile ?? loadInstalledRendererProfile;
  const loadDataResponseReader =
    dependencies.loadDataResponseReader ?? loadInstalledDataResponseReader;
  const artifacts = await auditArtifacts({
    manifestPath: config.manifestPath,
    expectedSourceRevision: config.expectedSourceRevision,
  });
  const roots = await Promise.all(
    consumers.map(consumer => fs.realpath(consumer.consumerRoot)),
  );
  for (let index = 0; index < roots.length; index++) {
    for (let other = index + 1; other < roots.length; other++) {
      const relation = path.relative(roots[index], roots[other]);
      const inverse = path.relative(roots[other], roots[index]);
      if (
        !relation ||
        (!relation.startsWith(`..${path.sep}`) &&
          relation !== '..' &&
          !path.isAbsolute(relation)) ||
        (!inverse.startsWith(`..${path.sep}`) &&
          inverse !== '..' &&
          !path.isAbsolute(inverse))
      ) {
        throw new Error(
          'Consumers must have separate, non-overlapping real roots',
        );
      }
    }
  }
  const identity = {
    sourceRevision: artifacts.sourceRevision,
    profileDigest: '',
    artifactDigests: artifacts.artifacts
      .map(artifact => artifact.sha256)
      .sort(),
    hmrPolicies: Object.fromEntries(
      consumers
        .filter(consumer => consumer.kind === 'generated')
        .map(consumer => [
          consumer.renderer,
          consumer.profile.hmr.editedBoundary,
        ]),
    ),
    applicationIdentities: {},
  };
  const report = {
    schemaVersion: 1,
    identity,
    artifacts,
    consumers: [],
    evidence: [],
    protocolEvidence: [],
    status: 'running',
  };
  for (const consumer of consumers) {
    const consumerRoot = await fs.realpath(consumer.consumerRoot);
    const applicationRoot = await fs.realpath(
      path.resolve(consumerRoot, consumer.applicationRoot ?? '.'),
    );
    const applicationRelative = path.relative(consumerRoot, applicationRoot);
    if (
      applicationRelative === '..' ||
      applicationRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(applicationRelative)
    )
      throw new Error('Application root must belong to its isolated consumer');
    const admittedProfile = await loadRendererProfile({
      applicationRoot,
      renderer: consumer.renderer,
      kind: consumer.kind,
    });
    if (
      admittedProfile?.renderer !== consumer.renderer ||
      !/^\d+\.\d+\.\d+$/u.test(admittedProfile.minimumNode ?? '') ||
      !validHmrProfile(admittedProfile.hmr) ||
      consumer.profile.minimumNode !== admittedProfile.minimumNode ||
      !isDeepStrictEqual(consumer.profile.hmr, admittedProfile.hmr)
    )
      throw new Error(
        'Consumer minimum Node/HMR policy does not match the installed admitted renderer profile',
      );
    const typeProgramPath = await fs.realpath(
      path.resolve(consumerRoot, consumer.typeProgramFile),
    );
    const typeProgramRelative = path.relative(consumerRoot, typeProgramPath);
    if (
      typeProgramRelative === '..' ||
      typeProgramRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(typeProgramRelative)
    )
      throw new Error('Type program must belong to its isolated consumer');
    const typeProgramBytes = await fs.readFile(typeProgramPath);
    const typeProgram = JSON.parse(typeProgramBytes);
    const typePrograms = [
      {
        role: consumer.renderer === 'react' ? 'application' : 'browser',
        path: typeProgramPath,
        relative: typeProgramRelative,
        bytes: typeProgramBytes,
        program: typeProgram,
      },
    ];
    if (consumer.renderer !== 'react') {
      const hostPath = await fs.realpath(
        path.resolve(consumerRoot, consumer.hostTypeProgramFile),
      );
      const relative = path.relative(consumerRoot, hostPath);
      if (
        hostPath === typeProgramPath ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        throw new Error(
          'Native browser and Node-host type programs must be separate owned files',
        );
      const bytes = await fs.readFile(hostPath);
      typePrograms.push({
        role: 'server',
        path: hostPath,
        relative,
        bytes,
        program: JSON.parse(bytes),
      });
    }
    const typeCommands = Array.isArray(consumer.commands.typecheck)
      ? consumer.commands.typecheck
      : [consumer.commands.typecheck];
    const permittedTypeFlags = new Set([
      '--project',
      '-p',
      '--noEmit',
      '--pretty',
      '--pretty=true',
      '--pretty=false',
    ]);
    for (const [index, command] of typeCommands.entries()) {
      const typeArguments = command.args;
      const projectIndices = typeArguments.flatMap((value, index) =>
        value === '--project' || value === '-p' ? [index] : [],
      );
      const projectIndex = projectIndices[0];
      if (
        projectIndices.length !== 1 ||
        typeArguments.some(
          value => value.startsWith('-') && !permittedTypeFlags.has(value),
        ) ||
        typeof typeArguments[projectIndex + 1] !== 'string' ||
        (await fs.realpath(
          path.resolve(applicationRoot, typeArguments[projectIndex + 1]),
        )) !== typePrograms[index]?.path
      )
        throw new Error(
          'Typecheck command must execute its actual recorded type program',
        );
    }
    const commandEnv = {
      ...process.env,
      PATH: `${path.dirname(consumer.nodeExecutable)}${path.delimiter}${process.env.PATH ?? ''}`,
      npm_node_execpath: consumer.nodeExecutable,
    };
    const commandOptions = {
      timeoutMs: config.commandTimeoutMs,
      env: commandEnv,
    };
    const commandResults = [];
    const buildEntryFiles = [];
    for (const relative of consumer.buildEntryFiles ?? []) {
      if (typeof relative !== 'string' || path.isAbsolute(relative))
        throw new Error(
          'Host build entry declarations must be consumer-relative paths',
        );
      const file = path.resolve(consumerRoot, relative);
      const stat = await fs.lstat(file);
      if (
        !stat.isFile() ||
        (await fs.realpath(file)) !== file ||
        path.relative(applicationRoot, file).startsWith(`..${path.sep}`) ||
        path.relative(applicationRoot, file) === '..' ||
        path
          .relative(consumerRoot, file)
          .split(path.sep)
          .includes('node_modules')
      )
        throw new Error(
          'Host build declaration requires an ordinary application-owned config file',
        );
      const bytes = await fs.readFile(file);
      buildEntryFiles.push({
        path: path.relative(consumerRoot, file),
        purpose: 'configuration',
        sha256: sha256(bytes),
        byteLength: bytes.length,
      });
    }
    const authoredDigest = await authoredInputDigest(applicationRoot);
    const observationDist = path.dirname(
      path.resolve(consumerRoot, consumer.environments.production.metadataFile),
    );
    const observationFile = path.join(
      observationDist,
      'native-compiler-observation.json',
    );
    const previousObservation = await fs.stat(observationFile).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    commandResults.push({
      phase: 'minimum-node',
      ...(await run(
        {
          command: consumer.nodeExecutable,
          args: [
            '--input-type=module',
            '--eval',
            `if (process.versions.node !== ${JSON.stringify(consumer.profile.minimumNode)}) throw new Error('Incorrect minimum Node runtime ' + process.versions.node);`,
          ],
        },
        consumerRoot,
        commandOptions,
      )),
    });
    commandResults.push({
      phase: 'engine-check',
      ...(await run(
        {
          command: consumer.packageManagerExecutable,
          args: [
            'install',
            '--frozen-lockfile',
            '--offline',
            '--ignore-scripts=false',
            '--config.engineStrict=true',
            '--config.packageImportMethod=clone-or-copy',
          ],
        },
        consumerRoot,
        commandOptions,
      )),
    });
    commandResults.push({
      phase: 'build',
      ...(await run(consumer.commands.build, applicationRoot, commandOptions)),
    });
    // Callers read the fresh build manifest here to bind host identities.
    await dependencies.afterBuild?.(consumer, {
      applicationRoot,
      consumerRoot,
    });
    if ((await authoredInputDigest(applicationRoot)) !== authoredDigest)
      throw new Error(
        'Authored source or type program drifted during the build',
      );
    let compilerObservation;
    {
      const current = await fs.stat(observationFile);
      if (
        previousObservation &&
        current.dev === previousObservation.dev &&
        current.ino === previousObservation.ino
      )
        throw new Error(
          'Actual build did not publish a fresh native compiler observation',
        );
      const production = consumer.environments.production;
      const readObservation =
        consumer.renderer === 'react'
          ? readCompiledClientModuleGraph
          : readNativeCompilerObservation;
      compilerObservation = await readObservation({
        applicationRoot,
        consumerRoot,
        distDirectory: observationDist,
        renderer: consumer.renderer,
        expectedEntryNames: [
          production.identity.entryName,
          production.csrIdentity.entryName,
        ],
      });
      if (consumer.renderer !== 'react')
        await assertNativeTypeProgramBindings(
          compilerObservation,
          Object.fromEntries(typePrograms.map(type => [type.role, type])),
        );
    }
    for (const type of typePrograms) {
      if (!Buffer.from(await fs.readFile(type.path)).equals(type.bytes))
        throw new Error('Type program drifted after its recorded validation');
      if (consumer.renderer === 'react') continue;
      type.generatedEntries = [];
      for (const absolute of compilerObservation.nativeTypeEntries[type.role]) {
        type.generatedEntries.push({
          path: path.relative(consumerRoot, absolute),
          absolute,
          sha256: sha256(await fs.readFile(absolute)),
        });
      }
    }
    for (const [index, command] of typeCommands.entries()) {
      commandResults.push({
        phase: 'typecheck',
        role: typePrograms[index].role,
        ...(await run(command, applicationRoot, commandOptions)),
      });
    }
    if ((await authoredInputDigest(applicationRoot)) !== authoredDigest)
      throw new Error(
        'Authored source or type program drifted during type checking',
      );
    for (const type of typePrograms)
      if (
        (await fs.realpath(type.path)) !== type.path ||
        !Buffer.from(await fs.readFile(type.path)).equals(type.bytes)
      )
        throw new Error('Validated type program drifted during type checking');
    if (compilerObservation)
      await assertNativeCompilerObservationUnchanged(compilerObservation);
    for (const type of typePrograms)
      for (const entry of type.generatedEntries ?? [])
        if (
          (await fs.realpath(path.resolve(consumerRoot, entry.path))) !==
            entry.absolute ||
          sha256(await fs.readFile(entry.absolute)) !== entry.sha256
        )
          throw new Error(
            'Final generated native type source drifted during type checking',
          );
    for (const probe of consumer.exportProbes) {
      if (probe.role === 'client-runtime' || probe.role === 'router') continue;
      commandResults.push({
        phase: 'public-export',
        ...(await run(
          publicExportCommand({
            ...probe,
            renderer: consumer.renderer,
            nodeExecutable: consumer.nodeExecutable,
          }),
          applicationRoot,
          commandOptions,
        )),
      });
    }
    // Callers start the installed production/development hosts here.
    await dependencies.attachHosts?.(consumer, {
      applicationRoot,
      consumerRoot,
    });
    consumer.identityMetadataSha256 = {};
    const builtIdentities = {};
    const csrBuiltIdentities = {};
    const buildProvenance = {};
    const rendererBuildEvidence = {};
    const nativeCompilerManifests = [];
    for (const environment of ['development', 'production']) {
      const host = consumer.environments[environment];
      const metadataPath = await fs.realpath(
        path.resolve(consumerRoot, host.metadataFile),
      );
      const metadataRelative = path.relative(consumerRoot, metadataPath);
      if (
        metadataRelative === '..' ||
        metadataRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(metadataRelative)
      )
        throw new Error('Built metadata must belong to its isolated consumer');
      const metadataBytes = await fs.readFile(metadataPath);
      const metadata = await loadBuildManifest({
        applicationRoot,
        metadata: JSON.parse(metadataBytes),
        renderer: consumer.renderer,
        kind: consumer.kind,
        environment,
      });
      if (
        metadata.profile.minimumNode !== admittedProfile.minimumNode ||
        !isDeepStrictEqual(metadata.profile.hmr, admittedProfile.hmr)
      )
        throw new Error(
          'Built metadata does not match the installed admitted Node/HMR profile',
        );
      const builtIdentity = metadata.identities?.[host.identity?.entryName];
      if (
        !builtIdentity ||
        builtIdentity.renderer !== consumer.renderer ||
        builtIdentity.buildId !== metadata.buildMarker ||
        builtIdentity.protocolVersion !== 1 ||
        !builtIdentity.appId ||
        !builtIdentity.entryName
      )
        throw new Error(
          'Actual built renderer entry identity is absent or invalid',
        );
      if (!isDeepStrictEqual(host.identity, builtIdentity))
        throw new Error(
          'HTTP host identity does not match the actual built candidate',
        );
      const csrBuiltIdentity =
        metadata.identities?.[host.csrIdentity?.entryName];
      if (
        !csrBuiltIdentity ||
        csrBuiltIdentity.entryName === builtIdentity.entryName ||
        csrBuiltIdentity.renderer !== consumer.renderer ||
        csrBuiltIdentity.buildId !== metadata.buildMarker ||
        csrBuiltIdentity.protocolVersion !== 1 ||
        !csrBuiltIdentity.appId ||
        !isDeepStrictEqual(host.csrIdentity, csrBuiltIdentity)
      )
        throw new Error(
          'CSR host identity does not match its distinct actual built entry',
        );
      consumer.identityMetadataSha256[environment] = sha256(metadataBytes);
      rendererBuildEvidence[environment] = {
        path: metadataRelative,
        sha256: consumer.identityMetadataSha256[environment],
        byteLength: metadataBytes.byteLength,
        value: metadata,
      };
      builtIdentities[environment] = builtIdentity;
      csrBuiltIdentities[environment] = csrBuiltIdentity;
      buildProvenance[environment] = {
        metadataFile: metadataRelative,
        ...metadata,
      };
      identity.applicationIdentities[
        `${consumer.renderer}:${consumer.kind}:${environment}:ssr`
      ] = builtIdentity;
      identity.applicationIdentities[
        `${consumer.renderer}:${consumer.kind}:${environment}:csr`
      ] = csrBuiltIdentity;
      for (const proof of host.nativeCompilerManifests ?? []) {
        if (consumer.renderer !== 'octane' || environment !== 'production')
          throw new Error(
            'Physical native compiler proof belongs only to the actual Octane production build; development memory authority is separate',
          );
        const rendererIdentity = [builtIdentity, csrBuiltIdentity].find(
          value => value.entryName === proof.entryName,
        );
        if (!rendererIdentity || typeof proof.manifestPath !== 'string')
          throw new Error(
            'Native compiler proof must bind an actual selected built entry',
          );
        nativeCompilerManifests.push({
          manifestPath: proof.manifestPath,
          rendererIdentity,
        });
      }
    }
    const installed = await auditConsumer({
      consumerRoot,
      applicationRoot: consumer.applicationRoot ?? '.',
      renderer: consumer.renderer,
      exactPackages: consumer.exactPackages,
      entryFiles: consumer.entryFiles,
      buildEntryFiles,
      buildCommandEvidence: commandResults.find(
        result => result.phase === 'build',
      ),
      testedProfile: {
        renderer: consumer.renderer,
        packages: consumer.exactPackages,
      },
      releaseArtifacts: artifacts,
      ...(consumer.renderer === 'octane' ? { nativeCompilerManifests } : {}),
      rendererBuildManifestPath: consumer.environments.production.metadataFile,
      rendererBuildEvidence: rendererBuildEvidence.production,
      rendererDevelopmentManifestPath:
        consumer.environments.development.metadataFile,
    });
    installed.nodeEngineExecution = {
      minimumNode: consumer.profile.minimumNode,
      engineCheck: 'frozen-offline-engine-strict',
      publicExportsExecuted: consumer.exportProbes.filter(
        probe => probe.role !== 'client-runtime' && probe.role !== 'router',
      ).length,
    };
    if (consumer.renderer === 'octane')
      installed.nativeCompilerAdmission = {
        artifactPhase: 'production',
        sourceAdmission: 'current-installed-raw-sources',
        emissionAdmission: 'actual-production-assets',
        developmentEmissionAdmission: false,
      };
    report.consumers.push({
      renderer: consumer.renderer,
      kind: consumer.kind,
      consumerRoot,
      applicationRoot,
      commands: commandResults,
      admittedProfile,
      compilerObservation: compilerObservation && {
        path: path.relative(consumerRoot, compilerObservation.receiptPath),
        sha256: compilerObservation.receiptSha256,
        sourceInventory: compilerObservation.observation.sourceInventory,
        environments: compilerObservation.observation.environments,
        configuredPlugins: compilerObservation.observation.configuredPlugins,
        auxiliaryCompiledEntries: compilerObservation.auxiliaryCompiledEntries,
        compiledModuleResources: compilerObservation.compiledModuleResources,
        nativeHydrationOwnershipArtifacts:
          compilerObservation.builtArtifacts.map(
            ({ absolute, sha256, size }) => ({
              path: path.relative(consumerRoot, absolute),
              sha256,
              size,
            }),
          ),
      },
      typeProgram: {
        path: typeProgramRelative,
        sha256: sha256(typeProgramBytes),
        explicitAmbientTypes: typeProgram.compilerOptions?.types,
        generatedEntries: typePrograms[0].generatedEntries?.map(
          ({ path, sha256 }) => ({ path, sha256 }),
        ),
      },
      hostTypeProgram:
        consumer.renderer === 'react'
          ? undefined
          : {
              path: typePrograms[1].relative,
              sha256: sha256(typePrograms[1].bytes),
              explicitAmbientTypes:
                typePrograms[1].program.compilerOptions.types,
              generatedEntries: typePrograms[1].generatedEntries.map(
                ({ path, sha256 }) => ({ path, sha256 }),
              ),
            },
      installed,
      builtIdentities,
      csrBuiltIdentities,
      buildProvenance,
      identityMetadataSha256: consumer.identityMetadataSha256,
      deferredBrowserExports: consumer.exportProbes.filter(
        probe => probe.role === 'client-runtime' || probe.role === 'router',
      ),
    });
    for (const environment of ['development', 'production']) {
      const host = consumer.environments?.[environment];
      if (!host)
        throw new Error(
          `${consumer.renderer} generated consumer requires its real ${environment} host`,
        );
      const builtIdentity = builtIdentities[environment];
      const readDataResponse =
        consumer.renderer === 'react'
          ? undefined
          : await loadDataResponseReader({
              applicationRoot,
              kind: consumer.kind,
            });
      const decodeControlResponse = readDataResponse
        ? async (response, { method, signal }) => {
            const routeId = host.probes.controlRouteId;
            if (typeof routeId !== 'string' || !routeId)
              throw new Error(
                'Native HTTP controls require their actual authorized filesystem route ID',
              );
            const outcome = await readDataResponse(
              response,
              {
                identity: builtIdentity,
                routeId,
                operation: method === 'GET' ? 'loader' : 'action',
              },
              signal,
            );
            if (
              outcome.kind !== 'success' ||
              outcome.status !== 200 ||
              !outcome.value ||
              typeof outcome.value !== 'object' ||
              Array.isArray(outcome.value)
            )
              throw new Error(
                'Native HTTP control did not produce approved successful observer data',
              );
            return outcome.value;
          }
        : undefined;
      const results = await http({
        baseUrl: host.baseUrl,
        renderer: consumer.renderer,
        identity: builtIdentity,
        probes: host.probes,
        identityHeader: host.probes.identityHeader,
        timeoutMs: config.httpTimeoutMs,
        decodeControlResponse,
      });
      for (const result of results) {
        if (result.dimension === 'rsc') {
          report.protocolEvidence.push({
            renderer: consumer.renderer,
            kind: consumer.kind,
            environment,
            producer: 'http-driver',
            observations: result.observations,
          });
          continue;
        }
        report.evidence.push({
          caseId: `${consumer.renderer}:${consumer.kind}:${environment}:${result.dimension}`,
          producer: 'http-driver',
          observations: result.observations,
        });
      }
    }
  }
  identity.profileDigest = profileDigest(consumers);
  report.evidence = report.evidence.map(evidence => ({
    ...identity,
    ...evidence,
  }));
  report.protocolEvidence = report.protocolEvidence.map(evidence => ({
    ...identity,
    ...evidence,
  }));
  let supplementalPaths = config;
  if (dependencies.provideSupplementalEvidence) {
    const snapshot = structuredClone(report);
    const freeze = value => {
      if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
      }
      return value;
    };
    supplementalPaths = await dependencies.provideSupplementalEvidence(
      freeze(snapshot),
    );
    if (
      !supplementalPaths ||
      Object.keys(supplementalPaths).sort().join(',') !==
        'browserEvidencePath,capabilitiesPath' ||
      !['browserEvidencePath', 'capabilitiesPath'].every(
        key =>
          typeof supplementalPaths[key] === 'string' &&
          path.isAbsolute(supplementalPaths[key]),
      )
    )
      throw new Error(
        'Supplemental evidence callback must return only the two existing absolute evidence paths',
      );
  }
  if (
    !supplementalPaths.browserEvidencePath ||
    !supplementalPaths.capabilitiesPath
  ) {
    report.status = 'awaiting-browser-and-platform-evidence';
    return report;
  }
  const browserEvidence = JSON.parse(
    await fs.readFile(supplementalPaths.browserEvidencePath, 'utf8'),
  );
  const capabilities = JSON.parse(
    await fs.readFile(supplementalPaths.capabilitiesPath, 'utf8'),
  );
  for (const consumer of report.consumers) {
    for (const environment of ['development', 'production']) {
      const csr = browserEvidence.find(
        evidence =>
          evidence.caseId ===
          `${consumer.renderer}:${consumer.kind}:${environment}:csr`,
      );
      for (const probe of consumer.deferredBrowserExports) {
        if (
          !csr?.observations?.publicExports?.some(
            result =>
              result.specifier === probe.specifier &&
              result.executed === true &&
              result.condition === 'browser' &&
              probe.exports.every(name => result.exports?.includes(name)),
          )
        )
          throw new Error('Native browser public exports were not executed');
      }
      if (
        consumer.renderer !== 'react' &&
        !report.protocolEvidence.some(
          evidence =>
            evidence.renderer === consumer.renderer &&
            evidence.kind === consumer.kind &&
            evidence.environment === environment &&
            evidence.observations.cases?.some(value => value.status === 400),
        )
      )
        throw new Error('Native RSC runtime rejection evidence is incomplete');
    }
  }
  const receipt = {
    schemaVersion: 1,
    identity,
    evidence: [...report.evidence, ...browserEvidence],
    capabilities,
  };
  report.conformance = assertConformanceReceipt(receipt, identity);
  report.receipt = receipt;
  report.status = 'passed';
  return report;
}

export async function writeReportAtomically(out, result) {
  const temporary = `${out}.${process.pid}.tmp`;
  let handle;
  let owned = false;
  try {
    handle = await fs.open(temporary, 'wx');
    owned = true;
    await handle.writeFile(`${JSON.stringify(result, null, 2)}\n`);
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, out);
  } finally {
    try {
      if (handle) await handle.close();
    } finally {
      if (owned) await fs.rm(temporary, { force: true });
    }
  }
}

async function main(args) {
  if (args.length !== 4 || args[0] !== '--config' || args[2] !== '--out') {
    throw new Error(
      'Usage: node run.mjs --config <consumer-config.json> --out <owned-report.json>',
    );
  }
  const configPath = path.resolve(args[1]);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const result = await runPackedConformance(config);
  const out = path.resolve(args[3]);
  await writeReportAtomically(out, result);
  process.stdout.write(`${result.status}: ${out}\n`);
  if (result.status !== 'passed') process.exitCode = 2;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
