// Provisions packed acceptance consumers from an installed generator and runs
// the HTTP conformance matrix against them.
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, stringify } from 'yaml';
import { runOctanePublicPrograms } from '../../../packages/runtime/renderer-octane/tests/public-programs/run.mjs';
import { runSolidPublicPrograms } from '../../../packages/runtime/renderer-solid/tests/public-programs/run.mjs';
import { withBareGeneratorProof } from '../../../packages/toolkit/ultramodern-create/tests/fixtures/installed-renderers/bare-generator-proof.mjs';
import { resolveAcceptanceReleaseAgeExclusions } from '../../ultramodern-production-readiness/published-create-proof/release-age-audit.mjs';
import {
  inspectNpmTarball,
  readVerifiedPackageArtifactBytes,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { auditInstalledConsumer } from './artifacts.mjs';
import {
  createHandAuthoredConsumer,
  MAINTAINED_NATIVE_TRANSPORTS,
  requiredFixtureDependencies,
} from './fixtures.mjs';
import {
  attachConformanceHosts,
  qualifyUntouchedNativeStarter,
} from './release-hosts.mjs';
import { registerArtifact } from './release-support.mjs';
import { rsbuildSpecifierFromRelease } from './rsbuild-dependency.mjs';
import {
  executeCommand,
  loadInstalledBuildManifest,
  loadInstalledRendererProfile,
  publicPackageSpecifier,
  requiredExportProbes,
  runPackedConformance,
} from './run.mjs';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const checker = fileURLToPath(
  new URL('./release-typecheck.mjs', import.meta.url),
);
const exact =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u;
const hostLifetimeMs = 3 * 60 * 60 * 1000;

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function frameworkItem(release, name) {
  return release.packages.find(
    item => item.sourceName === name || item.targetName === name,
  );
}

function projectedName(release, name) {
  return frameworkItem(release, name)?.targetName ?? name;
}

function declaredSpec(release, key, spec, catalogs, applicationRoot) {
  const item = frameworkItem(release, key);
  if (spec.startsWith('catalog:')) {
    const selected = spec.slice('catalog:'.length);
    spec = (selected ? catalogs.catalogs?.[selected] : catalogs.catalog)?.[key];
    assert.equal(typeof spec, 'string', `Missing catalog ${selected}:${key}`);
  }
  if (item) {
    assert.ok(
      [item.version, `npm:${item.targetName}@${item.version}`].includes(spec),
      `Generated framework spec differs from the release cohort: ${key}`,
    );
    return { name: item.targetName, spec: item.version };
  }
  const maintained = MAINTAINED_NATIVE_TRANSPORTS[key];
  if (maintained) {
    assert.equal(
      spec,
      maintained.url,
      `Maintained native transport differs: ${key}`,
    );
    return { name: key, spec };
  }
  if (key === '@rsbuild/core') {
    assert.equal(
      spec,
      rsbuildSpecifierFromRelease(release),
      'Generated Rsbuild declaration must select the release sidecar',
    );
    return { name: key, spec };
  }
  if (!exact.test(spec) && /^[~^]\d+\.\d+\.\d+$/u.test(spec)) {
    const json = JSON.parse(
      fsSync.readFileSync(
        path.join(applicationRoot, 'node_modules', key, 'package.json'),
        'utf8',
      ),
    );
    assert.equal(json.name, key, 'Declared external package identity differs');
    spec = json.version;
  }
  assert.ok(
    exact.test(spec),
    `Declared ${key} must resolve to an exact version, got ${spec}`,
  );
  return { name: key, spec };
}

/** Reads what the generator authored so the hand-authored twin uses the same tuple. */
async function authoredSpecifications(release, generated, profile) {
  const app = JSON.parse(
    await fs.readFile(path.join(generated.appRoot, 'package.json'), 'utf8'),
  );
  const workspace = parseDocument(
    await fs.readFile(
      path.join(generated.workspaceRoot, 'pnpm-workspace.yaml'),
      'utf8',
    ),
    { uniqueKeys: true },
  );
  assert.equal(workspace.errors.length, 0);
  const catalogs = workspace.toJS({ maxAliasCount: 0 });
  const dependencies = {};
  const devDependencies = {};
  const wanted = new Set([
    ...requiredFixtureDependencies(generated.renderer),
    ...Object.keys(profile.dependencies).map(name =>
      projectedName(release, name),
    ),
    projectedName(release, '@modern-js/app-tools-extensions'),
    profile.compiler.name,
    profile.hydration.name,
    projectedName(release, profile.router.name),
    profile.router.coreName,
    'typescript',
    ...(generated.renderer === 'octane' ? [] : ['@effect/tsgo']),
  ]);
  for (const [role, output] of [
    ['dependencies', dependencies],
    ['devDependencies', devDependencies],
  ]) {
    for (const [key, spec] of Object.entries(app[role] ?? {})) {
      if (!wanted.has(projectedName(release, key))) continue;
      if (spec.startsWith('workspace:')) continue;
      const value = declaredSpec(
        release,
        key,
        spec,
        catalogs,
        generated.appRoot,
      );
      output[value.name] = value.spec;
    }
  }
  for (const [key, spec] of Object.entries(profile.dependencies)) {
    const value = declaredSpec(release, key, spec, catalogs, generated.appRoot);
    if (!dependencies[value.name] && !devDependencies[value.name])
      dependencies[value.name] = value.spec;
  }
  for (const name of wanted) {
    if (dependencies[name] || devDependencies[name]) continue;
    const own = frameworkItem(release, name);
    if (own) {
      devDependencies[name] = own.version;
      continue;
    }
    const declared = [];
    for (const ownerName of [
      '@modern-js/ultramodern-app-tools',
      '@modern-js/builder',
      '@modern-js/plugin-tanstack',
    ]) {
      const item = frameworkItem(release, ownerName);
      assert.ok(item, `Missing framework owner ${ownerName}`);
      const json = inspectNpmTarball(
        readVerifiedPackageArtifactBytes(item, item.artifactPath),
      ).packageJson;
      const spec =
        json.dependencies?.[name] ??
        json.peerDependencies?.[name] ??
        json.devDependencies?.[name];
      if (typeof spec === 'string' && exact.test(spec)) declared.push(spec);
    }
    const unique = [...new Set(declared)];
    assert.equal(
      unique.length,
      1,
      `No unique exact owner declaration for ${name}: ${unique}`,
    );
    devDependencies[name] = unique[0];
  }
  return { dependencies, devDependencies, allowBuilds: catalogs.allowBuilds };
}

/**
 * Public framework packages keep canonical `@modern-js/*` peer names. The
 * generator satisfies them with `npm:` aliases of the public cohort packages;
 * without them pnpm auto-installs the bare canonical name from the public
 * registry, and selected optional peers stay unresolvable. Walk the packed
 * closure of the declared framework packages and return the alias each
 * canonical peer needs that no ancestor already provides (pnpm resolves a
 * peer from its parents' dependencies).
 */
export function frameworkPeerAliases(release, declaredNames) {
  const aliases = {};
  const manifests = new Map();
  const manifest = item => {
    if (!manifests.has(item.targetName))
      manifests.set(
        item.targetName,
        inspectNpmTarball(
          readVerifiedPackageArtifactBytes(item, item.artifactPath),
        ).packageJson,
      );
    return manifests.get(item.targetName);
  };
  const seen = new Set();
  const queue = declaredNames
    .map(name => frameworkItem(release, name))
    .filter(Boolean)
    .map(item => ({ item, provided: new Set(declaredNames) }));
  while (queue.length) {
    const { item, provided } = queue.shift();
    const key = `${item.targetName}|${[...provided].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const json = manifest(item);
    for (const name of Object.keys(json.peerDependencies ?? {})) {
      if (provided.has(name) || Object.hasOwn(aliases, name)) continue;
      const peer = frameworkItem(release, name);
      if (!peer || peer.targetName === name) continue;
      // An optional peer binds only when the consumer selects that package
      // (ultramodern-app-tools resolves the selected renderer's modules
      // through these canonical peers).
      if (
        json.peerDependenciesMeta?.[name]?.optional &&
        !declaredNames.includes(peer.targetName)
      )
        continue;
      aliases[name] = `npm:${peer.targetName}@${peer.version}`;
      queue.push({ item: peer, provided: new Set(declaredNames) });
    }
    const children = new Set(provided);
    for (const block of ['dependencies', 'optionalDependencies'])
      for (const name of Object.keys(json[block] ?? {})) children.add(name);
    for (const block of ['dependencies', 'optionalDependencies'])
      for (const spec of Object.values(json[block] ?? {})) {
        const target = /^npm:(@[^/]+\/[^@]+|[^@]+)@/u.exec(spec)?.[1];
        const owned = target && frameworkItem(release, target);
        if (owned) queue.push({ item: owned, provided: children });
      }
  }
  return aliases;
}

/** Lists authored files (path + bytes) so a build cannot silently rewrite them. */
export async function authoredInventory(
  directory,
  prefixes = [
    'src',
    'modern.config.ts',
    'modern.entry-base.config.ts',
    'tsconfig.json',
    'tsconfig.native-browser.json',
    'tsconfig.native-server.json',
  ],
) {
  const records = [];
  async function visit(file) {
    const stat = await fs.lstat(file);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(file)).sort())
        await visit(path.join(file, name));
    } else {
      assert.ok(
        stat.isFile(),
        `Authored source must be an ordinary file: ${file}`,
      );
      records.push({
        path: path.relative(directory, file),
        bytes: (await fs.readFile(file)).toString('base64'),
      });
    }
  }
  for (const prefix of prefixes) {
    const file = path.join(directory, prefix);
    if (
      await fs
        .lstat(file)
        .catch(error =>
          error.code === 'ENOENT' ? undefined : Promise.reject(error),
        )
    )
      await visit(file);
  }
  return records;
}

function installedCli(applicationRoot, kind, release) {
  const specifier =
    kind === 'generated'
      ? '@modern-js/ultramodern-app-tools'
      : frameworkItem(release, '@modern-js/ultramodern-app-tools').targetName;
  const require = createRequire(path.join(applicationRoot, 'package.json'));
  let directory = path.dirname(require.resolve(specifier));
  const expected = frameworkItem(release, '@modern-js/ultramodern-app-tools');
  while (path.dirname(directory) !== directory) {
    const packageJsonPath = path.join(directory, 'package.json');
    if (fsSync.existsSync(packageJsonPath)) {
      const json = JSON.parse(fsSync.readFileSync(packageJsonPath, 'utf8'));
      if (json.name === expected.targetName) {
        assert.equal(json.version, expected.version);
        assert.equal(typeof json.bin?.ultramodern, 'string');
        return {
          path: path.resolve(directory, json.bin.ultramodern),
          packageJsonPath,
          binName: 'ultramodern',
        };
      }
    }
    directory = path.dirname(directory);
  }
  throw new Error('Installed ultramodern CLI package was not found');
}

function selectedTuple(profile, release) {
  const tuple = {};
  for (const [name, spec] of Object.entries(profile.dependencies)) {
    const maintained = MAINTAINED_NATIVE_TRANSPORTS[name];
    if (maintained) assert.equal(spec, maintained.url);
    tuple[projectedName(release, name)] = maintained
      ? maintained.version
      : (frameworkItem(release, name)?.version ?? spec);
  }
  for (const record of [
    profile.compiler,
    profile.hydration,
    profile.router,
    { name: profile.router.coreName, version: profile.router.coreVersion },
  ])
    tuple[projectedName(release, record.name)] =
      frameworkItem(release, record.name)?.version ?? record.version;
  for (const value of Object.values(tuple)) assert.ok(exact.test(value));
  return tuple;
}

function strictInstallEnv(env, release) {
  const installEnv = { ...env };
  for (const key of Object.keys(installEnv))
    if (
      /^(?:npm|pnpm)_config_minimum_release_age(?:_exclude|_strict|_ignore_missing_time)?$/iu.test(
        key,
      )
    )
      delete installEnv[key];
  return Object.assign(installEnv, {
    pnpm_config_minimum_release_age: '1440',
    pnpm_config_minimum_release_age_strict: 'true',
    pnpm_config_minimum_release_age_ignore_missing_time: 'false',
    pnpm_config_minimum_release_age_exclude: JSON.stringify(
      resolveAcceptanceReleaseAgeExclusions({ release, mode: 'source' }),
    ),
  });
}

/**
 * Installs the generator from an ephemeral registry seeded with the cohort,
 * generates/hand-authors consumers for each selected renderer, and installs
 * them with the strict release-age policy. The registry stops on return.
 */
export async function provisionConsumers({
  manifestPath,
  qualifiedNode,
  pnpm,
  storeDir,
  consumerRoot,
  renderers,
  baselines,
  owner,
  ownerPid,
}) {
  const previousStore = process.env.npm_config_store_dir;
  process.env.npm_config_store_dir = storeDir;
  try {
    return await withBareGeneratorProof(
      { manifestPath, qualifiedNode, consumerRoot },
      async context => {
        const reportsRoot = path.join(context.consumerRoot, 'reports');
        await fs.mkdir(reportsRoot, { recursive: true });
        registerArtifact(path.join(context.bareRoot, 'node_modules'), {
          owner,
          ownerPid,
          kind: 'dependencies',
        });
        const installEnv = strictInstallEnv(context.env, context.release);
        const install = cwd =>
          executeCommand(
            {
              command: pnpm,
              args: [
                'install',
                '--ignore-scripts=false',
                '--store-dir',
                storeDir,
                '--config.engineStrict=true',
                '--config.packageImportMethod=clone-or-copy',
              ],
            },
            cwd,
            { env: installEnv, timeoutMs: 600000 },
          );
        const register = (directory, kind) =>
          registerArtifact(directory, { owner, ownerPid, kind });
        const minimumNode = context.release.tools.node.replace(/^v/u, '');
        const untouched = [];
        for (const baseline of context.report.generated) {
          if (
            baseline.renderer === 'react' ||
            !baselines.includes(baseline.renderer)
          )
            continue;
          register(
            path.join(baseline.workspaceRoot, 'node_modules'),
            'dependencies',
          );
          register(path.join(baseline.appRoot, 'dist'), 'build');
          await install(baseline.workspaceRoot);
          untouched.push(baseline);
        }
        const rows = [];
        for (const renderer of renderers) {
          const generated = context.generateInstalledConformance({
            ...context,
            outputRoot: path.join(
              context.consumerRoot,
              `target-generated-${renderer}`,
            ),
            renderer,
            overlays: [
              {
                generator: path.join(
                  workspaceRoot,
                  'tests/ultramodern-renderers/conformance/fixtures',
                  renderer === 'react'
                    ? 'react-resource-overlay'
                    : 'native-resource-overlay',
                ),
                config: {
                  conformanceRoutes: true,
                  twoEntryConformance: true,
                  releaseManifest: context.release.manifestPath,
                },
              },
            ],
            logFile: path.join(reportsRoot, `generate-${renderer}.log`),
          });
          register(
            path.join(generated.workspaceRoot, 'node_modules'),
            'dependencies',
          );
          register(path.join(generated.appRoot, 'dist'), 'build');
          await install(generated.workspaceRoot);
          const generatedProfile = loadInstalledRendererProfile({
            applicationRoot: generated.appRoot,
            renderer,
            kind: 'generated',
          });
          const specs = await authoredSpecifications(
            context.release,
            generated,
            generatedProfile,
          );
          const handRoot = path.join(
            context.consumerRoot,
            `target-hand-${renderer}`,
          );
          const hand = await createHandAuthoredConsumer({
            consumerRoot: handRoot,
            renderer,
            releaseManifest: context.release.manifestPath,
            dependencySpecs: {
              ...specs.dependencies,
              ...Object.fromEntries(
                Object.entries(specs.devDependencies).filter(
                  ([name]) => name !== '@typescript/native',
                ),
              ),
            },
            scripts: {
              build: 'ultramodern build',
              typecheck: `node ${JSON.stringify(checker)} --project tsconfig.json`,
            },
            minimumNode,
          });
          const handPackageFile = path.join(handRoot, 'package.json');
          const handPackage = JSON.parse(
            await fs.readFile(handPackageFile, 'utf8'),
          );
          handPackage.version = '0.1.0';
          handPackage.dependencies = {
            ...specs.dependencies,
            ...frameworkPeerAliases(context.release, [
              ...Object.keys(specs.dependencies),
              ...Object.keys(specs.devDependencies),
            ]),
          };
          handPackage.devDependencies = specs.devDependencies;
          handPackage.packageManager = `pnpm@${context.release.tools.pnpm}`;
          await fs.writeFile(
            path.join(handRoot, '.npmrc'),
            'engine-strict=true\npackage-import-method=clone-or-copy\nignore-scripts=false\n',
          );
          await fs.writeFile(
            path.join(handRoot, 'pnpm-workspace.yaml'),
            stringify({
              packages: ['.'],
              ...(specs.allowBuilds ? { allowBuilds: specs.allowBuilds } : {}),
            }),
          );
          await fs.writeFile(
            handPackageFile,
            `${JSON.stringify(handPackage, null, 2)}\n`,
          );
          for (const item of [
            {
              ...generated,
              kind: 'generated',
              consumerRoot: generated.workspaceRoot,
              applicationRoot: path.relative(
                generated.workspaceRoot,
                generated.appRoot,
              ),
            },
            {
              ...hand,
              kind: 'hand-authored',
              appRoot: handRoot,
              applicationRoot: '.',
            },
          ]) {
            if (item.kind === 'hand-authored') {
              register(
                path.join(item.consumerRoot, 'node_modules'),
                'dependencies',
              );
              register(path.join(item.appRoot, 'dist'), 'build');
              await install(item.consumerRoot);
            }
            rows.push(
              await consumerRow({
                item,
                renderer,
                release: context.release,
                qualifiedNode,
                pnpm,
                reportsRoot,
              }),
            );
          }
        }
        return {
          bareReport: context.report,
          release: context.release,
          env: context.env,
          bareRoot: context.bareRoot,
          generatorPackageRoot: context.installed.packageRoot,
          reportsRoot,
          untouched,
          rows,
        };
      },
    );
  } finally {
    if (previousStore === undefined) delete process.env.npm_config_store_dir;
    else process.env.npm_config_store_dir = previousStore;
  }
}

async function consumerRow({
  item,
  renderer,
  release,
  qualifiedNode,
  pnpm,
  reportsRoot,
}) {
  const profile = loadInstalledRendererProfile({
    applicationRoot: item.appRoot,
    renderer,
    kind: item.kind,
  });
  const source = await authoredInventory(item.appRoot);
  const cli = installedCli(item.appRoot, item.kind, release);
  const native = renderer !== 'react';
  const typePaths = native
    ? ['tsconfig.native-browser.json', 'tsconfig.native-server.json']
    : ['tsconfig.json'];
  const row = {
    ...item,
    entryNames: ['ssr', 'csr'],
    routeModules: Object.fromEntries(
      ['ssr', 'csr'].map(entry => [
        entry,
        {
          page: `src/${entry}/routes/page.tsx`,
          control: `src/${entry}/routes/control/page.tsx`,
          ...(renderer === 'solid'
            ? { item: `src/${entry}/routes/items/[id]/page.tsx` }
            : {}),
        },
      ]),
    ),
    typeProgramFile: path.join(item.applicationRoot, typePaths[0]),
    ...(native
      ? { hostTypeProgramFile: path.join(item.applicationRoot, typePaths[1]) }
      : {}),
    nodeExecutable: qualifiedNode,
    packageManagerExecutable: pnpm,
    profile,
    exactPackages: selectedTuple(profile, release),
    exportProbes: requiredExportProbes(renderer, item.kind),
    buildEntryFiles: source
      .filter(record => record.path === 'modern.config.ts')
      .map(record => path.join(item.applicationRoot, record.path)),
    entryFiles: source
      .filter(
        record =>
          /\.[cm]?[jt]sx?$/u.test(record.path) &&
          !['modern.config.ts', 'modern.entry-base.config.ts'].includes(
            record.path,
          ),
      )
      .map(record => path.join(item.applicationRoot, record.path)),
    commands: {
      build: { command: qualifiedNode, args: [cli.path, 'build'] },
      typecheck: typePaths.map(project => ({
        command: qualifiedNode,
        args: [checker, '--project', project, '--noEmit'],
      })),
    },
    environments: Object.fromEntries(
      ['development', 'production'].map(environment => [
        environment,
        {
          metadataFile: path.join(
            item.applicationRoot,
            'dist',
            ...(environment === 'development' ? ['.ultramodern-dev'] : []),
            'renderer-build.json',
          ),
        },
      ]),
    ),
    installedCli: cli,
    hostLogsDirectory: path.join(reportsRoot, `${renderer}-${item.kind}-hosts`),
  };
  if (!native) row.commands.typecheck = row.commands.typecheck[0];
  await fs.mkdir(row.hostLogsDirectory, { recursive: true });
  return row;
}

/** Builds and serves each untouched generated native starter; source must not change. */
export async function runUntouchedStarters({
  provisioned,
  qualifiedNode,
  signal,
}) {
  const results = [];
  for (const baseline of provisioned.untouched) {
    signal?.throwIfAborted();
    const before = await authoredInventory(baseline.appRoot);
    const cli = installedCli(
      baseline.appRoot,
      'generated',
      provisioned.release,
    );
    await executeCommand(
      { command: qualifiedNode, args: [cli.path, 'build'] },
      baseline.appRoot,
      { env: provisioned.env, timeoutMs: 600000 },
    );
    const metadataFile = path.join(
      baseline.appRoot,
      'dist',
      'renderer-build.json',
    );
    const manifest = await loadInstalledBuildManifest({
      applicationRoot: baseline.appRoot,
      metadata: JSON.parse(await fs.readFile(metadataFile, 'utf8')),
      renderer: baseline.renderer,
      kind: 'generated',
    });
    const logsDirectory = path.join(
      provisioned.reportsRoot,
      `untouched-${baseline.renderer}`,
    );
    await fs.mkdir(logsDirectory, { recursive: true });
    const proof = await qualifyUntouchedNativeStarter({
      baseline: { ...baseline, metadataFile },
      manifest,
      qualifiedNode,
      env: provisioned.env,
      port: await freePort(),
      installedCli: cli,
      logsDirectory,
      lifetimeMs: hostLifetimeMs,
      signal,
    });
    try {
      assert.deepEqual(
        await authoredInventory(baseline.appRoot),
        before,
        `Untouched ${baseline.renderer} starter source changed during build/serve`,
      );
    } finally {
      await proof.stop();
    }
    results.push(proof.receipt);
  }
  return results;
}

/**
 * Runs install/build/typecheck/export/HTTP conformance for the provisioned rows.
 * Hosts stay alive in `handles` for a following browser step; the caller stops them.
 */
export async function runHttpConformance({
  provisioned,
  manifestPath,
  qualifiedNode,
  renderers,
  captureCsrAuthority,
  signal,
}) {
  const handles = [];
  const { rows, release, env } = provisioned;
  try {
    const report = await runPackedConformance(
      {
        manifestPath,
        expectedSourceRevision: release.source.commit,
        renderers,
        consumers: rows,
        commandTimeoutMs: 600000,
        httpTimeoutMs: 30000,
      },
      {
        executeCommand: async (command, cwd, commandOptions) => {
          signal?.throwIfAborted();
          const row = rows.find(item => item.appRoot === cwd);
          return executeCommand(command, cwd, {
            ...commandOptions,
            env: {
              ...commandOptions.env,
              ...env,
              RELEASE_RENDERER: row?.renderer,
              RELEASE_EXTENSIONS_SPECIFIER: row
                ? publicPackageSpecifier(
                    '@modern-js/app-tools-extensions',
                    row.kind,
                  )
                : undefined,
            },
          });
        },
        afterBuild: async row => {
          const metadata = JSON.parse(
            await fs.readFile(
              path.join(row.appRoot, 'dist/renderer-build.json'),
              'utf8',
            ),
          );
          const manifest = await loadInstalledBuildManifest({
            applicationRoot: row.appRoot,
            metadata,
            renderer: row.renderer,
            kind: row.kind,
          });
          assert.deepEqual(
            Object.keys(manifest.identities).sort(),
            row.entryNames.slice().sort(),
          );
          row.environments.production.identity = manifest.identities.ssr;
          row.environments.production.csrIdentity = manifest.identities.csr;
          row.finalManifest = manifest;
          row.entryFiles.push(
            ...(await authoredInventory(row.appRoot, ['dist']))
              .filter(record => /\.[cm]?js$/u.test(record.path))
              .map(record => path.join(row.applicationRoot, record.path)),
          );
        },
        attachHosts: async row => {
          row.ports = {
            production: await freePort(),
            development: await freePort(),
          };
          for (const environment of ['production', 'development'])
            handles.push(
              await attachConformanceHosts({
                row,
                manifest: row.finalManifest,
                qualifiedNode,
                env,
                ports: row.ports,
                installedCli: row.installedCli,
                environment,
                lifetimeMs: hostLifetimeMs,
                signal,
                captureCsrAuthority,
              }),
            );
        },
        auditInstalledConsumer: async inputs => {
          const audited = auditInstalledConsumer(inputs);
          const row = rows.find(
            item => item.consumerRoot === inputs.consumerRoot,
          );
          if (row.kind === 'hand-authored' && row.renderer !== 'react') {
            const outputDirectory = path.join(
              row.appRoot,
              'dist/sdk-public-programs',
            );
            await fs.mkdir(outputDirectory, { recursive: true });
            const runSdk =
              row.renderer === 'solid'
                ? runSolidPublicPrograms
                : runOctanePublicPrograms;
            audited.sdkPublicPrograms = await runSdk({
              consumerRoot: row.consumerRoot,
              applicationRoot: row.appRoot,
              outputDirectory,
              nodeExecutable: qualifiedNode,
              auditProgramClosure: async ({ entryFiles }) =>
                auditInstalledConsumer({
                  ...inputs,
                  entryFiles: [...inputs.entryFiles, ...entryFiles],
                }),
            });
          }
          return audited;
        },
      },
    );
    return { report, rows, handles };
  } catch (error) {
    await stopHandles(handles);
    throw error;
  }
}

export async function stopHandles(handles) {
  const results = await Promise.allSettled(
    handles
      .splice(0)
      .map(handle => Promise.resolve().then(() => handle.stop())),
  );
  const failures = results
    .filter(item => item.status === 'rejected')
    .map(item => item.reason);
  if (failures.length)
    throw new AggregateError(failures, 'Host teardown failed');
}
