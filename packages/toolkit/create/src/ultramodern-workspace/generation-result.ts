import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appHasApi, ULTRAMODERN_CONFIG_PATH } from './descriptors';
import { normalizePath, packageName } from './naming';
import type {
  ResolvedPackageSource,
  UltramodernGeneratedAppDescriptor,
  UltramodernGenerationOperation,
  UltramodernGenerationResult,
  UltramodernGenerationWarning,
  WorkspaceApp,
} from './types';

const ignoredSnapshotDirectories = new Set([
  '.git',
  '.nx',
  '.output',
  'coverage',
  'dist',
  'node_modules',
]);

type FileSnapshot = Map<string, string>;

export function createFileSnapshot(root: string): FileSnapshot {
  const files: FileSnapshot = new Map();

  if (!fs.existsSync(root)) {
    return files;
  }

  function collect(currentDir: string) {
    for (const entry of fs
      .readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && ignoredSnapshotDirectories.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        collect(entryPath);
      } else if (entry.isFile()) {
        const relativePath = normalizePath(path.relative(root, entryPath));
        files.set(relativePath, hashFile(entryPath));
      }
    }
  }

  collect(root);
  return files;
}

export function diffFileSnapshots(
  before: FileSnapshot,
  after: FileSnapshot,
): Pick<UltramodernGenerationResult, 'createdPaths' | 'rewrittenPaths'> {
  const createdPaths: string[] = [];
  const rewrittenPaths: string[] = [];

  for (const [relativePath, hash] of after) {
    const previousHash = before.get(relativePath);
    if (previousHash === undefined) {
      createdPaths.push(relativePath);
    } else if (previousHash !== hash) {
      rewrittenPaths.push(relativePath);
    }
  }

  return {
    createdPaths: createdPaths.sort(),
    rewrittenPaths: rewrittenPaths.sort(),
  };
}

export function createGenerationResult(options: {
  operation: UltramodernGenerationOperation;
  workspaceRoot: string;
  packageScope: string;
  packageSource: ResolvedPackageSource;
  createdApps: WorkspaceApp[];
  createdPaths: string[];
  rewrittenPaths: string[];
  warnings?: UltramodernGenerationWarning[];
}): UltramodernGenerationResult {
  const createdApps = options.createdApps.map(app =>
    createGeneratedAppDescriptor(options.packageScope, app),
  );

  return {
    operation: options.operation,
    workspaceRoot: options.workspaceRoot,
    packageScope: options.packageScope,
    packageSource: { ...options.packageSource },
    createdApps,
    createdPaths: [...options.createdPaths].sort(),
    rewrittenPaths: [...options.rewrittenPaths].sort(),
    assignedPorts: Object.fromEntries(
      createdApps.map(app => [app.id, app.port]),
    ),
    moduleFederationNames: Object.fromEntries(
      createdApps.map(app => [app.id, app.moduleFederationName]),
    ),
    apiPrefixes: Object.fromEntries(
      createdApps
        .filter(app => app.apiPrefix)
        .map(app => [app.id, app.apiPrefix as string]),
    ),
    generatedContractPath: ULTRAMODERN_CONFIG_PATH,
    warnings: options.warnings ?? [],
  };
}

function createGeneratedAppDescriptor(
  scope: string,
  app: WorkspaceApp,
): UltramodernGeneratedAppDescriptor {
  return {
    id: app.id,
    directory: app.directory,
    packageName: packageName(scope, app.packageSuffix),
    packageSuffix: app.packageSuffix,
    displayName: app.displayName,
    kind: app.kind,
    portEnv: app.portEnv,
    port: app.port,
    moduleFederationName: app.mfName,
    ...(app.exposes ? { exposes: { ...app.exposes } } : {}),
    ...(appHasApi(app) ? { apiPrefix: app.api.prefix } : {}),
  };
}

function hashFile(filePath: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}
