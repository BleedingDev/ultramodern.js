// pnpm 12 stores its package-manager graph before the workspace graph.
// Keep this merger dependency-free for the pre-install release-age audit.
export function mergePnpmLockfileDocuments(value) {
  if (!Array.isArray(value)) return value;
  const lockfile = {};
  for (const document of value) {
    if (!document?.lockfileVersion || Array.isArray(document)) {
      throw new Error('Expected pnpm lockfile documents');
    }
    if (
      lockfile.lockfileVersion &&
      lockfile.lockfileVersion !== document.lockfileVersion
    ) {
      throw new Error('Conflicting pnpm lockfile versions');
    }
    const importers = { ...lockfile.importers };
    for (const [name, importer] of Object.entries(document.importers ?? {})) {
      importers[name] = { ...importers[name], ...importer };
    }
    const packages = { ...lockfile.packages, ...document.packages };
    const snapshots = { ...lockfile.snapshots, ...document.snapshots };
    Object.assign(lockfile, document, { importers, packages, snapshots });
  }
  return lockfile;
}
