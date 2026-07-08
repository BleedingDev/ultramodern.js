import fs from 'node:fs';
import path from 'node:path';

function findLockfile(dir) {
  let cur = dir;
  for (;;) {
    const lockfile = path.join(cur, 'pnpm-lock.yaml');
    if (fs.existsSync(lockfile)) return lockfile;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function findInstallRoot(dir, climb = true) {
  if (!climb) {
    return fs.existsSync(path.join(dir, 'node_modules')) ? dir : null;
  }

  let cur = dir;
  let fallback = null;
  for (;;) {
    const nodeModules = path.join(cur, 'node_modules');
    if (fs.existsSync(path.join(nodeModules, '.pnpm'))) return cur;
    if (!fallback && fs.existsSync(nodeModules)) fallback = cur;
    const parent = path.dirname(cur);
    if (parent === cur) return fallback;
    cur = parent;
  }
}

function dirSize(p) {
  let stat;
  try {
    stat = fs.lstatSync(p);
  } catch {
    return 0;
  }
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;

  let total = 0;
  for (const entry of fs.readdirSync(p)) {
    total += dirSize(path.join(p, entry));
  }
  return total;
}

function parseStoreEntry(entry) {
  const cleaned = entry.replace(/[(_].*$/, '');
  if (cleaned.startsWith('@')) {
    const at = cleaned.indexOf('@', 1);
    if (at === -1) return null;
    return {
      name: cleaned.slice(0, at).replace('+', '/'),
      version: cleaned.slice(at + 1),
    };
  }
  const at = cleaned.indexOf('@');
  if (at <= 0) return null;
  return { name: cleaned.slice(0, at), version: cleaned.slice(at + 1) };
}

function measureInstalled(dir) {
  const nodeModules = path.join(dir, 'node_modules');
  if (!fs.existsSync(nodeModules)) return null;

  const store = path.join(nodeModules, '.pnpm');
  const sizes = new Map();

  if (fs.existsSync(store)) {
    for (const entry of fs.readdirSync(store)) {
      const parsed = parseStoreEntry(entry);
      if (!parsed) continue;
      const packageDir = path.join(
        store,
        entry,
        'node_modules',
        ...parsed.name.split('/'),
      );
      if (!fs.existsSync(packageDir)) continue;
      sizes.set(
        parsed.name,
        (sizes.get(parsed.name) || 0) + dirSize(packageDir),
      );
    }
  } else {
    for (const entry of fs.readdirSync(nodeModules)) {
      if (entry.startsWith('.')) continue;
      const entryPath = path.join(nodeModules, entry);
      if (entry.startsWith('@')) {
        for (const scoped of fs.readdirSync(entryPath)) {
          sizes.set(
            `${entry}/${scoped}`,
            dirSize(path.join(entryPath, scoped)),
          );
        }
      } else {
        sizes.set(entry, dirSize(entryPath));
      }
    }
  }

  return sizes;
}

function installedSizeReport(dir, top, climb = true) {
  const installRoot = findInstallRoot(dir, climb);
  const installed = installRoot ? measureInstalled(installRoot) : null;
  if (!installed) {
    return {
      installPresent: false,
      installRoot: null,
      totalBytes: null,
      largest: [],
    };
  }

  const entries = [...installed.entries()].sort((a, b) => b[1] - a[1]);
  return {
    installPresent: true,
    installRoot,
    totalBytes: entries.reduce((sum, [, bytes]) => sum + bytes, 0),
    largest: entries.slice(0, top).map(([name, bytes]) => ({ name, bytes })),
    byPackage: Object.fromEntries(installed),
  };
}

const mb = bytes =>
  bytes === null || bytes === undefined
    ? 'N/A'
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

export {
  dirSize,
  findInstallRoot,
  findLockfile,
  installedSizeReport,
  mb,
  measureInstalled,
  parseStoreEntry,
};
