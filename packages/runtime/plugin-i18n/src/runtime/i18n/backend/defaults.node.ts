import fs from 'node:fs';
import nodePath from 'node:path';

/**
 * Conventional locales roots, in the same priority order as the CLI plugin's
 * `detectLocalesDirectory` auto-detection (project-root `./locales` first —
 * the upstream convention — then the scaffold's `./config/public/locales`).
 * The fs-backend default must read from the same directory whose existence
 * enabled the backend in the first place.
 */
const CONVENTIONAL_LOCALES_DIRS = [
  './locales',
  './config/public/locales',
] as const;

const isDirectory = (dirPath: string): boolean => {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
};

export const resolveDefaultLocalesDir = (
  cwd: string = process.cwd(),
): string => {
  for (const dir of CONVENTIONAL_LOCALES_DIRS) {
    if (isDirectory(nodePath.resolve(cwd, dir))) {
      return dir;
    }
  }
  return CONVENTIONAL_LOCALES_DIRS[0];
};

export const DEFAULT_I18NEXT_BACKEND_OPTIONS = {
  get loadPath(): string {
    return `${resolveDefaultLocalesDir()}/{{lng}}/{{ns}}.json`;
  },
  get addPath(): string {
    return `${resolveDefaultLocalesDir()}/{{lng}}/{{ns}}.json`;
  },
};

function convertPath(path: string | undefined): string | undefined {
  if (!path) {
    return path;
  }
  // If it's an absolute path (starts with /), convert to relative path
  if (path.startsWith('/')) {
    return `.${path}`;
  }
  return path;
}

interface InternalBackendPathOptions {
  loadPath?: string;
  addPath?: string;
  serverLoadPath?: string;
  serverAddPath?: string;
  serverLoadPaths?: string[];
  serverAddPaths?: string[];
  _detectedLoadPath?: string;
  _detectedAddPath?: string;
}

function shouldUseServerPath(
  currentPath: string | undefined,
  detectedPath: string | undefined,
): boolean {
  return !detectedPath || currentPath === detectedPath;
}

function getResourceBasePath(resourcePath: string): string {
  const markerIndex = resourcePath.indexOf('{{lng}}');
  if (markerIndex < 0) {
    return resourcePath;
  }
  return resourcePath.slice(0, markerIndex).replace(/[\\/]+$/, '');
}

function pathExists(resourcePath: string): boolean {
  try {
    return fs.existsSync(getResourceBasePath(resourcePath));
  } catch {
    return false;
  }
}

function getServerPath(
  pathCandidates: string[] | undefined,
  fallbackPath: string | undefined,
): string | undefined {
  const candidates = Array.from(
    new Set([...(pathCandidates || []), fallbackPath].filter(Boolean)),
  ) as string[];

  return candidates.find(pathExists) || candidates[0];
}

export function convertBackendOptions<T extends InternalBackendPathOptions>(
  options: T,
): T {
  if (!options) {
    return options;
  }
  const converted = { ...options };
  if (
    (converted.serverLoadPath || converted.serverLoadPaths) &&
    shouldUseServerPath(converted.loadPath, converted._detectedLoadPath)
  ) {
    converted.loadPath = getServerPath(
      converted.serverLoadPaths,
      converted.serverLoadPath,
    );
  } else if (converted.loadPath) {
    converted.loadPath = convertPath(converted.loadPath);
  }
  if (
    (converted.serverAddPath || converted.serverAddPaths) &&
    shouldUseServerPath(converted.addPath, converted._detectedAddPath)
  ) {
    converted.addPath = getServerPath(
      converted.serverAddPaths,
      converted.serverAddPath,
    );
  } else if (converted.addPath) {
    converted.addPath = convertPath(converted.addPath);
  }
  delete converted.serverLoadPath;
  delete converted.serverAddPath;
  delete converted.serverLoadPaths;
  delete converted.serverAddPaths;
  delete converted._detectedLoadPath;
  delete converted._detectedAddPath;
  return converted;
}
