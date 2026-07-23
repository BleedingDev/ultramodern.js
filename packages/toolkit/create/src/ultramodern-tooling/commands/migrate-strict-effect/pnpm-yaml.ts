import { semver, yaml } from '@modern-js/utils';

export type PnpmWorkspaceYaml = Record<string, any>;

type PnpmLockIdentity = {
  packageName: string;
  version: string;
  peers: PnpmLockIdentity[];
};

export type PnpmLockReleaseAgeCandidate = {
  packageName: string;
  version: string;
  registry: {
    dist: {
      integrity: string;
    };
  };
  path: string[];
};

export type PnpmLockReleaseAgeClosure = {
  candidates: PnpmLockReleaseAgeCandidate[];
  unresolved: Array<{
    package?: string;
    path: string[];
    reason: string;
  }>;
};

const dependencyBlocks = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
] as const;
const exactPackageNamePattern =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const integrityPattern = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

function isExactSemver(version: string) {
  return semver.valid(version) === version;
}

export function isYamlRecord(value: unknown): value is PnpmWorkspaceYaml {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredYamlRecord(value: unknown, label: string): PnpmWorkspaceYaml {
  if (!isYamlRecord(value)) {
    throw new Error(`${label} must be a YAML mapping.`);
  }
  return value;
}

function sortedEntries(value: unknown): Array<[string, any]> {
  return Object.entries(
    requiredYamlRecord(value, 'pnpm lockfile mapping'),
  ).sort(([left], [right]) => left.localeCompare(right));
}

function packageVersionKey(
  identity: Pick<PnpmLockIdentity, 'packageName' | 'version'>,
) {
  return `${identity.packageName}@${identity.version}`;
}

function splitPeerContext(
  locator: string,
): { base: string; peers: PnpmLockIdentity[] } | { unresolved: string } {
  const peerStart = locator.indexOf('(');
  if (peerStart === -1) {
    return { base: locator, peers: [] };
  }

  const context = locator.slice(peerStart);
  const segments: string[] = [];
  let start = -1;
  let depth = 0;
  for (let index = 0; index < context.length; index += 1) {
    const character = context[index];
    if (character === '(') {
      if (depth === 0) {
        start = index + 1;
      }
      depth += 1;
      continue;
    }
    if (character !== ')' || depth === 0) {
      if (depth === 0) {
        return { unresolved: locator };
      }
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      const segment = context.slice(start, index);
      if (segment === '') {
        return { unresolved: locator };
      }
      segments.push(segment);
      start = -1;
    }
  }
  if (depth !== 0 || start !== -1) {
    return { unresolved: locator };
  }

  const peers: PnpmLockIdentity[] = [];
  for (const segment of segments) {
    if (
      /^patch_hash=[a-f0-9]{32,128}$/u.test(segment) ||
      /^[a-f0-9]{32,128}$/u.test(segment)
    ) {
      continue;
    }
    const peer = parsePackageKey(segment);
    if (!peer) {
      return { unresolved: locator };
    }
    peers.push(peer);
  }
  return { base: locator.slice(0, peerStart), peers };
}

function parsePackageLocator(rawLocator: string): PnpmLockIdentity | undefined {
  const locator = rawLocator.replace(/^\//u, '');
  const separator = locator.lastIndexOf('@');
  if (separator <= 0) {
    return undefined;
  }
  const packageName = locator.slice(0, separator);
  const version = locator.slice(separator + 1);
  if (!exactPackageNamePattern.test(packageName) || !isExactSemver(version)) {
    return undefined;
  }
  return { packageName, version, peers: [] };
}

function parsePackageKey(rawKey: string): PnpmLockIdentity | undefined {
  const peerContext = splitPeerContext(rawKey.replace(/^\//u, ''));
  if ('unresolved' in peerContext) {
    return undefined;
  }
  const { base, peers } = peerContext;
  const identity = parsePackageLocator(base);
  return identity ? { ...identity, peers } : undefined;
}

function isSkippableLocalDependencyVersion(value: string) {
  if (/^(?:file|link):\S+$/u.test(value)) {
    return true;
  }
  if (!value.startsWith('workspace:')) {
    return false;
  }
  const version = value.slice('workspace:'.length);
  return (
    version === '*' ||
    version === '^' ||
    version === '~' ||
    (/^[~^]?/u.test(version) && isExactSemver(version.replace(/^[~^]/u, '')))
  );
}

function aliasNameFromSpecifier(specifier: unknown) {
  if (typeof specifier !== 'string' || !specifier.startsWith('npm:')) {
    return undefined;
  }
  const separator = specifier.slice('npm:'.length).lastIndexOf('@');
  return separator > 0
    ? specifier.slice('npm:'.length, 'npm:'.length + separator)
    : undefined;
}

function dependencyIdentity(
  dependencyName: string,
  rawValue: unknown,
): PnpmLockIdentity | { unresolved: string } | undefined {
  const descriptor = isYamlRecord(rawValue) ? rawValue : undefined;
  if (descriptor && !Object.hasOwn(descriptor, 'version')) {
    return { unresolved: 'missing descriptor version' };
  }
  const value = descriptor?.version ?? rawValue;
  if (typeof value !== 'string' || value === '') {
    return { unresolved: 'missing or invalid descriptor version' };
  }
  if (isSkippableLocalDependencyVersion(value)) {
    return undefined;
  }

  if (/^(?:file|link|workspace):/u.test(value)) {
    return { unresolved: value };
  }

  const peerContext = splitPeerContext(
    value.startsWith('npm:') ? value.slice('npm:'.length) : value,
  );
  if ('unresolved' in peerContext) {
    return peerContext;
  }
  const { base, peers } = peerContext;
  const full = parsePackageLocator(base);
  if (full) {
    return { ...full, peers };
  }
  if (!isExactSemver(base)) {
    return {
      unresolved: descriptor ? `invalid descriptor version ${value}` : value,
    };
  }
  return {
    packageName:
      aliasNameFromSpecifier(descriptor?.specifier) ?? dependencyName,
    version: base,
    peers,
  };
}

function dependencyEdges(record: unknown) {
  const mapping = requiredYamlRecord(record, 'pnpm lockfile dependency record');
  const edges: Array<{ dependencyName: string; descriptor: unknown }> = [];
  for (const blockName of dependencyBlocks) {
    const dependencies = mapping[blockName];
    if (dependencies === undefined) {
      continue;
    }
    for (const [dependencyName, descriptor] of sortedEntries(dependencies)) {
      edges.push({ dependencyName, descriptor });
    }
  }
  return edges;
}

export function discoverReachablePnpmLockReleaseAgeClosure(
  lockfile: unknown,
): PnpmLockReleaseAgeClosure {
  const lock = requiredYamlRecord(lockfile, 'pnpm lockfile');
  if (
    typeof lock.lockfileVersion !== 'string' &&
    typeof lock.lockfileVersion !== 'number'
  ) {
    throw new Error('pnpm lockfileVersion is missing.');
  }
  const importers = requiredYamlRecord(
    lock.importers,
    'pnpm lockfile importers',
  );
  const packages = requiredYamlRecord(lock.packages, 'pnpm lockfile packages');
  const snapshots = requiredYamlRecord(
    lock.snapshots,
    'pnpm lockfile snapshots',
  );

  const packageRecords = new Map(sortedEntries(packages));
  const snapshotRecords = new Map(sortedEntries(snapshots));
  const packageRecordsByIdentity = new Map<string, Array<[string, unknown]>>();
  for (const [packageKey, packageRecord] of packageRecords) {
    const identity = parsePackageKey(packageKey);
    if (!identity) {
      continue;
    }
    const key = packageVersionKey(identity);
    packageRecordsByIdentity.set(key, [
      ...(packageRecordsByIdentity.get(key) ?? []),
      [packageKey, packageRecord],
    ]);
  }

  const nodes = new Map<
    string,
    {
      identity: PnpmLockIdentity;
      packageRecords: unknown[];
      snapshotRecord: unknown;
    }
  >();
  const nodeIdsByIdentity = new Map<string, string[]>();
  for (const nodeId of [...snapshotRecords.keys()].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const identity = parsePackageKey(nodeId);
    if (!identity) {
      continue;
    }
    const key = packageVersionKey(identity);
    nodes.set(nodeId, {
      identity,
      packageRecords: (packageRecordsByIdentity.get(key) ?? []).map(
        ([, record]) => record,
      ),
      snapshotRecord: snapshotRecords.get(nodeId),
    });
    nodeIdsByIdentity.set(key, [...(nodeIdsByIdentity.get(key) ?? []), nodeId]);
  }

  const unresolved: PnpmLockReleaseAgeClosure['unresolved'] = [];
  const shortestNodePaths = new Map<string, string[]>();
  const queue: string[] = [];
  const recordUnresolved = (
    identity: PnpmLockIdentity | undefined,
    path: string[],
    reason: string,
  ) => {
    unresolved.push({
      package: identity ? packageVersionKey(identity) : undefined,
      path,
      reason,
    });
  };
  const enqueueIdentity = (identity: PnpmLockIdentity, path: string[]) => {
    const key = packageVersionKey(identity);
    const targetNodeIds = nodeIdsByIdentity.get(key);
    if (!targetNodeIds?.length) {
      recordUnresolved(identity, [...path, key], 'missing lock snapshot');
      return;
    }
    for (const nodeId of targetNodeIds) {
      const nextPath = [...path, key];
      const currentPath = shortestNodePaths.get(nodeId);
      if (currentPath && currentPath.length <= nextPath.length) {
        continue;
      }
      shortestNodePaths.set(nodeId, nextPath);
      queue.push(nodeId);
    }
  };

  for (const [importerName, importer] of sortedEntries(importers)) {
    for (const edge of dependencyEdges(importer)) {
      const identity = dependencyIdentity(edge.dependencyName, edge.descriptor);
      if (!identity) {
        continue;
      }
      const path = [`importer:${importerName}`];
      if ('unresolved' in identity) {
        recordUnresolved(
          undefined,
          [...path, edge.dependencyName],
          `non-exact dependency locator ${identity.unresolved}`,
        );
        continue;
      }
      enqueueIdentity(identity, path);
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    const node = nodes.get(nodeId) as {
      identity: PnpmLockIdentity;
      packageRecords: unknown[];
      snapshotRecord: unknown;
    };
    const nodePath = shortestNodePaths.get(nodeId) as string[];
    if (node.packageRecords.length === 0) {
      recordUnresolved(node.identity, nodePath, 'missing lock package');
      continue;
    }
    for (const peer of node.identity.peers) {
      enqueueIdentity(peer, nodePath);
    }
    for (const record of [...node.packageRecords, node.snapshotRecord]) {
      for (const edge of dependencyEdges(record)) {
        const identity = dependencyIdentity(
          edge.dependencyName,
          edge.descriptor,
        );
        if (!identity) {
          continue;
        }
        if ('unresolved' in identity) {
          recordUnresolved(
            undefined,
            [...nodePath, edge.dependencyName],
            `non-exact dependency locator ${identity.unresolved}`,
          );
          continue;
        }
        enqueueIdentity(identity, nodePath);
      }
    }
  }

  const shortestIdentityPaths = new Map<string, string[]>();
  for (const [nodeId, nodePath] of shortestNodePaths) {
    const node = nodes.get(nodeId) as { identity: PnpmLockIdentity };
    const key = packageVersionKey(node.identity);
    const currentPath = shortestIdentityPaths.get(key);
    if (!currentPath || nodePath.length < currentPath.length) {
      shortestIdentityPaths.set(key, nodePath);
    }
  }

  const candidates = [...shortestIdentityPaths.entries()]
    .map(([key, path]) => {
      const [packageName, version] = [
        key.slice(0, key.lastIndexOf('@')),
        key.slice(key.lastIndexOf('@') + 1),
      ];
      const packageRecordsForIdentity = packageRecordsByIdentity.get(key);
      if (!packageRecordsForIdentity?.length) {
        recordUnresolved(
          { packageName, version, peers: [] },
          path,
          'missing exact SHA-512 lock integrity',
        );
        return undefined;
      }
      let integrity: string | undefined;
      for (const [packageKey, packageRecord] of packageRecordsForIdentity) {
        const resolution = requiredYamlRecord(
          requiredYamlRecord(
            packageRecord,
            `pnpm lockfile package ${packageKey}`,
          ).resolution,
          `pnpm lockfile package ${packageKey} resolution`,
        );
        if (
          typeof resolution.integrity !== 'string' ||
          !integrityPattern.test(resolution.integrity)
        ) {
          throw new Error(
            `pnpm lockfile package ${packageKey} has uncertain registry integrity.`,
          );
        }
        if (integrity && integrity !== resolution.integrity) {
          throw new Error(
            `pnpm lockfile has conflicting registry integrity for ${key}.`,
          );
        }
        integrity = resolution.integrity;
      }
      return {
        packageName,
        version,
        registry: { dist: { integrity: integrity as string } },
        path,
      };
    })
    .filter((candidate): candidate is PnpmLockReleaseAgeCandidate =>
      Boolean(candidate),
    )
    .sort((left, right) =>
      packageVersionKey(left).localeCompare(packageVersionKey(right)),
    );

  unresolved.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
  return { candidates, unresolved };
}

export function parsePnpmWorkspaceYaml(
  source: string,
  filename = 'pnpm-workspace.yaml',
) {
  let document: unknown;
  try {
    document = yaml.load(source, { filename });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot migrate malformed ${filename}: ${message}`);
  }

  if (!isYamlRecord(document)) {
    throw new Error(`Cannot migrate ${filename}: root must be a YAML mapping.`);
  }

  return {
    document,
    lineEnding: source.includes('\r\n') ? '\r\n' : '\n',
  };
}

export function stringifyPnpmWorkspaceYaml(
  document: PnpmWorkspaceYaml,
  lineEnding = '\n',
) {
  const rendered = yaml.dump(document, {
    noCompatMode: true,
    noRefs: true,
    lineWidth: -1,
    quotingType: "'",
  });
  return lineEnding === '\n' ? rendered : rendered.replaceAll('\n', lineEnding);
}
