import fs from 'fs';
import nodePath from 'path';

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

export function convertBackendOptions<
  T extends { loadPath?: string; addPath?: string },
>(options: T): T {
  if (!options) {
    return options;
  }
  const converted = { ...options };
  if (converted.loadPath) {
    converted.loadPath = convertPath(converted.loadPath);
  }
  if (converted.addPath) {
    converted.addPath = convertPath(converted.addPath);
  }
  return converted;
}
