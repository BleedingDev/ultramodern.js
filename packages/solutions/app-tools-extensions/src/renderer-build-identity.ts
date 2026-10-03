import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  immutableRendererRouterBindings,
  type RendererIdentity,
  type RendererName,
  type RendererProfile,
  type RendererRouterBindings,
  validateRendererProfile,
  validateRendererRouterBindings,
} from '@modern-js/backend-federation-contracts';
import { yaml } from '@modern-js/utils';
import semver from '@modern-js/utils/semver';
import { resolveUltramodernReleaseIdentity } from './release-identity';
import {
  assertRendererGeneratedOutputReceiptNodesCurrent,
  type RendererGeneratedOutputNode,
  type RendererGeneratedOutputReceipt,
  type RendererGeneratedOutputRegistration,
  type RendererGeneratedOutputValue,
  rendererGeneratedOutputPermission,
} from './renderer-generated-outputs';
import { findHostingModuleDirectory } from './runtime-package-resolution';

export type RendererBuildConfiguration =
  | null
  | boolean
  | number
  | string
  | readonly RendererBuildConfiguration[]
  | { readonly [key: string]: RendererBuildConfiguration | undefined };

/** Physical owner observed through a selected framework's public module. */
export interface RendererFrameworkPackageBinding {
  readonly specifier: string;
  readonly name: string;
  readonly version: string;
  readonly directory: string;
}

/** One host-pinned receipt revision shared by phase and final identity reads. */
export interface RendererGeneratedOutputIdentityLease {
  readonly revision: string;
  readonly receipts: readonly {
    readonly registration: RendererGeneratedOutputRegistration;
    readonly receipt: RendererGeneratedOutputReceipt;
  }[];
  /** Check the exact live generation and pinned revision without rereading files. */
  assertEpochCurrent(): void;
  /** Fully reobserve the pinned filesystem inputs at identity transaction boundaries. */
  assertCurrent(): Promise<void>;
  permission(inputPath: string): RendererGeneratedOutputNode | undefined;
  withPublication<T>(callback: () => Promise<T>): Promise<T>;
  release(): void;
}

export interface RendererBuildIdentityOptions {
  projectRoot: string;
  generatedOutputs?: RendererGeneratedOutputIdentityLease;
  renderer: RendererName;
  profile: RendererProfile & {
    dependencies?: Readonly<Record<string, string>>;
    sourceExtensions?: readonly string[];
    jsxImportSource?: string;
  };
  entryNames: readonly string[];
  mode: 'development' | 'production';
  deliveryUnit?: {
    unitId: string;
    appId: string;
    buildMarker: string;
    sourceRevision?: string;
  };
  packageName?: string;
  inputDirectories?: readonly string[];
  /** Actual observed or compiler-imported source files outside the app directory. */
  inputFiles?: readonly string[];
  excludedDirectories?: readonly string[];
  configuration?: RendererBuildConfiguration;
  packageDirectories?: Readonly<Record<string, string>>;
  packageResolutionRoots?: readonly string[];
  /** Selected framework bootstrap packages, supplied by the owning build plugin. */
  frameworkPackages?: readonly string[];
  /** Canonical npm aliases and their actual selected module owners. */
  frameworkPackageBindings?: readonly RendererFrameworkPackageBinding[];
  /** Actual final entry ownership, supplied by the selected renderer composition. */
  routerBindings: RendererRouterBindings;
}

export interface RendererBuildIdentities {
  readonly identities: Readonly<Record<string, RendererIdentity>>;
  readonly buildMarker: string;
  readonly sourceRevision: string;
  readonly inputDigest: string;
  readonly profileDigest: string;
  readonly compilerDigest: string;
  readonly frameworkCohortDigest: string;
  readonly cacheAllowed: boolean;
  readonly promotable: boolean;
  readonly routerBindings: RendererRouterBindings;
}

function canonical(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (
    value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return `{${Object.keys(value)
      .sort()
      .filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .map(
        key =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  throw new TypeError(
    'Renderer identity configuration must contain only finite JSON values.',
  );
}

const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
function immutableJSON<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutableJSON(child);
    Object.freeze(value);
  }
  return value;
}
const within = (file: string, directory: string) =>
  file === directory || file.startsWith(`${directory}${path.sep}`);
const slash = (value: string) => value.split(path.sep).join('/');

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}

async function guardedRead<T>(
  lease: RendererGeneratedOutputIdentityLease | undefined,
  read: () => Promise<T>,
): Promise<T> {
  if (!lease) return read();
  lease.assertEpochCurrent();
  const result = await read();
  lease.assertEpochCurrent();
  return result;
}

/** Guard each IO's live generation; full filesystem validation fences the batch. */
function identityFileSystem(
  lease?: RendererGeneratedOutputIdentityLease,
): typeof fs {
  if (!lease) return fs;
  return new Proxy(fs, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) =>
        guardedRead(lease, () =>
          Promise.resolve(Reflect.apply(value, target, args)),
        );
    },
  });
}

async function filesIn(
  directory: string,
  excluded: readonly string[],
  ancestors = new Set<string>(),
  lease?: RendererGeneratedOutputIdentityLease,
): Promise<string[]> {
  const fs = identityFileSystem(lease);
  if (excluded.some(value => within(directory, value))) return [];
  const real = await fs.realpath(directory);
  if (ancestors.has(real))
    throw new Error(
      `Renderer identity input contains a directory symlink cycle: ${directory}`,
    );
  const nextAncestors = new Set(ancestors).add(real);
  const files: string[] = [];
  for (const item of (
    await fs.readdir(directory, { withFileTypes: true })
  ).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (item.name === 'node_modules' || item.name === '.git') continue;
    const file = path.join(directory, item.name);
    if (excluded.some(value => within(file, value))) continue;
    const stat = item.isSymbolicLink() ? await fs.stat(file) : item;
    if (stat.isDirectory())
      files.push(
        ...(await guardedRead(lease, () =>
          filesIn(file, excluded, nextAncestors, lease),
        )),
      );
    else if (stat.isFile()) files.push(file);
  }
  return files;
}

async function hashFiles(
  files: readonly { file: string; key: string }[],
  lease?: RendererGeneratedOutputIdentityLease,
): Promise<string> {
  const fs = identityFileSystem(lease);
  const hash = createHash('sha256');
  for (const { file, key } of [...files].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  )) {
    const before = await fs.stat(file, { bigint: true });
    const bytes = await fs.readFile(file);
    const after = await fs.stat(file, { bigint: true });
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      before.mode !== after.mode
    ) {
      throw new Error(
        `Renderer identity input changed while being read: ${file}. Restart the build.`,
      );
    }
    hash.update(JSON.stringify([key, bytes.byteLength]));
    hash.update(bytes);
  }
  return hash.digest('hex');
}

async function readPackage(
  directory: string,
  lease?: RendererGeneratedOutputIdentityLease,
): Promise<{
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}> {
  const fs = identityFileSystem(lease);
  return JSON.parse(
    await fs.readFile(path.join(directory, 'package.json'), 'utf8'),
  );
}

function packageDirectory(
  name: string,
  roots: readonly string[],
): string | undefined {
  for (const root of roots) {
    const modules = findHostingModuleDirectory(name, root);
    if (modules) return path.join(modules, name);
  }
  return undefined;
}

async function frameworkPackageDirectory(
  binding: RendererFrameworkPackageBinding,
  roots: readonly string[],
  requireSelectedPhysicalOwner: boolean,
  lease?: RendererGeneratedOutputIdentityLease,
): Promise<readonly string[]> {
  const fs = identityFileSystem(lease);
  const expectedDirectory = await fs.realpath(binding.directory);
  const expectedManifest = await guardedRead(lease, () =>
    readPackage(expectedDirectory, lease),
  );
  if (
    expectedManifest.name !== binding.name ||
    expectedManifest.version !== binding.version
  )
    throw new Error(
      `Selected public framework module ${binding.specifier} changed its owning manifest before identity resolution.`,
    );
  for (const root of roots) {
    let directory = path.resolve(root);
    for (;;) {
      const candidates: string[] = [];
      for (const name of new Set([binding.specifier, binding.name])) {
        const candidate = path.join(directory, 'node_modules', name);
        try {
          lstatSync(candidate);
          candidates.push(candidate);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      if (candidates.length > 0) {
        const actualDirectories = await Promise.all(
          candidates.map(async candidate => {
            const real = await fs.realpath(candidate);
            const manifest = await guardedRead(lease, () =>
              readPackage(real, lease),
            );
            if (
              manifest.name !== binding.name ||
              manifest.version !== binding.version
            )
              throw new Error(
                `Selected framework owner mismatch: ${binding.specifier} must resolve ${binding.name}@${binding.version}, found ${manifest.name}@${manifest.version}.`,
              );
            return real;
          }),
        );
        if (
          requireSelectedPhysicalOwner &&
          (new Set(actualDirectories).size !== 1 ||
            actualDirectories[0] !== expectedDirectory)
        )
          throw new Error(
            `Selected framework module ${binding.specifier} resolves a different physical owner from the application.`,
          );
        return [...new Set([...actualDirectories, expectedDirectory])];
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  throw new Error(
    `Selected framework module ${binding.specifier} cannot be resolved from its owning application or registrar.`,
  );
}

function dependencyIdentity(
  name: string,
  specifier: string,
): {
  name: string;
  exactVersion?: string;
  versionRange?: string;
} {
  if (typeof specifier !== 'string')
    throw new Error(
      `Renderer compiler dependency ${name} has an invalid specifier.`,
    );
  if (!/^npm:/iu.test(specifier)) return { name };
  const target = specifier.slice('npm:'.length);
  const match = /^((?:@[^/@\s:?#\\]+\/)?[^/@\s:?#\\]+)(?:@(.*))?$/u.exec(
    target,
  );
  const targetName = match?.[1];
  const targetVersion = match?.[2]?.trim() || '*';
  const segments = targetName?.replace(/^@/u, '').split('/');
  if (
    !targetName ||
    !segments ||
    segments.some(segment => encodeURIComponent(segment) !== segment) ||
    /^\./u.test(segments.at(-1)!) ||
    (!targetName.startsWith('@') &&
      (/^_/u.test(targetName) ||
        /\.(?:tgz|tar\.gz|tar)$/iu.test(targetName))) ||
    ['node_modules', 'favicon.ico'].includes(targetName.toLowerCase())
  ) {
    throw new Error(
      `Invalid renderer compiler npm alias ${name}: ${specifier}.`,
    );
  }
  const exactVersion = semver.valid(targetVersion, { loose: true });
  if (exactVersion) return { name: targetName, exactVersion };
  if (semver.validRange(targetVersion, { loose: true }))
    return { name: targetName, versionRange: targetVersion };
  if (encodeURIComponent(targetVersion) === targetVersion)
    return { name: targetName };
  throw new Error(`Invalid renderer compiler npm alias ${name}: ${specifier}.`);
}

async function compilerClosure(
  options: RendererBuildIdentityOptions,
): Promise<{ compilerDigest: string; frameworkCohortDigest: string }> {
  const lease = options.generatedOutputs;
  const fs = identityFileSystem(lease);
  const routers = [
    options.profile.router,
    ...Object.values(options.routerBindings ?? {}).flatMap(
      binding => binding.providers,
    ),
  ];
  const tuple = [
    options.profile.compiler,
    options.profile.hydration,
    ...routers.flatMap(router => [
      router,
      { name: router.coreName, version: router.coreVersion },
    ]),
  ];
  const tupleNames = new Set(tuple.map(item => item.name));
  const observedFrameworks = new Map(
    (options.frameworkPackageBindings ?? []).map(binding => [
      binding.name,
      binding,
    ]),
  );
  const frameworkSpecifiers = new Map(
    (options.frameworkPackageBindings ?? []).map(binding => [
      binding.specifier,
      binding,
    ]),
  );
  const pins: Record<string, string> = {};
  for (const [specifier, specification] of Object.entries(
    options.profile.dependencies ?? {},
  )) {
    const name = frameworkSpecifiers.get(specifier)?.name ?? specifier;
    if (semver.valid(specification)) {
      if (pins[name] !== undefined && pins[name] !== specification)
        throw new Error(
          `Renderer profile contains conflicting framework dependency versions for ${name}.`,
        );
      pins[name] = specification;
    } else if (
      !(tupleNames.has(name) && URL.parse(specification)?.protocol === 'https:')
    )
      throw new Error(
        `Renderer profile requires an exact version for ${name}; HTTPS installation specifications require an explicit compiler, hydration or router tuple.`,
      );
  }
  for (const item of tuple) {
    if (pins[item.name] !== undefined && pins[item.name] !== item.version) {
      throw new Error(
        `Renderer profile contains conflicting exact versions for ${item.name}.`,
      );
    }
    pins[item.name] = item.version;
  }
  const roots = await Promise.all(
    [
      path.resolve(options.projectRoot),
      ...(options.packageResolutionRoots ?? []).map(value =>
        path.resolve(value),
      ),
    ].map(value => fs.realpath(value)),
  );
  const bindings: { name: string; package: string }[] = [];
  const frameworkBindings: {
    name: string;
    specifier?: string;
    package: string;
  }[] = [];
  type PackageRecord = {
    id: string;
    name: string;
    version: string;
    digest: string;
    dependencies: { name: string; package: string }[];
  };
  const packages: PackageRecord[] = [];
  const seen = new Map<
    string,
    { record: PackageRecord; pinsValidated: boolean }
  >();
  const frameworkNames = [...new Set(options.frameworkPackages ?? [])].sort();
  const profileDependencyNames = new Set(
    Object.keys(options.profile.dependencies ?? {}).map(
      name => frameworkSpecifiers.get(name)?.name ?? name,
    ),
  );
  const nativeRootNames = new Set([
    options.profile.compiler.name,
    options.profile.hydration.name,
    options.profile.router.name,
    ...routers.map(router => router.name),
    ...frameworkNames.filter(name => profileDependencyNames.has(name)),
  ]);
  // A router core is certified through its selected physical router owner.
  // Other adapters in neutral tooling may own a separate version of that core.
  const nativeAnchorNames = new Set(nativeRootNames);
  const frameworkDirectories = new Map<string, string>();
  const frameworkModuleDirectories = new Map<string, readonly string[]>();
  const neutralRoots = new Set<string>();
  const nativeRoots = new Set<string>();
  for (const name of frameworkNames) {
    const observed = observedFrameworks.get(name);
    const observedDirectories = observed
      ? await frameworkPackageDirectory(
          observed,
          roots,
          nativeRootNames.has(name),
          lease,
        )
      : undefined;
    const directory =
      observedDirectories?.[0] ??
      options.packageDirectories?.[name] ??
      packageDirectory(name, roots);
    if (!directory)
      throw new Error(
        `Selected renderer framework package ${name} cannot be resolved before entry generation.`,
      );
    const real = await fs.realpath(directory);
    frameworkDirectories.set(name, real);
    (nativeRootNames.has(name) ? nativeRoots : neutralRoots).add(real);
    if (observedDirectories) {
      frameworkModuleDirectories.set(name, observedDirectories);
      for (const selected of observedDirectories)
        (nativeRootNames.has(name) ? nativeRoots : neutralRoots).add(selected);
    }
  }
  const nativeDirectories = new Map<string, string>();
  for (const name of [...nativeRootNames].sort()) {
    const directory =
      frameworkDirectories.get(name) ??
      options.packageDirectories?.[name] ??
      packageDirectory(name, roots);
    if (!directory)
      throw new Error(
        `Renderer ${options.renderer} requires installed ${name}@${pins[name]} before entry generation.`,
      );
    const real = await fs.realpath(directory);
    nativeDirectories.set(name, real);
    nativeRoots.add(real);
  }
  const routerCoreDirectories: {
    router: (typeof routers)[number];
    directory: string;
  }[] = [];
  for (const router of routers) {
    const routerRoot = nativeDirectories.get(router.name)!;
    const directory =
      router.coreName === router.name
        ? routerRoot
        : packageDirectory(router.coreName, [routerRoot]);
    if (!directory)
      throw new Error(
        `The selected router must resolve its own exact ${router.coreName} core package.`,
      );
    nativeRoots.add(await fs.realpath(directory));
    routerCoreDirectories.push({ router, directory });
  }
  const validatedPins = new Set<string>();
  const peerAliasRequests = new Map<
    string,
    { owner: string; specification: string }[]
  >();
  const selectedAliasOwners = new Set<string>();
  const aliasAuthority = new Map<
    string,
    { name: string; version: string; digest: string }
  >();
  const catalogCandidates = new Map<string, string>();
  const catalogAuthority = new Map<string, string>();
  const manifestAuthority = new Map<
    string,
    { state: string; digest: string }
  >();
  let appCatalog: Record<string, unknown> | undefined;
  const authorityFileState = async (file: string): Promise<string> => {
    const stat = await fs.lstat(file, { bigint: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (!stat) return 'missing';
    const target = await fs.stat(file, { bigint: true });
    return canonical({
      mode: stat.mode.toString(),
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      ctimeNs: stat.ctimeNs.toString(),
      real: await fs.realpath(file),
      target: {
        dev: target.dev.toString(),
        ino: target.ino.toString(),
        ctimeNs: target.ctimeNs.toString(),
        mode: target.mode.toString(),
      },
    });
  };
  const appCatalogRequest = async (name: string, specification: string) => {
    if (!appCatalog) {
      let directory = path.resolve(options.projectRoot);
      for (;;) {
        const file = path.join(directory, 'pnpm-workspace.yaml');
        const before = await authorityFileState(file);
        catalogCandidates.set(file, before);
        if (before !== 'missing') {
          const bytes = await fs.readFile(file, 'utf8');
          catalogAuthority.set(
            file,
            await hashFiles([{ file, key: 'pnpm-workspace.yaml' }], lease),
          );
          if (
            (await authorityFileState(file)) !== before ||
            (await fs.readFile(file, 'utf8')) !== bytes
          )
            throw new Error(`Renderer compiler catalog changed: ${file}.`);
          const parsed: unknown = yaml.load(bytes);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error(
              `Invalid renderer compiler workspace catalog: ${file}.`,
            );
          appCatalog = parsed as Record<string, unknown>;
          break;
        }
        const parent = path.dirname(directory);
        if (parent === directory)
          throw new Error(
            `Renderer compiler catalog ${specification} has no declaring pnpm workspace.`,
          );
        directory = parent;
      }
    }
    const catalogName = specification.slice('catalog:'.length);
    const catalogs = appCatalog.catalogs;
    const catalog = catalogName
      ? catalogs && typeof catalogs === 'object' && !Array.isArray(catalogs)
        ? (catalogs as Record<string, unknown>)[catalogName]
        : undefined
      : appCatalog.catalog;
    const request =
      catalog &&
      typeof catalog === 'object' &&
      !Array.isArray(catalog) &&
      Object.hasOwn(catalog, name)
        ? (catalog as Record<string, unknown>)[name]
        : undefined;
    if (
      typeof request !== 'string' ||
      !(semver.valid(request) || dependencyIdentity(name, request).exactVersion)
    )
      throw new Error(
        `Renderer compiler catalog ${specification} must declare an exact request for ${name}.`,
      );
    return request;
  };
  const collectPeerAliases = async (
    directory: string,
    app = false,
  ): Promise<void> => {
    const owner = await fs.realpath(directory);
    if (selectedAliasOwners.has(owner)) return;
    selectedAliasOwners.add(owner);
    const file = path.join(owner, 'package.json');
    const state = await authorityFileState(file);
    const bytes = await fs.readFile(file, 'utf8');
    const manifest: Awaited<ReturnType<typeof readPackage>> = JSON.parse(bytes);
    const manifestDigest = await hashFiles(
      [{ file, key: 'package.json' }],
      lease,
    );
    if ((await authorityFileState(file)) !== state)
      throw new Error(`Renderer compiler authority manifest changed: ${file}.`);
    manifestAuthority.set(file, { state, digest: manifestDigest });
    // Application plugin owners can sit outside the selected SDK graph. Their
    // actual declarations still require byte binding before certifying a peer.
    aliasAuthority.set(owner, {
      name: manifest.name,
      version: manifest.version,
      digest: manifestDigest,
    });
    for (const [name, declared] of Object.entries({
      ...(app ? manifest.devDependencies : {}),
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    })) {
      const specification =
        app && declared.startsWith('catalog:')
          ? await appCatalogRequest(name, declared)
          : declared;
      if (!/^npm:/iu.test(specification)) continue;
      const requests = peerAliasRequests.get(name) ?? [];
      requests.push({ owner, specification });
      peerAliasRequests.set(name, requests);
    }
    for (const name of new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])) {
      const resolved = packageDirectory(name, [owner]);
      // The original validating traversal still rejects missing required edges.
      if (resolved) await collectPeerAliases(resolved);
    }
  };
  await collectPeerAliases(options.projectRoot, true);
  // Complete the same selected physical closure before validating its peers;
  // an alias-owning sibling may sort after the package that consumes that peer.
  for (const owner of new Set([
    ...frameworkDirectories.values(),
    ...[...frameworkModuleDirectories.values()].flat(),
    ...nativeRoots,
  ])) {
    await collectPeerAliases(owner);
  }
  const peerIdentity = async (
    name: string,
    specification: string,
    resolved: string,
  ) => {
    const actual = await guardedRead(lease, () => readPackage(resolved, lease));
    if (actual.name === name) return dependencyIdentity(name, specification);
    // Published peers retain their canonical import key. Only an exact alias
    // declared by this selected cohort can certify its renamed physical owner.
    const requests = peerAliasRequests.get(name) ?? [];
    const identities = requests.map(request =>
      dependencyIdentity(name, request.specification),
    );
    if (
      identities.length === 0 ||
      identities.some(identity => !identity.exactVersion) ||
      new Set(
        identities.map(identity => `${identity.name}@${identity.exactVersion}`),
      ).size !== 1
    )
      throw new Error(
        `Renderer compiler/profile mismatch: renamed peer ${name} requires one exact declared npm alias target.`,
      );
    const identity = identities[0];
    if (
      identity.exactVersion === undefined ||
      !semver.validRange(specification, { loose: true }) ||
      !semver.satisfies(identity.exactVersion, specification, { loose: true })
    )
      throw new Error(
        `Renderer compiler/profile mismatch: peer ${name}@${specification} conflicts with declared ${identity.name}@${identity.exactVersion}.`,
      );
    const physical = await fs.realpath(resolved);
    for (const request of requests) {
      const provider = packageDirectory(name, [request.owner]);
      if (provider && (await fs.realpath(provider)) === physical)
        return identity;
    }
    throw new Error(
      `Renderer compiler/profile mismatch: peer ${name} resolves a different physical owner from its declared npm alias.`,
    );
  };
  const visit = async (
    directory: string,
    expectedName?: string,
    expectedVersion?: string,
    enforcePins = true,
    versionRange?: string,
  ): Promise<string> =>
    guardedRead(lease, async () => {
      const real = await fs.realpath(directory);
      const manifest = await guardedRead(lease, () => readPackage(real, lease));
      // Only declared neutral cohort roots reset a native branch. Aliases and
      // physical copies of native anchors still enter the exact native contract.
      const nativeBranch =
        nativeRoots.has(real) ||
        nativeAnchorNames.has(manifest.name) ||
        (enforcePins && !neutralRoots.has(real));
      const pinnedVersion = nativeBranch ? pins[manifest.name] : undefined;
      if (
        !manifest.name ||
        !manifest.version ||
        (expectedName && manifest.name !== expectedName) ||
        (expectedVersion && manifest.version !== expectedVersion) ||
        (pinnedVersion && manifest.version !== pinnedVersion) ||
        (versionRange &&
          !semver.satisfies(manifest.version, versionRange, { loose: true }))
      ) {
        throw new Error(
          `Renderer compiler/profile mismatch: expected ${expectedName ?? manifest.name ?? 'a named package'}@${expectedVersion ?? pinnedVersion ?? versionRange ?? 'an exact version'}, found ${manifest.name}@${manifest.version}.`,
        );
      }
      if (pinnedVersion) validatedPins.add(manifest.name);
      // Separate physical copies must not silently share an identity if their bytes differ.
      const existing = seen.get(real);
      if (existing && (!nativeBranch || existing.pinsValidated))
        return existing.record.id;
      let record = existing?.record;
      if (!record) {
        const files = await guardedRead(lease, () =>
          filesIn(real, [], new Set(), lease),
        );
        const packageDigest = await hashFiles(
          files.map(file => ({ file, key: slash(path.relative(real, file)) })),
          lease,
        );
        // Stable traversal IDs preserve the directed graph without absolute paths.
        record = {
          id: `package-${packages.length}`,
          name: manifest.name,
          version: manifest.version,
          digest: packageDigest,
          dependencies: [],
        };
        packages.push(record);
      }
      seen.set(real, { record, pinsValidated: nativeBranch });
      const resolvedDependencies: { name: string; package: string }[] = [];
      const dependencies = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);
      for (const name of [...dependencies].sort()) {
        const specification =
          manifest.optionalDependencies?.[name] ??
          manifest.dependencies?.[name] ??
          manifest.peerDependencies![name];
        let dependency = dependencyIdentity(name, specification);
        const resolved = packageDirectory(name, [real]);
        const optional =
          Object.hasOwn(manifest.optionalDependencies ?? {}, name) ||
          manifest.peerDependenciesMeta?.[name]?.optional === true;
        if (!resolved) {
          if (optional) continue;
          throw new Error(
            `Renderer compiler dependency ${name} cannot be resolved from ${manifest.name}. Install the admitted compiler tuple.`,
          );
        }
        if (
          !Object.hasOwn(manifest.optionalDependencies ?? {}, name) &&
          !Object.hasOwn(manifest.dependencies ?? {}, name) &&
          !/^npm:/iu.test(specification)
        )
          dependency = await peerIdentity(name, specification, resolved);
        const nativeClosure =
          nativeBranch || nativeAnchorNames.has(dependency.name);
        const pinnedVersion = nativeClosure ? pins[dependency.name] : undefined;
        if (
          pinnedVersion &&
          dependency.exactVersion &&
          pinnedVersion !== dependency.exactVersion
        ) {
          throw new Error(
            `Renderer compiler/profile mismatch: expected ${dependency.name}@${pinnedVersion}, but ${name} declares ${dependency.exactVersion}.`,
          );
        }
        resolvedDependencies.push({
          name,
          package: await visit(
            resolved,
            dependency.name,
            pinnedVersion ?? dependency.exactVersion,
            nativeClosure,
            dependency.versionRange,
          ),
        });
      }
      record.dependencies = resolvedDependencies;
      return record.id;
    });
  for (const { router, directory } of routerCoreDirectories) {
    await visit(directory, router.coreName, router.coreVersion);
  }
  for (const [name, directory] of nativeDirectories) {
    bindings.push({ name, package: await visit(directory, name, pins[name]) });
  }
  for (const [name, directory] of frameworkDirectories) {
    frameworkBindings.push({
      name,
      ...(observedFrameworks.has(name)
        ? { specifier: observedFrameworks.get(name)!.specifier }
        : {}),
      package: await visit(directory, name, undefined, false),
    });
    for (const selected of frameworkModuleDirectories.get(name) ?? []) {
      if (selected === directory) continue;
      frameworkBindings.push({
        name,
        specifier: observedFrameworks.get(name)!.specifier,
        package: await visit(
          selected,
          name,
          observedFrameworks.get(name)!.version,
          false,
        ),
      });
    }
  }
  const appOwner = await fs.realpath(options.projectRoot);
  for (const [owner, authority] of aliasAuthority) {
    if (owner === appOwner || seen.has(owner)) continue;
    // Bind application-only compiler implementations too; selected packages
    // already carry their complete bytes in the validating closure above.
    const files = await guardedRead(lease, () =>
      filesIn(owner, [], new Set(), lease),
    );
    authority.digest = await hashFiles(
      files.map(file => ({ file, key: slash(path.relative(owner, file)) })),
      lease,
    );
  }
  for (const name of Object.keys(pins).sort()) {
    if (!validatedPins.has(name))
      throw new Error(
        `Renderer ${options.renderer} requires ${name}@${pins[name]} in its selected native compiler, hydration or router graph.`,
      );
  }
  const byId = new Map(packages.map(record => [record.id, record]));
  const cohortIds = new Map<string, string>();
  const cohortPackages: PackageRecord[] = [];
  const projectCohort = (id: string): string => {
    const existing = cohortIds.get(id);
    if (existing) return existing;
    const source = byId.get(id)!;
    const cohortId = `package-${cohortPackages.length}`;
    cohortIds.set(id, cohortId);
    const record = {
      ...source,
      id: cohortId,
      dependencies: [] as PackageRecord['dependencies'],
    };
    cohortPackages.push(record);
    record.dependencies = source.dependencies.map(edge => ({
      name: edge.name,
      package: projectCohort(edge.package),
    }));
    return cohortId;
  };
  const projectedBindings = frameworkBindings.map(binding => ({
    ...binding,
    package: projectCohort(binding.package),
  }));
  for (const [file, before] of catalogCandidates)
    if ((await authorityFileState(file)) !== before)
      throw new Error(`Renderer compiler catalog changed: ${file}.`);
  for (const [file, before] of manifestAuthority)
    if (
      (await authorityFileState(file)) !== before.state ||
      (await hashFiles([{ file, key: 'package.json' }], lease)) !==
        before.digest ||
      (await authorityFileState(file)) !== before.state
    )
      throw new Error(`Renderer compiler authority manifest changed: ${file}.`);
  return {
    frameworkCohortDigest: digest({
      bindings: projectedBindings,
      packages: cohortPackages,
    }),
    compilerDigest: digest({
      catalogs: [...catalogAuthority.values()].sort(),
      aliasAuthority: [...aliasAuthority.values()].sort((a, b) =>
        canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0,
      ),
      bindings: [...bindings, ...frameworkBindings],
      packages: packages.sort((a, b) =>
        canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0,
      ),
    }),
  };
}

/** Resolve once before emitting entries, manifests or looking up a document cache. */
export async function resolveRendererBuildIdentities(
  options: RendererBuildIdentityOptions,
): Promise<RendererBuildIdentities> {
  const lease = options.generatedOutputs;
  const fs = identityFileSystem(lease);
  // Validation, package pinning and digest calculation share one authored
  // profile, even if a caller changes its object while files are being read.
  const capturedProfile = structuredClone(options.profile);
  canonical(capturedProfile);
  const capturedFrameworks = structuredClone(
    options.frameworkPackageBindings ?? [],
  );
  canonical(capturedFrameworks);
  const names = new Set<string>();
  const specifiers = new Set<string>();
  for (const binding of capturedFrameworks) {
    if (
      typeof binding.name !== 'string' ||
      typeof binding.specifier !== 'string' ||
      typeof binding.version !== 'string' ||
      typeof binding.directory !== 'string' ||
      !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(
        binding.name,
      ) ||
      !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(
        binding.specifier,
      ) ||
      !semver.valid(binding.version) ||
      !path.isAbsolute(binding.directory) ||
      names.has(binding.name) ||
      specifiers.has(binding.specifier)
    )
      throw new Error(
        'Selected framework module observations must have unique names and specifiers, exact versions and absolute physical directories.',
      );
    if (!options.frameworkPackages?.includes(binding.name))
      throw new Error(
        `The observed framework owner ${binding.name} is not part of the selected framework package graph.`,
      );
    names.add(binding.name);
    specifiers.add(binding.specifier);
  }
  options = {
    ...options,
    profile: immutableJSON(capturedProfile),
    frameworkPackageBindings: immutableJSON(capturedFrameworks),
    frameworkPackages: options.frameworkPackages
      ? Object.freeze([...options.frameworkPackages])
      : undefined,
    inputDirectories: options.inputDirectories
      ? Object.freeze([...options.inputDirectories])
      : undefined,
    inputFiles: options.inputFiles
      ? Object.freeze([...options.inputFiles])
      : undefined,
  };
  const projectRoot = path.resolve(options.projectRoot);
  const profile: RendererProfile = {
    renderer: options.profile.renderer,
    protocolVersion: options.profile.protocolVersion,
    compiler: options.profile.compiler,
    hydration: options.profile.hydration,
    router: options.profile.router,
  };
  const validation = validateRendererProfile(profile);
  if (!validation.ok || options.renderer !== profile.renderer) {
    throw new Error(
      `Renderer/profile identity mismatch: ${JSON.stringify(validation.errors)}.`,
    );
  }
  if (options.mode !== 'development' && options.mode !== 'production')
    throw new Error(
      'Renderer build identity requires development or production mode.',
    );
  const entries = [...options.entryNames].sort();
  if (
    entries.length === 0 ||
    new Set(entries).size !== entries.length ||
    entries.some(
      value =>
        typeof value !== 'string' ||
        !value ||
        value.trim() !== value ||
        value === '__proto__',
    )
  ) {
    throw new Error(
      'Renderer build identity requires unique nonempty entry names.',
    );
  }
  const routerValidation = validateRendererRouterBindings(
    options.routerBindings,
    entries,
    'routerBindings',
    options.renderer,
  );
  if (!routerValidation.ok)
    throw new Error(
      `Invalid renderer router bindings: ${JSON.stringify(routerValidation.errors)}.`,
    );
  const routerBindings = immutableRendererRouterBindings(
    options.routerBindings,
  );
  // The pinned host rereads its complete source/receipt scope once before and
  // once after the transaction. Per-IO guards keep its actual revision live;
  // per-file stat/read/stat still rejects mutation during a physical read.
  if (lease) await lease.assertCurrent();
  const manifest = await guardedRead(lease, () =>
    readPackage(projectRoot, lease),
  );
  if (options.packageName && options.packageName !== manifest.name)
    throw new Error(
      'Renderer application package name conflicts with its package manifest.',
    );
  const appId = options.deliveryUnit?.appId ?? manifest.name;
  if (typeof appId !== 'string' || !appId || appId.trim() !== appId)
    throw new Error(
      'Renderer application identity requires a delivery artifact appId or an actual package name.',
    );
  if (options.deliveryUnit) {
    for (const key of ['unitId', 'buildMarker'] as const) {
      const value = options.deliveryUnit[key];
      if (typeof value !== 'string' || !value || value.trim() !== value)
        throw new Error(
          `Renderer delivery identity requires a nonempty ${key}.`,
        );
    }
  }
  const gitRoot = git(projectRoot, ['rev-parse', '--show-toplevel'])?.trim();
  const workspaceRoot = gitRoot || projectRoot;
  const excluded = [
    ...[
      'node_modules',
      '.git',
      '.ultramodern',
      '.modern-js',
      '.modern',
      'dist',
      '.output',
      'coverage',
    ].map(value => path.join(projectRoot, value)),
    ...(options.excludedDirectories ?? []).map(value =>
      path.resolve(projectRoot, value),
    ),
  ];
  if (excluded.some(value => within(projectRoot, value)))
    throw new Error(
      'Renderer identity cannot exclude the application source root.',
    );
  const inputs = new Map<string, string>();
  const directories = [
    projectRoot,
    ...(options.inputDirectories ?? []).map(value =>
      path.resolve(projectRoot, value),
    ),
  ];
  const observedFiles = (options.inputFiles ?? []).map(value =>
    path.resolve(projectRoot, value),
  );
  if (gitRoot) {
    const pathspecs = [...new Set([...directories, ...observedFiles])]
      .filter(file => within(file, gitRoot))
      .map(file => `:(literal)${slash(path.relative(gitRoot, file)) || '.'}`);
    const tracked = git(gitRoot, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ...pathspecs,
    ]);
    if (tracked === undefined)
      throw new Error(
        'Cannot enumerate the owning Git input graph for renderer identity.',
      );
    for (const relative of tracked.split('\0').filter(Boolean)) {
      const file = path.resolve(gitRoot, relative);
      if (excluded.some(value => within(file, value))) continue;
      try {
        if ((await fs.stat(file)).isFile())
          inputs.set(file, `workspace/${slash(relative)}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  for (const [index, directory] of directories.entries()) {
    for (const file of await guardedRead(lease, () =>
      filesIn(directory, excluded, new Set(), lease),
    )) {
      if (!inputs.has(file))
        inputs.set(
          file,
          within(file, workspaceRoot)
            ? `workspace/${slash(path.relative(workspaceRoot, file))}`
            : `shared/${index}/${slash(path.relative(directory, file))}`,
        );
    }
  }
  for (const [index, file] of observedFiles.entries()) {
    if (excluded.some(value => within(file, value))) continue;
    if (!(await fs.stat(file)).isFile())
      throw new Error(`Observed renderer source input is not a file: ${file}`);
    if (!inputs.has(file))
      inputs.set(
        file,
        within(file, workspaceRoot)
          ? `workspace/${slash(path.relative(workspaceRoot, file))}`
          : `observed/${index}/${path.basename(file)}`,
      );
  }
  const generatedRecords: unknown[] = [];
  const generatedGroups = new Map<
    string,
    {
      binding: Record<string, unknown>;
      nodes: Map<string, unknown>;
    }
  >();
  if (lease) {
    if (
      !Object.isFrozen(lease) ||
      !Object.isFrozen(lease.receipts) ||
      !lease.revision
    )
      throw new Error(
        'Renderer generated outputs require an immutable host receipt lease.',
      );
    for (const { registration, receipt } of lease.receipts) {
      // Full receipts retain provenance. Only this pinned overlay's final
      // exact members may classify or bind current generated output bytes.
      const selectedNodes = receipt.nodes.filter(node => {
        const permission = lease.permission(node.path.lexical);
        return (
          permission !== undefined && canonical(permission) === canonical(node)
        );
      });
      assertRendererGeneratedOutputReceiptNodesCurrent(registration, receipt, {
        generation: receipt.generation,
        nodes: selectedNodes,
      });
      for (const node of selectedNodes) {
        const owned = rendererGeneratedOutputPermission(
          receipt,
          node.path.lexical,
        );
        if (!owned || canonical(owned) !== canonical(node))
          throw new Error(
            'Renderer generated output is not an exact pinned receipt member.',
          );
        if (node.kind === 'file' && !inputs.has(node.path.lexical))
          inputs.set(
            node.path.lexical,
            `generated/${slash(path.relative(workspaceRoot, node.path.lexical))}`,
          );
      }
      if (!selectedNodes.length) continue;
      const inputPath = (value: { lexical: string; canonical: string }) => ({
        lexical: slash(path.relative(workspaceRoot, value.lexical)),
        canonical: slash(path.relative(workspaceRoot, value.canonical)),
      });
      const context = registration.context;
      const implementation =
        context && typeof context === 'object' && !Array.isArray(context)
          ? (
              context as {
                readonly [key: string]: RendererGeneratedOutputValue;
              }
            ).implementation
          : undefined;
      const implementationRecord =
        implementation &&
        typeof implementation === 'object' &&
        !Array.isArray(implementation)
          ? (implementation as {
              readonly [key: string]: RendererGeneratedOutputValue;
            })
          : undefined;
      const capturedImplementation = implementationRecord
        ? {
            packageName: implementationRecord.packageName,
            version: implementationRecord.version,
            moduleDigest: implementationRecord.moduleDigest,
            modulePath:
              typeof implementationRecord.modulePath === 'string'
                ? slash(
                    path.relative(
                      typeof implementationRecord.packageDirectory === 'string'
                        ? implementationRecord.packageDirectory
                        : workspaceRoot,
                      implementationRecord.modulePath,
                    ),
                  )
                : implementationRecord.modulePath,
          }
        : undefined;
      const binding = {
        implementation: capturedImplementation,
        producer: {
          packageName: registration.producer.packageName,
          version: registration.producer.version,
          modulePath: slash(
            path.relative(
              registration.producer.packageDirectory,
              registration.producer.modulePath,
            ),
          ),
          moduleDigest: registration.producer.moduleDigest,
        },
        effectiveOptions: registration.effectiveOptions,
        destinations: registration.destinations.map(destination => ({
          ...destination,
          path: inputPath(destination.path),
        })),
      };
      const groupKey = canonical(binding);
      let group = generatedGroups.get(groupKey);
      if (!group) {
        group = { binding, nodes: new Map() };
        generatedGroups.set(groupKey, group);
      }
      for (const node of selectedNodes) {
        const projected = {
          path: inputPath(node.path),
          kind: node.kind,
          ...(node.kind === 'file' ? { byteDigest: node.byteDigest } : {}),
          ...(node.kind === 'directory' ? { entries: node.entries } : {}),
        };
        group.nodes.set(canonical(projected.path), projected);
      }
    }
    for (const group of generatedGroups.values())
      generatedRecords.push({
        ...group.binding,
        nodes: [...group.nodes.values()].sort((left, right) =>
          canonical(left) < canonical(right)
            ? -1
            : canonical(left) > canonical(right)
              ? 1
              : 0,
        ),
      });
  }
  const filesDigest = await guardedRead(lease, () =>
    hashFiles(
      [...inputs].map(([file, key]) => ({ file, key })),
      lease,
    ),
  );
  const inputDigest = generatedRecords.length
    ? digest({
        filesDigest,
        generatedOutputs: generatedRecords.sort((left, right) =>
          canonical(left) < canonical(right)
            ? -1
            : canonical(left) > canonical(right)
              ? 1
              : 0,
        ),
      })
    : filesDigest;
  const profileDigest = digest({
    mode: options.mode,
    profile: options.profile,
    dependencies: options.profile.dependencies ?? {},
    sourceExtensions: options.profile.sourceExtensions ?? [],
    jsxImportSource: options.profile.jsxImportSource ?? '',
    configuration: options.configuration ?? null,
    routerBindings,
  });
  const { compilerDigest, frameworkCohortDigest } = await guardedRead(
    lease,
    () =>
      compilerClosure({
        ...options,
        routerBindings,
      }),
  );
  const release = resolveUltramodernReleaseIdentity({
    workspaceRoot,
    generationBuildMarker: options.deliveryUnit?.buildMarker ?? inputDigest,
    sourceRevision: options.deliveryUnit?.sourceRevision,
    unitId: options.deliveryUnit?.unitId ?? manifest.name,
  });
  const buildMarker = digest({
    namespace: 'ultramodern-renderer-build:v1',
    renderer: options.renderer,
    appId,
    unitId: options.deliveryUnit?.unitId ?? manifest.name,
    entries,
    inputDigest,
    profileDigest,
    compilerDigest,
    frameworkCohortDigest,
    sourceRevision: release.sourceRevision,
  });
  const identities = Object.fromEntries(
    entries.map(entryName => [
      entryName,
      Object.freeze({
        renderer: options.renderer,
        appId,
        entryName,
        protocolVersion: 1 as const,
        buildId: buildMarker,
      }),
    ]),
  );
  const promotable =
    options.mode === 'production' && release.sourceRevision !== 'workspace';
  await lease?.assertCurrent();
  return Object.freeze({
    identities: Object.freeze(identities),
    buildMarker,
    sourceRevision: release.sourceRevision,
    inputDigest,
    profileDigest,
    compilerDigest,
    frameworkCohortDigest,
    cacheAllowed: promotable,
    promotable,
    routerBindings,
  });
}
